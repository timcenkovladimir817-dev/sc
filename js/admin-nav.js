'use strict';
// Единая навигация админ-панели. Скрипт сам находит контейнер #admin-nav,
// поэтому страница может вставить его в любой момент после проверки доступа.
(function () {
  const pages = [
    ['index.html', 'Обзор'],
    ['users.html', 'Пользователи'],
    ['audit.html', 'Журнал'],
    ['import.html', 'Главы в базу'],
    ['editor.html', 'Иллюстрации'],
    ['storage.html', 'Схемы'],
    ['diag.html', 'Диагностика'],
  ];

  let profilePromise = null;

  function currentFile() {
    const path = location.pathname;
    if (/\/admin\/?$/i.test(path)) return 'index.html';
    const file = path.split('/').pop();
    return file || 'index.html';
  }

  function getProfile() {
    if (profilePromise) return profilePromise;
    profilePromise = (async () => {
      try {
        if (!window.sb) return null;
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return null;
        const { data } = await sb.from('profiles')
          .select('full_name, email, role')
          .eq('id', session.user.id)
          .maybeSingle();
        return data || { email: session.user.email };
      } catch (error) {
        return null;
      }
    })();
    return profilePromise;
  }

  async function render() {
    const mount = document.querySelector('#admin-nav');
    if (!mount || mount.dataset.rendered === '1') return;
    mount.dataset.rendered = '1';

    const file = currentFile();
    const profile = await getProfile();
    const who = profile
      ? [profile.full_name, profile.email].filter(Boolean).join(' · ')
      : '';
    const role = profile ? profile.role : '';
    const visible = role === 'teacher'
      ? pages.filter(([href]) => ['index.html', 'users.html', 'import.html', 'editor.html'].includes(href))
      : pages;

    mount.innerHTML = `
      <div class="admin-nav" role="navigation" aria-label="Администрирование обучения">
        <span class="admin-brand">АРМАТУРА / PRO · ${role === 'teacher' ? 'Наставник' : 'Админка'}</span>
        ${visible.map(([href, label]) =>
          `<a href="${href}"${href === file ? ' class="active" aria-current="page"' : ''}>${label}</a>`).join('')}
        <span class="admin-spacer"></span>
        ${who ? `<span class="admin-who" title="${escapeText(who)}">${escapeText(who)}</span>` : ''}
        <a href="../index.html">Учебник</a>
        <button type="button" class="admin-logout">Выйти</button>
      </div>`;

    const logout = mount.querySelector('.admin-logout');
    if (logout) {
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try { if (window.sb) await sb.auth.signOut(); } catch (error) { /* всё равно уходим */ }
        location.replace('../login.html');
      });
    }
  }

  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // renderAdminNav() можно вызвать вручную сразу после отрисовки шаблона.
  window.renderAdminNav = render;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // requireAdmin() отрисовывает интерфейс асинхронно, поэтому ждём появления контейнера.
  const observer = new MutationObserver(() => {
    if (document.querySelector('#admin-nav:not([data-rendered="1"])')) render();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
