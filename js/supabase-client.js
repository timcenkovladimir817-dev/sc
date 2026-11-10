'use strict';
// Общий клиент Supabase. Работает и в корне сайта, и в подпапке GitHub Pages.
(function () {
  const cfg = window.APP_CONFIG || {};
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.supabaseUrl || '')) {
    document.addEventListener('DOMContentLoaded', () => {
      const app = document.querySelector('#app') || document.body;
      app.insertAdjacentHTML('afterbegin', '<div class="notice">Не настроен адрес Supabase в js/config.js.</div>');
    });
    return;
  }
  window.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  window.esc = function (value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  window.requireAdmin = async function () {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('../login.html?next=admin/'); return null; }
    // select('*') — чтобы страница не падала, если в базе другая версия схемы профиля.
    const { data: profile, error } = await sb.from('profiles')
      .select('*').eq('id', session.user.id).maybeSingle();
    if (error || !profile || profile.role !== 'admin' || profile.is_blocked) {
      const app = document.querySelector('#app') || document.body;
      app.innerHTML = `<div class="card"><h2>Доступ закрыт</h2>
        <p>Раздел доступен только администратору обучения.</p>
        ${error ? `<p><small>Ответ базы: ${esc(error.message)}</small></p>` : ''}
        ${profile && profile.role !== 'admin' ? `<p>Ваша роль сейчас: <b>${esc(profile.role || 'не задана')}</b>. Нужна роль <b>admin</b>.</p>` : ''}
        ${profile && profile.is_blocked ? '<p>Учётная запись заблокирована.</p>' : ''}
        <p><a href="diag.html">Диагностика доступа</a> · <a href="../index.html">Вернуться на главную</a></p></div>`;
      return null;
    }
    return { session, profile };
  };

  window.requireStaff = async function () {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('../login.html?next=admin/'); return null; }
    const { data: profile, error } = await sb.from('profiles')
      .select('*').eq('id', session.user.id).maybeSingle();
    if (error || !profile || !['admin', 'teacher'].includes(profile.role) || profile.is_blocked) {
      const app = document.querySelector('#app') || document.body;
      app.innerHTML = `<div class="card"><h2>Доступ закрыт</h2>
        <p>Раздел доступен администратору и наставнику обучения.</p>
        ${error ? `<p><small>Ответ базы: ${esc(error.message)}</small></p>` : ''}
        ${profile && !['admin', 'teacher'].includes(profile.role) ? `<p>Ваша роль сейчас: <b>${esc(profile.role || 'не задана')}</b>. Нужна роль <b>admin</b> или <b>teacher</b>.</p>` : ''}
        ${profile && profile.is_blocked ? '<p>Учётная запись заблокирована.</p>' : ''}
        <p><a href="../index.html">Вернуться на главную</a></p></div>`;
      return null;
    }
    return { session, profile };
  };

  window.callFunction = async function (name, body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Сессия истекла, войдите заново');
    const response = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'Ответ сервера не является JSON' }));
    if (!response.ok || data.ok === false) {
      throw new Error([data.error, ...(data.warnings || [])].filter(Boolean).join('; ') || 'Ошибка запроса');
    }
    return data;
  };
})();
