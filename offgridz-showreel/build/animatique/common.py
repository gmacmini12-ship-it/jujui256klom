"""Constantes, partition, outils de dessin et couches du logo pour l'animatique INSOUMISE.

Tout le temps vient de timeline/partition.json (images à 30 i/s ; blocs debut/fin inclusifs,
instants = image). Aucune seconde copie des temps n'est tenue ici.
"""
import json
import pathlib
import sys
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build" / "type"))
import typekit as tk  # noqa: E402

cv2.setNumThreads(1)

# ------------------------------------------------------------------ feuille
W, H = 1080, 1920
WX0, WY0, WX1, WY1 = 36, 204, 1044, 1716
LOGO_X, LOGO_Y, LOGO_S = 36, 456, 1008
K = LOGO_S / 1254.0
FPS = 30
NFRAMES = 600

BLACK = (10, 10, 9)
CREAM = (238, 223, 210)
ORANGE = (234, 71, 15)
ORANGE_HI = (246, 87, 38)
G_DARK = (76, 53, 45)
G_MID = (138, 126, 116)
G_LIGHT = (180, 167, 156)
AMBER = (201, 138, 43)
MINT = (86, 168, 112)          # le seul vert du film


def mix(c0, c1, t):
    return tuple(float(a + (b - a) * t) for a, b in zip(c0, c1))


# ------------------------------------------------------------------ partition
PART = json.loads((ROOT / "timeline" / "partition.json").read_text(encoding="utf-8"))
EV = PART["evenements"]
PER_BEAT = PART["grille"]["images_par_temps"]
PER_16TH = PART["grille"]["images_par_double_croche"]
assert PART["format"]["images"] == NFRAMES and PART["format"]["images_par_seconde"] == FPS


def blocks(track):
    return [e for e in EV if e["piste"] == track and "debut" in e]


def instants(track):
    return [e for e in EV if e["piste"] == track and "image" in e]


def find(track, key, kind=None):
    for e in EV:
        if e["piste"] == track and key in e["nom"] and (kind is None or (kind == "b") == ("debut" in e)):
            return e
    raise KeyError((track, key))


def seq_range(i):
    for e in blocks("sequence"):
        if e["nom"].startswith(str(i)):
            return e["debut"], e["fin"]
    raise KeyError(i)


def in_block(f, e):
    return e["debut"] <= f <= e["fin"]


def beat_pos(f):
    """(mesure, temps) ; mesure 0 = levée."""
    m1 = PART["grille"]["mesures"][0]["image"]
    if f < m1:
        return 0, f // PER_BEAT + 1
    return (f - m1) // (4 * PER_BEAT) + 1, ((f - m1) % (4 * PER_BEAT)) // PER_BEAT + 1


# ------------------------------------------------------------------ maths
def clamp01(x):
    return min(1.0, max(0.0, x))


def smooth(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ease_out_back(t, s=2.2):
    t = clamp01(t)
    if t >= 1:
        return 1.0
    u = t - 1
    return 1 + (s + 1) * u ** 3 + s * u ** 2


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ dessin
def blend_rect(img, x0, y0, x1, y1, color, a):
    """Rectangle plein avec opacité a (flottant ou tableau (h,w))."""
    x0, y0, x1, y1 = int(max(x0, 0)), int(max(y0, 0)), int(min(x1, img.shape[1])), int(min(y1, img.shape[0]))
    if x1 <= x0 or y1 <= y0:
        return
    roi = img[y0:y1, x0:x1].astype(np.float32)
    aa = a if np.isscalar(a) else a[..., None]
    img[y0:y1, x0:x1] = np.clip(roi + (np.array(color, np.float32) - roi) * aa + 0.5, 0, 255).astype(np.uint8)


def mask_blend(img, mask, color, opacity, ox, oy):
    """Mélange `color` dans img selon mask (uint8 0..255) posé en (ox,oy)."""
    h, w = mask.shape
    x0, y0 = max(ox, 0), max(oy, 0)
    x1, y1 = min(ox + w, img.shape[1]), min(oy + h, img.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    m = mask[y0 - oy:y1 - oy, x0 - ox:x1 - ox].astype(np.float32) * (opacity / 255.0)
    roi = img[y0:y1, x0:x1].astype(np.float32)
    col = np.array(color, np.float32)
    img[y0:y1, x0:x1] = np.clip(roi + (col - roi) * m[..., None] + 0.5, 0, 255).astype(np.uint8)


def fill_polys(img, polys, color, opacity=1.0, holes=()):
    """Remplit des polygones (listes (N,2) en px flottants) ; `holes` sont creusés.
    Travaille sur la boîte englobante seulement."""
    allp = [p for p in list(polys) + list(holes) if len(p)]
    if not allp:
        return
    cat = np.concatenate(allp)
    bx0, by0 = int(np.floor(cat[:, 0].min())) - 2, int(np.floor(cat[:, 1].min())) - 2
    bx1, by1 = int(np.ceil(cat[:, 0].max())) + 3, int(np.ceil(cat[:, 1].max())) + 3
    bx0, by0 = max(bx0, 0), max(by0, 0)
    bx1, by1 = min(bx1, img.shape[1]), min(by1, img.shape[0])
    if bx1 <= bx0 or by1 <= by0:
        return
    m = np.zeros((by1 - by0, bx1 - bx0), np.uint8)
    off = np.array([bx0, by0], np.float64)

    def pts(p):
        return np.round((np.asarray(p, np.float64) - off) * 16).astype(np.int32)
    cv2.fillPoly(m, [pts(p) for p in polys], 255, cv2.LINE_AA, shift=4)
    if len(holes):
        cv2.fillPoly(m, [pts(p) for p in holes], 0, cv2.LINE_AA, shift=4)
    mask_blend(img, m, color, opacity, bx0, by0)


def circle(img, x, y, r, color, thick=-1):
    cv2.circle(img, (int(round(x * 16)), int(round(y * 16))), max(int(round(r * 16)), 1), color, thick, cv2.LINE_AA, 4)


def line(img, p0, p1, color, thick=1.0, a=1.0):
    if a >= 0.999:
        cv2.line(img, (int(round(p0[0] * 16)), int(round(p0[1] * 16))), (int(round(p1[0] * 16)), int(round(p1[1] * 16))),
                 color, max(int(round(thick)), 1), cv2.LINE_AA, 4)
    else:
        x0, y0 = int(min(p0[0], p1[0])) - 4, int(min(p0[1], p1[1])) - 4
        x1, y1 = int(max(p0[0], p1[0])) + 5, int(max(p0[1], p1[1])) + 5
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, img.shape[1]), min(y1, img.shape[0])
        if x1 <= x0 or y1 <= y0:
            return
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.line(m, (int(round((p0[0] - x0) * 16)), int(round((p0[1] - y0) * 16))),
                 (int(round((p1[0] - x0) * 16)), int(round((p1[1] - y0) * 16))), 255, max(int(round(thick)), 1), cv2.LINE_AA, 4)
        mask_blend(img, m, color, a, x0, y0)


def grains(img, xs, ys, rs, cols):
    """Disques antialiasés à demi-pixel près ; cols : (n,3) uint8."""
    xi = np.round(np.asarray(xs) * 16).astype(np.int64)
    yi = np.round(np.asarray(ys) * 16).astype(np.int64)
    ri = np.maximum(np.round(np.asarray(rs) * 16).astype(np.int64), 8)
    h, w = img.shape[:2]
    ok = (xi > -400 * 16) & (xi < (w + 400) * 16) & (yi > -400 * 16) & (yi < (h + 400) * 16)
    cols = np.asarray(cols)
    for x, y, r, c in zip(xi[ok], yi[ok], ri[ok], cols[ok]):
        cv2.circle(img, (int(x), int(y)), int(r), (int(c[0]), int(c[1]), int(c[2])), -1, cv2.LINE_AA, 4)


# ------------------------------------------------------------------ texte (contours typekit)
@lru_cache(maxsize=None)
def face_axes(face_id):
    return dict(tk.faces()[face_id].get("showcase_axes") or {})


@lru_cache(maxsize=256)
def word_polys(text, face_id, axes_key=None):
    """Contours aplatis (unités de capitale, y haut) : (liste de polygones pleins, liste de trous, bornes)."""
    axes = dict(axes_key) if axes_key else face_axes(face_id)
    g = tk.outlines(text, face_id, 1.0, **axes)
    pl = tk.polylines(g, 0.0015)
    solid = [(p["glyph_index"], p["points"]) for p in pl if not p["hole"]]
    hole = [(p["glyph_index"], p["points"]) for p in pl if p["hole"]]
    return solid, hole, tk.bounds(g)


def axes_key(**kw):
    return tuple(sorted(kw.items()))


def word_layout(wp, width, max_cap, cx, baseline):
    """Échelle (px/unité) et origine pour que l'encre fasse `width` de large (hauteur de capitale bornée)."""
    x0, _, x1, _ = wp[2]
    s = min(width / (x1 - x0), max_cap)
    ox = cx - (x0 + x1) / 2 * s
    return s, ox, baseline


def to_px(P, lay, cam=None):
    """Unités typographiques -> px écran, avec caméra optionnelle (cx, cy, zoom, ax, ay)."""
    s, ox, by = lay
    X = ox + P[:, 0] * s
    Y = by - P[:, 1] * s
    if cam is not None:
        cx, cy, z, ax, ay = cam
        X = (X - cx) * z + ax
        Y = (Y - cy) * z + ay
    return np.stack([X, Y], 1)


def draw_word(img, wp, lay, color, opacity=1.0, cam=None):
    solid = [to_px(P, lay, cam) for _, P in wp[0]]
    hole = [to_px(P, lay, cam) for _, P in wp[1]]
    fill_polys(img, solid, color, opacity, hole)


# ------------------------------------------------------------------ texte des marges (IBM Plex Mono)
FONT_MONO = {400: str(ROOT / "assets/fonts/ibm-plex-mono/ibm-plex-mono-400.ttf"),
             700: str(ROOT / "assets/fonts/ibm-plex-mono/ibm-plex-mono-700.ttf")}


@lru_cache(maxsize=None)
def _font(size, weight):
    return ImageFont.truetype(FONT_MONO[weight], size)


@lru_cache(maxsize=4096)
def text_mask(text, size=20, weight=400, tracking=0):
    font = _font(size, weight)
    adv = font.getlength("M")
    n = len(text)
    wpx = int(np.ceil(n * (adv + tracking))) + 6
    img = Image.new("L", (wpx, int(size * 1.5)), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    x = 2.0
    for ch in text:
        d.text((x, 2), ch, font=font, fill=255)
        x += adv + tracking
    return np.array(img), int(x - tracking + 2)


def draw_text(img, text, x, y, size=20, color=CREAM, opacity=1.0, anchor="l", weight=400, tracking=0):
    m, wpx = text_mask(text, size, weight, tracking)
    if anchor == "r":
        x = x - wpx
    elif anchor == "c":
        x = x - wpx // 2
    mask_blend(img, m, color, opacity, int(x) - 2, int(y))


# ------------------------------------------------------------------ logo
LOGO_DIR = ROOT / "assets" / "logo"


@lru_cache(maxsize=1)
def logo_source():
    """Logo source : Lanczos du PNG source dans sa boîte 1008×1008 (uint8 RGB)."""
    im = Image.open(LOGO_DIR / "source" / "offgridz-logo-1254.png").convert("RGB")
    return np.array(im.resize((LOGO_S, LOGO_S), Image.LANCZOS))


def _layer(name):
    im = Image.open(LOGO_DIR / f"layer_{name}.png").convert("RGBA").convert("RGBa").resize((LOGO_S, LOGO_S), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0      # prémultiplié
    return a


@lru_cache(maxsize=1)
def logo_layers():
    L = {n: _layer(n) for n in ("photo", "band", "strip", "wordmark", "lines")}
    return L


@lru_cache(maxsize=1)
def logo_geom():
    return json.loads((LOGO_DIR / "geometry.json").read_text())


@lru_cache(maxsize=1)
def logo_circle():
    """Cercle du logo en px feuille : centre, rayon (ajustement par moindres carrés de geometry.json)."""
    c = logo_geom()["circle"]["px"]["best_fit_circle"]
    return LOGO_X + c["centre"][0] * K, LOGO_Y + c["centre"][1] * K, c["radius"] * K


@lru_cache(maxsize=1)
def logo_band_const():
    m = logo_geom()["orange_band"]["model"]
    return np.array(m["C_multiply_rgb_0_1"], np.float32), float(m["gain_K"])


def over(base, layer):
    return layer[..., :3] + base * (1 - layer[..., 3:4])


@lru_cache(maxsize=1)
def logo_base_photo():
    """Fond + photo (prémultipliée), flottant 0..1."""
    L = logo_layers()
    bg = np.array(BLACK, np.float32) / 255.0
    return over(np.broadcast_to(bg, L["photo"][..., :3].shape).copy(), L["photo"])


def band_factor(alpha_straight):
    C, Kg = logo_band_const()
    return 1 - alpha_straight[..., None] + alpha_straight[..., None] * Kg * C


def compose_logo(strip=True, wordmark=True, lines=True, photo=None, band_alpha=None):
    """Recomposition des couches (ordre du rapport QA : fond, photo, bande multiply, bande déchirée, mot, traits)."""
    L = logo_layers()
    acc = logo_base_photo() if photo is None else photo
    ba = np.where(L["band"][..., 3] > 1e-6, L["band"][..., 3], 0) if band_alpha is None else band_alpha
    out = np.clip(acc * band_factor(ba), 0, 1)
    if strip:
        out = over(out, L["strip"])
    if wordmark:
        out = over(out, L["wordmark"])
    if lines:
        out = over(out, L["lines"])
    return out


def to_u8(a):
    return np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
