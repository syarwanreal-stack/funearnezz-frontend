-- Additive follow-up: maintenance automatically expires at its configured reopen time.
-- This migration preserves existing settings, users, tasks, balances, and requests.
begin;

create or replace function public.funearnezz_maintenance_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  enabled_text text;
  reopen_text text;
  reopen_at timestamptz;
begin
  select value #>> '{}' into enabled_text
  from public.settings where key = 'maintenanceEnabled' limit 1;

  select nullif(value #>> '{}', '') into reopen_text
  from public.settings where key = 'maintenanceReopenAt' limit 1;

  if reopen_text is not null then
    begin
      reopen_at := reopen_text::timestamptz;
    exception when others then
      -- A malformed date must not silently turn maintenance off.
      reopen_at := null;
    end;
  end if;

  return lower(coalesce(enabled_text, 'false')) in ('true', '1', 'yes', 'on')
    and (reopen_at is null or reopen_at > now());
end;
$$;

revoke all on function public.funearnezz_maintenance_enabled() from public, anon, authenticated;
grant execute on function public.funearnezz_maintenance_enabled() to service_role;

commit;
