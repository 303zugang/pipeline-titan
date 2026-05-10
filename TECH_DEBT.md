# PipelineTitan — Tech Debt & Known Issues
*Last updated: May 10, 2026*

---

## Priority Guide
- 🔴 **High** — Will cause problems soon. Fix before scaling.
- 🟡 **Medium** — Important but not urgent. Fix before selling to clients.
- 🟢 **Low** — Nice to have. Address when capacity allows.

---

## 🔴 High Priority

### 1. Resend Inbound Webhook Not Configured
**What:** The `/reply` endpoint exists and works, but Resend's inbound email webhook is not pointed at it. Prospect replies are not currently being received and processed automatically.
**Impact:** Reply handling is non-functional in production. Prospects who reply get no AI response.
**Fix:** In Resend dashboard → Inbound → configure webhook URL to `https://pipeline-titan-production.up.railway.app/reply`. May require a Resend paid plan for inbound webhooks.

---

### 2. SQLite Is Not Persistent on Railway
**What:** Railway's filesystem is ephemeral — it resets on every deployment. The SQLite `pipeline.db` file lives on the Railway server and is wiped on each redeploy.
**Impact:** All lead data is lost on every deployment.
**Fix:** Migrate to Railway's managed Postgres add-on ($5-10/mo). Schema migration is straightforward — same SQL, different driver (`pg` instead of `better-sqlite3`).

---

### 3. No Authentication on /leads Endpoint
**What:** `GET /leads` returns all lead data as raw JSON with no authentication.
**Impact:** Anyone who knows the URL can see all lead names, emails, and messages.
**Fix:** Add a simple API key check: `if (req.headers['x-api-key'] !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' })`.

---

### 4. FROM_EMAIL vs discover@ Mismatch
**What:** Emails are sent from `kelly@pipelinetitan.com` (FROM_EMAIL env var) but the landing page shows `discover@pipelinetitan.com` as the public contact.
**Impact:** Minor brand confusion. Prospects may reply to kelly@ directly instead of discover@.
**Fix:** Either update FROM_EMAIL to `discover@pipelinetitan.com` in Railway env vars, or set up email forwarding from discover@ to kelly@ in Google Workspace.

---

## 🟡 Medium Priority

### 5. No Error Alerting
**What:** Errors are logged to Railway console only. No alerts when emails fail to send or Claude API calls fail.
**Impact:** Silent failures — leads could be missed with no notification.
**Fix:** Add a simple error notification. Easiest option: send a text or email to Kelly when a critical error occurs using Resend or Twilio.

---

### 6. Demo Mode Leads Enter Main Database
**What:** Demo submissions are saved to the leads table with status `'demo'` but are never cleaned up. Over time this will pollute lead tracking data.
**Impact:** Cosmetic for now. Will matter when real reporting is added.
**Fix:** Either add a separate `demo_leads` table or add a cleanup cron that deletes demo entries older than 24 hours.

---

### 7. No Duplicate Demo Protection
**What:** The same email can submit the demo form multiple times and receive the full 3-email sequence each time — even simultaneously.
**Impact:** Could spam a prospect or a reviewer who tests it multiple times.
**Fix:** Add a simple rate limit check: if a demo submission from the same email was received in the last 10 minutes, skip it.

---

### 8. ACTIVE_PROFILE Is Hardcoded
**What:** `prompts.js` uses a single `ACTIVE_PROFILE` constant. There is no way to serve different client voices per request yet.
**Impact:** PipelineTitan can only serve one client voice at a time in the current build.
**Fix:** Pass `clientId` in the form submission, look up the matching profile, and inject it per-request. This is the multi-tenant foundation.

---

### 9. Calendly Link Is Hardcoded in .env
**What:** The Calendly link comes from the `CALENDLY_LINK` environment variable, which is a single value. Client profiles in `prompts.js` each have their own `calendlyLink` field, but the default falls back to the env var.
**Impact:** Fine for single-client use. Will need to be per-client when multi-tenant is built.
**Fix:** Resolved naturally when multi-tenant profile switching (item 8) is implemented.

---

### 10. No Start Script for Local Development
**What:** Running locally requires two Terminal windows — one for `node index.js` and one for `node scheduler.js`.
**Impact:** Minor developer experience issue.
**Fix:** Add `nodemon` and a `dev` script: `"dev": "nodemon index.js & node scheduler.js"`.

---

## 🟢 Low Priority

### 11. No HTTPS Redirect
**What:** Visiting `http://pipelinetitan.com` (non-secure) may not redirect to `https://`. Cloudflare likely handles this, but it's not explicitly enforced in the app.
**Fix:** Cloudflare SSL settings → set to "Full" and enable "Always use HTTPS."

### 12. Landing Page Has No robots.txt or sitemap.xml
**What:** Search engines have no guidance on how to crawl the site.
**Fix:** Add a simple `public/robots.txt` and `public/sitemap.xml`.

### 13. No favicon
**What:** Browser tab shows a default icon.
**Fix:** Create a simple PT favicon and add to `/public/favicon.ico` and reference in `index.html`.

### 14. package.json Start Script Runs Two Processes with &
**What:** `"start": "node index.js & node scheduler.js"` runs two processes loosely coupled. If one crashes, Railway may not restart both correctly.
**Fix:** Use a process manager like `concurrently` npm package: `"start": "concurrently \"node index.js\" \"node scheduler.js\""`.

---

## Resolved ✅

- ~~Carrd custom form type locked~~ — Upgraded to Carrd Pro, form wired to Railway via Send to URL
- ~~Claude model deprecated~~ — Updated to `claude-opus-4-5`
- ~~Multipart form data not parsed~~ — Added `busboy` parser
- ~~Domain not connected to Railway~~ — CNAME updated, pipelinetitan.com live
- ~~DKIM verification failed~~ — Fixed in Namecheap, all DNS records verified
