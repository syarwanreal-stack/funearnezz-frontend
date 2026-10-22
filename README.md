# FunEarnEzz

FunEarnEzz is being prepared for a Cloudflare-first deployment. The existing visual design in `index.html` and `style.css` is intentionally preserved.

## Stage 1 — deploy and review the website

- Hosting and static assets: Cloudflare Worker Assets.
- Frontend API requests use same-origin `/api/*` routes; there is no separate panel URL to configure.
- CAPTCHA is not required.
- The site should be viewable before Supabase is configured. The UI shows that the frontend is ready and the backend is pending.
- Wrangler uses the Cloudflare Worker name `funearnezz-frontend` and a compatibility date that is not in the future.
- Repository metadata, Wrangler temporary files, database scripts, and local secret files are excluded from public asset uploads.

Use Cloudflare Workers Builds with the deploy command `npx wrangler deploy` and this repository's `wrangler.toml`. Do not add a Pterodactyl panel URL, panel startup command, or old external API URL.

## Stage 2 — configure Supabase after design approval

Supabase setup is intentionally deferred until the site design has been reviewed. Before production use, the database schema and RPCs must be aligned with the Worker endpoints and tested.

The Worker will eventually require server-only secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Add these through Cloudflare's secret settings only when we reach Stage 2. Never place the service-role key in `app.js`, HTML, or any public repository file, and never send it in chat.

## Important functionality status

A successful static deployment does not mean account and reward features are fully operational. Registration/login, balances, tasks, proof uploads, DANA withdrawals, Robux redemption, and admin workflows require the Supabase schema, secure upload handling, and transactional server-side validation to be configured and tested in Stage 2.

Do not treat this project as production-ready until those checks pass.
