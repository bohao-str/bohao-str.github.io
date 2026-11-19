"""Exercise GIF saving semantics that a filename or a file signature cannot test."""
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw
from gallery_gif import gif_download, KEEP_BYTES


def source(fmt, frames, **options):
    buf = BytesIO()
    frames[0].save(buf, fmt, save_all=True, append_images=frames[1:], **options)
    return buf.getvalue()


def export(raw, dest):
    with Image.open(BytesIO(raw)) as im:
        return gif_download(raw, im, dest)


with TemporaryDirectory() as tmp:
    target = Path(tmp)/'test.gif'
    frames = []
    for x,color in [(0,'red'),(12,'blue'),(24,'green')]:
        frame = Image.new('RGBA',(36,12))
        ImageDraw.Draw(frame).ellipse([x,0,x+11,11],fill=color)
        frames.append(frame)
    for plays, repeat in [(0,0),(1,None),(3,2)]:
        raw = source('WEBP',frames,lossless=True,duration=[83,83,84],loop=plays)
        export(raw,target)
        with Image.open(target) as im:
            assert im.format=='GIF' and im.n_frames==3 and im.info.get('loop')==repeat
            durations=[]
            for idx,expected in enumerate(frames):
                im.seek(idx); durations.append(im.info['duration'])
                actual=im.convert('RGBA')
                for x in (5,17,29):
                    a,b=actual.getpixel((x,5)),expected.getpixel((x,5))
                    assert a[3]==b[3] and (not b[3] or max(abs(a[k]-b[k]) for k in range(3))<=4)
            assert durations==[80,90,80],durations
    small=source('GIF',frames,duration=[60,80,150],loop=2,disposal=2)
    export(small,target);assert target.read_bytes()==small
    large=source('GIF',frames,duration=[60,80,150],disposal=2,comment=b'x'*(KEEP_BYTES+1))
    export(large,target)
    with Image.open(target) as result:
        assert result.n_frames==3 and 'loop' not in result.info
        assert [result.seek(i) or result.info['duration'] for i in range(3)]==[60,80,150]
    still=source('GIF',frames[:1]); export(still,target);assert target.read_bytes()==still
    buf=BytesIO();frames[0].convert('RGB').save(buf,'JPEG')
    assert export(buf.getvalue(),Path(tmp)/'unused.gif') is None
print('GIF originals, single-frame images, transparent animation, timing and loop counts passed.')
