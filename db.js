const Database = require('better-sqlite3');
const db = new Database('pipeline.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    message TEXT,
    status TEXT DEFAULT 'new',
    followup_count INTEGER DEFAULT 0,
    last_contact TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

console.log('Database ready');

module.exports = db;
