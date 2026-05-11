const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id              SERIAL PRIMARY KEY,
      name            TEXT,
      email           TEXT UNIQUE,
      message         TEXT,
      status          TEXT DEFAULT 'new',
      followup_count  INTEGER DEFAULT 0,
      last_contact    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      notes           TEXT,
      objection_type  TEXT,
      booked          BOOLEAN DEFAULT FALSE,
      manual_followup BOOLEAN DEFAULT FALSE,
      client_id       TEXT DEFAULT 'pipelinetitan'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id                SERIAL PRIMARY KEY,
      lead_id           INTEGER REFERENCES leads(id),
      lead_email        TEXT,
      direction         TEXT,
      email_type        TEXT,
      subject           TEXT,
      body              TEXT,
      sent_at           TIMESTAMPTZ DEFAULT NOW(),
      awkward_flag      BOOLEAN DEFAULT FALSE,
      needs_improvement BOOLEAN DEFAULT FALSE,
      operator_note     TEXT
    )
  `);

  console.log('Database ready');
}

module.exports = { pool, initDb };