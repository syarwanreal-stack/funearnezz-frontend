# FunEarnEzz

FunEarnEzz is a static frontend served by Cloudflare Workers, with server-side API routes that talk to Supabase. The browser never receives the Supabase secret/service key.

## Configure Supabase first

1. Create or choose a **fresh Supabase project**. The SQL below is a baseline schema for this branch, not a safe migration for an existing production database whose data must be preserved.
2. Open **SQL Editor** in the Supabase dashboard and run [`supabase/schema.sql`](./supabase/schema.sql). It creates the tables, private proof bucket, RLS policies, wallet ledger, and transactional RPC functions used by the Worker.
3. In Supabase **Project Settings → API**, copy the project URL and publishable key. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `wrangler.toml` (the publishable key is designed for public clients).
4. Configure `SUPABASE_SERVICE_ROLE_KEY` as a **Cloudflare Worker Secret**, never as a `[vars]` entry or committed file. From a terminal with Wrangler authenticated, run:
   ```sh
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
   Paste the new Supabase secret key when prompted. Supabase's new `sb_secret_...` key format is supported; a legacy service-role JWT is also supported. If a secret was pasted into a chat or committed into Git, rotate it first and use the replacement.
5. Deploy with `npx wrangler deploy`, or configure Cloudflare Workers Builds to use that command. The configured `FRONTEND_ORIGIN` must match the actual frontend origin when cross-origin requests are used. For the same-origin `workers.dev` deployment in this repository it is set in `wrangler.toml`.

## Username/password accounts

Users register and sign in with a username and password; no personal email address is requested. The Worker maps usernames to an internal synthetic email address and creates the Auth user server-side as confirmed. This is a username-only design, so users cannot use email-based account recovery; keep a secure record of their credentials and do not reuse passwords from other services.

Registration creates a regular user only. To provision the first admin, register the intended admin account, confirm that it exists, then run this SQL in Supabase SQL Editor:
```sql
update public.profiles set role = 'admin' where username = 'your_admin_username';
```
Replace the placeholder with the exact username you registered. The site does not promote an account just because its name is `admin`.

## Available workflows

- User authentication, dashboard, active jobs, image proof submissions, activity history, and balance display.
- DANA/other configured withdrawal requests with funds reserved at request time and refunded on rejection.
- Robux requests through Game Pass or username, with server-side rate calculation and balance reservation.
- Admin APIs for task creation, user controls and balance adjustment, submission/withdrawal/Robux review, audit logs, and settings.

Proof images are uploaded to the private `submission-proofs` Storage bucket. The Worker only returns a time-limited signed URL after checking that the caller owns the submission or is an admin.

## Checks

Run locally with Node.js 20 or later:
```sh
npm run check
npm test
```
GitHub Actions runs the same syntax and mocked-Supabase contract tests for pull requests. These tests do not prove that your live Supabase project has been configured; after applying the SQL and setting Cloudflare secrets, verify `/api/health`, then test registration, login, proof upload, withdrawal reservation/refund, and each admin review workflow against the actual project before accepting real users or handling real payouts.

## PR #21 product rework (existing production project)

For an existing deployed Supabase project, run `supabase/migrations/202610230003_pr21_product_rework.sql` in the Supabase SQL Editor **before** deploying this branch. This migration is additive: it preserves user balances, account records, existing requests and ledger rows. It adds job quotas, DANA payout/fee fields, Unickcode redemption, global chat, and chat mutes. Do not rerun `supabase/schema.sql` against a populated production database as a substitute.

The current PR #26 flow starts with registration requiring username, email, password, and password confirmation. Supabase Auth sends an email verification code; a new account can sign in only after Supabase confirms the email. Existing username-only legacy accounts remain compatible with the login form. After verification/login, users go directly to the dashboard. The hamburger menu includes referral, DANA, Robux, and manual FF diamond requests. Admins use **Setting UATS** for withdrawal rates/fees and the two referral rewards; staff keeps the existing chat moderation scope.

The browser notification control asks for the permission and polls the queue only while the admin page is open. It is not a service-worker push subscription and cannot guarantee alerts after the site/browser is closed. After applying the migration and deploying, verify a real test account end-to-end before handling payouts: code reward/cap, job quota/rejected slot release, both Robux methods, DANA fee math and rejection refund, global chat mute expiry, and maintenance/announcement visibility.

## PR #26: email verification, referral, and FF diamond

For an existing project, apply migrations in order: first the already-required PR #21 migration `supabase/migrations/202610230003_pr21_product_rework.sql` if it has not been applied, then the new additive migration `supabase/migrations/202610240001_pr26_email_referral_diamond.sql`. The PR #26 migration adds profile email/referral fields, the referral reward ledger, and manual FF diamond request/RPC support. It does not drop tables or reset users, balances, requests, or ledger rows. Do not run `supabase/schema.sql` over an existing populated project.

In Supabase Auth, enable email confirmations for new signups and configure the signup/confirmation email template to show the numeric token (for example, `{{ .Token }}`) so the code-entry form can verify the account. Keep the site domain and Supabase publishable URL/key configured as before, and keep the service-role key only as a Cloudflare Worker secret. The default diamond price and both referral rewards are zero (disabled) until an admin sets them in **Setting UATS**.

Referral rules: the invitee must be email-verified and have their first job submission approved; then the database transaction credits the invitee and referrer according to the configured rewards. There is no cap on the number of different invitees, while each invitee can earn referral rewards only once. FF diamond requests reserve their cost atomically and are sent manually by an admin; rejecting a request refunds the reserved balance.

After migration and deploy, test a new signup with a test email, wrong/correct/expired verification codes, resend code, existing legacy login, a referral with an approved first job, each payout type, diamond reject/refund, UATS changes, and announcement persistence. The repository tests use mocked Supabase requests and do not replace live end-to-end validation.
