-- Арматура PRO — административные операции, которые нельзя делать обычным UPDATE.
-- Выполните в Supabase → SQL Editor после 0001–0003.
-- Все функции проверяют public.is_admin() и работают только для вошедшего администратора.

-- Роль «наставник» (teacher) добавляется отдельно от транзакции —
-- так ALTER TYPE ADD VALUE работает на любых версиях PostgreSQL.
alter type public.app_role add value if not exists 'teacher';

begin;

-- Журнал действий администратора: кто, что и с кем сделал.
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists audit_admin_read on public.admin_audit_log;
create policy audit_admin_read on public.admin_audit_log for select to authenticated
using (public.is_admin());

revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function public.admin_log_action(p_action text, p_target text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_action is null or p_action = '' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  insert into public.admin_audit_log (admin_id, action, target, details)
  values ((select auth.uid()), p_action, coalesce(p_target, ''), coalesce(p_details, '{}'::jsonb));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_log_action(text, text, jsonb) from public, anon;
grant execute on function public.admin_log_action(text, text, jsonb) to authenticated;

-- Смена роли. Тип колонки profiles.role может быть enum или text,
-- поэтому тип подставляется из системного каталога, а не жёстко.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_role text;
  v_role_type text;
  v_active_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'Нельзя менять собственную роль';
  end if;
  if p_role is null or p_role not in ('admin', 'teacher', 'student') then
    raise exception 'Недопустимая роль: %', coalesce(p_role, 'null');
  end if;

  execute 'select role::text from public.profiles where id = $1'
    into v_old_role using p_user;
  if v_old_role is null then
    raise exception 'Пользователь не найден';
  end if;

  if v_old_role = 'admin' and p_role <> 'admin' then
    execute 'select count(*) from public.profiles where role::text = ''admin'' and is_blocked = false'
      into v_active_admins;
    if v_active_admins <= 1 then
      raise exception 'Нельзя снять роль с последнего активного администратора';
    end if;
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into v_role_type
  from pg_attribute a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'role'
    and not a.attisdropped;

  if v_role_type is null then
    raise exception 'В таблице public.profiles нет колонки role';
  end if;

  execute format('update public.profiles set role = $1::%s where id = $2', v_role_type)
    using p_role, p_user;

  perform public.admin_log_action('role_changed', 'profile',
    jsonb_build_object('userId', p_user, 'role', p_role, 'oldRole', v_old_role));

  return jsonb_build_object('ok', true, 'userId', p_user, 'role', p_role);
end $$;

revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- Отзыв ещё не принятого приглашения.
create or replace function public.admin_revoke_invitation(p_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  execute 'select status::text from public.invitations where id = $1'
    into v_status using p_invitation;
  if v_status is null then
    raise exception 'Приглашение не найдено';
  end if;
  if v_status <> 'pending' then
    raise exception 'Отозвать можно только ожидающее приглашение';
  end if;

  execute 'update public.invitations set status = ''revoked'', revoked_at = now() where id = $1'
    using p_invitation;

  perform public.admin_log_action('invitation_revoked', 'invitation',
    jsonb_build_object('invitationId', p_invitation));

  return jsonb_build_object('ok', true, 'invitationId', p_invitation);
end $$;

revoke all on function public.admin_revoke_invitation(uuid) from public, anon;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;

-- Полное удаление учётной записи: auth.users → каскадом профиль, назначения, прогресс.
-- Нужно для ошибочно созданных приглашений. Блокировка — отдельная операция.
create or replace function public.admin_delete_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_email text;
  v_active_admins integer;
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'Нельзя удалить собственную учётную запись';
  end if;

  execute 'select role::text, email from public.profiles where id = $1'
    into v_role, v_email using p_user;
  if v_role is null then
    raise exception 'Пользователь не найден';
  end if;

  if v_role = 'admin' then
    execute 'select count(*) from public.profiles where role::text = ''admin'' and is_blocked = false'
      into v_active_admins;
    if v_active_admins <= 1 then
      raise exception 'Нельзя удалить последнего активного администратора';
    end if;
  end if;

  -- Ссылки «кто пригласил / назначил / создал» не должны блокировать удаление.
  execute 'update public.enrollments set assigned_by = null where assigned_by = $1' using p_user;
  execute 'update public.invitations set invited_by = null where invited_by = $1' using p_user;
  execute 'update public.progress_links set created_by = null where created_by = $1' using p_user;

  delete from auth.users where id = p_user;
  if not found then
    raise exception 'Учётная запись не найдена в auth.users';
  end if;

  insert into public.notification_log (kind, payload)
  values ('user_deleted', jsonb_build_object('userId', p_user, 'email', v_email, 'by', (select auth.uid())));

  perform public.admin_log_action('user_deleted', 'profile',
    jsonb_build_object('userId', p_user, 'email', v_email));

  return jsonb_build_object('ok', true, 'userId', p_user, 'email', v_email);
end $$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

commit;
