require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const db = require('./db');
const { SYSTEM, inboundPrompt, followupPrompt, replyPrompt } = require('./prompts');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { req.body = JSON.parse(data); } catch(e) {
        const params = new URLSearchParams(data);
        req.body = Object.fromEntries(params);
      }
      next();
    });
  } else next();
});


const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

async function callClaude(userPrompt) {
  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: SYSTEM,
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

app.get('/', (req, res) => {
  res.json({ status: 'PipelineTitan is running' });
});

app.post('/lead', async (req, res) => {
  const name = req.body.name || req.body.Name || req.body['your-name'] || req.body.fullname || '';
const email = req.body.email || req.body.Email || req.body['your-email'] || req.body.emailaddress || '';
const message = req.body.message || req.body.Message || req.body['your-message'] || req.body.comments || '';

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
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  try {
    const raw = await callClaude(replyPrompt(lead.name, text));

    let intent = 'interested';
    let reply = raw;

    const intentMatch = raw.match(/INTENT:\s*(\w+)/i);
    const emailMatch = raw.match(/EMAIL:\s*([\s\S]+)/i);

    if (intentMatch) intent = intentMatch[1].toLowerCase();
    if (emailMatch) reply = emailMatch[1].trim();

    const newStatus =
      intent === 'wrong_person' || intent === 'not_now' ? 'dead' : 'replied';

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

app.get('/leads', (req, res) => {
  const leads = db.prepare(`SELECT * FROM leads ORDER BY created_at DESC`).all();
  res.json(leads);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PipelineTitan running on port ${PORT}`);
});

module.exports = { callClaude, sendEmail };