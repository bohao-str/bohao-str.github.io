/* A small, dependency-free gallery. Favorites stay in this browser. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 60;
  const FAVORITES_KEY = 'bohao-bandori-favorites-v1';
  let library, items = [], visible = [], shown = 0, current = null, modalItems = [], ordered = [];
  let state, searchTimer, toastTimer, favoriteIds = new Set(), isRestoring = false;
  const starButtons = new Map();
  const traditional = Object.fromEntries(['愛爱','樂乐','燈灯','華华','鈴铃','夢梦','麼么','這这','樣样','會会','們们','為为','說说','還还','沒没','來来','開开','對对','實实','點点','時时','歡欢','過过','個个','讓让','見见','覺觉','裡里','裏里','嗎吗','與与','難难','從从','聽听','經经','無无','別别','氣气','擔担','關关','應应','學学','輸输','厲厉','獲获','號号','總总','團团','聲声','錢钱','現现','後后','買买','頭头','發发','長长','該该','種种','給给','錯错','親亲','選选','網网','變变','隻只','葉叶','豐丰','橋桥','澤泽','濱滨','櫻樱','彌弥','麥麦','張张','蘭兰','將将','結结','連连','進进','憶忆','認认','謝谢','驚惊','嗎吗'].map(pair => [pair[0], pair[1]]));
  const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\u3400-\u9fff]/g, c => traditional[c] || c);
  const bandById = id => library.bands.find(b => b.id === id);
  const bandNames = a => a.bands.map(id => bandById(id)?.name).filter(Boolean).join(' / ');
  const textElement = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  const selectedImage = () => items.find(a => a.id === current);

  function readState() {
    const p = new URLSearchParams(location.search);
    const previousName = p.get('character') || '';
    const character = previousName === '仲町亚罗蕾' ? '仲町阿拉蕾' : previousName;
    return { q: p.get('q') || '', band: p.get('band') || '', character, kind: p.get('kind') || '', format: p.get('format') || '', sort: ['featured', 'newest', 'shuffle'].includes(p.get('sort')) ? p.get('sort') : 'featured', saved: p.get('saved') === '1', fresh: p.get('fresh') === '1' };
  }
  function writeURL() {
    const p = new URLSearchParams();
    for (const key of ['q','band','character','kind','format']) if (state[key]) p.set(key,state[key]);
    if (state.sort !== 'featured') p.set('sort',state.sort);
    if (state.saved) p.set('saved','1');
    if (state.fresh) p.set('fresh','1');
    if (current) p.set('m',current);
    const next = location.pathname + (p.size ? '?' + p.toString() : '');
    history.replaceState(null,'',next);
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; },2600);
  }
  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favoriteIds])); }
    catch { toast('这次收藏会保留到页面关闭；浏览器暂时不能写入本地存储。'); }
    $('saved-count').textContent = favoriteIds.size;
  }
  function paintStar(button,id) {
    const active = favoriteIds.has(id); button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',active ? '取消收藏' : '收藏这张图片');
  }
  function paintDetailStar() {
    const active = favoriteIds.has(current);
    $('detail-save').textContent = active ? '★ 已收藏' : '☆ 收藏';
    $('detail-save').setAttribute('aria-pressed',String(active));
  }
  function toggleFavorite(id) {
    const add = !favoriteIds.has(id); if (add) favoriteIds.add(id); else favoriteIds.delete(id);
    saveFavorites(); const button = starButtons.get(id); if (button) paintStar(button,id);
    if (current === id) paintDetailStar();
    if (state.saved) render(); else updateFacets();
    toast(add ? '已收藏，留在这台设备的浏览器里。' : '已取消收藏。');
  }

  function matches(a,omit = '') {
    if (omit !== 'band' && state.band && !a.bands.includes(state.band)) return false;
    if (omit !== 'band' && state.character && !a.characters.includes(state.character)) return false;
    if (omit !== 'kind' && state.kind && a.kind !== state.kind) return false;
    if (state.format && a.animated !== (state.format === 'animated')) return false;
    if (state.saved && !favoriteIds.has(a.id)) return false;
    if (state.fresh && !a.fresh) return false;
    const terms = normalize(state.q.trim()).split(/\s+/).filter(Boolean);
    return terms.every(term => a.search.includes(term));
  }
  function makeOrder() {
    if (state.sort === 'newest') return [...items].sort((a,b) => b.added.localeCompare(a.added) || Number(b.fresh)-Number(a.fresh));
    if (state.sort === 'shuffle') return [...items].sort((a,b) => a.shuffle-b.shuffle);
    const featured = items.filter(a => a.featured), rest = items.filter(a => !a.featured);
    const groups = library.bands.map(b => featured.filter(a => a.bands[0] === b.id));
    const result = []; const max = Math.max(0,...groups.map(g => g.length));
    for (let i=0;i<max;i++) for (const group of groups) if (group[i]) result.push(group[i]);
    return [...result,...rest];
  }
  function updateFacets() {
    const bandPool = items.filter(a => matches(a,'band'));
    for (const button of $('band-list').children) {
      const id = button.dataset.band;button.setAttribute('aria-pressed',String(state.band === id));
      button.querySelector('.band-count').textContent = id ? bandPool.filter(a => a.bands.includes(id)).length : bandPool.length;
    }
    const typePool = items.filter(a => matches(a,'kind'));
    for (const button of $('kind-list').children) {
      if (button.dataset.fresh) { button.setAttribute('aria-pressed',String(state.fresh));continue; }
      const kind = button.dataset.kind;button.setAttribute('aria-pressed',String(state.kind === kind));
      button.querySelector('.kind-count').textContent = kind ? typePool.filter(a => a.kind === kind).length : typePool.length;
    }
    $('saved-only').setAttribute('aria-pressed',String(state.saved));
  }
  function fillCharacters() {
    const available = new Set(items.filter(a => !state.band || a.bands.includes(state.band)).flatMap(a => a.characters));
    let names = [...available].sort((a,b) => a.localeCompare(b,'zh-CN'));
    if (state.band) {
      const canonical = bandById(state.band)?.characters || [];
      names = [...canonical.filter(c => available.has(c)),...names.filter(c => !canonical.includes(c))];
    }
    $('character').replaceChildren(new Option('全部角色',''));
    for (const name of names) $('character').append(new Option(name,name));
    if (state.character && !available.has(state.character)) state.character = '';
    $('character').value = state.character;
  }
  function setBand(id) {
    state.band = id;state.character = '';$('band-select').value = id;fillCharacters();render();
  }
  function buildControls() {
    $('band-list').replaceChildren();$('band-select').replaceChildren(new Option('全部乐队',''));
    for (const b of [{id:'',name:'全部乐队',color:'#91a27d'},...library.bands]) {
      if (b.id && !b.count) continue;
      const button = document.createElement('button');button.className = 'band-button';button.dataset.band = b.id;
      button.style.setProperty('--band',b.color);button.append(textElement('span','','dot'),textElement('span',b.name,'band-name'),textElement('span','','band-count'));
      button.onclick = () => setBand(b.id);$('band-list').append(button);
      if (b.id) $('band-select').append(new Option(b.name,b.id));
    }
    $('band-total').textContent = library.bands.filter(b => b.id !== 'other' && b.count).length;
    $('kind-list').replaceChildren();
    for (const kind of [{id:'',name:'全部'},...library.types]) {
      const button = document.createElement('button');button.className = 'kind-button';button.dataset.kind = kind.id;
      button.append(document.createTextNode(kind.name),textElement('span','','kind-count'));
      button.onclick = () => {state.kind = kind.id;render();};$('kind-list').append(button);
    }
    if (library.added) {
      const button = textElement('button',`本次新增 ${library.added}`,'kind-button fresh-button');button.dataset.fresh = '1';button.onclick = () => {state.fresh = !state.fresh;render();};$('kind-list').append(button);
    }
    syncControls();
  }
  function syncControls() {
    $('search').value = state.q;$('band-select').value = state.band;$('format').value = state.format;$('sort').value = state.sort;fillCharacters();
  }
  function reset() {
    clearTimeout(searchTimer);state = {q:'',band:'',character:'',kind:'',format:'',sort:'featured',saved:false,fresh:false};ordered = makeOrder();syncControls();render();
  }
  function makeCard(a) {
    const article = document.createElement('article');article.className = 'meme-card';
    const button = document.createElement('button');button.className = 'picture';button.setAttribute('aria-label','查看 '+a.title);
    const img = document.createElement('img');img.src = a.thumb;img.alt = a.title;img.width = 380;img.height = 350;img.loading = 'lazy';img.decoding = 'async';button.append(img);
    if (a.animated) button.append(textElement('span','▶ 动图','media-badge'));
    if (a.fresh) button.append(textElement('span','NEW','fresh-badge'));
    button.onclick = () => openImage(a.id);
    const info = document.createElement('div');info.className = 'card-info';
    const title = textElement('h2',a.title);title.title = a.title;
    const band = textElement('p',bandNames(a),'card-band');band.title = bandNames(a);
    const bottom = document.createElement('div');bottom.className = 'card-bottom';
    const download = textElement('a','保存 ↓');download.href = a.image;download.download = a.id+'.webp';
    const star = document.createElement('button');star.className = 'star-button';paintStar(star,a.id);star.onclick = () => toggleFavorite(a.id);starButtons.set(a.id,star);
    bottom.append(download,star);info.append(title,band,bottom);article.append(button,info);return article;
  }
  function appendPage() {
    const end = Math.min(visible.length,shown+PAGE_SIZE),fragment = document.createDocumentFragment();
    for (let i=shown;i<end;i++) fragment.append(makeCard(visible[i]));
    $('grid').append(fragment);shown = end;
    $('more-wrap').hidden = shown >= visible.length;
    $('more').textContent = `再翻 ${Math.min(PAGE_SIZE,visible.length-shown)} 张 ↓`;
    $('page-progress').textContent = `已看到 ${shown} / ${visible.length} 张`;
    const context = state.band ? bandById(state.band).name+' · ' : '';
    $('result-count').textContent = `${context}${visible.length} 张${visible.length ? ` · 已显示 ${shown} 张` : ''}`;
  }
  function render() {
    if (!library) return;
    visible = ordered.filter(a => matches(a));shown = 0;starButtons.clear();$('grid').replaceChildren();appendPage();updateFacets();
    $('empty').hidden = visible.length > 0;$('random').disabled = !visible.length;
    $('empty-title').textContent = state.saved && !favoriteIds.size ? '收藏夹还是空的。' : '暂时没找到这张图。';
    $('empty-copy').textContent = state.saved && !favoriteIds.size ? '点一下图片下面的 ☆，喜欢的图就能留在这里。' : '换个词，或者减少一个筛选条件试试。';
    $('reset').hidden = !['q','band','character','kind','format','saved','fresh'].some(k => state[k]);
    writeURL();
  }
  function openImage(id) {
    const a = items.find(x => x.id === id);if (!a) return;
    current = id;modalItems = visible.some(x => x.id === id) ? visible : ordered;
    $('image-loading').hidden = false;$('image-loading').textContent = '图片加载中…';
    $('detail-image').alt = a.title;$('detail-image').src = a.image;
    $('detail-title').textContent = a.title;$('detail-band').textContent = bandNames(a);
    $('detail-position').textContent = `${modalItems.findIndex(x => x.id === id)+1} / ${modalItems.length}`;
    const people = a.characters.length ? '画面人物：' + a.characters.join('、') : '';
    const dialogue = a.speaker ? '台词角色（原站标注）：' + a.speaker : '';
    $('detail-meta').textContent = [people,dialogue,a.animated ? '动态图片' : '静态图片',`${a.width} × ${a.height}`,`${Math.round(a.bytes/1024)} KB`,a.author ? `来源署名：${a.author}` : ''].filter(Boolean).join(' · ');
    $('download').href = a.image;$('download').download = a.id+'.webp';$('original').href = a.original;$('source').href = a.source;paintDetailStar();
    document.body.classList.add('has-dialog');if (!$('viewer').open) $('viewer').showModal();writeURL();
  }
  function stepImage(direction) {
    if (!modalItems.length) return;const i = modalItems.findIndex(a => a.id === current);
    openImage(modalItems[(i+direction+modalItems.length)%modalItems.length].id);
  }
  function closeImage() { $('viewer').close(); }
  $('detail-image').onload = () => { $('image-loading').hidden = true; };
  $('detail-image').onerror = () => { $('image-loading').hidden = false;$('image-loading').textContent = '图片暂时没有加载出来，可以试试下方的原始文件。'; };
  $('close').onclick = closeImage;$('previous').onclick = () => stepImage(-1);$('next').onclick = () => stepImage(1);
  $('viewer').addEventListener('close',() => {current = null;$('detail-image').removeAttribute('src');document.body.classList.remove('has-dialog');if (!isRestoring && library) writeURL();});
  $('viewer').addEventListener('click',e => {if (e.target !== $('viewer')) return;const r = $('viewer').getBoundingClientRect();if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) closeImage();});
  $('detail-save').onclick = () => {if (current) toggleFavorite(current);};
  $('copy-link').onclick = async () => {writeURL();try {await navigator.clipboard.writeText(location.href);toast('已复制这张图片的链接。');} catch {toast('链接已在地址栏里，可以直接复制。');}};
  $('search').addEventListener('input',() => {clearTimeout(searchTimer);searchTimer = setTimeout(() => {state.q = $('search').value;render();},160);});
  $('band-select').onchange = () => setBand($('band-select').value);
  $('character').onchange = () => {state.character = $('character').value;render();};
  $('format').onchange = () => {state.format = $('format').value;render();};
  $('sort').onchange = () => {state.sort = $('sort').value;ordered = makeOrder();render();};
  $('saved-only').onclick = () => {if (!library) return;state.saved = !state.saved;render();};
  $('reset').onclick = reset;$('empty-reset').onclick = reset;$('more').onclick = appendPage;
  $('random').onclick = () => {if (visible.length) openImage(visible[Math.floor(Math.random()*visible.length)].id);};
  document.addEventListener('keydown',e => {
    if ($('viewer').open) {if (e.key === 'ArrowLeft') {e.preventDefault();stepImage(-1);}if (e.key === 'ArrowRight') {e.preventDefault();stepImage(1);}return;}
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {e.preventDefault();$('search').focus();}
  });
  window.addEventListener('popstate',() => {if (!library) return;const id = new URLSearchParams(location.search).get('m');isRestoring = true;if ($('viewer').open) closeImage();state = readState();syncControls();ordered = makeOrder();render();if (id) openImage(id);isRestoring = false;});

  async function init() {
    $('load-error').hidden = true;$('result-count').textContent = '正在打开收藏夹…';
    for (const id of ['search','band-select','character','format','sort','saved-only']) $(id).disabled = true;
    try {
      const response = await fetch('data/catalog.json',{cache:'no-cache'});if (!response.ok) throw new Error('catalog '+response.status);
      library = await response.json();if (!Array.isArray(library.items) || !Array.isArray(library.bands)) throw new Error('invalid catalog');
      items = library.items.map(a => {
        const names = a.characters.flatMap(name => [name,...(library.characterAliases?.[name] || [])]);
        const bands = a.bands.flatMap(id => {const band = bandById(id);return band ? [band.name,...band.aliases] : [];});
        return {...a,shuffle:Math.random(),search:normalize([a.title,...names,...a.tags,...bands].join(' '))};
      });
      state = readState();if (state.band && !bandById(state.band)) state.band = '';if (state.kind && !library.types.some(t => t.id === state.kind)) state.kind = '';if (!['','animated','static'].includes(state.format)) state.format = '';
      try {const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');favoriteIds = new Set(Array.isArray(saved) ? saved.filter(id => items.some(a => a.id === id)) : []);} catch {favoriteIds = new Set();}
      $('saved-count').textContent = favoriteIds.size;$('total-count').textContent = library.count;$('animated-count').textContent = library.animated;
      const sharedId = new URLSearchParams(location.search).get('m');buildControls();ordered = makeOrder();render();if (sharedId) openImage(sharedId);
      for (const id of ['search','band-select','character','format','sort','saved-only']) $(id).disabled = false;
    } catch (error) {$('load-error').hidden = false;$('result-count').textContent = '收藏夹加载失败';$('random').disabled = true;console.error('Unable to load meme library',error);}
  }
  $('retry').onclick = init;
  init();
})();
