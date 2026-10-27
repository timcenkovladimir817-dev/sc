-- Apply after 0001_init.sql and 0002_seed_course.sql, in SQL Editor.
-- Atomic: an error rolls back every change in this migration.
begin;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_blocked = false
  );
$$;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Restrictive policies also constrain any old permissive policies made manually.
do $$
declare t text;
begin
  foreach t in array array['profiles','courses','course_modules','enrollments',
    'module_progress','invitations','progress_links','notification_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists active_account_required on public.%I', t);
    execute format('create policy active_account_required on public.%I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Ownership/admin boundaries remain effective even with old permissive policies.
drop policy if exists profile_owner_required on public.profiles;
create policy profile_owner_required on public.profiles as restrictive for all to authenticated
using (id = (select auth.uid()) or (select public.is_admin()))
with check (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists enrollment_owner_required on public.enrollments;
create policy enrollment_owner_required on public.enrollments as restrictive for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));
do $$
declare op text; t text;
begin
  foreach op in array array['insert','update','delete'] loop
    execute format('drop policy if exists admin_%s_required on public.enrollments', op);
    execute format('create policy admin_%s_required on public.enrollments as restrictive for %s to authenticated %s', op, op,
      case op when 'insert' then 'with check ((select public.is_admin()))'
      when 'delete' then 'using ((select public.is_admin()))'
      else 'using ((select public.is_admin())) with check ((select public.is_admin()))' end);
  end loop;
  foreach t in array array['invitations','progress_links','notification_log'] loop
    execute format('drop policy if exists admin_required on public.%I', t);
    execute format('create policy admin_required on public.%I as restrictive for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

grant select on public.profiles, public.courses, public.course_modules,
  public.enrollments, public.module_progress, public.invitations,
  public.progress_links, public.notification_log to authenticated;
-- Role, identity and blocking are changed by trusted server code or SQL Editor.
grant update (full_name, position, department) on public.profiles to authenticated;
grant insert, update, delete on public.enrollments to authenticated;
grant insert, update on public.module_progress to authenticated;
grant update (revoked) on public.progress_links to authenticated;
revoke all on sequence public.notification_log_id_seq from public, anon, authenticated;

-- Identity cannot be moved to another enrollment by an UPDATE.
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
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists module_progress_guard on public.module_progress;
create trigger module_progress_guard before insert or update on public.module_progress
for each row execute function public.guard_module_progress();
revoke all on function public.guard_module_progress() from public, anon, authenticated;

drop policy if exists assigned_course_required on public.module_progress;
create policy assigned_course_required on public.module_progress as restrictive
for all to authenticated
using (exists (
  select 1 from public.enrollments e
  where e.id = enrollment_id and e.status <> 'cancelled'
    and (e.user_id = (select auth.uid()) or (select public.is_admin()))
))
with check (exists (
  select 1 from public.enrollments e
  join public.course_modules cm on cm.course_id = e.course_id
  where e.id = enrollment_id and cm.slug = module_slug and e.status <> 'cancelled'
    and (e.user_id = (select auth.uid()) or (select public.is_admin()))
));

-- Only real modules contribute to the total, including pre-existing rows.
create or replace function public.recalc_enrollment_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_total int; v_sum numeric;
begin
  if tg_op = 'DELETE' then v_id := old.enrollment_id; else v_id := new.enrollment_id; end if;
  select count(*), coalesce(sum(mp.percent),0) into v_total, v_sum
  from public.enrollments e
  join public.course_modules cm on cm.course_id = e.course_id
  left join public.module_progress mp on mp.enrollment_id = e.id and mp.module_slug = cm.slug
  where e.id = v_id;
  update public.enrollments set
    progress = case when v_total = 0 then 0 else least(100, round(v_sum / v_total)) end,
    status = case
      when status = 'cancelled' then status
      when v_total > 0 and v_sum / v_total >= 100 then 'completed'
      when status in ('assigned','completed') then 'in_progress'
      else status end,
    completed_at = case when v_total > 0 and v_sum / v_total >= 100 then coalesce(completed_at, now()) else null end
  where id = v_id;
  return null;
end $$;
revoke all on function public.recalc_enrollment_progress() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_update() from public, anon, authenticated;

-- Token links stop working for blocked users and cancelled assignments.
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
           where mp.enrollment_id = e.id), '[]'::jsonb), now()
  from public.progress_links l
  join public.enrollments e on e.id = l.enrollment_id
  join public.profiles p on p.id = e.user_id
  join public.courses c on c.id = e.course_id
  where length(p_token) = 48 and l.token = p_token and not l.revoked
    and (l.expires_at is null or l.expires_at > now())
    and not p.is_blocked and e.status <> 'cancelled'
  limit 1;
$$;

-- Explicit API function privileges. Table grants do not cover functions.
revoke all on function public.create_progress_link(uuid,integer) from public, anon;
grant execute on function public.create_progress_link(uuid,integer) to authenticated;
revoke all on function public.progress_by_token(text) from public;
grant execute on function public.progress_by_token(text) to anon, authenticated;

commit;
