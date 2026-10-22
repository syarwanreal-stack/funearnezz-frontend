# FunEarnEzz — Supabase frontend integration

This branch documents the safe integration boundary before changing production flows.

## Supabase project
- Project URL: configure in frontend runtime config.
- Use only the Supabase publishable key in the browser.
- Never place a `service_role` key in frontend assets or commits.

## Data access
- Authentication uses Supabase Auth email/password endpoints.
- Read active tasks from `public.tasks` under authenticated RLS.
- Read a user's submissions and wallet transactions only through own-row RLS.
- A displayed wallet balance is the sum of signed transaction rows, not a browser-controlled balance field.

## Features that must remain disabled until secure server-side handling exists
- Proof upload: create a private Storage bucket, enforce authenticated object paths and file-size/type rules, then store the object path with the submission.
- Withdrawals: use a trusted backend or atomic database RPC to validate and reserve balance, prevent duplicate requests, and process status transitions.
- Rewards: approve submissions and write wallet transactions only through trusted server-side logic.

## Before merge
1. Verify schema and RLS policies in the Supabase project.
2. Configure email confirmation/redirect URLs in Supabase Auth.
3. Test signup, login, task reads, own-submission reads, and own-wallet reads with two separate test accounts.
4. Confirm no secrets other than the publishable key exist in browser assets.
