-- FunEarnEzz additive migration: maintenance, photo-required jobs, and working withdrawal RPCs.
-- Safe migration: does not drop tables, delete rows, or reset accounts.
begin;

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings(key,value) values
  ('maintenanceEnabled','false'::jsonb),
  ('maintenanceReason','"Sistem sedang dalam pemeliharaan."'::jsonb),
  ('maintenanceReopenAt','""'::jsonb),
  ('robuxMin','10'::jsonb),
  ('gamepassRate','170'::jsonb),
  ('usernameRate','230'::jsonb)
on conflict (key) do nothing;

create or replace function public.funearnezz_settings_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists funearnezz_settings_updated_at on public.settings;
create trigger funearnezz_settings_updated_at
before update on public.settings for each row
execute function public.funearnezz_settings_updated_at();

alter table public.jobs add column if not exists photo_required boolean not null default false;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('submission-proofs','submission-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create or replace function public.funearnezz_maintenance_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select lower(trim(both '"' from value::text)) in ('true','1','yes','on')
    from public.settings where key='maintenanceEnabled' limit 1
  ),false);
$$;

create or replace function public.funearnezz_validate_submission_proof()
returns trigger language plpgsql security definer set search_path = '' as $$
declare required_photo boolean;
begin
  select coalesce(photo_required,false) into required_photo
  from public.jobs where id=new.job_id;
  if not found then raise exception 'Tugas tidak ditemukan.'; end if;
  if required_photo and nullif(trim(coalesce(new.proof_url,'')),'') is null then
    raise exception 'Tugas ini mewajibkan foto bukti.';
  end if;
  return new;
end;
$$;
drop trigger if exists funearnezz_submission_proof_check on public.submissions;
create trigger funearnezz_submission_proof_check
before insert or update of job_id,proof_url on public.submissions
for each row execute function public.funearnezz_validate_submission_proof();

-- Atomic balance reservation + withdrawal queue insertion.
create or replace function public.create_withdrawal(
  p_user_id uuid,p_amount numeric,p_method text,p_destination text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  profile_row jsonb;
  current_balance numeric(14,2);
  is_disabled boolean;
  item public.withdrawals%rowtype;
begin
  if public.funearnezz_maintenance_enabled() then
    raise exception 'Maintenance aktif. Penarikan sementara dinonaktifkan.';
  end if;
  if p_user_id is null or p_amount is null or p_amount<=0
    or coalesce(trim(p_method),'')='' or coalesce(trim(p_destination),'')='' then
    raise exception 'Data penarikan tidak valid.';
  end if;
  select to_jsonb(p) into profile_row from public.profiles p
  where p.id=p_user_id for update;
  if profile_row is null then raise exception 'Akun tidak ditemukan.'; end if;
  is_disabled := coalesce((profile_row->>'disabled')::boolean,(profile_row->>'disable')::boolean,false);
  if is_disabled then raise exception 'Akun dinonaktifkan.'; end if;
  current_balance := coalesce((profile_row->>'balance')::numeric,0);
  if current_balance<p_amount then raise exception 'Saldo tidak mencukupi.'; end if;

  update public.profiles set balance=balance-p_amount,
    reserved_balance=coalesce(reserved_balance,0)+p_amount where id=p_user_id;
  insert into public.withdrawals(user_id,amount,method,destination,status)
  values(p_user_id,p_amount,left(trim(p_method),50),left(trim(p_destination),200),'pending')
  returning * into item;
  insert into public.wallet_transactions(user_id,amount,type,status,reason,reference_type,reference_id)
  values(p_user_id,-p_amount,'withdrawal_reserved','posted',
    'Penarikan menunggu pemeriksaan admin','withdrawal',item.id::text);
  return to_jsonb(item);
end;
$$;

-- Atomic Robux request + balance reservation + admin queue insertion.
create or replace function public.create_robux_request(
  p_user_id uuid,p_method text,p_robux integer,p_username text,
  p_gamepass_url text,p_rate numeric,p_cost numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  profile_row jsonb;
  current_balance numeric(14,2);
  is_disabled boolean;
  minimum_robux integer;
  item public.robux_requests%rowtype;
begin
  if public.funearnezz_maintenance_enabled() then
    raise exception 'Maintenance aktif. Penukaran Robux sementara dinonaktifkan.';
  end if;
  if p_user_id is null or p_method not in ('gamepass','username')
    or p_robux is null or p_robux<1 or p_rate is null or p_rate<=0
    or p_cost is null or p_cost<=0 or p_cost<>p_robux*p_rate
    or coalesce(trim(p_username),'')='' then
    raise exception 'Data penukaran Robux tidak valid.';
  end if;
  select coalesce((select trim(both '"' from value::text)::integer
    from public.settings where key='robuxMin'),10) into minimum_robux;
  if p_robux<greatest(minimum_robux,1) then raise exception 'Jumlah Robux di bawah batas minimum.'; end if;
  if p_method='gamepass' and coalesce(trim(p_gamepass_url),'') !~* '^https://www[.]roblox[.]com/' then
    raise exception 'URL Game Pass Roblox tidak valid.';
  end if;
  select to_jsonb(p) into profile_row from public.profiles p
  where p.id=p_user_id for update;
  if profile_row is null then raise exception 'Akun tidak ditemukan.'; end if;
  is_disabled := coalesce((profile_row->>'disabled')::boolean,(profile_row->>'disable')::boolean,false);
  if is_disabled then raise exception 'Akun dinonaktifkan.'; end if;
  current_balance := coalesce((profile_row->>'balance')::numeric,0);
  if current_balance<p_cost then raise exception 'Saldo tidak mencukupi.'; end if;

  update public.profiles set balance=balance-p_cost,
    reserved_balance=coalesce(reserved_balance,0)+p_cost where id=p_user_id;
  insert into public.robux_requests(user_id,method,robux,username,gamepass_url,rate,cost,status)
  values(p_user_id,p_method,p_robux,left(trim(p_username),100),
    left(coalesce(trim(p_gamepass_url),''),500),p_rate,p_cost,'pending')
  returning * into item;
  insert into public.wallet_transactions(user_id,amount,type,status,reason,reference_type,reference_id)
  values(p_user_id,-p_cost,'robux_reserved','posted',
    'Penukaran Robux menunggu pemeriksaan admin','robux',item.id::text);
  return to_jsonb(item);
end;
$$;

revoke all on function public.funearnezz_maintenance_enabled() from public,anon,authenticated;
grant execute on function public.funearnezz_maintenance_enabled() to service_role;
revoke all on function public.create_withdrawal(uuid,numeric,text,text) from public,anon,authenticated;
revoke all on function public.create_robux_request(uuid,text,integer,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.create_withdrawal(uuid,numeric,text,text) to service_role;
grant execute on function public.create_robux_request(uuid,text,integer,text,text,numeric,numeric) to service_role;

commit;
