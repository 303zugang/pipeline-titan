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

app.get('/admin/transcripts-ui', requireAdminKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.lead_email, t.direction, t.email_type, t.subject, t.body,
             t.sent_at, t.awkward_flag, t.needs_improvement, t.operator_note,
             l.name AS lead_name, l.message AS original_message,
             l.status AS lead_status, l.booked, l.objection_type,
             l.created_at AS lead_created_at, l.id AS lead_id
      FROM transcripts t
      LEFT JOIN leads l ON l.id = t.lead_id
      ORDER BY t.sent_at DESC
    `);

    const rows = result.rows;

    const cards = rows.map(r => {
      const sentAt = r.sent_at ? new Date(r.sent_at).toLocaleString() : '—';
      const leadCreated = r.lead_created_at ? new Date(r.lead_created_at).toLocaleString() : '—';
      const body = (r.body || '').replace(/\n/g, '<br>');
      const original = (r.original_message || '').replace(/\n/g, '<br>');
      const awkward = r.awkward_flag ? 'checked' : '';
      const improvement = r.needs_improvement ? 'checked' : '';
      const booked = r.booked ? 'checked' : '';
      const key = res.req.query.key || '';

      return `
        <div class="card ${r.awkward_flag ? 'flag-awkward' : ''} ${r.needs_improvement ? 'flag-improve' : ''}">
          <div class="card-header">
            <div class="lead-info">
              <span class="lead-name">${r.lead_name || '—'}</span>
              <span class="lead-email">${r.lead_email || '—'}</span>
            </div>
            <div class="meta">
              <span class="badge badge-${r.lead_status}">${r.lead_status || '—'}</span>
              <span class="badge badge-type">${r.email_type || '—'}</span>
              ${r.booked ? '<span class="badge badge-booked">BOOKED</span>' : ''}
              ${r.awkward_flag ? '<span class="badge badge-awkward">⚠ Awkward</span>' : ''}
              ${r.needs_improvement ? '<span class="badge badge-improve">✎ Needs Work</span>' : ''}
            </div>
          </div>

          <div class="timestamps">
            Lead created: ${leadCreated} &nbsp;|&nbsp; Email sent: ${sentAt}
          </div>

          <div class="section-label">Original message from lead</div>
          <div class="original-message">${original}</div>

          <div class="section-label">AI email sent — ${r.subject || '(no subject)'}</div>
          <div class="email-body">${body}</div>

          <form method="POST" action="/admin/transcripts-ui/${r.id}?key=${key}" class="flag-form">
            <div class="form-row">
              <label><input type="checkbox" name="awkward_flag" value="true" ${awkward} onchange="this.form.submit()"> Awkward response</label>
              <label><input type="checkbox" name="needs_improvement" value="true" ${improvement} onchange="this.form.submit()"> Needs prompt improvement</label>
              <label><input type="checkbox" name="booked" value="true" ${booked} onchange="this.form.submit()"> Booked</label>
            </div>
            <div class="form-row">
              <select name="objection_type" onchange="this.form.submit()">
                <option value="">Objection type</option>
                <option value="pricing" ${r.objection_type === 'pricing' ? 'selected' : ''}>Pricing</option>
                <option value="timing" ${r.objection_type === 'timing' ? 'selected' : ''}>Timing</option>
                <option value="not_decision_maker" ${r.objection_type === 'not_decision_maker' ? 'selected' : ''}>Not decision maker</option>
                <option value="not_interested" ${r.objection_type === 'not_interested' ? 'selected' : ''}>Not interested</option>
                <option value="wrong_person" ${r.objection_type === 'wrong_person' ? 'selected' : ''}>Wrong person</option>
                <option value="no_response" ${r.objection_type === 'no_response' ? 'selected' : ''}>No response</option>
              </select>
            </div>
            <div class="form-row notes-row">
              <textarea name="operator_note" placeholder="Operator notes...">${r.operator_note || ''}</textarea>
              <button type="submit">Save note</button>
            </div>
          </form>
        </div>
      `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PipelineTitan — Transcript Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 24px 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; color: #fff; }
    .subtitle { font-size: 13px; color: #666; margin-bottom: 24px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 20px; max-width: 860px; }
    .card.flag-awkward { border-left: 3px solid #e05c5c; }
    .card.flag-improve { border-left: 3px solid #e0a030; }
    .card.flag-awkward.flag-improve { border-left: 3px solid #9b59b6; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .lead-info { display: flex; flex-direction: column; gap: 2px; }
    .lead-name { font-size: 16px; font-weight: 600; color: #fff; }
    .lead-email { font-size: 13px; color: #888; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-contacted { background: #1e3a5f; color: #5ba3e0; }
    .badge-replied { background: #1e4a2a; color: #5be08a; }
    .badge-dead { background: #3a1e1e; color: #e05c5c; }
    .badge-booked { background: #2a4a1e; color: #8be05c; }
    .badge-demo { background: #2a2a1e; color: #e0d05c; }
    .badge-new { background: #2a2a2a; color: #888; }
    .badge-type { background: #222; color: #aaa; }
    .badge-awkward { background: #3a1e1e; color: #e05c5c; }
    .badge-improve { background: #3a2a1e; color: #e0a030; }
    .timestamps { font-size: 12px; color: #555; margin-bottom: 14px; }
    .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin-bottom: 6px; margin-top: 14px; }
    .original-message { font-size: 13px; color: #aaa; background: #141414; border: 1px solid #222; border-radius: 4px; padding: 10px 12px; line-height: 1.6; }
    .email-body { font-size: 14px; color: #ddd; background: #141414; border: 1px solid #2a2a2a; border-radius: 4px; padding: 14px; line-height: 1.7; white-space: pre-wrap; }
    .flag-form { margin-top: 16px; border-top: 1px solid #222; padding-top: 14px; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; }
    .form-row label { font-size: 13px; color: #aaa; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .form-row input[type=checkbox] { width: 14px; height: 14px; cursor: pointer; accent-color: #5ba3e0; }
    .form-row select { background: #111; border: 1px solid #333; color: #ccc; padding: 5px 10px; border-radius: 4px; font-size: 13px; cursor: pointer; }
    .notes-row { align-items: flex-end; }
    textarea { background: #111; border: 1px solid #333; color: #ccc; padding: 8px 10px; border-radius: 4px; font-size: 13px; width: 100%; max-width: 540px; min-height: 60px; resize: vertical; font-family: inherit; }
    button { background: #1e3a5f; color: #5ba3e0; border: 1px solid #2a5a8f; padding: 7px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; }
    button:hover { background: #2a4a7a; }
    .empty { color: #555; font-size: 14px; padding: 40px 0; text-align: center; }
  </style>
</head>
<body>
  <h1>PipelineTitan — Transcript Review</h1>
  <p class="subtitle">${rows.length} email${rows.length !== 1 ? 's' : ''} on record &nbsp;|&nbsp; Internal operator view</p>
  ${rows.length === 0 ? '<div class="empty">No transcripts yet. Send a test lead to generate one.</div>' : cards}
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error('Transcripts UI error:', err);
    res.status(500).send('Internal error');
  }
});

app.post('/admin/transcripts-ui/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const key = req.query.key || '';
    const { awkward_flag, needs_improvement, booked, objection_type, operator_note } = req.b

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