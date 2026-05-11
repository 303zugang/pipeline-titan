require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const busboy = require('busboy');
const { pool, initDb } = require('./db');
const { buildSystem, inboundPrompt, followupPrompt, replyPrompt, ACTIVE_PROFILE } = require('./prompts');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

async function callClaude(userPrompt) {
  const msg = await claude.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    system: buildSystem(ACTIVE_PROFILE),
    messages: [{ role: 'user', content: userPrompt }]
  });
  return msg.content[0].text;
}

async function sendEmail(to, subject, body) {
  return resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject,
    text: body
  });
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      const bb = busboy({ headers: req.headers });
      bb.on('field', (name, val) => { fields[name] = val; });
      bb.on('close', () => resolve(fields));
      bb.on('error', reject);
      req.pipe(bb);
    } else {
      resolve(req.body || {});
    }
  });
}

app.post('/lead', async (req, res) => {
  const fields = await parseForm(req);
  console.log('PARSED FIELDS:', JSON.stringify(fields));

  const name = fields.name || fields.Name || '';
  const email = fields.email || fields.Email || '';
  const message = fields.message || fields.Message || '';

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing name, email, or message' });
  }

  await pool.query(
    `INSERT INTO leads (name, email, message, status, last_contact)
     VALUES ($1, $2, $3, 'contacted', NOW())
     ON CONFLICT (email) DO UPDATE SET message=$2, status='contacted', last_contact=NOW()`,
    [name, email, message]
  );

  try {
    const subject = `Re: your inquiry`;
    const aiReply = await callClaude(inboundPrompt(name, message));
    await sendEmail(email, subject, aiReply);

    const leadResult = await pool.query('SELECT id FROM leads WHERE email = $1', [email]);
    const leadId = leadResult.rows[0]?.id;
    await saveTranscript({ leadId, leadEmail: email, direction: 'outbound', emailType: 'initial', subject, body: aiReply });

    console.log(`Responded to new lead: ${name} <${email}>`);
    res.json({ success: true, message: 'Lead captured and response sent' });
  } catch (err) {
    console.error('Error responding to lead:', err);
    res.status(500).json({ error: 'Failed to process lead' });
  }
});

app.post('/reply', async (req, res) => {
  const { from, text } = req.body;
  const email = (from?.match(/<(.+)>/) || [])[1] || from;

  const leadResult = await pool.query('SELECT * FROM leads WHERE email = $1', [email]);
  const lead = leadResult.rows[0];
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    const raw = await callClaude(replyPrompt(lead.name, text));
    let intent = 'interested';
    let reply = raw;

    const intentMatch = raw.match(/INTENT:\s*(\w+)/i);
    const emailMatch = raw.match(/EMAIL:\s*([\s\S]+)/i);

    if (intentMatch) intent = intentMatch[1].toLowerCase();
    if (emailMatch) reply = emailMatch[1].trim();

    const newStatus = intent === 'wrong_person' || intent === 'not_now' ? 'dead' : 'replied';

    await pool.query('UPDATE leads SET status=$1, last_contact=NOW() WHERE email=$2', [newStatus, email]);

    if (newStatus !== 'dead') {
      const subject = `Re: your inquiry`;
      await sendEmail(email, subject, reply);
      await saveTranscript({ leadId: lead.id, leadEmail: email, direction: 'outbound', emailType: 'reply_response', subject, body: reply });
    }

    console.log(`Handled reply from ${email} — intent: ${intent}`);
    res.json({ success: true, intent });
  } catch (err) {
    console.error('Error handling reply:', err);
    res.status(500).json({ error: 'Failed to handle reply' });
  }
});

app.post('/demo', async (req, res) => {
  const fields = await parseForm(req);
  console.log('DEMO FIELDS:', JSON.stringify(fields));

  const name = fields.name || fields.Name || '';
  const email = fields.email || fields.Email || '';
  const message = fields.message || fields.Message || '';

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing name, email, or message' });
  }

  await pool.query(
    `INSERT INTO leads (name, email, message, status, last_contact)
     VALUES ($1, $2, $3, 'demo', NOW())
     ON CONFLICT (email) DO UPDATE SET message=$2, status='demo', last_contact=NOW()`,
    [name, email, message]
  );

  const leadResult = await pool.query('SELECT id FROM leads WHERE email = $1', [email]);
  const leadId = leadResult.rows[0]?.id;

  try {
    const subject = `Re: your inquiry`;
    const aiReply = await callClaude(inboundPrompt(name, message));
    await sendEmail(email, subject, aiReply);
    await saveTranscript({ leadId, leadEmail: email, direction: 'outbound', emailType: 'initial', subject, body: aiReply });
    console.log(`DEMO: Sent instant response to ${name} <${email}>`);
  } catch (err) {
    console.error('DEMO: Error sending instant response:', err);
  }

  setTimeout(async () => {
    try {
      const subject = `Checking in`;
      const followup1 = await callClaude(followupPrompt(name, 1));
      await sendEmail(email, subject, followup1);
      await saveTranscript({ leadId, leadEmail: email, direction: 'outbound', emailType: 'followup_1', subject, body: followup1 });
      console.log(`DEMO: Sent follow-up #1 to ${name} <${email}>`);
    } catch (err) {
      console.error('DEMO: Error sending follow-up #1:', err);
    }
  }, 2 * 60 * 1000);

  setTimeout(async () => {
    try {
      const subject = `One last thought`;
      const followup2 = await callClaude(followupPrompt(name, 2));
      await sendEmail(email, subject, followup2);
      await saveTranscript({ leadId, leadEmail: email, direction: 'outbound', emailType: 'followup_2', subject, body: followup2 });
      console.log(`DEMO: Sent follow-up #2 to ${name} <${email}>`);
    } catch (err) {
      console.error('DEMO: Error sending follow-up #2:', err);
    }
  }, 4 * 60 * 1000);

  res.json({ success: true, message: 'Demo started — watch your inbox' });
});

// Auth middleware
function requireAdminKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Transcript save helper
async function saveTranscript({ leadId, leadEmail, direction, emailType, subject, body }) {
  try {
    await pool.query(
      `INSERT INTO transcripts (lead_id, lead_email, direction, email_type, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, leadEmail, direction, emailType, subject, body]
    );
  } catch (err) {
    console.error('Transcript save error:', err);
  }
}

// ADMIN ROUTES
app.get('/admin/leads', requireAdminKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Admin leads error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/admin/leads/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, objection_type, booked, manual_followup } = req.body;
    await pool.query(
      `UPDATE leads
       SET notes = COALESCE($1, notes),
           objection_type = COALESCE($2, objection_type),
           booked = COALESCE($3, booked),
           manual_followup = COALESCE($4, manual_followup)
       WHERE id = $5`,
      [notes, objection_type, booked, manual_followup, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Lead update error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/admin/transcripts', requireAdminKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.lead_email, t.direction, t.email_type, t.subject, t.body,
             t.sent_at, t.awkward_flag, t.needs_improvement, t.operator_note,
             l.name AS lead_name, l.message AS original_message,
             l.status AS lead_status, l.booked, l.objection_type
      FROM transcripts t
      LEFT JOIN leads l ON l.id = t.lead_id
      ORDER BY t.sent_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Transcripts error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/admin/transcripts/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { awkward_flag, needs_improvement, operator_note } = req.body;
    await pool.query(
      `UPDATE transcripts
       SET awkward_flag = COALESCE($1, awkward_flag),
           needs_improvement = COALESCE($2, needs_improvement),
           operator_note = COALESCE($3, operator_note)
       WHERE id = $4`,
      [awkward_flag, needs_improvement, operator_note, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Transcript update error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/client/dashboard', requireAdminKey, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'demo') AS total_leads,
        COUNT(*) FILTER (WHERE booked = TRUE)    AS booked_meetings,
        COUNT(*) FILTER (WHERE status = 'contacted') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'replied')   AS replied,
        COUNT(*) FILTER (WHERE status = 'dead')      AS not_interested
      FROM leads
    `);
    const recentLeads = await pool.query(`
      SELECT name, email, status, booked, created_at
      FROM leads WHERE status != 'demo'
      ORDER BY created_at DESC LIMIT 10
    `);
    const recentActivity = await pool.query(`
      SELECT t.lead_email, l.name AS lead_name, t.email_type, t.sent_at
      FROM transcripts t
      LEFT JOIN leads l ON l.id = t.lead_id
      WHERE t.direction = 'outbound'
      ORDER BY t.sent_at DESC LIMIT 10
    `);
    res.json({
      stats: stats.rows[0],
      recentLeads: recentLeads.rows,
      recentActivity: recentActivity.rows
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`PipelineTitan running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = { callClaude, sendEmail };