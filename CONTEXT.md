# PipelineTitan — Project Context
*Last updated: May 10, 2026*
*Upload this file to every new Claude Project chat to restore full context.*

---

## Who We Are

**PipelineTitan** is an always-on AI SDR product built by Kelly Peterson (founder).
Kelly is the visionary and operator. Claude acts as CTO/system engineer.
Kelly is not a developer — all implementation is done by Claude with Kelly as hands.

**Mission:** Help businesses never miss a lead again by responding instantly, following up automatically, and booking meetings — 24/7.

**Strategic moat:** PipelineTitan learns and communicates in each client's company voice while qualifying and converting leads automatically. This is not template personalization — it is a client voice onboarding system.

---

## What Is Built and Live

Everything below is production-deployed and working as of May 10, 2026.

| Component | Status | Notes |
|---|---|---|
| Backend API | ✅ Live | Railway, Node/Express |
| Landing page | ✅ Live | pipelinetitan.com |
| Lead capture form | ✅ Live | Wired to /lead endpoint |
| Instant AI response | ✅ Live | Claude generates email in real time |
| Follow-up scheduler | ✅ Live | Day 1, 3, 5 automatic |
| Demo mode | ✅ Live | 3 emails in 4 minutes |
| Client voice system | ✅ Live | prompts.js with clientProfile |
| Email domain | ✅ Verified | pipelinetitan.com via Resend |
| Google Workspace | ✅ Live | kelly@pipelinetitan.com |
| Stripe payments | ✅ Live | 3 payment links active |
| Reply handler | ✅ Code exists | Resend inbound webhook NOT configured yet |

---

## Key People & Accounts

| Account | Details |
|---|---|
| GitHub | 303zugang/pipeline-titan |
| Railway | zippy-unity project, pipeline-titan service |
| Resend | jkellypeterson@gmail.com |
| Anthropic | console.anthropic.com |
| Namecheap | pipelinetitan.com domain |
| Carrd | pipelinetitan.carrd.co (backup) |
| Google Workspace | kelly@pipelinetitan.com |
| Stripe | 3 active payment links |
| Calendly | jkellypeterson/30min |

---

## Pricing Model

- **Configuration & Onboarding:** $750 one-time (all clients pay this)
- **Monthly:** $400/mo (after onboarding)
- **Annual:** $4,200/yr ($350/mo pre-paid, 12.5% discount)
- **Performance:** +10% on PipelineTitan-sourced revenue opportunities

---

## Architecture Summary

```
pipelinetitan.com (Namecheap → Cloudflare → Railway)
    ↓
Express server (index.js) on Railway
    ├── GET  /          → serves public/index.html (landing page)
    ├── POST /lead      → capture lead → Claude → Resend → email
    ├── POST /demo      → same as /lead but 2min/4min timing
    ├── POST /reply     → classify intent → Claude → Resend
    └── GET  /leads     → raw lead data (NO AUTH — tech debt)
    
node-cron (scheduler.js) runs hourly
    → finds leads needing follow-up
    → generates follow-up via Claude
    → sends via Resend
    → updates DB

SQLite (pipeline.db) — WARNING: resets on Railway redeploy (tech debt)
```

---

## Key Files

| File | Purpose |
|---|---|
| `index.js` | Main server — all routes, Claude calls, email sending |
| `prompts.js` | Voice engine — all prompts + clientProfile system |
| `db.js` | SQLite schema and connection |
| `scheduler.js` | Automated follow-up cron job |
| `public/index.html` | Full landing page |
| `.env` | Secret keys (not in git) |

---

## The Client Voice System

`prompts.js` contains a `clientProfile` object for each client.
`ACTIVE_PROFILE` at the top of the file controls which voice is active.
`buildSystem(profile)` injects the profile into Claude's system prompt.

**To tune a client's voice:** edit their profile object in `prompts.js`.
**To onboard a new client:** duplicate a profile, fill their details, update `ACTIVE_PROFILE`.
**Future state:** multi-tenant — profile selected per-request based on clientId.

Current profiles:
- `PIPELINETITAN_PROFILE` — our own system (active)
- `HOME_SERVICES_PROFILE` — example for home services client

---

## Critical Tech Debt (fix before scaling)

1. **Resend inbound webhook not configured** — reply handling non-functional in prod
2. **SQLite resets on Railway redeploy** — migrate to Postgres before any real clients
3. **No auth on /leads endpoint** — anyone can see lead data
4. **ACTIVE_PROFILE is hardcoded** — multi-tenant not yet implemented
5. **FROM_EMAIL vs discover@ mismatch** — minor brand confusion

Full list in TECH_DEBT.md.

---

## Decisions Made & Why

| Decision | Reason |
|---|---|
| Node.js over Python | Faster to deploy, better Railway support |
| SQLite over Postgres | Speed to launch — must migrate before scaling |
| Resend over SendGrid | Simpler API, better free tier, great deliverability |
| Railway over Heroku/Render | Fast deploys, simple env var management |
| busboy for form parsing | Carrd sends multipart/form-data, not JSON |
| Static HTML over React | Carrd-like simplicity, no build step, easy updates |
| clientProfile in prompts.js | Keeps voice config co-located with prompts, easy to find |
| Stripe Payment Links over custom checkout | Zero code, instant, battle-tested |

---

## Next Features (not yet built)

In priority order based on business value:

1. Fix Resend inbound webhook → reply handling works in prod
2. Migrate SQLite → Postgres → data persists across deploys
3. Add /leads auth → security baseline
4. Multi-tenant profile switching → serve different clients
5. Lead dashboard → Kelly can see pipeline status
6. Client onboarding flow → new clients configure their own voice
7. Booked meeting detection → stop follow-ups when Calendly fires

---

## How to Start a New Feature Chat

1. Upload ARCHITECTURE.md, TECH_DEBT.md, and CONTEXT.md to the Project
2. Start the chat with: "You are CTO/operator for PipelineTitan. Read the uploaded context files and confirm you understand the current system before we begin."
3. State the feature or fix you want to build.
4. Claude will implement without rebuilding what exists.

---

## Guiding Principles

- No over-engineering. Every decision must pass: "Does this help capture a lead and book a meeting?"
- No dashboards, RAG, vector storage, or agent frameworks until the core is proven.
- Keep it simple. Get to first booked meeting fast. Then iterate.
- Kelly is the hands. Claude is the engineer. Surgical instructions only.
