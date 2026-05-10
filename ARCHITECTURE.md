# PipelineTitan — System Architecture
*Last updated: May 10, 2026*

---

## Product Definition

PipelineTitan is an always-on AI SDR (Sales Development Representative) that:
- Responds to inbound leads instantly (under 60 seconds)
- Follows up automatically at Day 1, 3, and 5
- Classifies reply intent and responds appropriately
- Pushes every conversation toward a booked meeting
- Communicates in each client's configured voice and sales style

---

## Live URLs

| Purpose | URL |
|---|---|
| Production website | https://pipelinetitan.com |
| Backend API | https://pipeline-titan-production.up.railway.app |
| Demo form | https://pipelinetitan.com/#demo |
| Carrd fallback | https://pipelinetitan.carrd.co |

---

## Tech Stack

| Layer | Tool | Purpose |
|---|---|---|
| Backend | Node.js + Express | API server, webhook receiver |
| AI Engine | Anthropic Claude API (claude-opus-4-5) | Email generation, intent classification |
| Email Delivery | Resend | Transactional email sending |
| Database | SQLite via better-sqlite3 | Lead storage and status tracking |
| Scheduler | node-cron | Automated follow-up timing |
| Hosting | Railway (Hobby $5/mo) | 24/7 cloud deployment |
| Domain | Namecheap | pipelinetitan.com |
| DNS/Proxy | Cloudflare (via Namecheap CNAME) | Proxied to Railway |
| Landing Page | HTML/CSS served by Express static | Hosted in /public/index.html |
| Email Inbox | Google Workspace | kelly@pipelinetitan.com |
| Booking | Calendly (free) | Meeting scheduling link in all emails |
| Payments | Stripe Payment Links | $750 onboarding, $400/mo, $4,200/yr |
| Form Parser | busboy | Handles Carrd multipart/form-data |

---

## Repository

- GitHub: https://github.com/303zugang/pipeline-titan
- Branch: main
- Auto-deploys to Railway on every push to main

---

## File Structure

```
pipeline-titan/
├── index.js          # Main Express server — all routes and logic
├── prompts.js        # AI voice engine — all email prompts + client profiles
├── db.js             # SQLite database setup and schema
├── scheduler.js      # node-cron follow-up scheduler
├── package.json      # Dependencies and start script
├── .env              # Secret keys (NOT in git)
├── .gitignore        # Excludes .env, node_modules, pipeline.db
└── public/
    └── index.html    # Full landing page (served as static file)
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | / | Serves landing page (static HTML) |
| POST | /lead | Inbound lead capture → instant AI response |
| POST | /demo | Demo mode → 3 emails in 4 minutes |
| POST | /reply | Inbound reply handler → intent classification |
| GET | /leads | View all leads in database (JSON) |

---

## Data Flow — Inbound Lead

```
1. Prospect submits form on pipelinetitan.com
2. POST /lead hits Express server
3. busboy parses multipart form data
4. Lead saved to SQLite (status: 'contacted')
5. inboundPrompt() builds voice-aware prompt
6. Claude API generates personalized email
7. Resend sends email from kelly@pipelinetitan.com
8. Scheduler monitors lead for follow-up timing
```

## Data Flow — Follow-Up Sequence

```
node-cron runs every hour
→ Queries leads WHERE status IN ('contacted','replied') AND followup_count < 3
→ Checks daysSince last_contact against schedule [1, 3, 5]
→ If due: generates follow-up via followupPrompt()
→ Sends email via Resend
→ Updates followup_count and last_contact in SQLite
```

## Data Flow — Reply Handling

```
1. Prospect replies to email
2. POST /reply receives webhook from Resend
3. Lead looked up by email address
4. replyPrompt() classifies intent + generates response
5. Intent mapped to status update:
   - interested/question → 'replied'
   - not_now/wrong_person → 'dead'
6. Response email sent if status != 'dead'
```

---

## Database Schema

```sql
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  message TEXT,
  status TEXT DEFAULT 'new',        -- new | contacted | replied | booked | dead | demo
  followup_count INTEGER DEFAULT 0, -- 0, 1, 2, or 3
  last_contact TEXT,                -- datetime of last outbound email
  created_at TEXT DEFAULT (datetime('now'))
)
```

---

## Lead Status Flow

```
new → contacted → replied → booked
                          → dead (not_now or wrong_person)
demo (separate track, does not enter follow-up sequence)
```

---

## Email Sending Configuration

- **From address:** kelly@pipelinetitan.com
- **Public-facing address:** discover@pipelinetitan.com (shown on landing page)
- **Domain verified in Resend:** pipelinetitan.com (DKIM, SPF, MX all verified)
- **Reply-to webhook:** /reply endpoint (not yet fully configured in Resend)

---

## Client Voice System (prompts.js)

Each client gets a `clientProfile` object with:

```javascript
{
  companyName, industry, idealCustomer,
  brandVoice, toneStyle, salesStyle,
  callToActionStyle, keyDifferentiators,
  commonObjections, wordsToAvoid,
  calendlyLink
}
```

`ACTIVE_PROFILE` at the top of prompts.js controls which client's voice is active.
`buildSystem(profile)` injects the profile into Claude's system prompt.
All three email functions accept `profile` as a parameter for future multi-tenant use.

---

## Environment Variables (Railway + .env)

```
ANTHROPIC_API_KEY     Claude API key
RESEND_API_KEY        Resend sending key
CALENDLY_LINK         Default booking link
FROM_EMAIL            kelly@pipelinetitan.com
PORT                  3000
```

---

## Monthly Costs

| Service | Cost |
|---|---|
| Railway Hobby | $5/mo |
| Google Workspace | $6/mo |
| Resend | Free (3,000 emails/mo) |
| Anthropic API | ~$3–15/mo usage |
| Carrd Pro | $49/yr (~$4/mo) |
| Namecheap domain | ~$12/yr (~$1/mo) |
| **Total** | **~$20–30/mo** |

---

## Stripe Payment Links

| Product | Price | Link |
|---|---|---|
| Configuration & Onboarding | $750 one-time | buy.stripe.com/fZu9AT0tieA7fwe77R1Fe04 |
| Monthly service | $400/mo | buy.stripe.com/9B65kD2BqeA73Nwbo71Fe03 |
| Annual service | $4,200/yr | buy.stripe.com/aFa00j0ti77F0Bk77R1Fe02 |
