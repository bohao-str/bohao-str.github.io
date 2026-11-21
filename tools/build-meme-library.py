"""Build the public Bandori library from locally collected, reviewed image catalogs.

python tools/build-meme-library.py --catalog catalog.json --asset-root path/to/originals
Repeat --extra for each new batch or --previous-extra for an earlier batch.
Manifests contain a JSON list (or {files: [...]}) with a local `file` per item.
Only web assets and public attribution metadata are emitted. Originals stay outside Git.
Requires Pillow. No network requests are made by this script.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from collections import Counter
from PIL import Image,ImageStat
from gallery_gif import gif_download, RECIPE as GIF_RECIPE
import argparse,json,hashlib,re,html,os,time
from datetime import date
from io import BytesIO

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'playground/bandori'
BANDS=[
 ('poppin-party',"Poppin’Party",'#d95776','PoPiPa','Poppin\'Party|Poppin’Party|Poppin Party|popipa|破琵琶|ppp'),
 ('afterglow','Afterglow','#d65350','AG','Afterglow|ag|阿芙特狗'),
 ('pastel-palettes','Pastel＊Palettes','#c788a7','PasuPare','Pastel＊Palettes|Pastel*Palettes|Pastel Palettes|pasupare|彩团'),
 ('roselia','Roselia','#666db2','Roselia','Roselia|r组|r团|露世莉亚'),
 ('hello-happy-world','Hello, Happy World!','#c8a334','HHW','Hello, Happy World!|Hello Happy World|hhw|harohapi|哈喽嗨皮'),
 ('morfonica','Morfonica','#4b9dba','Morfonica','Morfonica|morfonication|morf|蝶团'),
 ('raise-a-suilen','RAISE A SUILEN','#51a39a','RAS','RAISE A SUILEN|ras'),
 ('mygo','MyGO!!!!!','#4d93ad','MyGO','MyGO!!!!!|mygo|迷子'),
 ('ave-mujica','Ave Mujica','#90556b','Ave Mujica','Ave Mujica|avemujica|母鸡卡'),
 ('mewtype','梦限大MewType','#bd84bb','MewType','梦限大MewType|夢限大みゅーたいぷ|Mugendai Mewtype|mewtype|yumemita|梦限大|梦限大MewType'),
 ('millsage','millsage','#729b81','millsage','millsage'),
 ('ikka','一家Dumb Rock!','#c88750','一家','一家Dumb Rock!|一家|ikka dumb rock|ikkadumbrock|ikkadanrock'),
 ('fairy-bouquet','Fairy Bouquet','#947eaa','Fairy Bouquet','Fairy Bouquet|fairybouquet|フェアリィブゥケ'),
 ('other','综合 / 其他角色','#8b8b82','其他','跨团|跨团及其他|其他角色|其他')
]
# These sections are browsing groups, not a list of every media appearance of each band.
BAND_SECTIONS=[
 {'name':'老邦七团','bands':['poppin-party','afterglow','pastel-palettes','roselia','hello-happy-world','morfonica','raise-a-suilen']},
 {'name':'Our Notes 五团','bands':['mygo','ave-mujica','mewtype','millsage','ikka']},
 {'name':'其他出场','bands':['fairy-bouquet','other']}
]
LOOKUP={v.casefold():b[0] for b in BANDS for v in b[4].split('|')}
LOOKUP.update({b[0]:b[0] for b in BANDS})
CHARACTERS={
 'poppin-party':['户山香澄','花园多惠','牛込里美','山吹沙绫','市谷有咲'],
 'afterglow':['美竹兰','青叶摩卡','上原绯玛丽','宇田川巴','羽泽鸫'],
 'pastel-palettes':['丸山彩','冰川日菜','白鹭千圣','大和麻弥','若宫伊芙'],
 'roselia':['凑友希那','冰川纱夜','今井莉莎','宇田川亚子','白金燐子'],
 'hello-happy-world':['弦卷心','濑田薰','北泽育美','松原花音','奥泽美咲'],
 'morfonica':['仓田真白','桐谷透子','广町七深','二叶筑紫','八潮瑠唯'],
 'raise-a-suilen':['和奏瑞依（LAYER）','朝日六花（LOCK）','佐藤益木（MASKING）','鳰原令王那（PAREO）','珠手知由（CHU²）'],
 'mygo':['高松灯','千早爱音','椎名立希','长崎爽世','要乐奈'],
 'ave-mujica':['丰川祥子','若叶睦','三角初华','八幡海铃','祐天寺若麦'],
 'mewtype':['仲町阿拉蕾','宫永野乃花','峰月律','藤都子','千石由乃'],
 'millsage':['汐见萤','伊泽枣','琴平凪','滨崎茉幌','和泉朋花'],
 'ikka':['须贺蕾叶','马桥心玖','矢仓蓬咲','梅里千樱梨','四宫宁月'],
 'fairy-bouquet':['薇欧拉','Bell','Popo']
}
CHAR_ALIASES={
 '佐藤益木（MASKING）':['MASKING','佐藤益木'],'鳰原令王那（PAREO）':['PAREO','鳰原令王那'],
 '珠手知由（CHU²）':['CHU²','珠手知由','CHU2'],'朝日六花（LOCK）':['LOCK','朝日六花'],
 '和奏瑞依（LAYER）':['LAYER','和奏瑞依'],'奥泽美咲':['奥泽美咲','米歇尔'],
 '千早爱音':['千早爱音','千早愛音'],'高松灯':['高松灯','高松燈'],'要乐奈':['要乐奈','要樂奈'],
 '仲町阿拉蕾':['仲町阿拉蕾','仲町亚罗蕾','仲町亞羅蕾']
}
TYPE_LABELS={'remix':'整活改图','reaction':'反应表情','quote':'台词截图','dango':'团子表情'}
def load(p):
 value=json.loads(Path(p).read_text(encoding='utf8'));return value['files'] if isinstance(value,dict) else value
def band_ids(a):
 source=a.get('bands') or [a.get('band','其他')]
 if isinstance(source,str):source=[source]
 ids=list(dict.fromkeys(LOOKUP.get(x.casefold(),'other') for x in source))
 if len(ids)>1 and 'other' in ids:ids.remove('other')
 return ids or ['other']
def characters(a,bands):
 if 'characters' in a:
  names=a['characters']
  if not isinstance(names,list) or any(not isinstance(name,str) or not name.strip() for name in names):
   raise ValueError('Invalid character list for '+a['key'])
  return list(dict.fromkeys(name.strip() for name in names))
 text=a.get('character','')
 if isinstance(text,list):text='、'.join(text)
 # Do not infer characters from broad source tags, which often mention other bands.
 result=[]
 for band in bands:
  for name in CHARACTERS.get(band,[]):
   if any(t.casefold() in text.casefold() for t in CHAR_ALIASES.get(name,[name])):result.append(name)
 if not result and text and '全员' not in text:
  result=[x.strip() for x in re.split('[、,，]',text) if x.strip() and len(x.strip())<35]
 return list(dict.fromkeys(result))
def kind(a):
 category=a.get('category','');key=a['key'];hint=' '.join(a.get('tags',[])).lower()
 if a.get('kind') in TYPE_LABELS:return a['kind']
 if category in TYPE_LABELS.values():return next(k for k,label in TYPE_LABELS.items() if label==category)
 if key.startswith('mygo_search_') or '名台词' in category:return 'quote'
 if 'tuanzi' in key or '团子' in category:return 'dango'
 if key.startswith('fan_') or '改图' in category or '中文整活' in category or '英文整活' in category:return 'remix'
 if any(s in hint for s in ['meme','shitpost','picmix','true','brainrot','skill issue','face dance','fortnite','jarvis']):return 'remix'
 return 'reaction'
def poster_frame(im,n):
 choices=[]
 for index in sorted({0,n//4,n//2,3*n//4}):
  im.seek(index);thumb=im.convert('RGBA');thumb.thumbnail((160,160))
  white=Image.new('RGBA',thumb.size,'white');white.alpha_composite(thumb);g=white.convert('L')
  stat=ImageStat.Stat(g);score=stat.stddev[0]-(40 if stat.mean[0]<25 else 0)
  choices.append((score,index))
 return max(choices)[1]
def static_href(path):
 return path if path.startswith('https://') else '../'+path

def hosted_urls(key, hosting, original_sha, generated):
 repo='bohao-str/bohao-str.github.io'
 if hosting.get('sha256')!=original_sha:raise ValueError('Archive source differs: '+key)
 image=hosting.get('image','');save=hosting.get('save','')
 prefix='https://raw.githubusercontent.com/'+repo+'/'
 match=re.fullmatch(re.escape(prefix)+r'[0-9a-f]{40}/publications/(\d{4}-\d{2}-\d{2})/(w\d{3})/'+re.escape(key)+r'[.]webp',image)
 if not match:raise ValueError('Invalid archive preview: '+key)
 stamp=date.fromisoformat(match[1]).strftime('%Y%m%d');wave=match[2]
 thumb=hosting.get('thumb')
 if thumb:
  expected_thumb=image.rsplit('/',1)[0]+'/thumbs/'+key+'.webp'
  thumb_file=generated.parent.parent/'thumbs'/(key+'.webp')
  if thumb!=expected_thumb or hashlib.sha256(thumb_file.read_bytes()).hexdigest()!=hosting.get('thumb_sha256'):
   raise ValueError('Archive thumbnail differs: '+key)
 if len(hosting.get('preview_sha256',''))!=64 or hashlib.sha256(generated.read_bytes()).hexdigest()!=hosting['preview_sha256']:
  raise ValueError('Archive preview differs: '+key)
 ext=hosting.get('save_ext','gif' if hosting.get('gif') else 'webp')
 if ext not in ('jpg','png','webp','gif') or bool(hosting.get('gif'))!=(ext=='gif'):raise ValueError('Unexpected download type: '+key)
 if ext=='gif' and hosting['gif']!=image[:-4]+'gif':raise ValueError('Invalid archive GIF: '+key)
 expected=f'https://github.com/{repo}/releases/download/bandori-cn-{stamp}-{wave}/{key}.{ext}'
 if save!=expected:raise ValueError('Invalid native download: '+key)
 return image,save

def convert(a,cache):
 key=a['key'];src=Path(a['_file']);raw=src.read_bytes();sha=hashlib.sha256(raw).hexdigest();sig=sha+':web-v2'
 if a.get('sha256') and a['sha256']!=sha:raise ValueError(f'{key}: original does not match the reviewed file')
 if 'preview_frame' in a or 'thumbnail_frame' in a:sig+=':'+str(a.get('preview_frame',a.get('thumbnail_frame')))
 media_root=ROOT/'.local/gallery-hosted' if a.get('_hosting') else DEST
 target=media_root/'media'/f'{key}.webp'
 thumb_root=media_root if (a.get('_hosting') or {}).get('thumb') else DEST
 thumb=thumb_root/'thumbs'/f'{key}.webp'
 with Image.open(BytesIO(raw)) as im:
  n=getattr(im,'n_frames',1);orig_size=im.size
  bounds=(1200,1000)
  if n==1 and im.height>1000 and im.height>1.8*im.width:
   bounds=(1200,4000);sig+=':tall-strip-v1'
  elif n==1 and im.width>1200 and im.width>2.6*im.height:
   bounds=(3600,1000);sig+=':wide-strip-v1'
  gif_target=media_root/'gifs'/f'{key}.gif'
  old=cache.get(key,{})
  same_source=old.get('sha256')==sha
  needs_gif=n>1 or im.format=='GIF'
  if same_source and old.get('gifRecipe')==GIF_RECIPE and (not needs_gif or (old.get('download') and gif_target.is_file() and gif_target.stat().st_size==old['download']['bytes'])):
   download=old.get('download')
  else:
   download=gif_download(raw,im,gif_target);im.seek(0)
  if old.get('signature')==sig and target.is_file() and thumb.is_file():return key,{**old,'gifRecipe':GIF_RECIPE,'download':download}
  if isinstance(a.get('preview_frame'),int):index=max(0,min(n-1,a['preview_frame']))
  elif a.get('thumbnail_frame')=='first':index=0
  elif a.get('thumbnail_frame')=='last':index=n-1
  else:index=poster_frame(im,n)
  im.seek(index)
  poster=im.convert('RGBA');poster.thumbnail((360,330),Image.Resampling.LANCZOS)
  canvas=Image.new('RGBA',(380,350),'white');canvas.alpha_composite(poster,((380-poster.width)//2,(350-poster.height)//2));canvas.convert('RGB').save(thumb,'WEBP',quality=80,method=3)
  if n>1:
   frames=[];durations=[]
   for i in range(n):
    im.seek(i);frame=im.convert('RGBA');frame.thumbnail((480,480),Image.Resampling.LANCZOS);frames.append(frame);durations.append(max(20,im.info.get('duration',80)))
   frames[0].save(target,'WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=im.info.get('loop',0),quality=74,method=2,minimize_size=False)
   size=frames[0].size
  else:
   im.seek(0);frame=im.convert('RGBA');frame.thumbnail(bounds,Image.Resampling.LANCZOS);frame.save(target,'WEBP',quality=88,method=4);size=frame.size
 result={'signature':sig,'sha256':sha,'gifRecipe':GIF_RECIPE,'download':download,'frames':n,'width':size[0],'height':size[1],'originalWidth':orig_size[0],'originalHeight':orig_size[1],'bytes':target.stat().st_size}
 return key,result

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--catalog')
 ap.add_argument('--extend-published',type=Path,help='Carry this published catalog forward and add the reviewed extra images')
 ap.add_argument('--media-hosting',help='Optional map of immutable archive previews and release downloads')
 ap.add_argument('--asset-root')
 ap.add_argument('--extra',action='append',default=[])
 ap.add_argument('--previous-extra',action='append',default=[])
 ap.add_argument('--updated',type=date.fromisoformat,default=date(2026,11,18))
 ap.add_argument('--workers',type=int,default=4)
 args=ap.parse_args()
 hosting=json.loads(Path(args.media_hosting).read_text('utf8')) if args.media_hosting else {}
 if hosting:
  for folder in ('media','thumbs','gifs'):(ROOT/'.local/gallery-hosted'/folder).mkdir(parents=True,exist_ok=True)
 for sub in ['media','thumbs','gifs','data','all']:(DEST/sub).mkdir(parents=True,exist_ok=True)
 state=ROOT/'.local/meme-build-cache.json';state.parent.mkdir(exist_ok=True)
 cache=json.loads(state.read_text(encoding='utf8')) if state.exists() else {}
 prior=[]
 if args.extend_published:
  if args.catalog or args.asset_root or args.previous_extra:ap.error('--extend-published takes only --extra manifests')
  snapshot=json.loads(args.extend_published.read_bytes())
  if snapshot.get('version')!=2 or snapshot['count']!=len(snapshot['items']):raise ValueError('Invalid published catalog')
  prior=[dict(a,fresh=False) for a in snapshot['items']]
  data=[]
 else:
  if not args.catalog or not args.asset_root:ap.error('Pass --catalog and --asset-root, or --extend-published')
  data=load(args.catalog)
  for a in data:a['_file']=str(Path(args.asset_root)/a['path']);a['_fresh']=False
 for fresh,files in [(False,args.previous_extra),(True,args.extra)]:
  for path in files:
   extra=load(path)
   for a in extra:a['_file']=a['file'];a['_fresh']=fresh
   data.extend(extra)
 unique=[]
 seen={cache[a['id']]['sha256'] for a in prior if a['id'] in cache and cache[a['id']].get('sha256')}
 seen_keys={a['id'] for a in prior};seen_urls={a['original'] for a in prior}
 if len(seen_keys)!=len(prior):raise ValueError('Repeated image ID in published catalog')
 for a in data:
  if a.get('status') and a['status']!='ok':continue
  if not re.fullmatch(r'[a-zA-Z0-9_-]+',a['key']):raise ValueError('Invalid image ID: '+a['key'])
  sha=a.get('sha256') or hashlib.sha256(Path(a['_file']).read_bytes()).hexdigest()
  original=a.get('url')
  if sha in seen or (original and original in seen_urls):continue
  if a['key'] in seen_keys:raise ValueError('Duplicate image ID: '+a['key'])
  seen_keys.add(a['key'])
  if original:seen_urls.add(original)
  seen.add(sha)
  if a['key'] in hosting:a['_hosting']=hosting[a['key']]
  unique.append(a)
 original_index=DEST/'full/index.json'
 originals=json.loads(original_index.read_bytes()) if original_index.is_file() else {}
 corrections=json.loads((ROOT/'tools/meme-corrections.json').read_text(encoding='utf8'))
 aliases=json.loads((ROOT/'tools/meme-character-aliases.json').read_text(encoding='utf8'))
 bad=[]
 with ThreadPoolExecutor(max_workers=args.workers) as pool:
  futures={pool.submit(convert,a,cache):a['key'] for a in unique}
  for i,f in enumerate(as_completed(futures)):
   try:key,result=f.result();cache[key]=result
   except Exception as e:bad.append({'key':futures[f],'error':str(e)})
   if (i+1)%40==0:
    state.write_text(json.dumps(cache),encoding='utf8');print(json.dumps({'converted':i+1,'total':len(unique),'failed':len(bad)}),flush=True)
 state.write_text(json.dumps(cache),encoding='utf8')
 if bad:raise RuntimeError(json.dumps(bad))
 public=[]
 for a in unique:
  key=a['key'];m=cache[key];bands=band_ids(a);chars=characters(a,bands)
  title=a.get('caption') or a.get('title') or '邦邦反应表情';title=re.sub(r'\s+GIF$','',title)
  entry={'id':key,'title':title,'bands':bands,'characters':chars,'kind':kind(a),'animated':m['frames']>1,'image':f'media/{key}.webp','thumb':f'thumbs/{key}.webp','width':m['width'],'height':m['height'],'bytes':m['bytes'],'source':a['source'],'original':a.get('url',a['source']),'author':a.get('author',''),'tags':list(dict.fromkeys(a.get('tags',[])+[a.get('description','')])), 'featured':bool(a.get('featured')),'fresh':a['_fresh'],'added':a.get('added',args.updated.isoformat() if a['_fresh'] else '2026-11-18')}
  if m.get('download'):entry['download']=dict(m['download'])
  if a.get('_hosting'):
   hosted=a['_hosting']
   entry['image'],entry['save']=hosted_urls(key,hosted,m['sha256'],ROOT/'.local/gallery-hosted/media'/f'{key}.webp')
   entry['imageSha256']=hosted['preview_sha256']
   if hosted.get('thumb'):
    entry['thumb']=hosted['thumb'];entry['thumbSha256']=hosted['thumb_sha256']
   assert bool(hosted.get('gif'))==bool(m.get('download')),key
   if m.get('download'):entry['download']['path']=hosted['gif']
  if key in originals:
   native=originals[key];name=Path(native['path']).name
   if native['path']!='full/'+name or Path(name).stem!=key or (Path(name).suffix=='.gif')!=bool(entry.get('download')):
    raise ValueError(f'{key}: invalid full-size still image')
   data=(DEST/native['path']).read_bytes()
   if len(data)!=native['bytes'] or hashlib.sha256(data).hexdigest()!=native['sha256']:
    raise ValueError(f'{key}: full-size file differs from the preserved source')
   entry['nativeOriginal']={k:native[k] for k in ('path','sha256','width','height','bytes','frames')}
   entry['original']=native['original']
  if a.get('creditSource'):
   if not re.fullmatch(r'https://(?:x\.com/[A-Za-z0-9_]{1,15}/status/\d+|www\.facebook\.com/(?:\d+/photos/a\.\d+/\d+/|photo/\?fbid=\d+|[A-Za-z0-9_.]{1,80}/posts/(?:pfbid[A-Za-z0-9]{12,160}|\d{6,30})))',a['creditSource']):raise ValueError('Invalid linked credit: '+key)
   entry['creditSource']=a['creditSource']
  if a.get('display_title'):
   entry['title']=a['display_title']
   if a.get('caption') and a['caption']!=entry['title']:entry['context']=a['caption']
  if a.get('batch'):entry['batch']=int(a['batch'])
  if key in corrections:
   edit=corrections[key]
   allowed={'title','characters','bands','tags','speaker','kind','featured'}
   if edit.keys()-allowed:raise ValueError(f'{key}: unsupported correction fields')
   entry.update(edit)
  entry['title']=entry['title'].replace('亚罗蕾','阿拉蕾')
  entry['characters']=[s.replace('仲町亚罗蕾','仲町阿拉蕾') for s in entry['characters']]
  public.append(entry)
 # A balanced first screen, with curated new items followed by the previous selection.
 fresh=[a for a in public if a['fresh']];previous=[a for a in public if not a['fresh']]
 public=fresh+previous+prior
 manifest={'version':2,'updated':args.updated.isoformat(),'count':len(public),'animated':sum(a['animated'] for a in public),'added':len(fresh),'characterAliases':aliases,'bandSections':BAND_SECTIONS,'bands':[{'id':b[0],'name':b[1],'color':b[2],'short':b[3],'aliases':b[4].split('|'),'characters':CHARACTERS.get(b[0],[]),'count':sum(b[0] in a['bands'] for a in public)} for b in BANDS],'types':[{'id':k,'name':v,'count':sum(a['kind']==k for a in public)} for k,v in TYPE_LABELS.items()],'items':public}
 (DEST/'data/catalog.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 attrs=[{'id':a['id'],'title':a['title'],'source':a['source'],'original':a['original'],'author':a['author'],**({'creditSource':a['creditSource']} if a.get('creditSource') else {})} for a in public]
 (DEST/'data/sources.json').write_text(json.dumps(attrs,ensure_ascii=False,indent=2),encoding='utf8')
 cards=[]
 for a in public:
  asset=a.get('nativeOriginal',{}).get('path') or a.get('download',{}).get('path') or a['image'];save=a.get('nativeOriginal',{}).get('path') or a.get('save',asset);label='保存 GIF' if a.get('download') else '保存图片'
  credited=(f' · <a href="{html.escape(a["creditSource"],quote=True)}" target="_blank" rel="noreferrer">图源帖子 ↗</a>' if a.get('creditSource') else '')
  title=html.escape(a['title']);cards.append(f'<article class="meme-card"><a class="picture" href="{static_href(asset)}"><img src="{static_href(a["thumb"])}" alt="{title}" loading="lazy" width="380" height="350"></a><div class="card-info"><h2>{title}</h2><a href="{static_href(save)}" download="{save.rsplit(chr(47),1)[-1]}">{label}</a> · <a href="{html.escape(a["source"],quote=True)}" target="_blank" rel="noreferrer">出处 ↗</a>{credited}</div></article>')
 static='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>全部梗图 · Bandori · Playground</title><link rel="stylesheet" href="../../playground.css"><link rel="stylesheet" href="../gallery.css?v=20261119-gif1"></head><body><header class="pg-header"><a class="brand" href="../../">PLAYGROUND<span>课余时间</span></a><a class="text-link" href="../">返回可筛选图库 ↗</a></header><main class="static-library"><p class="eyebrow">BANDORI / ALL IMAGES</p><h1>全部梗图</h1><p class="intro">不需要脚本的完整图片索引。点击查看，长按或下载保存。</p><div class="meme-grid">'''+''.join(cards)+'''</div></main><footer class="pg-footer"><a href="/">学术主页 ↗</a><span>非官方同人收藏 · 保留原作者署名</span></footer></body></html>'''
 (DEST/'all/index.html').write_text(static,encoding='utf8')
 totals={'count':manifest['count'],'new':manifest['added'],'animated':manifest['animated'],'media_mb':round(sum(m['bytes'] for key,m in cache.items() if any(a['id']==key for a in public))/1024**2,1),'band_counts':{b['name']:b['count'] for b in manifest['bands']}}
 (ROOT/'.local/build-summary.json').write_text(json.dumps(totals,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps(totals,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
