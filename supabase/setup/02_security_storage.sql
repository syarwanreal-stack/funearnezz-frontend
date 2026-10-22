-- FunEarnEzz setup 2/4: private proof bucket, RLS, policies and table grants.
-- Run after 01_tables_reset.sql.

-- Private object storage. Proof paths are saved in submissions.proof_url; the Worker
-- signs short-lived view links after verifying the owner/admin permission.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-proofs', 'submission-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.submissions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.robux_requests enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "jobs_read_active" on public.jobs;
create policy "jobs_read_active" on public.jobs for select to anon, authenticated using (status = 'active');
drop policy if exists "submissions_read_own" on public.submissions;
create policy "submissions_read_own" on public.submissions for select to authenticated using (user_id = auth.uid());
drop policy if exists "withdrawals_read_own" on public.withdrawals;
create policy "withdrawals_read_own" on public.withdrawals for select to authenticated using (user_id = auth.uid());
drop policy if exists "robux_read_own" on public.robux_requests;
create policy "robux_read_own" on public.robux_requests for select to authenticated using (user_id = auth.uid());
drop policy if exists "transactions_read_own" on public.wallet_transactions;
create policy "transactions_read_own" on public.wallet_transactions for select to authenticated using (user_id = auth.uid());

-- This Worker is the only application-facing data API; browser clients never receive
-- the service secret. Remove inherited public/anon/authenticated table grants explicitly.
revoke all privileges on public.profiles, public.jobs, public.submissions, public.withdrawals,
  public.robux_requests, public.wallet_transactions, public.settings, public.audit_logs
  from public, anon, authenticated;
grant all privileges on public.profiles, public.jobs, public.submissions, public.withdrawals,
  public.robux_requests, public.wallet_transactions, public.settings, public.audit_logs
  to service_role;
grant usage, select on sequence public.jobs_id_seq, public.submissions_id_seq,
  public.withdrawals_id_seq, public.robux_requests_id_seq,
  public.wallet_transactions_id_seq, public.audit_logs_id_seq to service_role;
