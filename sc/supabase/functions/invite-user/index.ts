// Приглашение сотрудника: проверка администратора, создание пользователя,
// назначение курса, задача Bitrix24, письмо Яндекс и ссылка на прогресс.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json, fail, cleanText, EMAIL_RE, DATE_RE } from '../_shared/cors.ts';
import { createTrainingTask, buildDescription } from '../_shared/bitrix.ts';
import { sendMail, inviteEmail } from '../_shared/mail.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? '';
const MAX_OBSERVERS = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Только POST', 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail('Нет авторизации', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return fail('Сессия недействительна', 401);

  const { data: profile } = await asUser.from('profiles').select('role, is_blocked').eq('id', userData.user.id).single();
  if (!profile || profile.role !== 'admin' || profile.is_blocked) return fail('Нужны права администратора', 403);

  let body: any;
  try { body = await req.json(); } catch { return fail('Неверный JSON'); }

  const email = cleanText(body.email, 254).toLowerCase();
  const fullName = cleanText(body.fullName, 120);
  const position = cleanText(body.position, 120);
  const department = cleanText(body.department, 120);
  const courseSlug = cleanText(body.courseSlug ?? 'armatura', 40);
  const mentorEmail = cleanText(body.mentorEmail, 254).toLowerCase();
  const supervisorEmail = cleanText(body.supervisorEmail, 254).toLowerCase();
  const dueDate = body.dueDate ? cleanText(body.dueDate, 10) : null;

  if (!EMAIL_RE.test(email)) return fail('Некорректный email сотрудника');
  if (fullName.length < 3) return fail('Укажите ФИО');
  if (mentorEmail && !EMAIL_RE.test(mentorEmail)) return fail('Некорректный email наставника');
  if (supervisorEmail && !EMAIL_RE.test(supervisorEmail)) return fail('Некорректный email руководителя');
  if (dueDate && (!DATE_RE.test(dueDate) || Number.isNaN(Date.parse(dueDate)))) return fail('Срок должен быть в формате ГГГГ-ММ-ДД');
  if (dueDate && new Date(dueDate).getTime() < Date.now() - 86400000) return fail('Срок уже прошёл');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: course } = await admin.from('courses').select('id, title, module_count').eq('slug', courseSlug).maybeSingle();
  if (!course) return fail('Курс не найден', 404);

  const { data: existing } = await admin.from('invitations')
    .select('id, status, created_at').eq('email', email).eq('status', 'pending').maybeSingle();
  if (existing) return fail('Для этого адреса уже есть действующее приглашение. Используйте «Отправить повторно».', 409);

  // Ссылку приглашения формирует Supabase, а письмо отправляет Яндекс.
  // Это позволяет не зависеть от встроенной почты Supabase и видеть ошибки доставки.
  const { data: invited, error: inviteError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${SITE_URL}/reset.html`, data: { full_name: fullName } },
  });
  if (inviteError || !invited.user) {
    const message = inviteError?.message ?? 'Пользователь не создан';
    if (/already|exists/i.test(message)) return fail('Пользователь с таким email уже существует. Проверьте раздел «Пользователи».', 409);
    return fail(message, 400);
  }

  const userId = invited.user.id;
  const inviteUrl = invited.properties?.action_link ?? `${SITE_URL}/reset.html`;

  await admin.from('profiles').upsert({
    id: userId, full_name: fullName, email, role: 'student',
    position: position || null, department: department || null, is_blocked: false,
  }, { onConflict: 'id' });

  const { data: enrollment, error: enrollmentError } = await admin.from('enrollments').insert({
    user_id: userId, course_id: course.id, mentor_email: mentorEmail || null,
    supervisor_email: supervisorEmail || null, due_date: dueDate,
    bitrix_responsible_id: null, assigned_by: userData.user.id, status: 'assigned',
  }).select('id').single();
  if (enrollmentError || !enrollment) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return fail('Приглашение не создано: ' + (enrollmentError?.message ?? 'ошибка назначения'), 500);
  }

  const { data: linkToken } = await asUser.rpc('create_progress_link', { p_enrollment: enrollment.id, p_days: 365 });
  const progressUrl = `${SITE_URL}/progress.html?token=${linkToken}`;

  const observers = [mentorEmail, supervisorEmail].filter(Boolean);
  let bitrixTaskId: string | null = null;
  let bitrixError: string | null = null;
  let warnings: string[] = [];
  try {
    const task = await createTrainingTask({
      title: `Пройти обучение: ${course.title}`,
      description: buildDescription({ fullName, courseTitle: course.title, moduleCount: course.module_count, progressUrl, dueDate }),
      responsibleId: email,
      deadline: dueDate,
      observerEmails: observers,
      courseUrl: SITE_URL,
    });
    bitrixTaskId = task.taskId;
    warnings = task.warnings;
    if (task.responsibleId) {
      await admin.from('enrollments').update({ bitrix_responsible_id: Number(task.responsibleId) }).eq('id', enrollment.id);
    }
  } catch (error) {
    bitrixError = (error as Error).message;
  }

  let mailSent = true;
  let mailError: string | null = null;
  try {
    const inviterName = (await admin.from('profiles').select('full_name').eq('id', userData.user.id).single()).data?.full_name || 'Администратор обучения';
    const letter = inviteEmail({ fullName, courseTitle: course.title, dueDate, inviteUrl, inviterName });
    await sendMail({ to: email, ...letter });
  } catch (error) {
    mailSent = false;
    mailError = (error as Error).message;
  }

  await admin.from('invitations').insert({
    email, full_name: fullName, course_id: course.id, mentor_email: mentorEmail || null,
    supervisor_email: supervisorEmail || null, due_date: dueDate, invited_by: userData.user.id,
    user_id: userId, enrollment_id: enrollment.id, bitrix_task_id: bitrixTaskId ? Number(bitrixTaskId) : null,
    bitrix_error: bitrixError, status: 'pending',
  });

  await admin.from('notification_log').insert({
    kind: 'invitation',
    ok: mailSent && !bitrixError,
    detail: [mailError && `mail: ${mailError}`, bitrixError && `bitrix: ${bitrixError}`].filter(Boolean).join('; ') || null,
    payload: { email, course: courseSlug, bitrixTaskId, warnings },
  });

  return json({
    ok: true,
    userId,
    enrollmentId: enrollment.id,
    progressUrl,
    bitrixTaskId,
    mailSent,
    warnings: [...warnings, ...(bitrixError ? [`Bitrix24: ${bitrixError}`] : []), ...(mailError ? [`Почта: ${mailError}`] : [])],
  }, 200);
});
