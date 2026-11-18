import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const gallery=path.join(root,'playground/bandori');
const data=JSON.parse(await fs.readFile(path.join(gallery,'data/catalog.json'),'utf8'));
const js=await fs.readFile(path.join(gallery,'gallery.js'),'utf8');
new vm.Script(js);
assert.equal(data.count,data.items.length);
assert.equal(data.animated,data.items.filter(a=>a.animated).length);
assert.equal(data.added,data.items.filter(a=>a.fresh).length);
assert.equal(new Set(data.items.map(a=>a.id)).size,data.count);
const bands=new Set(data.bands.map(b=>b.id));
const types=new Set(data.types.map(t=>t.id));
let size=0;
for(const a of data.items){
 assert(a.title&&a.characters&&a.bands.length,a.id);
 assert(a.bands.every(b=>bands.has(b)),a.id+' band');assert(types.has(a.kind),a.id+' kind');
 assert(/^https:\/\//.test(a.source),a.id+' source');assert(/^https:\/\//.test(a.original),a.id+' original');
 for(const rel of [a.image,a.thumb]){
  assert(!rel.includes('..')&&!path.isAbsolute(rel),a.id+' path');
  const p=path.join(gallery,rel);const stat=await fs.stat(p);assert(stat.size>100,p);size+=stat.size;
  const buf=await fs.readFile(p);assert.equal(buf.toString('ascii',0,4),'RIFF',p);assert.equal(buf.toString('ascii',8,12),'WEBP',p);
 }
}
for(const band of data.bands)assert.equal(band.count,data.items.filter(a=>a.bands.includes(band.id)).length,band.name);
for(const type of data.types)assert.equal(type.count,data.items.filter(a=>a.kind===type.id).length,type.name);
for(const n of ['playground/playground.css','playground/bandori/gallery.css']){
 const css=await fs.readFile(path.join(root,n),'utf8');
 assert.equal([...css].filter(c=>c==='{').length,[...css].filter(c=>c==='}').length,n+' braces');
 assert.equal([...css].filter(c=>c==='(').length,[...css].filter(c=>c===')').length,n+' parentheses');
 assert(!/@import|url\(/i.test(css),n+' external assets');
}
for(const n of ['index.html','notes/index.html','blog/index.html','404.html']){
 const html=await fs.readFile(path.join(root,n),'utf8');assert(html.includes('class="off-duty-link" href="/playground/"'),n+' navigation');assert(!/<script\b/i.test(html),n+' academic scripts');
}
const html=await fs.readFile(path.join(gallery,'index.html'),'utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
for(const m of js.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(m[1]),'missing UI element '+m[1]);
assert(!html.includes('OurNotes 各团'));
assert(!/C:\\Users|file:\/\/|_file|\\downloads\\/.test(JSON.stringify(data)),'private local path in public catalog');
console.log(JSON.stringify({images:data.count,animations:data.animated,new:data.added,assets:data.count*2,assetMB:Math.round(size/1024**2),checks:'metadata, paths, WebP signatures, CSS balance, navigation, JS syntax and UI bindings passed'}));
