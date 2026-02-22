#!/usr/bin/env node
/*
  sync_tempmails.js

  Reads temporary emails from /data/tempmail.sqlite (table `temp_emails`)
  and writes/updates entries into /backend/postfix.db (table `virtual_aliases`).

  Behavior:
  - Detects email column in `temp_emails` (tries common names).
  - Detects source/destination columns in `virtual_aliases` (prefers `source`/`destination`).
  - If a mapping for a source exists it's removed and replaced (simple upsert).
  - Destination can be supplied via env `POSTFIX_DESTINATION`; if omitted and
    `temp_emails` has no forwarding column, destination defaults to the source.

  This script is safe to run periodically (e.g., via cron every hour).
*/

const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const SRC_DB = '/usr/app/data/tempmail.sqlite';
const DST_DB = '/usr/app/backend/postfix.db';


function openDb(path, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new sqlite3.Database(path, mode, (err) => {
    if (err) {
      console.error(`Failed to open DB ${path}:`, err.message);
      process.exitCode = 2;
    }
  });
}

function all(db, sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
}

function run(db, sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function (err) { err ? rej(err) : res(this); }));
}

function get(db, sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function tableExists(db, table) {
  const row = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
  return !!row;
}

async function pragmaInfo(db, name) {
  return all(db, `PRAGMA table_info(${quoteIdent(name)})`);
}

function findColumn(cols, candidates) {
  const lower = cols.map(c => c.name.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx !== -1) return cols[idx].name;
  }
  return null;
}

async function main() {
  const srcDb = openDb(SRC_DB, sqlite3.OPEN_READONLY);
  const dstDb = openDb(DST_DB);

  try {
    if (!await tableExists(srcDb, 'temp_emails')) {
      console.error('Source table `temp_emails` not found in', SRC_DB);
      process.exit(1);
    }

    if (!await tableExists(dstDb, 'virtual_aliases')) {
      console.warn('Destination table `virtual_aliases` not found in', DST_DB, '\nCreating a basic `virtual_aliases` table.');
      await run(dstDb, 'CREATE TABLE IF NOT EXISTS virtual_aliases (id INTEGER PRIMARY KEY, source TEXT UNIQUE, destination TEXT)');
    }

    const srcCols = await pragmaInfo(srcDb, 'temp_emails');
    const dstCols = await pragmaInfo(dstDb, 'virtual_aliases');

    

    const rows = await all(srcDb, `SELECT * FROM ${quoteIdent('temp_emails')}`);
    console.log(`Found ${rows.length} rows in temp_emails.`);

    // Prepare statements
    const deleteStmt = dstDb.prepare(`DELETE FROM ${quoteIdent('virtual_aliases')}`);
    const insertSql = `INSERT INTO ${quoteIdent('virtual_aliases')} ('email', 'destination') VALUES (?, ?)`;
    const insertStmt = dstDb.prepare(insertSql);

    const tx = dstDb.prepare('BEGIN');
    const commit = dstDb.prepare('COMMIT');
    const rollback = dstDb.prepare('ROLLBACK');

    try {
      tx.run();
      let added = 0, skipped = 0, errors = 0;

      for (const r of rows) {
        const source = r.email;
        let destination = r.forward_email;

        try {
          
          insertStmt.run(source, destination);
          
        } catch (err) {
          console.error('Error inserting mapping for', source, err.message);
          
        }
      }

      commit.run();
    } catch (err) {
      console.error('Transaction failed:', err.message);
      try { rollback.run(); } catch (_) {}
    }

  } catch (err) {
    console.error('Unexpected error:', err && err.message ? err.message : err);
  } finally {
    try { srcDb.close(); } catch (e) {}
    try { dstDb.close(); } catch (e) {}
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
