'use strict';
// ZIP without external libraries, uncompressed entries, UTF-8 names.
function zipBytes(entries){
 const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
 const u16=(v,n,x)=>v.setUint16(n,x,true),u32=(v,n,x)=>v.setUint32(n,x>>>0,true);
 const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0};
 for(const [name,data] of entries){const n=enc.encode(name),b=typeof data==='string'?enc.encode(data):data,c=crc(b);
 const local=new Uint8Array(30+n.length),v=new DataView(local.buffer);u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x800);u32(v,14,c);u32(v,18,b.length);u32(v,22,b.length);u16(v,26,n.length);local.set(n,30);chunks.push(local,b);
 const cd=new Uint8Array(46+n.length),cv=new DataView(cd.buffer);u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x800);u32(cv,16,c);u32(cv,20,b.length);u32(cv,24,b.length);u16(cv,28,n.length);u32(cv,42,offset);cd.set(n,46);central.push(cd);offset+=local.length+b.length;
 }
 const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0,0x06054b50);u16(v,8,entries.length);u16(v,10,entries.length);u32(v,12,size);u32(v,16,offset);return new Blob([...chunks,...central,end],{type:'application/zip'});
}
async function exportProject(){
 if(editorDirty&&!saveChapter())return;
 validateBook({format:'armatura-book-v4',modules});
 const entries=[],paths=await fetch('content/project-files.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Список файлов недоступен');return r.json()});
 for(const path of paths){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('Не удалось прочитать '+path);entries.push([path,new Uint8Array(await r.arrayBuffer())])}
 const names=modules.map((_,i)=>'content/modules/'+String(i+1).padStart(2,'0')+'-module.json');
 entries.push(['content/book.json',JSON.stringify({...BOOK.manifest,version:Date.now(),modules:names},null,2)]);
 modules.forEach((m,i)=>entries.push([names[i],JSON.stringify(m,null,2)]));
 // Retain externally stored images referenced by chapters.
 const imagePaths=[...new Set(modules.flatMap(m=>(m.images||[]).map(x=>x.data)).filter(x=>/^images\/[A-Za-z0-9_./-]+$/.test(x)))];
 for(const p of imagePaths){if(paths.includes(p))continue;const r=await fetch(p);if(!r.ok)throw Error('Не загружено изображение '+p);entries.push([p,new Uint8Array(await r.arrayBuffer())])}
 const blob=zipBytes(entries),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='armatura_project_'+dateStamp()+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
