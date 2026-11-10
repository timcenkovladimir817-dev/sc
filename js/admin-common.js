'use strict';
// Общие помощники админ-панели: вынесены из users.html и stats.html,
// чтобы не дублировать форматирование дат, статусы, прогресс и выгрузку CSV.
// Подключается ПОСЛЕ js/supabase-client.js (использует window.sb и window.esc).
(function () {
  const escText = (value) => (typeof window.esc === 'function' ? window.esc(value) : String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const roleNames = { admin: 'Администратор', teacher: 'Наставник', student: 'Сотрудник' };
  const statusNames = { assigned: 'Назначено', in_progress: 'В работе', completed: 'Завершено', cancelled: 'Отменено' };

  function roleName(role) { return roleNames[role] || role || 'Не задана'; }

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? value + 'T00:00:00' : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU');
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function todayStart() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isOverdue(enrollment) {
    if (!enrollment || !enrollment.due_date) return false;
    if (enrollment.status === 'completed' || enrollment.status === 'cancelled') return false;
    return new Date(enrollment.due_date + 'T00:00:00') < todayStart();
  }

  function statusBadge(status) {
    const cls = status === 'completed' ? 'ok' : status === 'in_progress' ? 'warn' : status === 'cancelled' ? 'muted' : '';
    return `<span class="badge ${cls}">${escText(statusNames[status] || status || '—')}</span>`;
  }

  function progressBar(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="progress-mini" title="Прогресс ${value}%"><span style="width:${value}%"></span></div>`;
  }

  function fmtDuration(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return '—';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'меньше минуты';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + ' мин';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' ч ' + (min % 60) + ' мин';
    const d = Math.floor(h / 24);
    return d + ' д ' + (h % 24) + ' ч';
  }

  function durationMs(enrollment) {
    if (!enrollment) return null;
    const start = enrollment.started_at ? new Date(enrollment.started_at) : null;
    const end = enrollment.completed_at ? new Date(enrollment.completed_at)
      : enrollment.last_activity_at ? new Date(enrollment.last_activity_at) : null;
    if (!start || !end) return null;
    return end - start;
  }

  async function selectAll(table, order) {
    if (!window.sb) return { data: null, error: { message: 'Клиент Supabase не настроен' } };
    let result = order
      ? await window.sb.from(table).select('*').order(order, { ascending: false })
      : await window.sb.from(table).select('*');
    if (result.error && order) result = await window.sb.from(table).select('*');
    return result;
  }

  function downloadCsv(filename, lines) {
    const quote = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = lines.map((row) => row.map(quote).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  window.AdminCommon = {
    escText, roleNames, statusNames, roleName, fmtDate, fmtDateTime, todayStart,
    isOverdue, statusBadge, progressBar, fmtDuration, durationMs, selectAll, downloadCsv,
  };
})();
