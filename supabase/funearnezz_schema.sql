-- FunEarnEzz Supabase schema
-- Jalankan sekali di Supabase Dashboard > SQL Editor.
-- Aman untuk diulang pada tabel/policy yang dikelola script ini.
begin;

create extension if not exists pgcrypto;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (username is null or char_length(username) between 3 and 32)
);

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

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in ('task_reward','withdrawal','adjustment','refund')),
  description text not null default '',
  reference_id uuid,
  created_at timestamptz not null default now()
);

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

create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function app_private.touch_updated_at();
drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks
for each row execute function app_private.touch_updated_at();
drop trigger if exists submissions_touch_updated_at on public.submissions;
create trigger submissions_touch_updated_at before update on public.submissions
for each row execute function app_private.touch_updated_at();
drop trigger if exists withdrawals_touch_updated_at on public.withdrawals;
create trigger withdrawals_touch_updated_at before update on public.withdrawals
for each row execute function app_private.touch_updated_at();

create or replace function app_private.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, username, display_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function app_private.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawals enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "tasks_read_active" on public.tasks;
create policy "tasks_read_active" on public.tasks for select to authenticated using (status = 'active');

drop policy if exists "submissions_read_own" on public.submissions;
create policy "submissions_read_own" on public.submissions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own" on public.submissions for insert to authenticated with check ((select auth.uid()) = user_id and status = 'pending' and reviewed_at is null);
drop policy if exists "submissions_update_own_pending" on public.submissions;
create policy "submissions_update_own_pending" on public.submissions for update to authenticated using ((select auth.uid()) = user_id and status = 'pending') with check ((select auth.uid()) = user_id and status = 'pending' and reviewed_at is null);

drop policy if exists "wallet_transactions_read_own" on public.wallet_transactions;
create policy "wallet_transactions_read_own" on public.wallet_transactions for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "withdrawals_read_own" on public.withdrawals;
create policy "withdrawals_read_own" on public.withdrawals for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "withdrawals_insert_own_pending" on public.withdrawals;
create policy "withdrawals_insert_own_pending" on public.withdrawals for insert to authenticated with check ((select auth.uid()) = user_id and status = 'pending');

revoke all on public.profiles, public.tasks, public.submissions, public.wallet_transactions, public.withdrawals from anon;
grant select, update on public.profiles to authenticated;
grant select on public.tasks to authenticated;
grant select, insert, update on public.submissions to authenticated;
grant select on public.wallet_transactions to authenticated;
grant select, insert on public.withdrawals to authenticated;

-- Deliberately no client-side write access to wallet_transactions.
-- Production withdrawals/rewards must be validated atomically by a trusted backend/RPC.
commit();
