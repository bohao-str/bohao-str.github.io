"""Make self-contained, attributed ZIP downloads of a reviewed public batch.

Usage: python tools/build-meme-downloads.py --manifest path/to/cumulative.json --batch 4
Originals are read from the private build manifest; only clean public fields are packaged.
"""
import argparse
import hashlib
import html
import json
import re
import zipfile
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]/'playground/bandori'
cli=argparse.ArgumentParser(description=__doc__)
cli.add_argument('--manifest',type=Path,required=True)
cli.add_argument('--batch',type=int,required=True)
args=cli.parse_args()
if args.batch<1:cli.error('batch must be positive')
catalog=json.loads((ROOT/'data/catalog.json').read_text('utf8'))
raw={r['key']:r for r in json.loads(args.manifest.read_text('utf8'))}
rows=sorted((r for r in catalog['items'] if r.get('batch')==args.batch),key=lambda r:r['id'])
assert rows,'public catalog does not contain this batch'
base=ROOT/'downloads';base.mkdir(exist_ok=True)
limit=24*1024*1024;groups=[[]];size=0
for item in rows:
    r=raw[item['id']];n=Path(r['file']).stat().st_size
    if size and size+n>limit:groups.append([]);size=0
    groups[-1].append(item);size+=n
names={b['id']:b['name'] for b in catalog['bands']}
records=[]
for part,group in enumerate(groups,1):
    name=f'bandori-{args.batch:02d}-{part:02d}.zip';path=base/name;stage=path.with_suffix('.partial')
    credits=[]
    with zipfile.ZipFile(stage,'w',allowZip64=False) as z:
        def add(rel,body,compress=zipfile.ZIP_STORED):
            info=zipfile.ZipInfo(rel);info.create_system=3;info.external_attr=0o100644<<16
            z.writestr(info,body,compress_type=compress)
        for a in group:
            origin=raw[a['id']];file=Path(origin['file']);body=file.read_bytes()
            assert hashlib.sha256(body).hexdigest()==origin['sha256']
            with Image.open(file) as im:ext={'JPEG':'jpg','PNG':'png','WEBP':'webp','GIF':'gif','AVIF':'avif','BMP':'bmp'}[im.format]
            label=re.sub(r'[<>:"/\\|?*\x00-\x1f]', ' ',a['title']).strip(' .')[:35].rstrip(' .') or '梗图'
            rel=f'原图/{label} [{a["id"]}].{ext}';add(rel,body)
            credit={k:a[k] for k in ('id','title','characters','author','source','original','animated')}
            credit.update(bands=[names[b] for b in a['bands']],path=rel,sha256=origin['sha256'])
            if a.get('speaker'):credit['speaker']=a['speaker']
            credits.append(credit)
        add('来源清单.json',json.dumps(credits,ensure_ascii=False,indent=2).encode('utf8'),zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(stage) as z:
        assert len(z.namelist())==len(group)+1 and z.testzip() is None
        for r in credits:assert hashlib.sha256(z.read(r['path'])).hexdigest()==r['sha256']
    if stage.stat().st_size>=48*1024*1024:raise ValueError('Part is too large for this site')
    stage.replace(path)
    records.append(dict(file=name,items=len(group),bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
manifest=dict(batch=args.batch,date=catalog['updated'],count=len(rows),parts=records)
(base/'manifest.json').write_bytes((json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
links=''.join(f'<li><a class="outline-button" href="{r["file"]}" download>第 {i} 包 ↓</a><span>{r["items"]} 张 · {r["bytes"]/1e6:.1f} MB</span></li>' for i,r in enumerate(records,1))
size_mb=sum(r['bytes'] for r in records)/1e6
page=f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>本批原图下载 · 邦邦表情仓库</title><link rel="stylesheet" href="../../playground.css"><link rel="stylesheet" href="../gallery.css?v=20261119-4"></head>
<body><header class="pg-header"><a class="brand" href="../../">PLAYGROUND<span>课余时间</span></a><a class="text-link" href="../">回到图库 ↗</a></header><main class="download-page"><p class="eyebrow">BANDORI / DOWNLOAD</p><h1>打包带走这批梗图。</h1><p>{html.escape(catalog['updated'])} · {len(rows)} 张原图 · 共 {size_mb:.1f} MB</p><p>每个 ZIP 都能单独解压，动图保留原格式。压缩包内的「来源清单.json」列出了每张图的原帖和来源署名。</p><ul>{links}</ul><a class="text-link" href="../?batch={args.batch}">先看这一批的缩略图 →</a></main></body></html>"""
(base/'index.html').write_bytes((page+'\n').encode('utf8'))
print(json.dumps({'count':len(rows),'parts':len(records),'MB':round(size_mb,1)},ensure_ascii=False))
