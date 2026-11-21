// Execute the real gallery script against a small DOM fixture. This checks behavior,
// not browser layout; responsive appearance is verified separately in a browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const folder=path.join(root,'playground/bandori');
const html=await fs.readFile(path.join(folder,'index.html'),'utf8');
const catalog=JSON.parse(await fs.readFile(path.join(folder,'data/catalog.json'),'utf8'));
let source=(await fs.readFile(path.join(folder,'gallery.js'),'utf8')).replace(/\r\n/g,'\n');
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.dataset={};this.attrs={};this.events={};this.style={setProperty(){}};this.classList={add(){},remove(){}};}
 append(...nodes){for(const n of nodes){if(n.tagName==='FRAGMENT')this.children.push(...n.children);else this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=v;}
 getAttribute(k){return this.attrs[k];}
 removeAttribute(k){delete this[k];delete this.attrs[k];}
 addEventListener(k,v){this.events[k]=v;}
 querySelector(s){const wanted=s.slice(1);for(const n of this.children){if(n.className?.split(' ').includes(wanted))return n;const child=n.querySelector?.(s);if(child)return child;}return null;}
 showModal(){this.open=true;}
 close(){this.open=false;this.events.close?.();}
 focus(){}
}
class Option extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}}
const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const get=id=>nodes.get(id);
const document={body:new Element('body'),activeElement:new Element('body'),getElementById:get,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),createTextNode:text=>{const e=new Element('#text');e.textContent=text;return e;},addEventListener(){}};
const location={href:'https://bohao-str.github.io/playground/bandori/',pathname:'/playground/bandori/',search:''};
const storage=new Map();
source=source.replace('  init();\n})();','  globalThis.__test={getState:()=>state, getVisible:()=>visible, setBand, render, reset, openImage, toggleFavorite, init};\n  globalThis.__ready=init();\n})();');
assert(source.includes('globalThis.__ready'));
const context=vm.createContext({document,Option,URLSearchParams,location,history:{replaceState(_,__,url){const parsed=new URL(url,location.href);Object.assign(location,{href:parsed.href,pathname:parsed.pathname,search:parsed.search});}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},fetch:async()=>({ok:true,json:async()=>structuredClone(catalog)}),setTimeout:()=>1,clearTimeout(){},console,Math});
new vm.Script(source).runInContext(context);await context.__ready;
const api=context.__test, checks=[];
assert.equal(api.getVisible().length,catalog.count);assert.equal(get('grid').children.length,60);assert.equal(get('search').disabled,false);checks.push('catalog initialization and pagination');
get('more').onclick();assert.equal(get('grid').children.length,120);
for(const band of catalog.bands){api.setBand(band.id);assert.equal(api.getVisible().length,band.count,band.name);}
checks.push('every band filter, including multi-band membership');
if(catalog.bandSections){
 const allIds=catalog.bands.filter(b=>b.count).map(b=>b.id).sort();
 const options=get('band-select').children.filter(b=>b.tagName==='OPTGROUP');
 assert.deepEqual(options.map(b=>b.label),['老邦七团','Our Notes 五团','其他出场']);
 assert.deepEqual(options.flatMap(g=>g.children.map(o=>o.value)).sort(),allIds);
 assert.deepEqual(options[1].children.map(o=>o.value),['mygo','ave-mujica','mewtype','millsage','ikka']);
 const bandGroup=get('band-list').children.find(el=>el.getAttribute('aria-label')==='其他出场');
 const fairy=bandGroup.children.find(el=>el.dataset.band==='fairy-bouquet');fairy.onclick();
 assert.equal(Number(fairy.querySelector('.band-count').textContent),api.getVisible().length);
 assert(api.getVisible().some(a=>a.id==='tw19_baha_47099_17063_0'));
 assert(!api.getVisible().some(a=>a.id==='tw19_home_6415374_22'),'mention in the joke does not imply Fairy Bouquet appears');
 checks.push('grouped mobile and desktop band lists, guests and name-only references');
}
if(catalog.items.some(a=>a.batch)){
 api.reset();const chip=get('kind-list').children.find(e=>e.dataset.batch);chip.onclick();
 const batch=Number(chip.dataset.batch);const expected=catalog.items.filter(a=>a.batch===batch);
 assert.equal(api.getVisible().length,expected.length);assert(location.search.includes('batch='+batch));
 assert.equal(chip.getAttribute('aria-pressed'),'true');chip.onclick();assert.equal(api.getVisible().length,catalog.count);
 get('sort').value='newest';get('sort').onchange();assert(api.getVisible().slice(0,expected.length).every(a=>a.batch===batch));
 api.openImage('tw19_baha_47099_17063_0');assert(!get('detail-context').hidden);get('close').onclick();
 api.openImage('mygo_search_0076');assert(get('detail-context').hidden);get('close').onclick();
 checks.push('new-batch links, chronological ordering and image context');
}

api.setBand('ave-mujica');
const groups=get('character').children.filter(option=>option.tagName==='OPTGROUP');
assert.deepEqual(groups.map(group=>group.label),['本团成员','同图出镜']);
assert(groups[0].children.some(option=>option.value==='若叶睦'));
assert(groups[1].children.some(option=>option.value==='长崎爽世'));
get('character').value='长崎爽世';get('character').onchange();
assert(api.getVisible().some(item=>item.id==='expand_gif_0369'));
assert(api.getVisible().every(item=>item.characters.includes('长崎爽世') && item.bands.includes('ave-mujica')));
checks.push('band roster and identifiable guests stay searchable in separate option groups');
const reaction=catalog.items.find(a=>a.id==='mygo_search_0076');
assert.deepEqual(reaction.characters,['要乐奈']);
assert.equal(reaction.speaker,'长崎爽世');
api.reset();api.setBand('mygo');get('character').value='长崎爽世';get('character').onchange();
assert(!api.getVisible().some(a=>a.id===reaction.id),'off-screen speaker must not count as a visible character');
api.reset();api.getState().q='Tsukushi Futaba';api.render();
assert(api.getVisible().some(a=>a.id==='web_meme_0296'),'verified romanized character search');
api.reset();api.getState().q='八潮瑠唯';api.render();
assert(!api.getVisible().some(a=>a.id==='web_meme_0296'),'discarded name must not survive in search tags');
checks.push('on-screen characters, attributed lines and corrected search names');
api.reset();api.setBand('raise-a-suilen');get('character').value='佐藤益木（MASKING）';get('character').onchange();assert(api.getVisible().length>0);assert(api.getVisible().every(a=>a.characters.includes('佐藤益木（MASKING）')));checks.push('dependent character filter');
api.reset();get('format').value='animated';get('format').onchange();assert.equal(api.getVisible().length,catalog.animated);get('format').value='static';get('format').onchange();assert.equal(api.getVisible().length,catalog.count-catalog.animated);checks.push('animated and static formats');
for(const type of catalog.types){api.reset();api.getState().kind=type.id;api.render();assert.equal(api.getVisible().length,type.count);}
checks.push('semantic meme categories');
api.reset();api.getState().q='是又怎样';api.render();assert(api.getVisible().some(a=>a.id==='mygo_search_0086'));api.getState().q='true';api.render();assert(api.getVisible().length>0);checks.push('simplified/traditional Chinese and English search');
api.reset();api.getState().fresh=true;api.render();assert.equal(api.getVisible().length,catalog.added);checks.push('current additions filter');
api.reset();get('sort').value='newest';get('sort').onchange();if(catalog.added)assert(api.getVisible()[0].fresh);get('sort').value='shuffle';get('sort').onchange();assert.equal(new Set(api.getVisible().map(a=>a.id)).size,catalog.count);checks.push('newest and randomized ordering');
api.reset();const favorite=catalog.items[0].id;api.toggleFavorite(favorite);assert(storage.get('bohao-bandori-favorites-v1').includes(favorite));get('saved-only').onclick();assert.equal(api.getVisible().length,1);assert.equal(api.getVisible()[0].id,favorite);api.toggleFavorite(favorite);assert.equal(api.getVisible().length,0);assert.equal(get('empty').hidden,false);checks.push('favorites persist locally and empty favorites state');
// Check actual card anchors and dialog state as the user switches between formats.
for(const format of ['animated','static']){
 api.reset();get('format').value=format;get('format').onchange();
 const row=api.getVisible()[0], file=row.download?.path || row.image, save=row.save || file;
 const card=get('grid').children[0], link=card.querySelector('.card-bottom').children[0];
 assert.equal(link.href,save);assert.equal(link.download,path.posix.basename(save));
 if(format==='animated'){assert.match(file,/\.gif$/);assert.match(link.textContent,/GIF/);}
 const picture=card.querySelector('.picture');assert.equal(picture.href,file);
 picture.onclick({ctrlKey:true,preventDefault(){throw Error('modified link click intercepted');}});assert(!get('viewer').open);
 picture.onclick({preventDefault(){}});
 for(const el of [link,get('download')]){assert.equal(el.href,save);assert.equal(el.download,path.posix.basename(save));}
 assert.equal(get('detail-image').src,file);assert.equal(get('enlarge').href,file);get('close').onclick();
}
checks.push('download filename, card, native save in detail and full-size link for each format');
for(const format of ['gif','webp','png','jpg']){
 const item=catalog.items.find(a=>a.save && a.save.endsWith('.'+format));
 if(!item)continue;
 api.reset();api.openImage(item.id);
 assert.equal(get('download').href,item.save);assert.equal(get('download').download,item.id+'.'+format);
 assert.equal(get('detail-image').src,item.download?.path || item.image);
 assert.equal(get('enlarge').href,get('detail-image').src);
 get('close').onclick();
}
checks.push('archived downloads keep the correct filename and full-size image');
api.reset();api.getState().band='roselia';api.getState().format='animated';api.render();const first=api.getVisible()[0];api.openImage(first.id);assert(get('viewer').open);assert.equal(get('download').href,first.save || first.download.path);assert.equal(get('original').href,first.original);assert.equal(get('source').href,first.source);assert(location.search.includes('m='+first.id));get('next').onclick();assert.notEqual(get('detail-image').src,first.download.path);get('previous').onclick();assert.equal(get('detail-image').src,first.download.path);get('close').onclick();assert(!get('viewer').open);assert(!location.search.includes('m='));checks.push('modal, navigation, per-image share URL and downloads');
api.reset();location.search='?band=mygo&m='+catalog.items[0].id;location.href='https://bohao-str.github.io/playground/bandori/'+location.search;await api.init();assert(get('viewer').open);assert(location.search.includes('m='));get('close').onclick();checks.push('shared image opens even outside current filter');
api.reset();api.getState().q='__nothing_98237653__';api.render();assert.equal(api.getVisible().length,0);assert(get('random').disabled);api.reset();get('random').onclick();assert(get('viewer').open);checks.push('no results, reset and random image');
const longComic=catalog.items.find(item=>item.id==='cn19_weibo_5353261520393237_0');
if(longComic){
  api.reset();api.openImage(longComic.id);
  assert(longComic.width>=1000 && longComic.height>=2000,'long panel text should remain legible');
  assert.equal(get('enlarge').href,longComic.image);
  assert.equal(get('download').href,longComic.save || longComic.image);
  assert.equal(get('original').href,longComic.original);
  get('close').onclick();checks.push('legible long comics and full-size gallery links');
}
console.log(JSON.stringify({passed:checks.length,images:catalog.count,checks}));
