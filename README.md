# PrimeWave Hotel — Vercel + Supabase

## Deploy checklist
1. **Supabase → SQL Editor:** run `schema.sql`, then `migrations/002_hardening.sql`, then `migrations/003_news_and_settings.sql` (news + social links).
   - Enable the `pg_cron` extension, then run the commented `cron.schedule(...)` lines at the bottom of the migration.
   - The migration adds the overlap constraints that make double-booking impossible, the shared rate limiter, and RLS.
2. **Create the first staff account:** register in the UI, then in SQL: `UPDATE users SET role='systemowner' WHERE email='you@…';`
3. **Vercel → Project → Environment Variables:** everything in `.env.example` (JWT_SECRET ≥ 32 chars, CRON_SECRET, PUBLIC_BASE_URL, SMTP_*, PESAPAL_*, GROQ_API_KEY).
4. **PesaPal IPN id (required on serverless):** deploy once, then call
   `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/register-ipn`
   and store the returned `ipn_id` as `PESAPAL_IPN_ID`, then redeploy.
5. **Rotate every key** that ever appeared in the old Apps Script files (Groq, PesaPal, old JWT secret).
6. Test the full payment loop in `PESAPAL_ENV=sandbox` before switching to `live`.

## Dashboards
All three staff dashboards are built from one set of modules (`public/console.js`), so a higher role always has everything the lower roles have.

| Page | Role | Modules |
|---|---|---|
| `/account.html` | every signed-in guest | Home (next stay), bookings, receipts, profile, password, sign out everywhere |
| `/admin.html` | admin | Overview · Bookings · Walk-in · Payments · Rooms & tables (status) · **News** · Users |
| `/owner.html` | owner | everything above, plus Business analytics · Revenue reports · **Site settings** (social links) · full room/table add/edit/delete · create staff accounts |
| `/systemowner.html` | system owner | everything above, plus Security · Audit log · Incidents · Backups · Jobs · account tools (clear OTP lock, sign out everywhere, delete, history) |

**Who can see which accounts** (one rule, `server/services/userPolicy.js`, used by the user list, password resets and the archive):
- **Admin** → guests and admins. Owners and the system owner are invisible.
- **Owner** → guests, admins and owners. The system owner is invisible.
- **System owner** → everyone.

Anyone may set a new password for any account they can see (never their own — that uses *Change password*). The target is emailed, signed out of every device, and the action is audited. Changing someone's **role** or deactivating them is stricter: only accounts strictly below you, and only roles below yours can be granted.

## News
Admin, owner and system owner write stories in the **News** module (draft or publish, optional pinning, optional https cover-image link). Admins can edit/delete only their own stories; owners and system owners can manage everyone's. Published stories appear on `/news.html` (with a full-article view at `/news.html?id=…`) and as "Latest news" on the home page. Story text is plain text and is escaped everywhere it is shown.

## Social links
The owner (or system owner) pastes the Facebook, Instagram, YouTube and TikTok links under **Site settings**. Coloured icons then appear in the footer of every public page (and the contact page). Only `https://` links on the matching network are accepted; empty boxes hide that icon. Until links are saved no icons are shown.

## Tests
`npm test` runs the suite with Node's built-in runner (no extra packages). An in-memory database stands in for Supabase, so no secrets or network are needed.

| Suite | What it proves |
|---|---|
| `helpers`, `availability`, `calendar` | Nairobi-time dates, overlap rules, same-day turnover, payment holds, calendar output (no guest data) |
| `booking-quote` | Prices are computed on the server (VAT, nights/hours); a price sent by the browser is ignored |
| `finalizer`, `payment-flow` | Paid → confirmed booking exactly once (even when IPN and browser race); amount/reference mismatches refused; paid-but-slot-taken triggers refund alerts |
| `route-protection` | Static audit: every API route is public on purpose, cron-secret protected, or requires login + the right role |
| `guard`, `calendar-widget`, `seo` | Dashboard pages bounce signed-out / under-privileged / expired visitors; date-picker logic; robots.txt + sitemap |
| `user-policy`, `news`, `settings`, `dashboards` | Who can see/reset which accounts; news permissions, validation, pagination; social-link validation; every higher dashboard contains every lower module |
| `browser` | **Real Chromium** drives the actual pages: dashboards per role, the password dialog, writing/editing news, social icons in every footer, the booking calendar, phone-width overflow checks. Optional: needs `npm i -D playwright && npx playwright install chromium` |
| `password`, `auth-middleware`, `api` | bcrypt + legacy upgrade, token checks, and real HTTP requests against the app. **These skip themselves until `npm install` has been run.** |

The fake database mimics the rules in `migrations/002_hardening.sql` — it proves the app handles them correctly, not that Postgres enforces them. Do one real double-booking attempt against your Supabase project after running the migration.

## Search engines
`/robots.txt` and `/sitemap.xml` are generated from `PUBLIC_BASE_URL` (see `server/utils/seo.js`), so there is no hard-coded domain. On Vercel they are rewritten to the API function; don't add static copies to `public/` — they would override the generated ones. Add new public pages to `PAGES` in `server/utils/seo.js` (a test fails if you forget). After launch, submit `https://YOUR-DOMAIN/sitemap.xml` in Google Search Console.

## Availability calendar
`GET /api/availability/calendar` returns only taken nights/time slots. `book.html` shows it as a date-range picker (booked nights crossed out, check-out allowed on the first free morning), and accepts `?type=room&room_id=…&checkin=…&checkout=…` (also `table_id`) to preselect — used by the rooms page and "Book again".

## Notes
- `/api/*` → `api/index.js` (Express app). `public/` is served statically by Vercel.
- Vercel Cron runs `/api/cron/housekeeping` daily (Hobby plan allows daily only); pg_cron handles the 15-minute expiries.
- Existing users with old SHA-256 password hashes keep working and are upgraded to bcrypt on next login.

## Node version

This project targets **Node.js 26.x** (see `.nvmrc` and `engines`).
Environment variables are read from `.env` by Node itself (`process.loadEnvFile`), so `dotenv` and `nodemon` are no longer needed.
`npm run dev` uses `node --watch` for auto-restart.
On Vercel, set the project's Node.js Version to 26.x in Settings → General.
