-- Арматура PRO — учётные записи, приглашения, прогресс. PostgreSQL / Supabase.
begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin','student');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invite_status as enum ('pending','accepted','revoked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.enrollment_status as enum ('assigned','in_progress','completed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.app_role not null default 'student',
  position text,
  department text,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  is_active boolean not null default true,
  module_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  title text not null,
  position integer not null default 0,
  unique (course_id, slug)
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  mentor_email text,
  supervisor_email text,
  due_date date,
  status public.enrollment_status not null default 'assigned',
  progress smallint not null default 0 check (progress between 0 and 100),
  bitrix_task_id bigint,
  bitrix_responsible_id bigint,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);

create table if not exists public.module_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  module_slug text not null,
  percent smallint not null default 0 check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, module_slug)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  course_id uuid not null references public.courses(id),
  mentor_email text,
  supervisor_email text,
  due_date date,
  status public.invite_status not null default 'pending',
  invited_by uuid references public.profiles(id),
  user_id uuid references public.profiles(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  bitrix_task_id bigint,
  bitrix_error text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index if not exists invitations_email_idx on public.invitations (lower(email));

create table if not exists public.progress_links (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  token text not null unique,
  created_by uuid references public.profiles(id),
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_log (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  ok boolean not null default true,
  detail text,
  created_at timestamptz not null default now()
);

-- Профиль создаётся при появлении пользователя в auth.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_blocked = false);
$$;

-- Сотрудник не может повысить себе роль или снять блокировку.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if not public.is_admin() then
    new.role := old.role;
    new.is_blocked := old.is_blocked;
    new.email := old.email;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
for each row execute function public.guard_profile_update();

-- Пересчёт прогресса курса по модулям.
create or replace function public.recalc_enrollment_progress() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total int; v_sum numeric;
begin
  if tg_op = 'DELETE' then v_id := old.enrollment_id; else v_id := new.enrollment_id; end if;
  select count(*) into v_total from public.course_modules cm
    join public.enrollments e on e.course_id = cm.course_id where e.id = v_id;
  select coalesce(sum(percent),0) into v_sum from public.module_progress where enrollment_id = v_id;
  update public.enrollments set
    progress = case when v_total = 0 then 0 else least(100, round(v_sum / v_total)) end,
    status = case
      when v_total > 0 and v_sum / v_total >= 100 then 'completed'
      when status = 'assigned' then 'in_progress'
      else status end,
    completed_at = case when v_total > 0 and v_sum / v_total >= 100 then coalesce(completed_at, now()) else null end
  where id = v_id;
  return null;
end $$;

drop trigger if exists module_progress_recalc on public.module_progress;
create trigger module_progress_recalc after insert or update or delete on public.module_progress
for each row execute function public.recalc_enrollment_progress();

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.enrollments enable row level security;
alter table public.module_progress enable row level security;
alter table public.invitations enable row level security;
alter table public.progress_links enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated using (true);

drop policy if exists course_modules_read on public.course_modules;
create policy course_modules_read on public.course_modules for select to authenticated using (true);

drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists enrollments_admin on public.enrollments;
create policy enrollments_admin on public.enrollments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists module_progress_read on public.module_progress;
create policy module_progress_read on public.module_progress for select to authenticated
using (exists (select 1 from public.enrollments e where e.id = enrollment_id and (e.user_id = auth.uid() or public.is_admin())));

drop policy if exists module_progress_write on public.module_progress;
create policy module_progress_write on public.module_progress for insert to authenticated
with check (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.user_id = auth.uid()));

drop policy if exists module_progress_update on public.module_progress;
create policy module_progress_update on public.module_progress for update to authenticated
using (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.user_id = auth.uid()))
with check (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.user_id = auth.uid()));

drop policy if exists invitations_admin on public.invitations;
create policy invitations_admin on public.invitations for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists progress_links_admin on public.progress_links;
create policy progress_links_admin on public.progress_links for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists notification_log_admin on public.notification_log;
create policy notification_log_admin on public.notification_log for select to authenticated using (public.is_admin());

-- Ссылка на прогресс для наставника и руководителя: токен вместо учётной записи.
create or replace function public.create_progress_link(p_enrollment uuid, p_days integer default 90)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Срок ссылки от 1 до 3650 дней'; end if;
  if not exists (select 1 from public.enrollments where id = p_enrollment) then raise exception 'Назначение не найдено'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.progress_links (enrollment_id, token, created_by, expires_at)
  values (p_enrollment, v_token, auth.uid(), now() + make_interval(days => p_days));
  return v_token;
end $$;

create or replace function public.progress_by_token(p_token text)
returns table (
  full_name text, course_title text, progress smallint, status text,
  due_date date, mentor_email text, supervisor_email text, modules jsonb, generated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.full_name, c.title, e.progress, e.status::text, e.due_date,
         e.mentor_email, e.supervisor_email,
         coalesce((select jsonb_agg(jsonb_build_object('slug', mp.module_slug, 'percent', mp.percent, 'updated_at', mp.updated_at) order by mp.module_slug)
                   from public.module_progress mp where mp.enrollment_id = e.id), '[]'::jsonb),
         now()
  from public.progress_links l
  join public.enrollments e on e.id = l.enrollment_id
  join public.profiles p on p.id = e.user_id
  join public.courses c on c.id = e.course_id
  where l.token = p_token and l.revoked = false and (l.expires_at is null or l.expires_at > now())
  limit 1;
$$;

revoke all on function public.progress_by_token(text) from public;
grant execute on function public.progress_by_token(text) to anon, authenticated;
revoke all on function public.create_progress_link(uuid, integer) from public;
grant execute on function public.create_progress_link(uuid, integer) to authenticated;

commit;
