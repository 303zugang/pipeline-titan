require('dotenv').config();

const CALENDLY = process.env.CALENDLY_LINK;

const SYSTEM = `You are a sharp, helpful sales development rep named Kelly at PipelineTitan. 
You write short, human emails — no fluff, no corporate speak, no bullet points. 
Every message has one goal: get the prospect on a quick call. 
Keep responses under 100 words. Sound like a real person, not a robot.`;

function inboundPrompt(name, message) {
  return `A new lead just filled out our contact form. Write a warm, direct reply that:
- Acknowledges what they said
- Shows we understand their problem
- Invites them to a quick 20-minute call
- Ends with our booking link naturally in the message

Lead name: ${name}
Their message: ${message}
Booking link: ${CALENDLY}

Write the email body only. No subject line. No sign-off name needed.`;
}

function followupPrompt(name, count) {
  const angles = [
    `This is follow-up #1. Be casual and friendly — just checking if they saw your last note. Keep it to 2-3 sentences.`,
    `This is follow-up #2. Be a little more direct — mention that you have a specific idea for their situation and want 20 minutes to share it. Create mild urgency.`,
    `This is follow-up #3. This is the last message. Keep it very short — 2 sentences max. Give them an easy out but leave the door open warmly.`
  ];

  return `Write a short follow-up email to ${name}. ${angles[count - 1]}
End naturally with the booking link: ${CALENDLY}
Write email body only. No subject line.`;
}

function replyPrompt(name, replyText) {
  return `A prospect replied to our outreach. 

First, classify their intent as exactly one of these:
- interested
- question  
- objection
- not_now
- wrong_person

Then write a short, human response that moves them toward booking a call.
If they are interested: great, make it easy to book.
If they have a question: answer it briefly, then invite them to a call for more.
If they have an objection: acknowledge it, reframe gently, invite a call.
If not now: be gracious, ask when to follow up.
If wrong person: ask who the right person is.

Always include the booking link: ${CALENDLY}

Prospect name: ${name}
Their reply: "${replyText}"

Respond in this exact format:
INTENT: [one word from the list above]
EMAIL: [your email response]`;
}

module.exports = { SYSTEM, inboundPrompt, followupPrompt, replyPrompt };