-- Арматура PRO — приглашение помечается «принято» после первого входа сотрудника.
-- Причина бага: invitations.status навсегда оставался 'pending' («Ожидает входа»),
-- потому что его никто не менял — колонка accepted_at есть в схеме 0001, но ни один
-- код её не заполнял. Сотрудник заходил и учился, а в админке висел статус ожидания.
-- Решение: триггер на auth.users при первом входе (last_sign_in_at стал непустым)
-- ставит 'accepted' и accepted_at у ожидающих приглашений с этим email. Ниже —
-- разовая обратная заливка тех, кто уже вошёл, но чьё приглашение «зависло».
-- Выполните в Supabase → SQL Editor после 0001–0010.

begin;

create or replace function public.accept_invitation_on_signin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Первый вход: last_sign_in_at сменился с NULL на значение.
  if new.last_sign_in_at is not null and old.last_sign_in_at is null then
    update public.invitations
       set status = 'accepted',
           accepted_at = now()
     where status = 'pending'
       and lower(email) = lower(new.email);
  end if;
  return new;
end $$;

revoke all on function public.accept_invitation_on_signin() from public, anon, authenticated;

drop trigger if exists on_auth_user_signin on auth.users;
create trigger on_auth_user_signin
after update of last_sign_in_at on auth.users
for each row execute function public.accept_invitation_on_signin();

-- Разовая обратная заливка: пользователи, которые уже вошли, но их приглашения
-- так и остались в статусе «Ожидает входа».
update public.invitations i
   set status = 'accepted',
       accepted_at = now()
 where i.status = 'pending'
   and exists (
     select 1 from auth.users u
     where lower(u.email) = lower(i.email)
       and u.last_sign_in_at is not null
   );

commit;
