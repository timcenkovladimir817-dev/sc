// Напоминания о сроках обучения. Только администратор.
// Тело запроса:
//   { enrollmentId: "uuid" }           — напомнить одному назначению
//   { days: 3 }                         — напомнить всем, у кого срок в пределах N дней или уже прошёл
// Ответ: { ok: true, sent: number, skipped: number, failed: [{ email, error }] }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json, fail, cleanText } from '../_shared/cors.ts';
import { sendMail, reminderEmail } from '../_shared/mail.ts';

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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Собрать назначения, которым нужна отправка.
  let enrollments: any[] = [];
  const enrollmentId = cleanText(body.enrollmentId, 40);
  if (enrollmentId && /^[0-9a-f-]{36}$/i.test(enrollmentId)) {
    const { data } = await admin.from('enrollments')
      .select('id, user_id, due_date, course_id')
      .eq('id', enrollmentId)
      .in('status', ['assigned', 'in_progress'])
      .maybeSingle();
    enrollments = data ? [data] : [];
  } else {
    const days = Math.max(0, Math.min(365, Number(body.days ?? 3) || 3));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const { data } = await admin.from('enrollments')
      .select('id, user_id, due_date, course_id')
      .in('status', ['assigned', 'in_progress'])
      .not('due_date', 'is', null)
      .lte('due_date', cutoff.toISOString().slice(0, 10));
    enrollments = data ?? [];
  }

  const failed: { email: string; error: string }[] = [];
  let skipped = 0;

  for (const enrollment of enrollments) {
    // Не дублируем письмо чаще раза в сутки.
    const { data: existing } = await admin.from('enrollments')
      .select('last_reminder_at').eq('id', enrollment.id).maybeSingle();
    if (existing?.last_reminder_at) {
      const last = new Date(existing.last_reminder_at);
      if (Date.now() - last.getTime() < 24 * 3600 * 1000) { skipped += 1; continue; }
    }

    const { data: student } = await admin.from('profiles')
      .select('email, full_name').eq('id', enrollment.user_id).maybeSingle();
    if (!student?.email) { skipped += 1; continue; }

    const { data: course } = await admin.from('courses')
      .select('title').eq('id', enrollment.course_id).single();

    const dueDate = enrollment.due_date;
    const daysLeft = dueDate
      ? Math.floor((new Date(dueDate).getTime() - Date.now()) / 86400000)
      : null;

    const letter = reminderEmail({
      fullName: student.full_name || 'Сотрудник',
      courseTitle: course?.title ?? 'Курс',
      dueDate,
      daysLeft,
    });

    try {
      await sendMail({ to: student.email, ...letter });
      await admin.from('enrollments').update({ last_reminder_at: new Date().toISOString() }).eq('id', enrollment.id);
    } catch (error) {
      failed.push({ email: student.email, error: (error as Error).message });
    }
  }

  await admin.from('notification_log').insert({
    kind: 'reminders_sent', ok: failed.length === 0,
    detail: failed.length ? `${failed.length} не отправлено` : null,
    payload: { by: me.user.id, sent: enrollments.length - skipped - failed.length, failed: failed.length },
  });

  if (failed.length) return json({ ok: false, sent: enrollments.length - skipped - failed.length, skipped, failed }, 502);
  return json({ ok: true, sent: enrollments.length - skipped, skipped, failed });
});
