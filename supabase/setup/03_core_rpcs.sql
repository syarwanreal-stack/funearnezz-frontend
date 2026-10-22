-- FunEarnEzz setup 3/4: withdrawal and Robux RPCs.
-- Run after parts 1 and 2.

create or replace function public.create_withdrawal(
  p_user_id uuid, p_amount numeric, p_method text, p_destination text
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_create_withdrawal$
declare
  v_profile public.profiles%rowtype;
  v_withdrawal public.withdrawals%rowtype;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal penarikan tidak valid'; end if;
  if coalesce(trim(p_method),'') = '' or coalesce(trim(p_destination),'') = '' then
    raise exception 'Metode dan tujuan penarikan wajib diisi';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found or v_profile.disabled then raise exception 'Akun tidak tersedia'; end if;
  if v_profile.balance < p_amount then raise exception 'Saldo tidak mencukupi'; end if;
  update public.profiles set balance = balance - p_amount,
    reserved_balance = reserved_balance + p_amount where id = p_user_id;
  insert into public.withdrawals(user_id, amount, method, destination, status)
  values (p_user_id, p_amount, left(trim(p_method),50), left(trim(p_destination),200), 'pending')
  returning * into v_withdrawal;
  insert into public.wallet_transactions(user_id, amount, type, reason, reference_type, reference_id)
  values (p_user_id, -p_amount, 'withdrawal_reserved', 'Penarikan menunggu pemeriksaan', 'withdrawal', v_withdrawal.id::text);
  return to_jsonb(v_withdrawal);
end;
$fn_create_withdrawal$;

create or replace function public.create_robux_request(
  p_user_id uuid, p_method text, p_robux integer, p_username text,
  p_gamepass_url text, p_rate numeric, p_cost numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_create_robux_request$
declare
  v_profile public.profiles%rowtype;
  v_request public.robux_requests%rowtype;
begin
  if p_method not in ('gamepass','username') or p_robux is null or p_robux < 1
    or p_rate is null or p_rate <= 0 or p_cost is null or p_cost <= 0
    or p_cost <> (p_robux * p_rate) then
    raise exception 'Parameter penukaran Robux tidak valid';
  end if;
  if coalesce(trim(p_username),'') = '' then raise exception 'Username Roblox wajib diisi'; end if;
  if p_method='gamepass' and coalesce(trim(p_gamepass_url),'') not like 'https://www.roblox.com/%' then
    raise exception 'URL Game Pass Roblox tidak valid';
  end if;
  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found or v_profile.disabled then raise exception 'Akun tidak tersedia'; end if;
  if v_profile.balance < p_cost then raise exception 'Saldo tidak mencukupi'; end if;
  update public.profiles set balance=balance-p_cost, reserved_balance=reserved_balance+p_cost where id=p_user_id;
  insert into public.robux_requests(user_id,method,robux,username,gamepass_url,rate,cost,status)
  values (p_user_id,p_method,p_robux,left(trim(p_username),100),left(coalesce(p_gamepass_url,''),500),p_rate,p_cost,'pending')
  returning * into v_request;
  insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
  values(p_user_id,-p_cost,'robux_reserved','Penukaran Robux menunggu pemeriksaan','robux',v_request.id::text);
  return to_jsonb(v_request);
end;
$fn_create_robux_request$;
