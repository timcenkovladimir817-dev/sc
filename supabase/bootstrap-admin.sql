-- Арматура PRO — первый администратор.
-- Это НЕ миграция: выполните файл один раз в Supabase → SQL Editor.
--
-- Порядок:
-- 1. Authentication → Users → Add user: создайте учётную запись с email и паролем.
--    Включите «Auto Confirm User», иначе вход не сработает до подтверждения письма.
-- 2. Замените admin@example.com ниже на email этой учётной записи.
-- 3. Выполните весь файл. В конце появится список администраторов.
--
-- После этого откройте /login.html, войдите и перейдите в /admin/.
-- Дальше сотрудников добавляйте через «Пригласить сотрудника»: пароль они зададут сами.

do $$
declare
  v_email text := 'admin@example.com';  -- ЗАМЕНИТЕ на свой email
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    raise exception 'Пользователь % не найден. Сначала создайте его в Authentication → Users → Add user.', v_email;
  end if;

  insert into public.profiles (id, full_name, email, role, is_blocked)
  select
    u.id,
    coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), 'Администратор обучения'),
    u.email,
    'admin',
    false
  from auth.users u
  where u.id = v_user_id
  on conflict (id) do update
    set role = 'admin',
        is_blocked = false,
        email = excluded.email;

  raise notice 'Готово: % назначен администратором.', v_email;
end $$;

-- Проверка. В списке должен быть ваш email и role = admin.
select id, email, full_name, role, is_blocked, created_at
from public.profiles
where role::text = 'admin'
order by created_at;
