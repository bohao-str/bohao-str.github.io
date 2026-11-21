"""Publish only checksum-verified gallery downloads named in this archive commit."""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path
from datetime import date
from tempfile import TemporaryDirectory
from zipfile import ZipFile

def gh(*args):
    return subprocess.check_output(['gh', *args, '--repo', 'bohao-str/bohao-str.github.io'], text=True).strip()

def publish(path, scratch):
    base = Path(path).parent
    manifest = json.loads(Path(path).read_bytes())
    tag = manifest['tag']
    day = date.fromisoformat(base.parent.name)
    stamp = day.strftime('%Y%m%d')
    if not re.fullmatch(r'w[0-9]{3}', base.name) or tag != f'bandori-cn-{stamp}-{base.name}':
        raise ValueError('Unexpected release tag')
    files = []
    for row in manifest['files']:
        name = row['file']
        if not re.fullmatch(r'cn[0-9]{2}_[a-zA-Z0-9_-]{2,88}[.](?:gif|webp|png|jpg)', name):
            raise ValueError('Unexpected gallery filename')
        if 'archive' in row:
            origin = row['archive']
            archive_name = origin['pack']
            if not re.fullmatch(r'bandori-cn-' + stamp + r'-[0-9]{3}[.]zip', archive_name):
                raise ValueError('Invalid original pack')
            member = origin['member']
            expected_suffix = ' [' + Path(name).stem + ']' + Path(name).suffix
            if not member.startswith('原图/') or not member.endswith(expected_suffix) or len(Path(member).parts) != 2:
                raise ValueError('Invalid archive member')
            archive_path = Path(day.isoformat()) / archive_name
            if archive_path.is_symlink():
                raise ValueError('Unexpected linked archive')
            f = scratch / name
            with ZipFile(archive_path) as zipped:
                info = zipped.getinfo(member)
                if not 0 < info.file_size == row['bytes'] <= 32 * 1024**2:
                    raise ValueError('Unexpected original size')
                f.write_bytes(zipped.read(member))
        else:
            f = base / name
        if f.is_symlink() or not f.is_file() or f.stat().st_size != row['bytes'] or hashlib.sha256(f.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Missing or changed image: ' + name)
        files.append(f)
    if not 1 <= len(files) <= 500 or len(set(files)) != len(files):
        raise ValueError('Invalid release size or duplicate filename')
    releases = json.loads(gh('release', 'list', '--limit', '100', '--json', 'tagName'))
    if not any(r['tagName'] == tag for r in releases):
        # Publish after all assets have been attached. No existing release is overwritten.
        gh('release', 'create', tag, '--draft', '--latest=false', '--target', os.environ['GITHUB_SHA'], '--title',
           '邦邦表情仓库 · ' + day.isoformat() + ' · ' + base.name.upper(), '--notes',
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
        if re.fullmatch(r'publications/\d{4}-\d{2}-\d{2}/w\d{3}/assets\.json', path):
            with TemporaryDirectory() as temp:
                publish(path, Path(temp))
