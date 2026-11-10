// Ограничение источника: ALLOWED_ORIGIN → SITE_URL. Если ни один не задан,
// кросс-доменные запросы не разрешаются (нет fallback на '*'), чтобы чужие
// домены не могли читать ответы функций. Для работы сайта на GitHub Pages
// задайте SITE_URL или ALLOWED_ORIGIN в секретах каждой функции.
const origin = Deno.env.get('ALLOWED_ORIGIN') || Deno.env.get('SITE_URL') || '';
export const corsHeaders = {
  ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  ...(origin ? { 'Vary': 'Origin' } : {}),
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, status);
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
