'use strict';
// Ссылки на вход/админку в боковом меню книги — зависят от роли.
// Меню #nav перерисовывается, поэтому блок добавляется в <aside> рядом с ним.
(function () {
  async function render() {
    if (window.__appReady) { try { await window.__appReady; } catch (e) { /* доступ уже закрыт */ } }
    const role = window.USER_ROLE;
    if (!role) return; // перенаправление на вход или доступ закрыт
    const aside = document.querySelector('aside');
    if (!aside || document.querySelector('#account-links')) return;
    const box = document.createElement('div');
    box.id = 'account-links';
    box.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid #2b477b;display:grid;gap:8px';
    const staff = role === 'admin' || role === 'teacher';
    box.innerHTML = staff
      ? '<a href="admin/" style="color:#ccd8ec;font-size:14px">Панель обучения</a>'
        + '<a href="admin/users.html" style="color:#adc0df;font-size:12px">Ученики и прогресс</a>'
        + '<a href="progress.html" style="color:#adc0df;font-size:12px">Прогресс по ссылке</a>'
      : '<a href="#" id="account-logout" style="color:#ccd8ec;font-size:14px">Выйти из системы</a>';
    aside.append(box);
    if (!staff) {
      box.querySelector('#account-logout').addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.sb) { try { await sb.auth.signOut(); } catch (err) { /* всё равно уходим */ } }
        location.replace('login.html');
      });
    }
  }
  render();
  if (!document.querySelector('#account-links')) document.addEventListener('DOMContentLoaded', render);
})();
