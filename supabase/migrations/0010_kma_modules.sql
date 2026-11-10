-- Главы 17–20 по материалам цикла презентаций (КМА): присоединения, опросный лист,
-- классификация по назначению, приводы и крутящий момент.
-- slug совпадает с именем файла в content/modules (17..20).
insert into public.course_modules (course_id, slug, title, position)
select id, '17', 'Номинальные диаметры, давления и виды присоединений', 17 from public.courses where slug='armatura'
on conflict (course_id, slug) do update set title=excluded.title, position=excluded.position;

insert into public.course_modules (course_id, slug, title, position)
select id, '18', 'Опросный лист: ключевые поля и типичные ошибки', 18 from public.courses where slug='armatura'
on conflict (course_id, slug) do update set title=excluded.title, position=excluded.position;

insert into public.course_modules (course_id, slug, title, position)
select id, '19', 'Классификация арматуры по назначению', 19 from public.courses where slug='armatura'
on conflict (course_id, slug) do update set title=excluded.title, position=excluded.position;

insert into public.course_modules (course_id, slug, title, position)
select id, '20', 'Электроприводы и пневмоприводы: крутящий момент и подбор', 20 from public.courses where slug='armatura'
on conflict (course_id, slug) do update set title=excluded.title, position=excluded.position;

update public.courses set module_count=(select count(*) from public.course_modules cm where cm.course_id=courses.id) where slug='armatura';
