-- FunEarnEzz setup 4/4: review/admin RPCs, function grants, schema reload.
-- Run after parts 1, 2 and 3.

create or replace function public.review_submission(
  p_submission_id bigint, p_status text, p_note text, p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_review_submission$
declare
  v_item public.submissions%rowtype;
  v_reward numeric(14,2);
begin
  if p_status not in ('approved','rejected') then raise exception 'Status pengajuan tugas tidak valid'; end if;
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin' and not disabled) then raise exception 'Akses admin ditolak'; end if;
  select * into v_item from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if v_item.status <> 'pending' then raise exception 'Pengajuan ini sudah diperiksa'; end if;
  if p_status='approved' then
    select reward into v_reward from public.jobs where id=v_item.job_id;
    if v_reward is null then raise exception 'Tugas tidak ditemukan'; end if;
    update public.profiles set balance=balance+v_reward where id=v_item.user_id;
    insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
    values(v_item.user_id,v_reward,'task_reward','Reward tugas disetujui','submission',v_item.id::text);
  end if;
  update public.submissions set status=p_status,review_note=left(coalesce(p_note,''),1000),
    reviewed_at=now() where id=v_item.id returning * into v_item;
  return to_jsonb(v_item);
end;
$fn_review_submission$;

create or replace function public.review_withdrawal(
  p_withdrawal_id bigint, p_status text, p_note text, p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_review_withdrawal$
declare
  v_item public.withdrawals%rowtype;
begin
  if p_status not in ('paid','rejected') then raise exception 'Status penarikan tidak valid'; end if;
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin' and not disabled) then raise exception 'Akses admin ditolak'; end if;
  select * into v_item from public.withdrawals where id=p_withdrawal_id for update;
  if not found then raise exception 'Penarikan tidak ditemukan'; end if;
  if v_item.status <> 'pending' then raise exception 'Penarikan ini sudah diperiksa'; end if;
  if v_item.amount > (select reserved_balance from public.profiles where id=v_item.user_id) then
    raise exception 'Saldo tertahan tidak konsisten';
  end if;
  if p_status='rejected' then
    update public.profiles set balance=balance+v_item.amount,
      reserved_balance=reserved_balance-v_item.amount where id=v_item.user_id;
    insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
    values(v_item.user_id,v_item.amount,'withdrawal_refund','Penarikan ditolak dan saldo dikembalikan','withdrawal',v_item.id::text);
  else
    update public.profiles set reserved_balance=reserved_balance-v_item.amount where id=v_item.user_id;
    insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
    values(v_item.user_id,0,'withdrawal_paid','Penarikan ditandai sudah dibayar','withdrawal',v_item.id::text);
  end if;
  update public.withdrawals set status=p_status,review_note=left(coalesce(p_note,''),1000),reviewed_at=now()
  where id=v_item.id returning * into v_item;
  return to_jsonb(v_item);
end;
$fn_review_withdrawal$;

create or replace function public.review_robux_request(
  p_robux_request_id bigint, p_status text, p_note text, p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_review_robux_request$
declare
  v_item public.robux_requests%rowtype;
begin
  if p_status not in ('completed','rejected') then raise exception 'Status Robux tidak valid'; end if;
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin' and not disabled) then raise exception 'Akses admin ditolak'; end if;
  select * into v_item from public.robux_requests where id=p_robux_request_id for update;
  if not found then raise exception 'Permintaan Robux tidak ditemukan'; end if;
  if v_item.status <> 'pending' then raise exception 'Permintaan Robux ini sudah diperiksa'; end if;
  if v_item.cost > (select reserved_balance from public.profiles where id=v_item.user_id) then
    raise exception 'Saldo tertahan tidak konsisten';
  end if;
  if p_status='rejected' then
    update public.profiles set balance=balance+v_item.cost,
      reserved_balance=reserved_balance-v_item.cost where id=v_item.user_id;
    insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
    values(v_item.user_id,v_item.cost,'robux_refund','Permintaan Robux ditolak dan saldo dikembalikan','robux',v_item.id::text);
  else
    update public.profiles set reserved_balance=reserved_balance-v_item.cost where id=v_item.user_id;
    insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
    values(v_item.user_id,0,'robux_completed','Penukaran Robux selesai','robux',v_item.id::text);
  end if;
  update public.robux_requests set status=p_status,review_note=left(coalesce(p_note,''),1000),reviewed_at=now()
  where id=v_item.id returning * into v_item;
  return to_jsonb(v_item);
end;
$fn_review_robux_request$;

create or replace function public.admin_adjust_balance(
  p_user_id uuid, p_amount numeric, p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn_admin_adjust_balance$
declare
  v_profile public.profiles%rowtype;
begin
  if p_amount is null or p_amount=0 then raise exception 'Nominal penyesuaian tidak valid'; end if;
  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  if v_profile.balance+p_amount < 0 then raise exception 'Saldo tidak boleh negatif'; end if;
  update public.profiles set balance=balance+p_amount where id=p_user_id returning * into v_profile;
  insert into public.wallet_transactions(user_id,amount,type,reason,reference_type,reference_id)
  values(p_user_id,p_amount,'admin_adjustment',left(coalesce(p_reason,'Penyesuaian admin'),200),'profile',p_user_id::text);
  return jsonb_build_object('user_id',v_profile.id,'balance',v_profile.balance);
end;
$fn_admin_adjust_balance$;
revoke all on function public.create_withdrawal(uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.create_robux_request(uuid,text,integer,text,text,numeric,numeric) from public, anon, authenticated;
revoke all on function public.review_submission(bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.review_withdrawal(bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.review_robux_request(bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.admin_adjust_balance(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid,numeric,text,text) to service_role;
grant execute on function public.create_robux_request(uuid,text,integer,text,text,numeric,numeric) to service_role;
grant execute on function public.review_submission(bigint,text,text,uuid) to service_role;
grant execute on function public.review_withdrawal(bigint,text,text,uuid) to service_role;
grant execute on function public.review_robux_request(bigint,text,text,uuid) to service_role;
grant execute on function public.admin_adjust_balance(uuid,numeric,text) to service_role;

notify pgrst, 'reload schema';
