-- Арматура PRO — закрываем прямую запись прогресса в обход RPC.
-- Выполните в Supabase → SQL Editor после 0001–0012.
--
-- Причина: миграция 0003 выдала authenticated права insert/update на
-- public.module_progress. Ученик мог через PostgREST напрямую менять свой
-- percent/notes, минуя save_my_progress_for(), где действует правило
-- «процент только растёт» (greatest()) и проверка назначенных глав.
-- Теперь запись прогресса выполняется только через RPC-функции
-- (security definer, им прямые grants не нужны). Чтение (select) остаётся
-- для персонала и собственного прогресса.

begin;

revoke insert, update on public.module_progress from authenticated;

commit;
