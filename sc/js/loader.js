'use strict';
// Run through GitHub Pages or a local HTTP server (not file://).
// Материалы читаются из Supabase (опубликованные блоки).
// Если база пуста или недоступна — берём JSON-файлы, сайт работает всегда.
(async()=>{try{
 const get=async p=>{const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw Error(p+': '+r.status);return r.json()};
 const cfg=window.APP_CONFIG||{};
 const db=(window.supabase&&cfg.supabaseUrl&&cfg.supabaseAnonKey)
   ?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
 const fromDB=async()=>{
   if(!db)return null;
   try{
     const{data,error}=await db.rpc('published_book');
     if(error)throw Error(error.message||'запрос отклонён');
     return Array.isArray(data)&&data.length?data:null;
   }catch(e){console.warn('Главы из базы не получены, используем JSON:',e.message);return null}
 };
 const manifest=await get('content/book.json');
 const remote=await fromDB();
 const modules=remote?remote.map(m=>({
   title:String(m.title??''),hours:Number(m.hours??0),goal:String(m.goal??''),
   sections:Array.isArray(m.sections)?m.sections:[],table:Array.isArray(m.table)?m.table:[],
   task:String(m.task??''),answer:String(m.answer??''),
   checks:Array.isArray(m.checks)?m.checks:[],links:Array.isArray(m.links)?m.links:[]
 })):await Promise.all(manifest.modules.map(get));
 if(remote&&remote.length<manifest.modules.length){
   console.warn('В базе опубликовано '+remote.length+' из '+manifest.modules.length+' глав.');
 }
 window.BOOK={manifest,modules,source:remote?'db':'json',standards:await get('content/standards.json'),quiz:await get('content/quiz.json')};
 for(const src of ['js/calculations.js','js/app.js','js/export.js','js/editor.js'])await new Promise((resolve,reject)=>{const e=document.createElement('script');e.src=src;e.onload=resolve;e.onerror=()=>reject(Error('Не загружен '+src));document.body.append(e)});
 nav('home');
}catch(e){document.querySelector('#view').textContent='Ошибка загрузки: '+e.message+'. Откройте через GitHub Pages или запустите python -m http.server 8000 в папке проекта. Двойной щелчок по index.html не поддерживается.';console.error(e)}})();