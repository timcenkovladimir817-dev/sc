-- Арматура PRO — назначение курса и отдельных глав (блоков) сотруднику.
-- Выполните в Supabase → SQL Editor после 0001–0006.
-- Даёт администратору и наставнику назначать не весь курс, а выбранные главы,
-- и менять назначение существующему пользователю (не только через приглашение).
--
-- Соглашение: если для назначения нет строк в enrollment_modules — значит,
-- назначен весь курс (совместимо со старыми назначениями). Если строки есть —
-- назначены только перечисленные главы.

begin;

-- 1. Главы, назначенные в рамках конкретного назначения (enrollment).
create table if not exists public.enrollment_modules (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  module_slug text not null,
  primary key (enrollment_id, module_slug)
);

alter table public.enrollment_modules enable row level security;

-- Активная учётная запись обязательна (как в 0003 для остальных таблиц).
drop policy if exists active_account_required on public.enrollment_modules;
create policy active_account_required on public.enrollment_modules as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- Читать свои назначенные главы может ученик; персонал видит все.
drop policy if exists enrollment_modules_read on public.enrollment_modules;
create policy enrollment_modules_read on public.enrollment_modules for select to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.id = enrollment_id and (e.user_id = auth.uid() or public.is_staff())
  ));

-- Изменяют назначение только персонал; обычно это делает функция assign_enrollment.
drop policy if exists enrollment_modules_write on public.enrollment_modules;
create policy enrollment_modules_write on public.enrollment_modules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

revoke all on table public.enrollment_modules from public, anon, authenticated;
grant select, insert, update, delete on public.enrollment_modules to authenticated;

-- 2. Пересчёт прогресса по назначенным главам (если подмножество задано).
create or replace function public.recalc_one_enrollment(p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
  v_sum numeric;
begin
  select count(*), coalesce(sum(mp.percent), 0) into v_total, v_sum
  from public.enrollments e
  join public.course_modules cm on cm.course_id = e.course_id
  left join public.module_progress mp on mp.enrollment_id = e.id and mp.module_slug = cm.slug
  where e.id = p_enrollment
    and (
      not exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id)
      or exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id and em.module_slug = cm.slug)
    );

  update public.enrollments set
    progress = case when v_total = 0 then 0 else least(100, round(v_sum / v_total)) end,
    status = case
      when status = 'cancelled' then status
      when v_total > 0 and v_sum / v_total >= 100 then 'completed'
      when v_sum > 0 or status = 'completed' then 'in_progress'
      else status
    end,
    completed_at = case when v_total > 0 and v_sum / v_total >= 100 then coalesce(completed_at, now()) else null end
  where id = p_enrollment;
end $$;
revoke all on function public.recalc_one_enrollment(uuid) from public, anon, authenticated;

-- Триггер пересчёта теперь делегирует в recalc_one_enrollment.
create or replace function public.recalc_enrollment_progress() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then v_id := old.enrollment_id; else v_id := new.enrollment_id; end if;
  perform public.recalc_one_enrollment(v_id);
  return null;
end $$;
revoke all on function public.recalc_enrollment_progress() from public, anon, authenticated;

-- 3. Ученик пишет прогресс только по назначенным главам.
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

  return jsonb_build_object('ok', true, 'slug', p_slug, 'percent', p_percent);
end $$;
revoke all on function public.save_my_progress(text, smallint, text) from public, anon;
grant execute on function public.save_my_progress(text, smallint, text) to authenticated;

-- 4. Чтение собственного прогресса — только назначенные главы.
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
  where e.user_id = auth.uid() and e.status <> 'cancelled'
    and (
      not exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id)
      or exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id and em.module_slug = mp.module_slug)
    );
  return v_result;
end $$;
revoke all on function public.my_progress() from public, anon;
grant execute on function public.my_progress() to authenticated;

-- 5. Ссылка на прогресс показывает только назначенные главы.
create or replace function public.progress_by_token(p_token text)
returns table (
  full_name text, course_title text, progress smallint, status text,
  due_date date, mentor_email text, supervisor_email text, modules jsonb, generated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.full_name, c.title, e.progress, e.status::text, e.due_date,
         e.mentor_email, e.supervisor_email,
         coalesce((select jsonb_agg(jsonb_build_object('slug', mp.module_slug, 'percent', mp.percent, 'updated_at', mp.updated_at) order by mp.module_slug)
           from public.module_progress mp
           join public.course_modules cm on cm.course_id = e.course_id and cm.slug = mp.module_slug
           where mp.enrollment_id = e.id
             and (
               not exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id)
               or exists (select 1 from public.enrollment_modules em where em.enrollment_id = e.id and em.module_slug = mp.module_slug)
             )), '[]'::jsonb), now()
  from public.progress_links l
  join public.enrollments e on e.id = l.enrollment_id
  join public.profiles p on p.id = e.user_id
  join public.courses c on c.id = e.course_id
  where length(p_token) = 48 and l.token = p_token and not l.revoked
    and (l.expires_at is null or l.expires_at > now())
    and not p.is_blocked and e.status <> 'cancelled'
  limit 1;
$$;
revoke all on function public.progress_by_token(text) from public;
grant execute on function public.progress_by_token(text) to anon, authenticated;

-- 6. Защита прямых записей в module_progress: только назначенные главы.
create or replace function public.guard_module_progress() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and
    (new.enrollment_id is distinct from old.enrollment_id or
     new.module_slug is distinct from old.module_slug) then
    raise exception 'Progress identity cannot be changed' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.enrollments e
    join public.course_modules cm on cm.course_id = e.course_id
    where e.id = new.enrollment_id and cm.slug = new.module_slug
  ) then
    raise exception 'Module does not belong to assigned course' using errcode = '23514';
  end if;
  if exists (select 1 from public.enrollment_modules em where em.enrollment_id = new.enrollment_id)
     and not exists (select 1 from public.enrollment_modules em where em.enrollment_id = new.enrollment_id and em.module_slug = new.module_slug) then
    raise exception 'Module is not assigned' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_module_progress() from public, anon, authenticated;

-- 7. Назначение курса и глав существующему пользователю (админ и наставник).
create or replace function public.assign_enrollment(
  p_user uuid,
  p_course_id uuid,
  p_module_slugs text[] default null,
  p_mentor_email text default null,
  p_supervisor_email text default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment uuid;
  v_course_title text;
  v_user_email text;
  v_total int;
begin
  if not public.is_staff() then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  select email into v_user_email
  from public.profiles
  where id = p_user and role = 'student';
  if v_user_email is null then
    raise exception 'Назначать курс можно только сотруднику (роль «student»)';
  end if;

  select title into v_course_title
  from public.courses
  where id = p_course_id and is_active = true;
  if v_course_title is null then
    raise exception 'Курс не найден или неактивен';
  end if;

  if p_module_slugs is not null and cardinality(p_module_slugs) > 0 then
    select count(*) into v_total
    from public.course_modules cm
    where cm.course_id = p_course_id
      and cm.slug = any(p_module_slugs);
    if v_total <> cardinality(p_module_slugs) then
      raise exception 'Некоторые главы не принадлежат выбранному курсу';
    end if;
  end if;

  insert into public.enrollments (user_id, course_id, mentor_email, supervisor_email, due_date, assigned_by, status)
  values (p_user, p_course_id, nullif(p_mentor_email, ''), nullif(p_supervisor_email, ''), p_due_date, auth.uid(), 'assigned')
  on conflict (user_id, course_id) do update set
    mentor_email = excluded.mentor_email,
    supervisor_email = excluded.supervisor_email,
    due_date = excluded.due_date,
    assigned_by = excluded.assigned_by,
    status = case when public.enrollments.status = 'cancelled' then 'assigned' else public.enrollments.status end
  returning id into v_enrollment;

  -- Перезаписываем набор глав. Пустой/null набор = весь курс.
  delete from public.enrollment_modules where enrollment_id = v_enrollment;
  if p_module_slugs is not null and cardinality(p_module_slugs) > 0 then
    insert into public.enrollment_modules (enrollment_id, module_slug)
    select v_enrollment, unnest(p_module_slugs);
  end if;

  perform public.recalc_one_enrollment(v_enrollment);

  -- Журнал действий: виден администратору в audit.html.
  insert into public.admin_audit_log (admin_id, action, target, details)
  values (auth.uid(), 'course_assigned', 'enrollment',
    jsonb_build_object(
      'userId', p_user,
      'email', v_user_email,
      'enrollmentId', v_enrollment,
      'courseTitle', v_course_title,
      'modules', coalesce(to_jsonb(p_module_slugs), to_jsonb('all'))
    ));

  return jsonb_build_object(
    'ok', true,
    'enrollmentId', v_enrollment,
    'modules', coalesce(to_jsonb(p_module_slugs), to_jsonb('all'))
  );
end $$;
revoke all on function public.assign_enrollment(uuid, uuid, text[], text, text, date) from public, anon;
grant execute on function public.assign_enrollment(uuid, uuid, text[], text, text, date) to authenticated;

commit;
