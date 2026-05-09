require('dotenv').config();
const cron = require('node-cron');
const db = require('./db');
const { callClaude, sendEmail } = require('./index');
const { followupPrompt } = require('./prompts');

console.log('Follow-up scheduler started');

cron.schedule('0 * * * *', async () => {
  console.log('Scheduler running — checking for follow-ups...');

  const now = new Date();

  const leads = db.prepare(`
    SELECT * FROM leads
    WHERE status IN ('contacted', 'replied')
    AND followup_count < 3
  `).all();

  for (const lead of leads) {
    const lastContact = new Date(lead.last_contact);
    const daysSince = (now - lastContact) / (1000 * 60 * 60 * 24);
    const schedule = [1, 3, 5];
    const nextAt = schedule[lead.followup_count];

    if (daysSince >= nextAt) {
      const count = lead.followup_count + 1;

      try {
        const message = await callClaude(followupPrompt(lead.name, count));
        await sendEmail(lead.email, `Checking in`, message);

        db.prepare(`
          UPDATE leads
          SET followup_count=?, last_contact=datetime('now')
          WHERE id=?
        `).run(count, lead.id);

        console.log(`Follow-up #${count} sent to ${lead.name} <${lead.email}>`);
      } catch (err) {
        console.error(`Failed to follow up with ${lead.email}:`, err);
      }
    }
  }
});