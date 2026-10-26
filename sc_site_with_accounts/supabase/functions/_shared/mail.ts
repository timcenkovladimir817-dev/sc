// Отправка писем через SMTP Яндекс 360 / Яндекс Почты для бизнеса.
// Используется чистый SMTP-over-TLS без сторонних библиотек.
// Секреты: YANDEX_SMTP_USER, YANDEX_SMTP_PASSWORD, MAIL_FROM_NAME.

const encoder = new TextEncoder();

function b64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function chunk64(value: string): string {
  return value.replace(/(.{1,76})/g, '$1\r\n').trimEnd();
}

async function readReply(conn: Deno.Conn, expect: number[]): Promise<string> {
  const buffer = new Uint8Array(4096);
  let text = '';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const n = await conn.read(buffer);
    if (n === null) break;
    text += new TextDecoder().decode(buffer.subarray(0, n));
    const lines = text.split('\r\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    if (/^\d{3} /.test(last)) {
      const code = Number(last.slice(0, 3));
      if (!expect.includes(code)) throw new Error(`SMTP ответ ${code}: ${last.slice(4)}`);
      return text;
    }
  }
  throw new Error('SMTP не ответил вовремя');
}

async function send(conn: Deno.Conn, line: string, expect: number[]): Promise<void> {
  await conn.write(encoder.encode(line + '\r\n'));
  await readReply(conn, expect);
}

export type MailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendMail({ to, subject, text, html }: MailInput): Promise<void> {
  const user = Deno.env.get('YANDEX_SMTP_USER') ?? '';
  const password = Deno.env.get('YANDEX_SMTP_PASSWORD') ?? '';
  const fromName = Deno.env.get('MAIL_FROM_NAME') ?? 'Учебный центр';
  const host = Deno.env.get('YANDEX_SMTP_HOST') ?? 'smtp.yandex.ru';
  const port = Number(Deno.env.get('YANDEX_SMTP_PORT') ?? '465');
  if (!user || !password) throw new Error('YANDEX_SMTP_USER или YANDEX_SMTP_PASSWORD не заданы');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) throw new Error('Некорректный адрес получателя');

  const conn = await Deno.connectTls({ hostname: host, port });
  try {
    await readReply(conn, [220]);
    await send(conn, `EHLO ${host}`, [250]);
    await send(conn, 'AUTH LOGIN', [334]);
    await send(conn, b64(user), [334]);
    await send(conn, b64(password), [235]);
    await send(conn, `MAIL FROM:<${user}>`, [250]);
    await send(conn, `RCPT TO:<${to}>`, [250, 251]);
    await send(conn, 'DATA', [354]);

    const boundary = `--armatura-${crypto.randomUUID()}`;
    const headers = [
      `From: ${encodeHeader(fromName)} <${user}>`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${user.split('@')[1]}>`,
      'MIME-Version: 1.0',
    ];
    let body: string;
    if (html) {
      body = [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunk64(b64(text)),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunk64(b64(html)),
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      body = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', chunk64(b64(text))].join('\r\n');
    }
    const message = [...headers, body].join('\r\n');
    await conn.write(encoder.encode(message + '\r\n.\r\n'));
    await readReply(conn, [250]);
    await send(conn, 'QUIT', [221]);
  } finally {
    try { conn.close(); } catch { /* соединение уже закрыто */ }
  }
}

// Кодирование темы и имени отправителя в UTF-8 по RFC 2047.
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').slice(0, 200);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${b64(clean)}?=`;
}

export function inviteEmail(input: { fullName: string; courseTitle: string; dueDate: string | null; inviteUrl: string; inviterName: string }): { subject: string; text: string; html: string } {
  const deadline = input.dueDate ? `Срок прохождения: ${input.dueDate}.` : 'Срок прохождения указан в задаче Bitrix24.';
  const subject = `Приглашение на обучение: ${input.courseTitle}`;
  const text = [
    `${input.fullName}, здравствуйте!`,
    '',
    `${input.inviterName} приглашает вас на курс «${input.courseTitle}».`,
    deadline,
    '',
    'Задайте пароль и войдите по ссылке:',
    input.inviteUrl,
    '',
    'Ссылка действует ограниченное время и предназначена только для вас.',
    'Прогресс обучения будет виден наставнику и руководителю.',
    '',
    'Если вы не ожидали это письмо, сообщите администратору обучения.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.6;color:#20304b">
    <p>${escape(input.fullName)}, здравствуйте!</p>
    <p>${escape(input.inviterName)} приглашает вас на курс <b>«${escape(input.courseTitle)}»</b>.</p>
    <p>${escape(deadline)}</p>
    <p><a href="${escape(input.inviteUrl)}" style="display:inline-block;padding:12px 18px;background:#315de0;color:#fff;border-radius:9px;text-decoration:none">Задать пароль и войти</a></p>
    <p style="font-size:13px;color:#65738a">Ссылка действует ограниченное время и предназначена только для вас. Прогресс будет виден наставнику и руководителю.</p>
  </div>`;
  return { subject, text, html };
}

export function escape(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
