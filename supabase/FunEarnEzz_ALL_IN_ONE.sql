-- FunEarnEzz: SINGLE Supabase setup script
-- Jalankan seluruh file ini sekali di Supabase SQL Editor.
-- Login/register ditangani Supabase Auth; user dibuat melalui aplikasi / Supabase Auth.
-- Role yang dipakai hanya: admin dan user. Admin utama: syarwanreal@gmail.com.

begin;

create extension if not exists pgcrypto;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- 1) Profiles and roles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (username is null or char_length(username) between 3 and 32)
);
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user','admin'));

-- 2) Jobs/tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  instructions text not null default '',
  reward numeric(14,2) not null default 0 check (reward >= 0),
  status text not null default 'active' check (status in ('draft','active','paused','closed')),
  proof_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) User job submissions and proof metadata (proof files live in private Storage bucket)
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete restrict,
  proof_url text,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_id)
);

-- 4) Append-only wallet ledger; balance is sum(amount)
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in ('task_reward','withdrawal','adjustment','refund')),
  description text not null default '',
  reference_id uuid,
  created_at timestamptz not null default now()
);

-- 5) Withdrawal requests
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_user_created_idx on public.submissions(user_id, created_at desc);
create index if not exists submissions_task_status_idx on public.submissions(task_id, status);
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);
create index if not exists withdrawals_user_created_idx on public.withdrawals(user_id, created_at desc);
create index if not exists tasks_status_created_idx on public.tasks(status, created_at desc);

-- Keep updated_at current
create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function app_private.touch_updated_at();
drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks for each row execute function app_private.touch_updated_at();
drop trigger if exists submissions_touch_updated_at on public.submissions;
create trigger submissions_touch_updated_at before update on public.submissions for each row execute function app_private.touch_updated_at();
drop trigger if exists withdrawals_touch_updated_at on public.withdrawals;
create trigger withdrawals_touch_updated_at before update on public.withdrawals for each row execute function app_private.touch_updated_at();

-- Create/sync profile from Supabase Auth. Exact email receives admin; other users get user.
create or replace function app_private.sync_funearnezz_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assigned_role text;
begin
  assigned_role := case when lower(coalesce(new.email,'')) = 'syarwanreal@gmail.com' then 'admin' else 'user' end;
  insert into public.profiles(id, username, display_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username',''),
    nullif(new.raw_user_meta_data ->> 'display_name',''),
    assigned_role
  )
  on conflict (id) do update set
    username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    role = case when assigned_role = 'admin' then 'admin' else public.profiles.role end;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert or update of email on auth.users
for each row execute function app_private.sync_funearnezz_profile();

-- Ensure the designated admin profile exists if that Auth user already exists.
insert into public.profiles(id, username, display_name, role)
select u.id, nullif(u.raw_user_meta_data ->> 'username',''),
       nullif(u.raw_user_meta_data ->> 'display_name',''), 'admin'
from auth.users u where lower(u.email) = 'syarwanreal@gmail.com'
on conflict (id) do update set role = 'admin';

create or replace function app_private.is_funearnezz_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;
revoke all on function app_private.is_funearnezz_admin() from public, anon;
grant execute on function app_private.is_funearnezz_admin() to authenticated;

-- 6) RLS
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawals enable row level security;

-- Remove policies managed by this script so it can be safely rerun.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists admin_read_profiles on public.profiles;
drop policy if exists tasks_read_active on public.tasks;
drop policy if exists admin_manage_tasks on public.tasks;
drop policy if exists submissions_read_own on public.submissions;
drop policy if exists submissions_insert_own on public.submissions;
drop policy if exists submissions_update_own_pending on public.submissions;
drop policy if exists admin_read_submissions on public.submissions;
drop policy if exists admin_update_submissions on public.submissions;
drop policy if exists wallet_transactions_read_own on public.wallet_transactions;
drop policy if exists admin_read_wallet_transactions on public.wallet_transactions;
drop policy if exists withdrawals_read_own on public.withdrawals;
drop policy if exists withdrawals_insert_own_pending on public.withdrawals;
drop policy if exists admin_read_withdrawals on public.withdrawals;
drop policy if exists admin_update_withdrawals on public.withdrawals;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy admin_read_profiles on public.profiles for select to authenticated
using ((select app_private.is_funearnezz_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy tasks_read_active on public.tasks for select to authenticated using (status = 'active');
create policy admin_manage_tasks on public.tasks for all to authenticated
using ((select app_private.is_funearnezz_admin())) with check ((select app_private.is_funearnezz_admin()));

create policy submissions_read_own on public.submissions for select to authenticated
using ((select auth.uid()) = user_id);
create policy submissions_insert_own on public.submissions for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending' and reviewed_at is null);
create policy submissions_update_own_pending on public.submissions for update to authenticated
using ((select auth.uid()) = user_id and status = 'pending')
with check ((select auth.uid()) = user_id and status = 'pending' and reviewed_at is null);
create policy admin_read_submissions on public.submissions for select to authenticated
using ((select app_private.is_funearnezz_admin()));
create policy admin_update_submissions on public.submissions for update to authenticated
using ((select app_private.is_funearnezz_admin())) with check ((select app_private.is_funearnezz_admin()));

create policy wallet_transactions_read_own on public.wallet_transactions for select to authenticated
using ((select auth.uid()) = user_id);
create policy admin_read_wallet_transactions on public.wallet_transactions for select to authenticated
using ((select app_private.is_funearnezz_admin()));

create policy withdrawals_read_own on public.withdrawals for select to authenticated
using ((select auth.uid()) = user_id);
create policy withdrawals_insert_own_pending on public.withdrawals for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending');
create policy admin_read_withdrawals on public.withdrawals for select to authenticated
using ((select app_private.is_funearnezz_admin()));
create policy admin_update_withdrawals on public.withdrawals for update to authenticated
using ((select app_private.is_funearnezz_admin())) with check ((select app_private.is_funearnezz_admin()));

-- Column grants prevent users changing their own role or admin review fields.
revoke all on public.profiles, public.tasks, public.submissions, public.wallet_transactions, public.withdrawals from anon;
grant select on public.profiles to authenticated;
grant update (username, display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update on public.submissions to authenticated;
grant select on public.wallet_transactions to authenticated;
grant select, insert, update on public.withdrawals to authenticated;

-- 7) Private storage bucket for proof screenshots/files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('funearnezz-proofs', 'funearnezz-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists funearnezz_proof_upload_own on storage.objects;
drop policy if exists funearnezz_proof_read_own on storage.objects;
drop policy if exists funearnezz_proof_admin_read on storage.objects;
drop policy if exists funearnezz_proof_delete_own on storage.objects;
create policy funearnezz_proof_upload_own on storage.objects for insert to authenticated
with check (bucket_id = 'funearnezz-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy funearnezz_proof_read_own on storage.objects for select to authenticated
using (bucket_id = 'funearnezz-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy funearnezz_proof_admin_read on storage.objects for select to authenticated
using (bucket_id = 'funearnezz-proofs' and (select app_private.is_funearnezz_admin()));
create policy funearnezz_proof_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'funearnezz-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit();

-- Notes:
-- * This creates database tables, access rules, and a private proof-upload bucket in one SQL.
-- * Users still sign up/sign in through Supabase Auth from the frontend; SQL does not create a password for them.
-- * Wallet reward/withdrawal settlement should only be done through a trusted server-side RPC/backend,
--   not by granting browser clients write access to wallet_transactions.
-- * If the app uses different table/column names, its frontend queries must match these names.
