-- Арматура PRO — прогресс, привязанный к конкретному назначению (enrollment).
-- Выполните в Supabase → SQL Editor после 0001–0011.
--
-- Зачем: старые save_my_progress / my_progress / save_my_quiz / my_quiz_best
-- выбирали самое старое назначение пользователя (order by created_at asc limit 1).
-- При повторном назначении или втором курсе прогресс писался не в то назначение.
-- Новые функции принимают явный enrollment_id и проверяют, что назначение
-- принадлежит текущему пользователю. Клиент передаёт активное назначение
-- (window.ACTIVE_ENROLLMENT из loader.js) и откатывается на старые функции,
-- если новые ещё не установлены.
--
-- Также добавляется reset_my_progress — сброс отметки «изучено» в облаке:
-- раньше снятие отметки локально не отражалось (процент только рос).

begin;

-- 1. Запись прогресса по одному модулю для конкретного назначения.
create or replace function public.save_my_progress_for(
  p_enrollment uuid, p_slug text, p_percent smallint, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old smallint;
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'Процент должен быть от 0 до 100';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment and e.user_id = auth.uid() and e.status <> 'cancelled'
  ) then
    raise exception 'Назначение не найдено или недоступно' using errcode = '42501';
  end if;
  if p_slug is null or not exists (
    select 1
    from public.enrollments e
    join public.course_modules cm on cm.course_id = e.course_id and cm.slug = p_slug
    where e.id = p_enrollment
      and (
        not exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id)
        or exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id and em.module_slug = p_slug)
      )
  ) then
    raise exception 'Модуль не входит в назначенный курс';
  end if;

  select percent into v_old
  from public.module_progress
  where enrollment_id = p_enrollment and module_slug = p_slug;

  if v_old is null then
    insert into public.module_progress (enrollment_id, module_slug, percent, notes)
    values (p_enrollment, p_slug, p_percent, nullif(p_notes, ''));
  else
    update public.module_progress
    set percent = greatest(percent, p_percent),
        notes = case when p_notes is not null and p_notes <> '' then p_notes else notes end,
        updated_at = now()
    where enrollment_id = p_enrollment and module_slug = p_slug;
  end if;

  update public.enrollments
  set started_at = coalesce(started_at, now()),
      last_activity_at = now()
  where id = p_enrollment;

  return jsonb_build_object('ok', true, 'slug', p_slug, 'percent', p_percent);
end $$;
revoke all on function public.save_my_progress_for(uuid, text, smallint, text) from public, anon;
grant execute on function public.save_my_progress_for(uuid, text, smallint, text) to authenticated;

-- 2. Чтение прогресса по конкретному назначению.
create or replace function public.my_progress_for(p_enrollment uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment and e.user_id = auth.uid() and e.status <> 'cancelled'
  ) then
    raise exception 'Назначение не найдено или недоступно' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', mp.module_slug, 'percent', mp.percent, 'notes', mp.notes, 'updated_at', mp.updated_at
  ) order by mp.module_slug), '[]'::jsonb)
  into v_result
  from public.module_progress mp
  where mp.enrollment_id = p_enrollment
    and (
      not exists (select 1 from public.enrollment_modules em where em.enrollment_id = p_enrollment)
      or exists (select 1 from public.enrollment_modules em where em.enrollment_id = p_enrollment and em.module_slug = mp.module_slug)
    );
  return v_result;
end $$;
revoke all on function public.my_progress_for(uuid) from public, anon;
grant execute on function public.my_progress_for(uuid) to authenticated;

-- 3. Лучший результат теста по конкретному назначению.
create or replace function public.save_my_quiz_for(p_enrollment uuid, p_percent smallint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'Процент должен быть от 0 до 100';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment and e.user_id = auth.uid() and e.status <> 'cancelled'
  ) then
    raise exception 'Назначение не найдено или недоступно' using errcode = '42501';
  end if;

  update public.enrollments
  set quiz_best = greatest(coalesce(quiz_best, 0), p_percent),
      started_at = coalesce(started_at, now()),
      last_activity_at = now()
  where id = p_enrollment;

  return jsonb_build_object('ok', true, 'percent', p_percent);
end $$;
revoke all on function public.save_my_quiz_for(uuid, smallint) from public, anon;
grant execute on function public.save_my_quiz_for(uuid, smallint) to authenticated;

create or replace function public.my_quiz_best_for(p_enrollment uuid)
returns smallint
language sql security definer set search_path = ''
as $$
  select e.quiz_best
  from public.enrollments e
  where e.id = p_enrollment
    and e.user_id = auth.uid()
    and e.status <> 'cancelled'
  limit 1;
$$;
revoke all on function public.my_quiz_best_for(uuid) from public, anon;
grant execute on function public.my_quiz_best_for(uuid) to authenticated;

-- 4. Сброс отметки «изучено» (удаление строки прогресса по модулю).
create or replace function public.reset_my_progress(p_enrollment uuid, p_slug text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Нет авторизации' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment and e.user_id = auth.uid() and e.status <> 'cancelled'
  ) then
    raise exception 'Назначение не найдено или недоступно' using errcode = '42501';
  end if;

  delete from public.module_progress
  where enrollment_id = p_enrollment and module_slug = p_slug;

  return jsonb_build_object('ok', true, 'slug', p_slug);
end $$;
revoke all on function public.reset_my_progress(uuid, text) from public, anon;
grant execute on function public.reset_my_progress(uuid, text) to authenticated;

commit;
