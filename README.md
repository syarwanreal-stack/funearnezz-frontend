# FunEarnEzz — Cloudflare Workers + Supabase

This project is being migrated from the old Pterodactyl API to a same-origin Cloudflare Worker with Supabase as the database/auth provider. The existing FunEarnEzz visual design in `index.html` and `style.css` is retained. CAPTCHA is not required.

## Architecture

- Static UI: `index.html`, `style.css`, `app.js`.
- API: `worker.js`, served on the same origin as the static assets.
- Database and authentication: Supabase.
- Deployment config: `wrangler.toml`.
- Frontend calls `/api/*` on the same origin. No Supabase service-role key or database secret belongs in browser code.

## Configure Cloudflare

1. Connect this repository to Cloudflare Workers (static assets + Worker) or use Wrangler from a local development environment.
2. Set Worker secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Cloudflare dashboard. Never commit actual values.
3. Set the Worker variable `ADMIN_USERNAME` to the intended administrator username before public registration.
4. Set `FRONTEND_ORIGIN` to the exact public site origin if cross-origin access is ever enabled. Same-origin frontend requests are preferred.
5. Use `wrangler dev` for local development; use `wrangler deploy` only after configuring secrets and validating the build.

## Supabase setup — important

The current Worker expects tables named `profiles`, `jobs`, `submissions`, `withdrawals`, `robux_requests`, `settings`, and `audit_logs`. It also calls database RPCs including `create_withdrawal`, `create_robux_request`, and `admin_adjust_balance`.

The existing `supabase/funearnezz_schema.sql` is an earlier schema and does **not** yet fully match those Worker expectations. Do not treat this repository as production-ready until a migration aligning the schema, constraints, RLS policies, and atomic balance-changing RPCs is added and tested. In particular, balance changes and withdrawal/Robux requests must be atomic and server-validated.

## Current implementation notes

- CAPTCHA is not required; the Worker config endpoint returns `captchaRequired: false`.
- The frontend uses same-origin Worker requests and an HttpOnly-cookie session rather than a browser-configured API base URL.
- Task proof submission still needs a production-safe upload implementation. Do not send a private service-role key to the browser.
- Validate account registration/login, task submission, wallet balances, DANA withdrawals, both Robux methods (Game Pass and username), admin review/adjustment, and session/logout flows against a configured test Supabase project before going live.

## Security checklist

- Never put `SUPABASE_SERVICE_ROLE_KEY`, passwords, access tokens, or real `.dev.vars` in Git.
- Do not allow public signup to grant administrator role just by choosing an admin username. Provision the admin account/role through a trusted, explicit migration or secure operator action before public launch.
- Enable and test RLS; use server-side authorization checks for admin endpoints.
- Verify that approval/rejection transitions, balance reservation/release, and audit logs are transactional and cannot be replayed.
- CAPTCHA removal does not remove the need for rate limiting, password protection, and abuse monitoring.
