-- Арматура PRO — роль «наставник» получает доступ к контролю обучения.
-- Выполните в Supabase → SQL Editor после 0001–0005.
-- Наставник (teacher) может: приглашать учеников, видеть чужой прогресс,
-- выдавать ссылки на прогресс и выгружать результаты. Смена ролей, блокировка,
-- удаление и журнал остаются только у администратора.

-- Роль teacher добавляется отдельно от транзакции (как в 0004).
alter type public.app_role add value if not exists 'teacher';

begin;

-- Персонал = администратор или наставник (активные).
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin','teacher')
      and is_blocked = false
  );
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Профили: персонал видит всех (контроль прогресса и экспорт).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profile_owner_required on public.profiles;
create policy profile_owner_required on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()))
  with check (id = (select auth.uid()) or (select public.is_staff()));

-- Назначения: персонал видит чужие назначения.
drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists enrollment_owner_required on public.enrollments;
create policy enrollment_owner_required on public.enrollments as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

-- Прогресс по модулям: персонал видит чужой прогресс.
drop policy if exists module_progress_read on public.module_progress;
create policy module_progress_read on public.module_progress for select to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.id = enrollment_id and (e.user_id = auth.uid() or public.is_staff())
  ));

-- Запись прогресса остаётся только за самим учеником (или админом).
drop policy if exists assigned_course_required on public.module_progress;
create policy assigned_course_required on public.module_progress as restrictive for all to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.id = enrollment_id and e.status <> 'cancelled'
      and (e.user_id = (select auth.uid()) or (select public.is_staff()))
  ))
  with check (exists (
    select 1 from public.enrollments e
    join public.course_modules cm on cm.course_id = e.course_id
    where e.id = enrollment_id and cm.slug = module_slug and e.status <> 'cancelled'
      and (e.user_id = (select auth.uid()) or (select public.is_admin()))
  ));

-- Ссылку на прогресс теперь выдаёт и наставник.
create or replace function public.create_progress_link(p_enrollment uuid, p_days integer default 90)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_staff() then raise exception 'Недостаточно прав'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Срок ссылки от 1 до 3650 дней'; end if;
  if not exists (select 1 from public.enrollments where id = p_enrollment) then raise exception 'Назначение не найдено'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.progress_links (enrollment_id, token, created_by, expires_at)
  values (p_enrollment, v_token, auth.uid(), now() + make_interval(days => p_days));
  return v_token;
end $$;
revoke all on function public.create_progress_link(uuid, integer) from public, anon;
grant execute on function public.create_progress_link(uuid, integer) to authenticated;

commit;
