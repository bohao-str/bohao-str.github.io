"""Publish only checksum-verified gallery downloads named in this archive commit."""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

def gh(*args):
    return subprocess.check_output(['gh', *args, '--repo', 'bohao-str/bohao-str.github.io'], text=True).strip()

def publish(path):
    base = Path(path).parent
    manifest = json.loads(Path(path).read_bytes())
    tag = manifest['tag']
    if not re.fullmatch(r'bandori-cn-20261120-w\d{3}', tag) or base.name != tag.rsplit('-', 1)[-1]:
        raise ValueError('Unexpected release tag')
    files = []
    for row in manifest['files']:
        name = row['file']
        if not re.fullmatch(r'cn20_[a-zA-Z0-9_-]{2,88}\.(?:gif|webp)', name):
            raise ValueError('Unexpected gallery filename')
        f = base / name
        if f.is_symlink() or not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Missing or changed image: ' + name)
        files.append(f)
    if not 1 <= len(files) <= 500 or len(set(files)) != len(files):
        raise ValueError('Invalid release size or duplicate filename')
    releases = json.loads(gh('release', 'list', '--limit', '100', '--json', 'tagName'))
    if not any(r['tagName'] == tag for r in releases):
        # Publish after all assets have been attached. No existing release is overwritten.
        gh('release', 'create', tag, '--draft', '--latest=false', '--target', os.environ['GITHUB_SHA'], '--title',
           '邦邦表情仓库 · 2026-11-20 · ' + base.name.upper(), '--notes',
           '中文社区表情图的网页版下载文件。逐图出处与原图分包见 https://bohao-str.github.io/playground/bandori/downloads/ 。')
    release = json.loads(gh('release', 'view', tag, '--json', 'assets,isDraft'))
    existing = {a['name']: a for a in release['assets']}
    for f, row in zip(files, manifest['files']):
        if f.name in existing:
            if existing[f.name]['size'] != f.stat().st_size or existing[f.name].get('digest') not in (None, '', 'sha256:' + row['sha256']):
                raise ValueError('Previously uploaded image differs: ' + f.name)
    missing = [str(f) for f in files if f.name not in existing]
    for i in range(0, len(missing), 35):
        gh('release', 'upload', tag, *missing[i:i+35])
    if release['isDraft']:
        gh('release', 'edit', tag, '--draft=false', '--latest=false')
    print('Published', tag, len(files), 'verified images', flush=True)

if __name__ == '__main__':
    if os.environ.get('GITHUB_REPOSITORY', '').lower() != 'bohao-str/bohao-str.github.io' or os.environ.get('GITHUB_REF') != 'refs/heads/bandori-archives':
        sys.exit('Unexpected repository or branch')
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD^', 'HEAD'], text=True).splitlines()
    for path in sorted(changed):
        if re.fullmatch(r'publications/2026-11-20/w\d{3}/assets\.json', path):
            publish(path)
