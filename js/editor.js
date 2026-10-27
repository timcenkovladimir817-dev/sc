
// Редактор: данные хранятся как обычный текст, без исполнения пользовательского HTML.
const originalModules=JSON.parse(JSON.stringify(modules));
modules.forEach((m,i)=>{if(m.origin===undefined)m.origin=i});
let editorIndex=0, editorDirty=false;
const contentKey='armatura.editor.project.v5.'+hashBook(JSON.stringify(modules));
function hashBook(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16)}
function cleanModule(m){return {title:escapeHTML(m.title),hours:m.hours,goal:escapeHTML(m.goal),sections:m.sections.map(s=>[escapeHTML(s[0]),escapeHTML(s[1]),(s[2]||[]).map(x=>[escapeHTML(x[0]),escapeHTML(x[1])])]),images:(m.images||[]).map(x=>[escapeHTML(x[0]),escapeHTML(x[1])]),table:m.table.map(r=>r.map(escapeHTML)),task:escapeHTML(m.task),answer:escapeHTML(m.answer),checks:m.checks.map(escapeHTML)}}
function validateBook(data){
 if(!data||data.format!=='armatura-book-v4'||!Array.isArray(data.modules)||!data.modules.length||data.modules.length>300)throw Error('Неверный формат книги или число модулей (1–300).');
 for(const m of data.modules){
 for(const k of ['title','goal','task','answer'])if(typeof m[k]!=='string')throw Error('В модуле отсутствует текстовое поле '+k);
 if(!m.title.trim()||!Number.isFinite(m.hours)||m.hours<0||m.hours>10000)throw Error('Проверьте название и часы.');
 if(!Array.isArray(m.sections)||!m.sections.length||m.sections.length>500||m.sections.some(s=>!Array.isArray(s)||s.length<2||s.length>3||typeof s[0]!=='string'||typeof s[1]!=='string'))throw Error('Неверные разделы.');
 if(!Array.isArray(m.table)||!m.table.length||m.table.some(r=>!Array.isArray(r)||!r.length||r.some(x=>typeof x!=='string')))throw Error('Неверная таблица.');
 if(!Array.isArray(m.checks)||m.checks.some(x=>typeof x!=='string'))throw Error('Неверные вопросы.');
 if(m.origin!==undefined&&(!Number.isInteger(m.origin)||m.origin<0||m.origin>15))throw Error('Неверный идентификатор источников.');
 if(m.images!==undefined&&(!Array.isArray(m.images)||m.images.length>30||m.images.some(x=>!x||typeof x.caption!=='string'||typeof x.data!=='string'||!(/^(images\/|graphics\/)[A-Za-z0-9_./-]+$/.test(x.data)||/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x.data)))))throw Error('Неверное изображение.');
 if(m.links!==undefined&&(!Array.isArray(m.links)||m.links.some(x=>!Array.isArray(x)||x.length!==2||x.some(s=>typeof s!=='string')||!/^https?:\/\//i.test(x[1]))))throw Error('Ссылки должны начинаться с https:// или http://');
 }
 return data.modules;
}
function persistContent(){try{localStorage.setItem(contentKey,JSON.stringify({format:'armatura-book-v4',modules}));return true}catch(e){return false}}
try{const cached=localStorage.getItem(contentKey);if(cached){const list=validateBook(JSON.parse(cached));modules.splice(0,modules.length,...list)}}catch(e){console.warn('Локальная копия книги не загружена:',e.message)}
const oldRender=render;
render=function(){if(current==='editor'){editor();return}oldRender()};
pages.push(['editor','✎ Редактор книги']);
function safeLeave(){return !editorDirty||confirm('Есть несохранённые изменения формы. Продолжить без их сохранения?')}
const previousNav=nav;
nav=function(id){if(current==='editor'&&!safeLeave())return;editorDirty=false;previousNav(id)};
window.addEventListener('beforeunload',e=>{if(editorDirty){e.preventDefault();e.returnValue=''}});
function editor(){
 editorIndex=Math.min(Math.max(0,editorIndex),modules.length-1);
 $('#view').innerHTML=`<div class="notice"><b>Как работать:</b> выберите главу → измените поля → «Сохранить главу» → «Скачать весь проект ZIP». Сам исходный файл не перезаписывается. Экспорт создаёт новый файл в папке загрузок браузера.<br>Редактор доступен любому, у кого есть эта книга; это не защищённый кабинет администратора.</div><div class="card"><h2>Книга и резервные копии</h2><div class="actions"><button id="export-html">Скачать весь проект ZIP</button><button id="export-chapter" class="secondary">Скачать только главу JSON</button><button id="export-json" class="secondary">Скачать резервную копию JSON</button><button id="import-json" class="secondary">Загрузить копию JSON</button><button id="all-preview" class="secondary">Просмотреть всю книгу</button></div><input type="file" id="json-file" accept="application/json,.json" hidden><p id="book-status" role="status" style="margin-top:12px"></p><small>JSON содержит материалы, но не ответы читателей. Храните копии с датой. Большие изображения могут превысить лимит хранения браузера — экспортируйте HTML и JSON.</small></div><div class="card"><label for="edit-select">Модуль для редактирования</label><select id="edit-select">${modules.map((m,i)=>`<option value="${i}" ${i===editorIndex?'selected':''}>${i+1}. ${escapeHTML(m.title)}</option>`).join('')}</select><div class="actions"><button id="add-module">+ Новый модуль</button><button class="secondary" id="duplicate-module">Копировать модуль</button><button class="secondary" id="module-up" ${editorIndex===0?'disabled':''}>↑ Выше</button><button class="secondary" id="module-down" ${editorIndex===modules.length-1?'disabled':''}>↓ Ниже</button><button class="secondary" id="delete-module" ${modules.length===1?'disabled':''}>Удалить модуль</button></div></div><form id="editor-form" class="card"><h2>Содержание главы</h2><div class="field"><label for="etitle">Название</label><input id="etitle" required maxlength="500"></div><div class="field"><label for="ehours">Часы, включая практику</label><input id="ehours" type="number" min="0" max="10000" step="0.5" required></div><div class="field"><label for="egoal">Цель обучения</label><textarea id="egoal" style="min-height:90px"></textarea></div><h3>Разделы</h3><p class="muted">Пишите обычный текст, без HTML-кода. Переносы строк сохранятся.</p><div id="section-editor"></div><button type="button" id="add-section" class="secondary">+ Добавить раздел</button><div class="field" style="margin-top:20px"><label for="etable">Инженерная таблица</label><small>Одна строка таблицы — одна строка текста. Столбцы разделяйте знаком |. Первая строка — заголовки. Не используйте | внутри ячеек.</small><textarea id="etable"></textarea></div><div class="field"><label for="etask">Практическое задание</label><textarea id="etask"></textarea></div><div class="field"><label for="eanswer">Разбор и критерии ответа</label><textarea id="eanswer"></textarea></div><div class="field"><label for="echecks">Вопросы самопроверки — по одному на строку</label><textarea id="echecks"></textarea></div><div class="field"><label for="elinks">Ссылки — по одной на строку: название | https://адрес</label><textarea id="elinks" placeholder="Руководство изготовителя | https://example.com/manual.pdf"></textarea></div><h3>Изображения главы</h3><p class="muted">PNG, JPEG или WebP, до 3 МБ на изображение. Встраиваются в файл, интернет для просмотра не нужен.</p><input type="file" id="image-file" accept="image/png,image/jpeg,image/webp"><div id="image-editor"></div><div class="notice">Здесь редактируются содержание, таблицы, задания и вопросы самопроверки. Итоговый тест и расчётные формулы остаются программными — они не меняются автоматически вместе с главой.</div><div class="actions"><button type="submit">Сохранить главу</button><button type="button" id="preview-module" class="secondary">Сохранить и посмотреть</button></div><p id="edit-status" role="status"></p></form>`;
 const m=modules[editorIndex];
 for(const [id,key] of [['etitle','title'],['ehours','hours'],['egoal','goal'],['etask','task'],['eanswer','answer']])$('#'+id).value=m[key];
 $('#etable').value=m.table.map(r=>r.join(' | ')).join('\n');$('#echecks').value=m.checks.join('\n');$('#elinks').value=(m.links||[]).map(l=>l.join(' | ')).join('\n');
 editorSections=JSON.parse(JSON.stringify(m.sections));editorImages=JSON.parse(JSON.stringify(m.images||[]));drawEditSections();drawImages();
 $('#editor-form').addEventListener('input',()=>{editorDirty=true});
 $('#editor-form').addEventListener('submit',e=>{e.preventDefault();saveChapter()});
 $('#edit-select').addEventListener('change',e=>{if(!safeLeave()){e.target.value=editorIndex;return}editorIndex=Number(e.target.value);editorDirty=false;editor()});
 $('#add-section').onclick=()=>{captureSections();editorSections.push(['Новый раздел','']);editorDirty=true;drawEditSections()};
 $('#preview-module').onclick=()=>{if(saveChapter()){openLesson(editorIndex)}};
 $('#export-html').onclick=()=>{if(editorDirty&&!saveChapter())return;downloadBook()};
 $('#export-chapter').onclick=()=>{if(editorDirty&&!saveChapter())return;downloadData(JSON.stringify(modules[editorIndex],null,2),(editorIndex+1).toString().padStart(2,'0')+'-module.json','application/json')};
 $('#export-json').onclick=()=>{if(editorDirty&&!saveChapter())return;downloadData(JSON.stringify({format:'armatura-book-v4',modules},null,2),'armatura_backup_'+dateStamp()+'.json','application/json');$('#book-status').textContent='Резервная копия передана браузеру для скачивания.'};
 $('#import-json').onclick=()=>$('#json-file').click();$('#json-file').onchange=importBook;
 $('#all-preview').onclick=()=>{if(editorDirty&&!saveChapter())return;current='modules';showAll()};
 $('#add-module').onclick=()=>modifyStructure('add');$('#duplicate-module').onclick=()=>modifyStructure('duplicate');$('#delete-module').onclick=()=>modifyStructure('delete');$('#module-up').onclick=()=>modifyStructure('up');$('#module-down').onclick=()=>modifyStructure('down');
 $('#image-file').onchange=addImage;
}
let editorSections=[],editorImages=[];
function captureSections(){document.querySelectorAll('[data-section]').forEach((el,i)=>{editorSections[i]=[el.querySelector('input').value,el.querySelector('textarea').value]})}
function drawEditSections(){$('#section-editor').innerHTML=editorSections.map((s,i)=>`<div data-section="${i}" class="card" style="background:#f6f8fd"><label>Заголовок раздела ${i+1}<input value="${escapeHTML(s[0])}" required></label><label>Текст раздела<textarea style="min-height:220px">${escapeHTML(s[1])}</textarea></label><div class="actions"><button type="button" class="secondary" onclick="moveSection(${i},-1)" ${i===0?'disabled':''}>↑</button><button type="button" class="secondary" onclick="moveSection(${i},1)" ${i===editorSections.length-1?'disabled':''}>↓</button><button type="button" class="secondary" onclick="deleteSection(${i})" ${editorSections.length===1?'disabled':''}>Удалить раздел</button></div></div>`).join('')}
function moveSection(i,d){captureSections();const j=i+d;if(j<0||j>=editorSections.length)return;[editorSections[i],editorSections[j]]=[editorSections[j],editorSections[i]];editorDirty=true;drawEditSections()}
function deleteSection(i){captureSections();if(editorSections.length===1||!confirm('Удалить этот раздел?'))return;editorSections.splice(i,1);editorDirty=true;drawEditSections()}
function drawImages(){$('#image-editor').innerHTML=editorImages.map((im,i)=>`<div class="card"><img src="${im.data}" alt="" style="max-width:230px;max-height:180px"><label>Подпись<input data-caption="${i}" value="${escapeHTML(im.caption)}"></label><button type="button" class="secondary" onclick="removeImage(${i})">Удалить изображение</button></div>`).join('');document.querySelectorAll('[data-caption]').forEach(el=>el.oninput=()=>{editorImages[Number(el.dataset.caption)].caption=el.value;editorDirty=true})}
function removeImage(i){editorImages.splice(i,1);editorDirty=true;drawImages()}
async function addImage(e){const f=e.target.files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>3*1024*1024){alert('Нужен PNG, JPEG или WebP не больше 3 МБ.');return}if(editorImages.length>=30){alert('Не больше 30 изображений в главе.');return}try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});editorImages.push({data,caption:f.name});editorDirty=true;drawImages()}catch(e){alert('Не удалось прочитать изображение.')}}
function saveChapter(){
 const form=$('#editor-form');if(!form.reportValidity())return false;captureSections();
 try{
 const rows=$('#etable').value.split('\n').filter(x=>x.trim()).map(r=>r.split('|').map(x=>x.trim()));
 if(!rows.length||rows.some(r=>r.length!==rows[0].length))throw Error('В таблице должно быть одинаковое число столбцов в каждой строке.');
 const links=$('#elinks').value.split('\n').filter(x=>x.trim()).map(r=>{const p=r.indexOf('|');if(p<1)throw Error('Ссылка: название | https://адрес');return [r.slice(0,p).trim(),r.slice(p+1).trim()]});
 const prev=modules[editorIndex];const m={title:$('#etitle').value.trim(),hours:Number($('#ehours').value),goal:$('#egoal').value,sections:editorSections,table:rows,task:$('#etask').value,answer:$('#eanswer').value,checks:$('#echecks').value.split('\n').filter(x=>x.trim()),links,images:editorImages};if(prev.origin!==undefined)m.origin=prev.origin;if(prev.graphic)m.graphic=prev.graphic;
 validateBook({format:'armatura-book-v4',modules:[m]});modules[editorIndex]=JSON.parse(JSON.stringify(m));const stored=persistContent();editorDirty=false;
 // Content changes invalidate self-assessment for the edited chapter.
 state.done=state.done.filter(i=>i!==editorIndex);state.best=null;save();
 $('#edit-status').textContent=stored?'Глава сохранена в браузере. Для передачи скачайте весь проект ZIP.':'Глава обновлена в памяти, но браузер не сохранил её на диск. Сейчас скачайте HTML или JSON — иначе изменения можно потерять.';return true;
 }catch(e){$('#edit-status').textContent='Не сохранено: '+e.message;return false}
}
function modifyStructure(action){if(editorDirty&&!saveChapter())return;if(action==='delete'&&!confirm('Удалить модуль? Это действие сбросит учебный прогресс. Сначала сохраните резервную копию.'))return;
 if(action==='add'){modules.push({title:'Новый модуль',hours:0,goal:'',sections:[['Первый раздел','']],table:[['Параметр','Пояснение'],['Пример','Текст']],task:'',answer:'',checks:[],links:[],images:[]});editorIndex=modules.length-1}
 if(action==='duplicate'){const m=JSON.parse(JSON.stringify(modules[editorIndex]));m.title+=' — копия';modules.splice(editorIndex+1,0,m);editorIndex++}
 if(action==='delete'&&modules.length>1){modules.splice(editorIndex,1);editorIndex=Math.min(editorIndex,modules.length-1)}
 if(action==='up'&&editorIndex>0){[modules[editorIndex-1],modules[editorIndex]]=[modules[editorIndex],modules[editorIndex-1]];editorIndex--}
 if(action==='down'&&editorIndex<modules.length-1){[modules[editorIndex+1],modules[editorIndex]]=[modules[editorIndex],modules[editorIndex+1]];editorIndex++}
 state={done:[],notes:{},best:null};save();const ok=persistContent();editorDirty=false;editor();$('#book-status').textContent=ok?'Структура обновлена. Учебный прогресс сброшен, чтобы не связывать ответы с другой главой.':'Изменения только в памяти. Скачайте HTML или JSON сейчас.';
}
async function importBook(e){const file=e.target.files[0];if(!file)return;if(file.size>100*1024*1024){alert('Файл больше 100 МБ.');return}try{const list=validateBook(JSON.parse(await file.text()));if(!confirm('Заменить всю текущую книгу и сбросить прогресс? Несохранённые изменения будут потеряны.'))return;modules.splice(0,modules.length,...JSON.parse(JSON.stringify(list)));state={done:[],notes:{},best:null};save();const ok=persistContent();editorIndex=0;editorDirty=false;editor();$('#book-status').textContent=ok?'Книга загружена. Теперь можно скачать новую HTML-версию.':'Книга загружена только в память — скачайте HTML или JSON.'}catch(e){alert('Импорт отменён: '+e.message)}}
function dateStamp(){return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}
function downloadData(text,name,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
function serialData(data){return JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')}
async function downloadBook(){try{await exportProject();$('#book-status').textContent='ZIP-проект передан браузеру. Распакуйте и загрузите изменённые файлы в GitHub. Исходный сайт автоматически не меняется.'}catch(e){alert('Не удалось собрать ZIP: '+e.message)}}
