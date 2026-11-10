-- Арматура PRO — статистика по каждому ученику: результат теста и активность.
-- Выполните в Supabase → SQL Editor после 0001–0007.
-- Добавляет к назначению лучший результат итогового теста, дату начала и дату
-- последней активности. На этих данных строится страница admin/stats.html.

begin;

-- Лучший результат итогового теста (0–100, NULL — тест ещё не пройден)
-- и даты активности по назначению.
alter table public.enrollments add column if not exists quiz_best smallint;
alter table public.enrollments add column if not exists started_at timestamptz;
alter table public.enrollments add column if not exists last_activity_at timestamptz;

-- save_my_progress теперь фиксирует начало и последнюю активность ученика.
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

  if p_slug is null or not exists (
    select 1
    from public.enrollments e
    join public.course_modules cm on cm.course_id = e.course_id and cm.slug = p_slug
    where e.id = v_enrollment
      and (
        not exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id)
        or exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id and em.module_slug = p_slug)
      )
  ) then
    raise exception 'Модуль не входит в назначенный курс';
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

  update public.enrollments
  set started_at = coalesce(started_at, now()),
      last_activity_at = now()
  where id = v_enrollment;

  return jsonb_build_object('ok', true, 'slug', p_slug, 'percent', p_percent);
end $$;

revoke all on function public.save_my_progress(text, smallint, text) from public, anon;
grant execute on function public.save_my_progress(text, smallint, text) to authenticated;

-- Ученик записывает лучший результат итогового теста (0–100).
create or replace function public.save_my_quiz(p_percent smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment uuid;
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
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

  update public.enrollments
  set quiz_best = greatest(coalesce(quiz_best, 0), p_percent),
      started_at = coalesce(started_at, now()),
      last_activity_at = now()
  where id = v_enrollment;

  return jsonb_build_object('ok', true, 'percent', p_percent);
end $$;

revoke all on function public.save_my_quiz(smallint) from public, anon;
grant execute on function public.save_my_quiz(smallint) to authenticated;

-- Ученик читает свой лучший результат теста для восстановления интерфейса после входа.
create or replace function public.my_quiz_best()
returns smallint
language sql
security definer
set search_path = ''
as $$
  select e.quiz_best
  from public.enrollments e
  where e.user_id = auth.uid() and e.status <> 'cancelled'
  order by e.created_at asc
  limit 1;
$$;

revoke all on function public.my_quiz_best() from public, anon;
grant execute on function public.my_quiz_best() to authenticated;

commit;
