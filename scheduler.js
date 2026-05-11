require('dotenv').config();
const cron = require('node-cron');
const { pool } = require('./db');
const { callClaude, sendEmail } = require('./index');
const { followupPrompt } = require('./prompts');

console.log('Follow-up scheduler started');

cron.schedule('0 * * * *', async () => {
  console.log('Scheduler running — checking for follow-ups...');

  const now = new Date();

  const result = await pool.query(`
    SELECT * FROM leads
    WHERE status IN ('contacted', 'replied')
    AND followup_count < 3
  `);
  const leads = result.rows;

  for (const lead of leads) {
    const lastContact = new Date(lead.last_contact);
    const daysSince = (now - lastContact) / (1000 * 60 * 60 * 24);
    const schedule = [1, 3, 5];
    const nextAt = schedule[lead.followup_count];

    if (daysSince >= nextAt) {
      const count = lead.followup_count + 1;
      const emailTypes = ['followup_1', 'followup_2', 'followup_3'];
      const subjects = ['Checking in', 'Checking in', 'One last thought'];
      const subject = subjects[count - 1] || 'Checking in';
      const emailType = emailTypes[count - 1] || 'followup_1';

      try {
        const message = await callClaude(followupPrompt(lead.name, count));
        await sendEmail(lead.email, subject, message);

        await pool.query(
          `UPDATE leads SET followup_count=$1, last_contact=NOW() WHERE id=$2`,
          [count, lead.id]
        );

        await pool.query(
          `INSERT INTO transcripts (lead_id, lead_email, direction, email_type, subject, body)
           VALUES ($1, $2, 'outbound', $3, $4, $5)`,
          [lead.id, lead.email, emailType, subject, message]
        );

        console.log(`Follow-up #${count} sent to ${lead.name} <${lead.email}>`);
      } catch (err) {
        console.error(`Failed to follow up with ${lead.email}:`, err);
      }
    }
  }
});