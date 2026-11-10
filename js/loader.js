'use strict';
// Доступ к учебным материалам — только после входа и с активной учётной записью.
// Главы читаются из content/modules/*.json; Supabase используется для проверки доступа и прогресса.
window.__appReady = (async () => {
  try {
    const cfg = window.APP_CONFIG || {};
    if (!window.sb) {
      document.querySelector('#view').innerHTML =
        '<div class="card"><h2>Система не настроена</h2><p>Не настроен адрес Supabase в js/config.js.</p></div>';
      return;
    }

    // 1. Без входа материалов нет.
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) { location.replace('login.html'); return; }

    // 2. Профиль и роль.
    const { data: profile, error: profileError } = await window.sb
      .from('profiles').select('role, is_blocked').eq('id', session.user.id).maybeSingle();
    if (profileError || !profile || profile.is_blocked) {
      document.querySelector('#view').innerHTML =
        '<div class="card"><h2>Доступ закрыт</h2><p>' +
        (profile && profile.is_blocked
          ? 'Учётная запись заблокирована. Обратитесь к администратору обучения.'
          : 'Профиль не найден. Обратитесь к администратору обучения.') +
        '</p><p><a href="login.html">Войти заново</a></p></div>';
      return;
    }

    window.USER_ROLE = profile.role;
    window.CAN_EDIT = profile.role === 'admin' || profile.role === 'teacher';

    // 3. Ученику нужен действующий курс, иначе показывать нечего.
    if (profile.role === 'student') {
      const { data: enrollments, error: enrollError } = await window.sb
        .from('enrollments').select('id, status');
      if (!enrollError && Array.isArray(enrollments) && !enrollments.some(e => e.status !== 'cancelled')) {
        document.querySelector('#view').innerHTML =
          '<div class="card"><h2>Курс не назначен</h2><p>Вам ещё не назначен учебный курс. Обратитесь к наставнику или администратору обучения.</p><p><a href="login.html">Войти под другой учётной записью</a></p></div>';
        return;
      }
    }

    // 4. Загрузка материалов.
    const get = async p => { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw Error(p + ': ' + r.status); return r.json(); };
    const manifest = await get('content/book.json');
    const modules = await Promise.all(manifest.modules.map(get));
    window.BOOK = { manifest, modules, source: 'json', standards: await get('content/standards.json'), quiz: await get('content/quiz.json') };
    for (const src of ['js/calculations.js', 'js/app.js', 'js/export.js', 'js/editor.js']) {
      await new Promise((resolve, reject) => { const e = document.createElement('script'); e.src = src; e.onload = resolve; e.onerror = () => reject(Error('Не загружен ' + src)); document.body.append(e); });
    }
    nav('home');
  } catch (e) {
    document.querySelector('#view').textContent = 'Ошибка загрузки: ' + e.message + '.';
    console.error(e);
  }
})();
