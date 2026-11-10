-- Арматура PRO — синхронизация прогресса ученика и напоминания о сроках.
-- Выполните в Supabase → SQL Editor после 0001–0004.

begin;

-- Заметки ученика к модулю хранятся вместе с прогрессом.
alter table public.module_progress add column if not exists notes text;

-- Дата последнего напоминания о сроке — для подавления дублей писем.
alter table public.enrollments add column if not exists last_reminder_at timestamptz;

-- Ученик записывает свой прогресс по одному модулю.
-- Процент только растёт; заметку можно обновить. Работает для собственного назначения.
create or replace function public.save_my_progress(p_slug text, p_percent smallint, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment uuid;
  v_old smallint;
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
  end if;
  if p_slug is null or not exists (select 1 from public.course_modules where slug = p_slug) then
    raise exception 'Недопустимый модуль';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'Процент должен быть от 0 до 100';
  end if;

  select e.id into v_enrollment
  from public.enrollments e
  where e.user_id = auth.uid() and e.status <> 'cancelled'
  order by e.created_at asc
  limit 1;

  if v_enrollment is null then
    return jsonb_build_object('ok', false, 'reason', 'no_enrollment');
  end if;

  select percent into v_old
  from public.module_progress
  where enrollment_id = v_enrollment and module_slug = p_slug;

  if v_old is null then
    insert into public.module_progress (enrollment_id, module_slug, percent, notes)
    values (v_enrollment, p_slug, p_percent, nullif(p_notes, ''));
  else
    update public.module_progress
    set percent = greatest(percent, p_percent),
        notes = case when p_notes is not null and p_notes <> '' then p_notes else notes end,
        updated_at = now()
    where enrollment_id = v_enrollment and module_slug = p_slug;
  end if;

  return jsonb_build_object('ok', true, 'slug', p_slug, 'percent', p_percent);
end $$;

revoke all on function public.save_my_progress(text, smallint, text) from public, anon;
grant execute on function public.save_my_progress(text, smallint, text) to authenticated;

-- Ученик читает собственный прогресс для заполнения интерфейса после входа.
create or replace function public.my_progress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', mp.module_slug, 'percent', mp.percent, 'notes', mp.notes, 'updated_at', mp.updated_at
  ) order by mp.module_slug), '[]'::jsonb)
  into v_result
  from public.module_progress mp
  join public.enrollments e on e.id = mp.enrollment_id
  where e.user_id = auth.uid() and e.status <> 'cancelled';
  return v_result;
end $$;

revoke all on function public.my_progress() from public, anon;
grant execute on function public.my_progress() to authenticated;

commit;
