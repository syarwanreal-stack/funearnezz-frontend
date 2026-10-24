-- Game Pass withdrawals no longer collect or validate a URL.
-- Apply this migration to the existing Supabase project before relying on the change.
create or replace function public.create_robux_request(
  p_user_id uuid, p_method text, p_robux integer, p_username text,
  p_gamepass_url text, p_rate numeric, p_cost numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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
  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found or v_profile.disabled then raise exception 'Akun tidak tersedia'; end if;
  if v_profile.balance < p_cost then raise exception 'Saldo tidak mencukupi'; end if;
  update public.profiles set balance=balance-p_cost, reserved_balance=reserved_balance+p_cost where id=p_user_id;
  insert into public.robux_requests(user_id,method,robux,username,gamepass_url,rate,cost,status)
  values (p_user_id,p_method,p_robux,left(trim(p_username),100),'',p_rate,p_cost,'pending')
  returning * into v_request;
  insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
  values(p_user_id,-p_cost,'robux_reserved','Penukaran Robux menunggu pemeriksaan','robux',v_request.id::text);
  return to_jsonb(v_request);
end; $$;
