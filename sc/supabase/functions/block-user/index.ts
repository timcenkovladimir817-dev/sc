// Блокировка и разблокировка сотрудника. Только администратор.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json, fail, cleanText } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Только POST', 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail('Нет авторизации', 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: me } = await asUser.auth.getUser();
  if (!me.user) return fail('Сессия недействительна', 401);
  const { data: profile } = await asUser.from('profiles').select('role, is_blocked').eq('id', me.user.id).single();
  if (!profile || profile.role !== 'admin' || profile.is_blocked) return fail('Нужны права администратора', 403);

  let body: any;
  try { body = await req.json(); } catch { return fail('Неверный JSON'); }
  const userId = cleanText(body.userId, 40);
  const blocked = body.blocked === true;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail('Некорректный идентификатор пользователя');
  if (userId === me.user.id) return fail('Нельзя заблокировать собственную учётную запись', 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: updateError } = await admin.from('profiles').update({ is_blocked: blocked }).eq('id', userId);
  if (updateError) return fail(updateError.message, 500);

  // Блокировка должна действовать и на уровне входа, а не только интерфейса.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: blocked ? '876000h' : 'none',
  });
  if (authError) return fail('Профиль обновлён, но вход не заблокирован: ' + authError.message, 500);

  await admin.from('notification_log').insert({ kind: blocked ? 'user_blocked' : 'user_unblocked', payload: { userId, by: me.user.id } });
  return json({ ok: true, userId, blocked });
});
