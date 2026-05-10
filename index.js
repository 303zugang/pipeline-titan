require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const busboy = require('busboy');
const db = require('./db');
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

  try {
    db.prepare(`
      INSERT INTO leads (name, email, message, status, last_contact)
      VALUES (?, ?, ?, 'contacted', datetime('now'))
    `).run(name, email, message);
  } catch (e) {
    db.prepare(`
      UPDATE leads SET message=?, status='contacted', last_contact=datetime('now') WHERE email=?
    `).run(message, email);
  }

  try {
    const aiReply = await callClaude(inboundPrompt(name, message));
    await sendEmail(email, `Re: your inquiry`, aiReply);
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

  const lead = db.prepare(`SELECT * FROM leads WHERE email = ?`).get(email);
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

    db.prepare(`
      UPDATE leads SET status=?, last_contact=datetime('now') WHERE email=?
    `).run(newStatus, email);

    if (newStatus !== 'dead') {
      await sendEmail(email, `Re: your inquiry`, reply);
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

  try {
    db.prepare(`
      INSERT INTO leads (name, email, message, status, last_contact)
      VALUES (?, ?, ?, 'demo', datetime('now'))
    `).run(name, email, message);
  } catch (e) {
    db.prepare(`
      UPDATE leads SET message=?, status='demo', last_contact=datetime('now') WHERE email=?
    `).run(message, email);
  }

  try {
    const aiReply = await callClaude(inboundPrompt(name, message));
    await sendEmail(email, `Re: your inquiry`, aiReply);
    console.log(`DEMO: Sent instant response to ${name} <${email}>`);
  } catch (err) {
    console.error('DEMO: Error sending instant response:', err);
  }

  setTimeout(async () => {
    try {
      const followup1 = await callClaude(followupPrompt(name, 1));
      await sendEmail(email, `Checking in`, followup1);
      console.log(`DEMO: Sent follow-up #1 to ${name} <${email}>`);
    } catch (err) {
      console.error('DEMO: Error sending follow-up #1:', err);
    }
  }, 2 * 60 * 1000);

  setTimeout(async () => {
    try {
      const followup2 = await callClaude(followupPrompt(name, 2));
      await sendEmail(email, `One last thought`, followup2);
      console.log(`DEMO: Sent follow-up #2 to ${name} <${email}>`);
    } catch (err) {
      console.error('DEMO: Error sending follow-up #2:', err);
    }
  }, 4 * 60 * 1000);

  res.json({ success: true, message: 'Demo started — watch your inbox' });
});

app.get('/leads', (req, res) => {
  const leads = db.prepare(`SELECT * FROM leads ORDER BY created_at DESC`).all();
  res.json(leads);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PipelineTitan running on port ${PORT}`);
});

module.exports = { callClaude, sendEmail };