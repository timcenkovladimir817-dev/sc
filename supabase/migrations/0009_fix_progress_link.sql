-- Арматура PRO — исправление create_progress_link.
-- Причина: gen_random_bytes() из расширения pgcrypto на Supabase ставится в схему
-- extensions, а функция create_progress_link объявлена с search_path = public,
-- поэтому при вызове pgcrypto не виден и возникает
-- «function gen_random_bytes(integer) does not exist».
-- Решение: токен генерируется встроенной gen_random_uuid() (PostgreSQL 13+, pg_catalog),
-- расширения не требуются. Длина токена остаётся 48 hex-символов, как ожидает progress.html.
-- Выполните в Supabase → SQL Editor после 0001–0008.

begin;

create or replace function public.create_progress_link(p_enrollment uuid, p_days integer default 90)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_staff() then raise exception 'Недостаточно прав'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Срок ссылки от 1 до 3650 дней'; end if;
  if not exists (select 1 from public.enrollments where id = p_enrollment) then raise exception 'Назначение не найдено'; end if;
  v_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 48);
  insert into public.progress_links (enrollment_id, token, created_by, expires_at)
  values (p_enrollment, v_token, auth.uid(), now() + make_interval(days => p_days));
  return v_token;
end $$;

revoke all on function public.create_progress_link(uuid, integer) from public, anon;
grant execute on function public.create_progress_link(uuid, integer) to authenticated;

commit;
