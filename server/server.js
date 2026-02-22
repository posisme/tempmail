const fs = require('fs');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'backend');
fs.mkdirSync(dataDir, { recursive: true });

// Open (or create) sqlite database
const dbPath = path.join(dataDir, 'postfix.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Failed to open database', err);
  else console.log('Opened sqlite DB at', dbPath);
});

// Create table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS temp_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  temp_email TEXT NOT NULL,
  forward_email TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback for SPA or unknown routes — serve index.html

app.get("/api/listemails", (req, res) => {
  const sql = `SELECT * FROM virtual_aliases`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB query error', err);
      return res.status(500).json({ error: 'Database error' });
    }
    return res.json(rows);
  });
});
// Insert temp email into sqlite
app.post('/api/resurrectemail', (req, res) => {
  const tempEmail = req.body.tempEmail;
  const forwardEmail = req.body.forwardEmail;
  const duration = 24; // hours

  const expiresModifier = `+${duration} hours`;
  const sql = `UPDATE temp_emails SET expires_at = datetime('now', ?) WHERE temp_email = ?`;

  db.run(sql, [expiresModifier, tempEmail], function (err) {
    if (err) {
      console.error('DB update error', err);
      return res.status(500).json({ error: 'Database error' });
    }
    return res.json({ id: this.lastID, email: tempEmail });
  });
});

app.post('/api/maketempmail', (req, res) => {
  
  const tempEmail = req.body.tempEmail || `temp-${Date.now()}@posis.me`;
  const forwardEmail = req.body.forwardEmail || 'drop';
  const duration = 24; // hours

  const expiresModifier = `+${duration} hours`;
  const sql = `INSERT INTO temp_emails (temp_email, forward_email, expires_at)
    VALUES (?, ?, datetime('now', ?))`;

  db.run(sql, [tempEmail, forwardEmail, expiresModifier], function (err) {
    if (err) {
      console.error('DB insert error', err);
      return res.status(500).json({ error: 'Database error' });
    }
    return res.json({ id: this.lastID, email: tempEmail });
  });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
