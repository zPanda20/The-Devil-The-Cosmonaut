"""Cut a Gemini art sheet (4 emblems on top, 6 faces below: K red, K black, Q red, Q black, J red, J black
in sheet order given by FACE_ORDER) into the engine's asset file.

Usage is per deck inside main(); see the DECKS table. Needs Pillow, numpy and scipy."""
import io, json, base64, sys
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

def b64(im, fmt, **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw)
    return 'data:image/' + fmt.lower() + ';base64,' + base64.b64encode(b.getvalue()).decode()

def largest(mask):
    lab, n = ndimage.label(mask)
    if n == 0: return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (np.argmax(sizes) + 1)

def cutout(a, shape, size=170, soft=0.8):
    """Square RGBA tile of the shape, centred, transparent outside."""
    al = ndimage.gaussian_filter(shape.astype(float), soft) * 255
    ys, xs = np.where(shape)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    r = max(xs.max() - xs.min(), ys.max() - ys.min()) * 1.04 / 2
    im = Image.fromarray(np.dstack([a, al]).astype('uint8'), 'RGBA')
    sq = Image.new('RGBA', (int(2 * r), int(2 * r)), (0, 0, 0, 0))
    sq.paste(im, (int(r - cx), int(r - cy)))
    return sq.resize((size, size), Image.LANCZOS)

# --- emblem masks -------------------------------------------------------------
def mask_keyed(a):
    """Flat background colour (sampled at the panel edge) keyed out."""
    edge = np.concatenate([a[:10].reshape(-1, 3), a[-10:].reshape(-1, 3), a[:, :10].reshape(-1, 3), a[:, -10:].reshape(-1, 3)])
    bg = np.median(edge, 0)
    dist = np.sqrt(((a - bg) ** 2).sum(2))
    m = largest(ndimage.binary_opening(dist > 38, iterations=1))
    return ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2))

def mask_saturated(a):
    """Bright saturated shape on a dark ground."""
    sat = a.max(2) - a.min(2)
    m = (sat > 70) & (a.max(2) > 110)
    near = ndimage.binary_closing(m, iterations=3)
    lab, n = ndimage.label(near)
    sizes = ndimage.sum(near, lab, range(1, n + 1))
    edge = set(np.unique(np.concatenate([lab[:6].ravel(), lab[-6:].ravel(), lab[:, :6].ravel(), lab[:, -6:].ravel()])))
    big = np.argmax(sizes) + 1
    # keep the main shape plus any sizeable pieces (like a spade's stem) that do not run into the smoke at the panel edge
    main = lab == big
    main = ndimage.binary_dilation(largest(ndimage.binary_opening(main, iterations=6)), iterations=6) & main   # cut thin bridges to smoke
    ys, xs = np.where(main); x0, x1 = xs.min(), xs.max(); mid = (x0 + x1) / 2
    close = ndimage.binary_dilation(main, iterations=25)
    keep = [big]
    for i in range(1, n + 1):
        if i == big or i in edge or sizes[i - 1] < 0.01 * sizes[big - 1]: continue
        piece = lab == i
        cx = np.where(piece)[1].mean()
        if (piece & close).any() and abs(cx - mid) < 0.15 * (x1 - x0): keep.append(i)
    shape = np.isin(lab, keep[1:]) | main
    shape = ndimage.binary_closing(shape, iterations=8)
    return ndimage.binary_opening(ndimage.binary_fill_holes(shape), iterations=2)

def mask_dark(a):
    """Dark silhouette on a light ground; thin attached details are cut away first."""
    dark = a.mean(2) < 105
    core = largest(ndimage.binary_opening(dark, iterations=6))
    grown = core.copy()
    for _ in range(8): grown = ndimage.binary_dilation(grown) & dark
    grown = ndimage.binary_fill_holes(ndimage.binary_closing(grown, iterations=3))
    return ndimage.binary_opening(grown, iterations=2)

def build(sheet, emb_boxes, face_boxes, method, out_paths, header, deck_id, assets_dir, focus=(0.5, 0.4)):
    A = np.asarray(Image.open(sheet).convert('RGB')).astype(float)
    crop = lambda b, m=8: A[b[1] + m:b[3] - m, b[0] + m:b[2] - m]
    d = {'blend': 'normal', 'faces': {'K': {}, 'Q': {}, 'J': {}}, 'suits': {}}
    for key, box in face_boxes.items():
        im = ImageOps.fit(Image.fromarray(crop(box).astype('uint8')), (350, 500), Image.LANCZOS, centering=focus)
        im.save(f'{assets_dir}/{key}.jpg', quality=82)
        r, c = key.split('_'); d['faces'][r][c] = b64(im, 'JPEG', quality=80)
    for suit, box in emb_boxes.items():
        a = crop(box)
        tile = cutout(a, method(a))
        tile.save(f'{assets_dir}/emblem_{suit}.png')
        d['suits'][suit] = b64(tile, 'WEBP', quality=86, method=6)
    js = '/* ' + header + ' */\nCardEngine.registerAssets(' + json.dumps(deck_id) + ', ' + json.dumps(d) + ');\n'
    for p in out_paths: open(p, 'w').write(js)
    return len(js)
