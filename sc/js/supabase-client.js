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

  function jwtPayload(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(part).split('').map((c) =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  // Сессия из localStorage без обращения к клиенту: не зависит от блокировки между вкладками.
  function storedSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!/-auth-token$/.test(key)) continue;
        const raw = JSON.parse(localStorage.getItem(key));
        const session = raw && (raw.currentSession || raw);
        const token = session && session.access_token;
        if (!token) continue;
        const payload = jwtPayload(token);
        if (!payload) continue;
        if (payload.exp && payload.exp * 1000 < Date.now() + 30000) return { expired: true, token, payload };
        return {
          access_token: token,
          user: { id: payload.sub, email: payload.email },
          expires_at: payload.exp,
        };
      }
    } catch (e) { /* пустое или битое хранилище */ }
    return null;
  }

  // Основной способ получить сессию: сначала клиент с таймаутом, затем прямое чтение токена.
  window.currentSession = async function () {
    try {
      const result = await Promise.race([
        sb.auth.getSession(),
        new Promise((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
      if (result && result.data && result.data.session) return result.data.session;
    } catch (e) { /* клиент недоступен — идём в обход */ }
    const stored = storedSession();
    if (stored && !stored.expired) return stored;
    return null;
  };

  window.apiFetch = async function (path, options) {
    const session = await window.currentSession();
    if (!session) throw new Error('Сессия истекла');
    const opts = options || {};
    const res = await fetch(cfg.supabaseUrl + path, {
      method: opts.method || 'GET',
      body: opts.body,
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const message = data && (data.message || data.error_description || data.error || data.hint);
      throw new Error(message || ('HTTP ' + res.status));
    }
    return data;
  };

  window.loadProfile = async function () {
    const session = await window.currentSession();
    if (!session) return null;
    const rows = await window.apiFetch('/rest/v1/profiles?id=eq.'
      + encodeURIComponent(session.user.id) + '&select=id,full_name,email,role,is_blocked');
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  function deny(title, message, hint) {
    const app = document.querySelector('#app') || document.body;
    app.innerHTML = '<div class="card"><h2>' + window.esc(title) + '</h2><p>' + window.esc(message) + '</p>'
      + (hint ? '<div class="notice">' + hint + '</div>' : '')
      + '<div class="actions"><a href="../login.html">Войти заново</a>'
      + '<a href="../index.html">Вернуться на главную</a></div></div>';
  }

  // roles: массив допустимых ролей. По умолчанию только admin.
  window.requireAccess = async function (roles) {
    const allowed = Array.isArray(roles) && roles.length ? roles : ['admin'];
    const session = await window.currentSession();
    if (!session) {
      deny('Нужен вход', 'Сессия не найдена или истекла. Войдите заново — после входа откроется нужный раздел.',
        'Открывайте сайт по адресу <b>https://timcenkovladimir817-dev.github.io/sc/</b>, а не файлом с диска: при открытии через file:// вход не работает.');
      return null;
    }
    let profile = null;
    try {
      profile = await window.loadProfile();
    } catch (e) {
      deny('Не удалось прочитать профиль', e.message,
        'Проверьте, что применены миграции. Диагностика: <a href="diag.html">admin/diag.html</a>');
      return null;
    }
    if (!profile) {
      deny('Профиль не найден', 'Учётная запись есть, а строки в public.profiles нет.',
        'Создайте профиль в SQL Editor или повторите приглашение. Диагностика: <a href="diag.html">admin/diag.html</a>');
      return null;
    }
    if (profile.is_blocked) {
      deny('Доступ закрыт', 'Учётная запись заблокирована администратором.', '');
      return null;
    }
    if (allowed.indexOf(profile.role) === -1) {
      deny('Доступ закрыт', 'Ваша роль — «' + profile.role + '», для этого раздела нужна '
        + allowed.map((r) => '«' + r + '»').join(' или ') + '.',
        'Диагностика: <a href="diag.html">admin/diag.html</a>');
      return null;
    }
    return { session, profile };
  };

  window.requireAdmin = function () {
    return window.requireAccess(['admin']);
  };

  window.callFunction = async function (name, body) {
    const session = await window.currentSession();
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
