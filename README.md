# FunEarnEzz — Cloudflare Workers + Supabase

This branch moves API requests to a same-origin Cloudflare Worker and prepares the app for a fresh Supabase setup. The existing frontend layout is retained and CAPTCHA is not required.

## Setup
1. Install Node.js and Wrangler: `npm install`, then run `npx wrangler dev`.
2. Copy `.dev.vars.example` to `.dev.vars` and fill in the Supabase project URL and **server-only service-role key**. Never commit `.dev.vars` or put the service-role key in browser code.
3. Configure the database tables and RPCs listed in `worker.js` in Supabase before using member/admin features.
4. Deploy with `npx wrangler deploy`. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Worker secrets. Set `FRONTEND_ORIGIN` to the exact deployed origin.

## Included
- Cloudflare Worker API routes for username/password auth, profiles, jobs, submissions, wallet balance, withdrawal and Robux requests, and admin review/management.
- Same-origin frontend requests; CAPTCHA is not required.
- Server-side Supabase service-role access and role checks on admin endpoints.
- `GET /api/health` health check.

## Must be completed before production
- Create and verify Supabase tables/constraints and RPCs (`create_withdrawal`, `admin_adjust_balance`) before live withdrawals or balance adjustments. SQL is intentionally left for the next setup step.
- Set `ADMIN_USERNAME` before deployment. New registration with that username is assigned the admin role; existing profiles must be assigned the role explicitly.
- Private Storage upload for image proof is not implemented yet; submissions currently accept a proof URL/text.
- Test every endpoint and confirm atomic balance changes, RLS, and authorization before deploying a live rewards system.

Never expose the service-role key in frontend files. Keep it only in Cloudflare Worker secrets.
