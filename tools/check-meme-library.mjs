import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
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
const index=await fs.readFile(path.join(gallery,'all/index.html'),'utf8');
const saves=[...index.matchAll(/href="([^"]+)" download="([^"]+)"/g)].map(m=>m.slice(1));
const pictures=[...index.matchAll(/class="picture" href="([^"]+)"/g)].map(m=>m[1]);
const thumbnails=[...index.matchAll(/<img src="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(thumbnails,data.items.map(a=>a.thumb.startsWith('https://')?a.thumb:'../'+a.thumb));
assert.equal(saves.length,data.count);assert.equal(pictures.length,data.count);
// Walk GIF blocks: counting 0x2C bytes in compressed image data would give false frames.
function gifInfo(buf){
 assert.match(buf.toString('ascii',0,6),/^GIF8[79]a$/);
 const table=flags=>(flags&128)?3*(2**((flags&7)+1)):0;
 let pos=13+table(buf[10]), frames=0;
 function subblocks(){while(pos<buf.length){const n=buf[pos++];if(!n)return;pos+=n;}throw Error('truncated GIF');}
 while(pos<buf.length){
  const kind=buf[pos++];
  if(kind===0x3b)return {width:buf.readUInt16LE(6),height:buf.readUInt16LE(8),frames};
  if(kind===0x21){pos++;subblocks();continue;}
  assert.equal(kind,0x2c,'bad GIF image descriptor');frames++;
  pos+=9+table(buf[pos+8])+1;subblocks();
 }
 throw Error('missing GIF trailer');
}
let size=0,gifs=0;
let i=0;
for(const a of data.items){
 const file=a.download?.path || a.image;
 const saving=a.save || file;
 const staticHref=url=>url.startsWith('https://')?url:'../'+url;
 assert.deepEqual(saves[i],[staticHref(saving),path.posix.basename(saving)],a.id+' static download');
 assert.equal(pictures[i++],staticHref(file),a.id+' static full-size image');
 if(a.save){
  const match=/^https:\/\/raw\.githubusercontent\.com\/bohao-str\/bohao-str\.github\.io\/[0-9a-f]{40}\/publications\/(\d{4}-\d{2}-\d{2})\/(w\d{3})\/([^/]+)$/.exec(a.image);
  assert(match && match[3]===a.id+'.webp',a.id+' immutable browser preview');
  const ext=path.posix.extname(a.save).slice(1);
  assert(a.download ? ext==='gif' : ['jpg','png','webp'].includes(ext),a.id+' native download format');
  assert.equal(a.save,'https://github.com/bohao-str/bohao-str.github.io/releases/download/bandori-cn-'+match[1].replaceAll('-','')+'-'+match[2]+'/'+a.id+'.'+ext);
  if(a.download)assert.equal(a.download.path,a.image.slice(0,-4)+'gif');
  assert.match(a.imageSha256,/^[0-9a-f]{64}$/);
 }
 assert(!a.animated||a.download,a.id+' needs GIF download');
 if(a.download){
  if(!a.save)assert.equal(file,'gifs/'+a.id+'.gif');
  const disk=a.save?path.join(root,'.local/gallery-hosted/gifs',a.id+'.gif'):path.join(gallery,file);
  const bytes=await fs.readFile(disk).catch(e=>{if(a.save && e.code==='ENOENT')return null;throw e;});
  if(bytes){
  const info=gifInfo(bytes);
  assert.equal(bytes.length,a.download.bytes,file);
  assert.deepEqual([info.width,info.height],[a.download.width,a.download.height],file);
  assert.equal(info.frames>1,a.animated,file+' animation');assert(info.frames>=1,file);
  size+=bytes.length;
  }
  gifs++;
 }
 assert(a.title&&a.characters&&a.bands.length,a.id);
 assert(a.bands.every(b=>bands.has(b)),a.id+' band');assert(types.has(a.kind),a.id+' kind');
 assert(/^https:\/\//.test(a.source),a.id+' source');assert(/^https:\/\//.test(a.original),a.id+' original');
 for(const rel of [a.image,a.thumb]){
  if(a.save && rel===a.image){
   const preview=await fs.readFile(path.join(root,'.local/gallery-hosted/media',a.id+'.webp')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(preview){assert.equal(preview.length,a.bytes);assert.equal(createHash('sha256').update(preview).digest('hex'),a.imageSha256);}
   continue;
  }
  if(rel===a.thumb && rel.startsWith('https://')){
   assert(a.save,a.id+' hosted thumbnail needs a published asset');
   assert.equal(rel,a.image.slice(0,a.image.lastIndexOf('/')+1)+'thumbs/'+a.id+'.webp');
   assert.match(a.thumbSha256,/^[a-f0-9]{64}$/);
   const thumb=await fs.readFile(path.join(root,'.local/gallery-hosted/thumbs',a.id+'.webp')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(thumb)assert.equal(createHash('sha256').update(thumb).digest('hex'),a.thumbSha256);
   continue;
  }
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
console.log(JSON.stringify({images:data.count,animations:data.animated,new:data.added,assets:data.count*2+gifs,gifDownloads:gifs,assetMB:Math.round(size/1024**2),checks:'metadata, paths, WebP signatures, GIF frames and static downloads, CSS balance, navigation, JS syntax and UI bindings passed'}));
