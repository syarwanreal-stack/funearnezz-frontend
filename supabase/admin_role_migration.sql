-- FunEarnEzz admin role migration
-- Run in Supabase SQL Editor AFTER funearnezz_schema.sql.
-- Grants admin only to the exact email configured below; never trust user-editable metadata.
begin;

create schema if not exists app_private;

alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user','admin'));

create or replace function app_private.sync_funearnezz_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, username, display_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    case when lower(coalesce(new.email, '')) = 'syarwanreal@gmail.com' then 'admin' else 'user' end
  )
  on conflict (id) do update set
    role = case when lower(coalesce(new.email, '')) = 'syarwanreal@gmail.com'
                then 'admin' else public.profiles.role end,
    username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert or update of email on auth.users
for each row execute function app_private.sync_funearnezz_profile();

insert into public.profiles(id, username, display_name, role)
select u.id,
       nullif(u.raw_user_meta_data ->> 'username', ''),
       nullif(u.raw_user_meta_data ->> 'display_name', ''),
       'admin'
from auth.users u
where lower(u.email) = 'syarwanreal@gmail.com'
on conflict (id) do update set role = 'admin';

create or replace function app_private.is_funearnezz_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function app_private.is_funearnezz_admin() from public, anon;
grant execute on function app_private.is_funearnezz_admin() to authenticated;

drop policy if exists "admin_read_profiles" on public.profiles;
create policy "admin_read_profiles" on public.profiles
for select to authenticated
using ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_manage_tasks" on public.tasks;
create policy "admin_manage_tasks" on public.tasks
for all to authenticated
using ((select app_private.is_funearnezz_admin()))
with check ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_read_submissions" on public.submissions;
create policy "admin_read_submissions" on public.submissions
for select to authenticated
using ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_update_submissions" on public.submissions;
create policy "admin_update_submissions" on public.submissions
for update to authenticated
using ((select app_private.is_funearnezz_admin()))
with check ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_read_wallet_transactions" on public.wallet_transactions;
create policy "admin_read_wallet_transactions" on public.wallet_transactions
for select to authenticated
using ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_read_withdrawals" on public.withdrawals;
create policy "admin_read_withdrawals" on public.withdrawals
for select to authenticated
using ((select app_private.is_funearnezz_admin()));

drop policy if exists "admin_update_withdrawals" on public.withdrawals;
create policy "admin_update_withdrawals" on public.withdrawals
for update to authenticated
using ((select app_private.is_funearnezz_admin()))
with check ((select app_private.is_funearnezz_admin()));

commit;
