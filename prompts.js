// ============================================================
// prompts.js — PipelineTitan Email Voice Engine
// ============================================================
// This file controls how PipelineTitan writes every email.
// Each client gets a clientProfile that teaches Claude how to
// sound, sell, and follow up in that company's voice.
//
// TO TUNE A CLIENT'S VOICE: edit their clientProfile object.
// TO ADD A NEW CLIENT: duplicate a profile, change the fields,
// and pass it into the prompt functions from index.js.
// ============================================================

require('dotenv').config();

// ============================================================
// CLIENT PROFILES
// Each client deployed on PipelineTitan gets their own profile.
// This is the core of the voice onboarding system.
// ============================================================

// --- DEFAULT PROFILE: PipelineTitan (our own system) ---
const PIPELINETITAN_PROFILE = {
  companyName: 'PipelineTitan',
  industry: 'B2B SaaS / Sales Automation',
  idealCustomer: 'Small and mid-size businesses with inbound leads who struggle to respond fast enough or follow up consistently',
  brandVoice: 'Clear, confident, and helpful. We sound like a sharp colleague, not a vendor.',
  toneStyle: 'Business casual — warm but direct. No fluff.',
  salesStyle: 'Consultative but direct. We ask questions, show we understand the problem, and make it easy to take the next step.',
  callToActionStyle: 'Invite a short 20-minute intro call. Low pressure, high value framing.',
  keyDifferentiators: [
    'Responds to every lead in under 60 seconds',
    'Follows up automatically at Day 1, 3, and 5',
    'Learns and communicates in your company\'s voice',
    'Books meetings directly to your calendar',
  ],
  commonObjections: [
    'We already have a CRM',
    'We don\'t have enough leads to justify it',
    'We\'re worried it will sound robotic',
  ],
  wordsToAvoid: ['game changer', 'revolutionary', 'synergy', 'leverage', 'circle back', 'touch base'],
  calendlyLink: process.env.CALENDLY_LINK,
};

// --- EXAMPLE PROFILE: Home Services Client ---
// Use this as a template when onboarding a home services business.
const HOME_SERVICES_PROFILE = {
  companyName: 'Apex Home Solutions',
  industry: 'Home Services / Residential Contracting',
  idealCustomer: 'Homeowners in the Denver metro area looking for roofing, HVAC, or general contracting services',
  brandVoice: 'Friendly, trustworthy, and straightforward. We sound like a neighbor who happens to be an expert.',
  toneStyle: 'Conversational and warm. Like a text from a trusted local contractor.',
  salesStyle: 'Relationship-first. We lead with empathy, ask about their project, and offer a free on-site estimate.',
  callToActionStyle: 'Offer a free, no-obligation estimate. Make it feel easy and local.',
  keyDifferentiators: [
    'Local Denver team with 15+ years experience',
    'Licensed, bonded, and insured',
    'Free on-site estimates with same-week availability',
    'Financing options available',
  ],
  commonObjections: [
    'I need to get a few quotes first',
    'I\'m not sure of my budget yet',
    'I had a bad experience with a contractor before',
  ],
  wordsToAvoid: ['utilize', 'leverage', 'synergy', 'world-class', 'best-in-class'],
  calendlyLink: 'https://calendly.com/apexhomesolutions/estimate',
};

// ============================================================
// ACTIVE PROFILE SELECTOR
// Change this line to switch which client profile is active.
// In a multi-tenant build, this will be passed in per-request.
// ============================================================
const ACTIVE_PROFILE = PIPELINETITAN_PROFILE;

// ============================================================
// SYSTEM PROMPT
// Sets Claude's role and ground rules for every email.
// Injected with the active client's voice settings.
// ============================================================
function buildSystem(profile) {
  return `You are an AI sales development rep working on behalf of ${profile.companyName}.

Your job is to write short, human emails that move prospects toward booking a call.

VOICE & TONE:
- Brand voice: ${profile.brandVoice}
- Tone style: ${profile.toneStyle}
- Sales style: ${profile.salesStyle}

RULES:
- Write under 120 words per email. Shorter is almost always better.
- Never use bullet points in emails.
- Never sound like a robot or a template.
- Never use these words or phrases: ${profile.wordsToAvoid.join(', ')}.
- Always end with a natural call to action: ${profile.callToActionStyle}.
- Write email body only. No subject line. No sign-off name.
- Sound like a real person who genuinely wants to help.`;
}

// ============================================================
// EMAIL 1 — INSTANT RESPONSE
// Triggered immediately when a lead submits the form.
// Goal: acknowledge their message, show understanding, invite a call.
// TUNE: adjust callToActionStyle and salesStyle in clientProfile.
// ============================================================
function inboundPrompt(name, message, profile = ACTIVE_PROFILE) {
  return `A new lead just reached out to ${profile.companyName}. Write a warm, direct reply.

WHO WE HELP:
${profile.idealCustomer}

WHAT MAKES US DIFFERENT:
${profile.keyDifferentiators.join('\n')}

LEAD NAME: ${name}
THEIR MESSAGE: "${message}"

YOUR TASK:
- Acknowledge what they said specifically — show you actually read it.
- Connect their situation to what ${profile.companyName} does.
- Invite them to a call using this link naturally: ${profile.calendlyLink}

Do not be generic. Do not over-explain. Be the response they didn't expect to get so fast.`;
}

// ============================================================
// EMAIL 2 — FOLLOW-UP #1 (Day 1 real / 2 min demo)
// Triggered if no reply after Day 1.
// Goal: casual check-in, bring the thread back to the top.
// TUNE: adjust toneStyle in clientProfile for warmer/cooler feel.
// ============================================================
function followupPrompt(name, count, profile = ACTIVE_PROFILE) {
  const angles = [

    // Follow-up #1: casual, low pressure, just checking in
    `Write a casual, friendly follow-up to ${name}. Keep it to 2-3 sentences.
Just checking if they had a chance to see your last note.
Tone: ${profile.toneStyle}. Don't be pushy — be human.
End naturally with the booking link: ${profile.calendlyLink}`,

    // Follow-up #2: add a little value, create mild urgency
    `Write a follow-up to ${name} that adds a little more context.
Mention one thing that makes ${profile.companyName} worth 20 minutes of their time:
${profile.keyDifferentiators[0]}.
Tone: ${profile.toneStyle}. Create mild urgency without pressure.
End with the booking link: ${profile.calendlyLink}`,

    // Follow-up #3: short, final, leave door open
    `Write a very short final follow-up to ${name}. Two sentences maximum.
Be gracious — give them an easy out but leave the door open warmly.
Tone: ${profile.toneStyle}.
End with the booking link: ${profile.calendlyLink}`,
  ];

  return `${angles[count - 1]}

Write email body only. No subject line.`;
}

// ============================================================
// REPLY HANDLER — INTENT CLASSIFICATION + RESPONSE
// Triggered when a prospect replies to any email.
// Goal: read their intent, respond appropriately, keep moving toward booking.
// TUNE: adjust commonObjections in clientProfile to handle specific pushback.
// ============================================================
function replyPrompt(name, replyText, profile = ACTIVE_PROFILE) {
  return `A prospect replied to outreach from ${profile.companyName}.

CLASSIFY their intent as exactly one of:
- interested
- question
- objection
- not_now
- wrong_person

COMMON OBJECTIONS WE HEAR (handle these with empathy):
${profile.commonObjections.map((o, i) => `${i + 1}. "${o}"`).join('\n')}

THEN write a short response that moves them toward booking a call.
- If interested: make it easy to book.
- If question: answer briefly, then invite a call for more.
- If objection: acknowledge it, reframe gently using our voice, invite a call.
- If not now: be gracious, ask when to follow up.
- If wrong person: ask who the right person is.

Always include the booking link naturally: ${profile.calendlyLink}
Voice: ${profile.brandVoice}
Tone: ${profile.toneStyle}

PROSPECT NAME: ${name}
THEIR REPLY: "${replyText}"

Respond in this exact format:
INTENT: [one word from the list above]
EMAIL: [your email response — body only, no subject line]`;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  buildSystem,
  inboundPrompt,
  followupPrompt,
  replyPrompt,
  ACTIVE_PROFILE,
  // Export profiles so index.js can switch per client if needed
  PIPELINETITAN_PROFILE,
  HOME_SERVICES_PROFILE,
};