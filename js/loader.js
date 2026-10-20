'use strict';
// Run through GitHub Pages or a local HTTP server (not file://).
(async()=>{try{
 const get=async p=>{const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw Error(p+': '+r.status);return r.json()};
 const manifest=await get('content/book.json');
 window.BOOK={manifest,modules:await Promise.all(manifest.modules.map(get)),standards:await get('content/standards.json'),quiz:await get('content/quiz.json')};
 for(const src of ['js/calculations.js','js/app.js','js/export.js','js/editor.js'])await new Promise((resolve,reject)=>{const e=document.createElement('script');e.src=src;e.onload=resolve;e.onerror=()=>reject(Error('Не загружен '+src));document.body.append(e)});
 nav('home');
}catch(e){document.querySelector('#view').textContent='Ошибка загрузки: '+e.message+'. Откройте через GitHub Pages или запустите python -m http.server 8000 в папке проекта. Двойной щелчок по index.html не поддерживается.';console.error(e)}})();
