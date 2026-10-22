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

The Supabase project URL is set as the non-secret `SUPABASE_URL` Worker variable in `wrangler.toml`. Set the server-only key using Cloudflare Worker Secrets; never put it in `app.js`, HTML, or a public repository file. This Worker version sends the key as both `apikey` and `Authorization: Bearer`, so use a compatible legacy `service_role` JWT from Supabase API settings rather than a new-format `sb_secret_...` key. Rotate any key shared publicly or in chat. Run `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and paste the rotated compatible service-role key when prompted.

Username-only registration uses an internal synthetic email address that the user never needs to enter. In Supabase Auth, disable email confirmation for this username/password flow; otherwise signup may require email verification. The form asks for password confirmation, but only the password is sent to the server.

To create the admin account, register username `admin` through the site first, then promote that profile in Supabase SQL Editor after verifying it exists: `update public.profiles set role = 'admin' where username = 'admin';`. Do not store the initial admin password in source code or SQL.

## Important functionality status

A successful static deployment does not mean account and reward features are fully operational. Registration/login, balances, tasks, proof uploads, DANA withdrawals, Robux redemption, and admin workflows require the Supabase schema, secure upload handling, and transactional server-side validation to be configured and tested in Stage 2.

Do not treat this project as production-ready until those checks pass.
