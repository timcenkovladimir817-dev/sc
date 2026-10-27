'use strict';
// Постоянная ссылка на вход и админку в боковом меню книги.
// Меню #nav перерисовывается, поэтому блок добавляется в <aside> рядом с ним.
(function () {
  function addLinks() {
    const aside = document.querySelector('aside');
    if (!aside || document.querySelector('#account-links')) return;
    const box = document.createElement('div');
    box.id = 'account-links';
    box.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid #2b477b;display:grid;gap:8px';
    box.innerHTML = '<a href="login.html" style="color:#ccd8ec;font-size:14px">Вход в систему</a>'
      + '<a href="admin/" style="color:#adc0df;font-size:12px">Панель обучения</a>'
      + '<a href="progress.html" style="color:#adc0df;font-size:12px">Прогресс по ссылке</a>';
    aside.append(box);
  }
  // Скрипт подключён в конце body: боковая панель уже существует.
  addLinks();
  if (!document.querySelector('#account-links')) document.addEventListener('DOMContentLoaded', addLinks);
})();
