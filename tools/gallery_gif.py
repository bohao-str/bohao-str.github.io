"""Build same-origin, directly savable GIFs without changing the WebP preview archive."""
from io import BytesIO
from PIL import Image

# Real, small GIFs can be served byte for byte. Large ones get a chat-sized copy;
# do not skip frames to meet a byte budget. The source link still offers the original.
RECIPE = 'gif-download-v1'
KEEP_BYTES = 384 * 1024


def read_sequence(im, edge):
    frames, delays = [], []
    elapsed = previous_tick = 0
    for i in range(im.n_frames):
        im.seek(i)
        frame = im.convert('RGBA')  # Pillow composites source frame disposal/blending.
        frame.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        frames.append(frame)
        # Round cumulative time, so repeated 83 ms WebP frames do not lose 3 ms each.
        elapsed += im.info.get('duration', 100)
        tick = (elapsed + 5) // 10
        delays.append((tick - previous_tick) * 10)
        previous_tick = tick
    return frames, delays


def encode(frames, durations, loop, size, colors):
    # One palette sampled across the animation prevents colour flicker and makes
    # unchanged backgrounds compress well. Reserve a distinct index for alpha.
    count = min(12, len(frames))
    sheet = Image.new('RGB', (80 * count, 80))
    for i in range(count):
        sample = frames[i * (len(frames)-1) // max(1, count-1)].convert('RGB')
        sheet.paste(sample.resize((80,80), Image.Resampling.BOX), (80*i,0))
    palette = sheet.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    table = bytes(palette.getpalette()[:colors*3]); used = len(table) // 3
    # Duplicate the first colour in padding; if Pillow picks it, map it back to index 0.
    palette.putpalette(table + table[:3] * (256-used))
    remap = list(range(used)) + [0] * (256-used)
    # Keep a palette entry for transparency even on frames that are wholly opaque.
    # Make that entry unique so Pillow can pass the shared palette to its GIF writer.
    colours = {table[i:i+3] for i in range(0,len(table),3)}
    clear_rgb = next(i.to_bytes(3,'big') for i in range(256) if i.to_bytes(3,'big') not in colours)
    gif_table = table + clear_rgb
    alpha_index = used
    indexed, transparent = [], False
    for frame in frames:
        if frame.size != size:
            frame = frame.resize(size, Image.Resampling.LANCZOS)
        layer = frame.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE).point(remap)
        layer.info.clear()  # Do not inherit source loop or transparency indices.
        layer.putpalette(gif_table)
        alpha = frame.getchannel('A')
        if alpha.getextrema()[0] < 128:
            transparent = True
            layer.paste(alpha_index, mask=alpha.point([255]*128+[0]*128))
        indexed.append(layer)
    options = {'duration':durations, 'palette':gif_table, 'optimize':True,
               'transparency':alpha_index, 'background':alpha_index,
               'disposal':2 if transparent else 1}
    if loop is not None:
        options['loop'] = loop
    result = BytesIO()
    indexed[0].save(result, 'GIF', save_all=True, append_images=indexed[1:], **options)
    return result.getvalue()


def gif_download(raw, im, target):
    """Return display metadata or None for a still image that is not a GIF."""
    is_gif, n = im.format == 'GIF', getattr(im, 'n_frames', 1)
    if not is_gif and n == 1:
        return None
    blob = raw
    if not is_gif or (n > 1 and len(raw) > KEEP_BYTES):
        loop = im.info.get('loop')  # Missing is play-once, not infinite.
        if im.format == 'WEBP' and loop:
            loop = loop-1 if loop > 1 else None  # WebP counts plays; GIF counts repeats.
        frames, durations = read_sequence(im, 384)
        size = frames[0].size
        colors = 95 if is_gif else 127
        budget = max(KEEP_BYTES, int(len(raw)*0.195)) if is_gif else 600*1024
        blob = encode(frames, durations, loop, size, colors)
        if len(blob) > budget:
            factor = min(1, max(200 / max(size), min(.95, (.93*budget/len(blob))**.55)))
            if factor < 1:
                smaller = tuple(max(1, round(x*factor)) for x in size)
                blob = encode(frames, durations, loop, smaller, colors)
        if is_gif and len(raw) <= len(blob):
            blob = raw
    with Image.open(BytesIO(blob)) as out:
        if out.format != 'GIF' or (n > 1 and out.n_frames < 2):
            if not is_gif:
                raise ValueError(f'{target.name}: animation lost during GIF encoding')
            blob, size = raw, im.size
        else:
            size = out.size
    tmp = target.with_suffix('.tmp')
    tmp.write_bytes(blob)
    tmp.replace(target)
    return {'path':'gifs/'+target.name,'width':size[0],'height':size[1],'bytes':len(blob)}
