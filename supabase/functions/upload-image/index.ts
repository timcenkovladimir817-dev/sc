// Загрузка изображения в Supabase Storage и возврат публичной ссылки.
// Только администратор и наставник. Файл приходит base64 в JSON:
//   { contentType: "image/jpeg", data: "<base64>" }
// Самодостаточная версия: помощники CORS встроены, чтобы функцию можно было
// задеплоить одним файлом через панель Supabase (без папки _shared).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// --- CORS и помощники (копия логики _shared/cors.ts) ---
const origin = Deno.env.get('ALLOWED_ORIGIN') || Deno.env.get('SITE_URL') || '';
const corsHeaders: Record<string, string> = {
  ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  ...(origin ? { 'Vary': 'Origin' } : {}),
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function fail(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}
function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const MAX_BYTES = 3 * 1024 * 1024; // 3 МБ
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Только POST', 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail('Нет авторизации', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: me } = await asUser.auth.getUser();
  if (!me.user) return fail('Сессия недействительна', 401);
  const { data: profile } = await asUser.from('profiles')
    .select('role, is_blocked').eq('id', me.user.id).single();
  if (!profile || !['admin', 'teacher'].includes(profile.role) || profile.is_blocked) {
    return fail('Нужны права администратора или наставника', 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return fail('Неверный JSON'); }

  const contentType = cleanText(body.contentType, 40);
  const ext = ALLOWED[contentType];
  if (!ext) return fail('Допустимы только PNG, JPEG, WebP', 400);

  const data = typeof body.data === 'string' ? body.data : '';
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return fail('Некорректные данные изображения', 400);

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return fail('Не удалось раскодировать изображение', 400);
  }
  if (bytes.length === 0) return fail('Изображение пустое', 400);
  if (bytes.length > MAX_BYTES) return fail('Изображение должно быть не больше 3 МБ', 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const filename = `${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from('editor-images')
    .upload(filename, bytes, { contentType, upsert: false });
  if (uploadError) return fail('Не удалось сохранить изображение: ' + uploadError.message, 500);

  const publicUrl = admin.storage.from('editor-images').getPublicUrl(filename).data.publicUrl;
  return json({ ok: true, url: publicUrl, path: `editor-images/${filename}` });
});
