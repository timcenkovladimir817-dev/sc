'use strict';
// Тема оформления и размер шрифта. Подключается на всех страницах.
// Кнопка «Настройки» добавляется автоматически в правый нижний угол.
(function () {
  const THEME_KEY = 'armatura.theme';
  const FONT_KEY = 'armatura.font';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function storedTheme() {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
  }

  function resolveTheme(value) {
    return value === 'auto' ? (media.matches ? 'dark' : 'light') : value;
  }

  function apply() {
    const theme = storedTheme();
    const font = localStorage.getItem(FONT_KEY) || 'm';
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    document.documentElement.setAttribute('data-font', font);
    document.documentElement.style.fontSize =
      font === 'l' ? '18px' : font === 's' ? '15px' : '16px';
    return { theme, font };
  }

  function setTheme(value) {
    localStorage.setItem(THEME_KEY, value);
    apply();
    renderPanel();
  }

  function setFont(value) {
    localStorage.setItem(FONT_KEY, value);
    apply();
    renderPanel();
  }

  function buildPanel() {
    let panel = document.getElementById('settings-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.className = 'settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="settings-head">Оформление</div>
      <div class="settings-row">
        <span>Тема</span>
        <select id="settings-theme" aria-label="Тема оформления">
          <option value="auto">Авто</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select>
      </div>
      <div class="settings-row">
        <span>Размер текста</span>
        <select id="settings-font" aria-label="Размер текста">
          <option value="s">Мелкий</option>
          <option value="m">Обычный</option>
          <option value="l">Крупный</option>
        </select>
      </div>`;
    document.body.append(panel);

    panel.querySelector('#settings-theme').addEventListener('change', (e) => setTheme(e.target.value));
    panel.querySelector('#settings-font').addEventListener('change', (e) => setFont(e.target.value));
    return panel;
  }

  function renderPanel() {
    const panel = buildPanel();
    const state = apply();
    const themeSel = panel.querySelector('#settings-theme');
    const fontSel = panel.querySelector('#settings-font');
    if (themeSel) themeSel.value = state.theme;
    if (fontSel) fontSel.value = state.font;
  }

  function buildFab() {
    let button = document.getElementById('settings-fab');
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'settings-fab';
    button.className = 'settings-fab';
    button.setAttribute('aria-label', 'Настройки отображения');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '⚙';
    document.body.append(button);

    button.addEventListener('click', () => {
      const panel = buildPanel();
      const willShow = panel.hidden;
      panel.hidden = !willShow;
      button.setAttribute('aria-expanded', String(willShow));
      renderPanel();
    });
    return button;
  }

  function closeOnOutside(event) {
    const panel = document.getElementById('settings-panel');
    const fab = document.getElementById('settings-fab');
    if (!panel || panel.hidden) return;
    if (!panel.contains(event.target) && !(fab && fab.contains(event.target))) {
      panel.hidden = true;
      if (fab) fab.setAttribute('aria-expanded', 'false');
    }
  }

  function init() {
    apply();
    buildFab();
    renderPanel();
    document.addEventListener('click', closeOnOutside);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const panel = document.getElementById('settings-panel');
        const fab = document.getElementById('settings-fab');
        if (panel) panel.hidden = true;
        if (fab) fab.setAttribute('aria-expanded', 'false');
      }
    });
    if (media.addEventListener) media.addEventListener('change', () => { if (storedTheme() === 'auto') apply(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
