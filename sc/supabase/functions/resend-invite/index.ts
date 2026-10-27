// Повторное приглашение: новое письмо для непринятого приглашения.
// Старое приглашение помечается отозванным, создаётся новое с тем же назначением.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json, fail, cleanText } from '../_shared/cors.ts';
import { sendMail, inviteEmail } from '../_shared/mail.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? '';

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
  const { data: profile } = await asUser.from('profiles').select('role, is_blocked, full_name').eq('id', me.user.id).single();
  if (!profile || profile.role !== 'admin' || profile.is_blocked) return fail('Нужны права администратора', 403);

  let body: any;
  try { body = await req.json(); } catch { return fail('Неверный JSON'); }
  const invitationId = cleanText(body.invitationId, 40);
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return fail('Некорректный идентификатор приглашения');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: invitation } = await admin.from('invitations')
    .select('id, email, full_name, course_id, mentor_email, supervisor_email, due_date, status')
    .eq('id', invitationId).maybeSingle();
  if (!invitation) return fail('Приглашение не найдено', 404);
  if (invitation.status !== 'pending') return fail('Это приглашение уже принято или отозвано', 409);

  const { data: course } = await admin.from('courses').select('title').eq('id', invitation.course_id).single();

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: invitation.email,
    options: { redirectTo: `${SITE_URL}/reset.html` },
  });
  if (linkError) return fail('Ссылка не создана: ' + linkError.message, 400);

  let mailError: string | null = null;
  try {
    const letter = inviteEmail({
      fullName: invitation.full_name,
      courseTitle: course?.title ?? 'Курс',
      dueDate: invitation.due_date,
      inviteUrl: link.properties?.action_link ?? `${SITE_URL}/reset.html`,
      inviterName: profile.full_name || 'Администратор обучения',
    });
    await sendMail({ to: invitation.email, ...letter });
  } catch (error) {
    mailError = (error as Error).message;
  }

  await admin.from('invitations').update({
    status: 'revoked', revoked_at: new Date().toISOString(),
  }).eq('id', invitation.id);

  await admin.from('invitations').insert({
    email: invitation.email, full_name: invitation.full_name, course_id: invitation.course_id,
    mentor_email: invitation.mentor_email, supervisor_email: invitation.supervisor_email,
    due_date: invitation.due_date, invited_by: me.user.id, status: 'pending',
  });

  await admin.from('notification_log').insert({
    kind: 'invitation_resent', ok: !mailError, detail: mailError,
    payload: { email: invitation.email, invitationId },
  });

  if (mailError) return fail('Письмо не отправлено: ' + mailError, 502);
  return json({ ok: true, sentTo: invitation.email });
});
