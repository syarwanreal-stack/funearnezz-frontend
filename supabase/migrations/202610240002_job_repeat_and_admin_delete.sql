-- Allow optional repeat submissions per job and preserve audit history when admin removes published items.
begin;
alter table public.jobs add column if not exists allow_repeat boolean not null default false;

create or replace function public.funearnezz_reserve_job_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  quota_limit integer;
  occupied integer;
  repeat_allowed boolean;
begin
  select j.quota,j.quota_used,j.allow_repeat into quota_limit,occupied,repeat_allowed
  from public.jobs j where j.id=new.job_id and j.status='active' for update;
  if not found then raise exception 'Tugas tidak tersedia.'; end if;
  if not coalesce(repeat_allowed,false) and exists (
    select 1 from public.submissions s
    where s.user_id=new.user_id and s.job_id=new.job_id
  ) then
    raise exception 'Job ini hanya boleh dikerjakan satu kali untuk setiap akun.';
  end if;
  if quota_limit is not null and occupied >= quota_limit then
    raise exception 'Kuota job sudah habis.';
  end if;
  update public.jobs set quota_used=quota_used+1 where id=new.job_id;
  return new;
end;
$$;
commit;
