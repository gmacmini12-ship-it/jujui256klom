"""Primitives de dessin du compositeur : couverture exacte (rectangles), texte IBM Plex Mono en contours
(sans hinting, alignement optique à l'encre), peinture en flottant 0..65535 sur la feuille entière."""
import sys
from functools import lru_cache

import numpy as np

import fx_common as X

sys.path.insert(0, str(X.ROOT / "build" / "type"))
import typekit as tk  # noqa: E402

FACE = {400: "ibm-plex-mono-400", 700: "ibm-plex-mono-700"}
NARROW = 0.30      # espace fine insécable (U+202F), en em
THIN = 0.20        # espace fine (U+2009), en em


def rgb16(c):
    return np.array(c, np.float32) * X.SCALE16


def paint(S, cov, x0, y0, color, opacity=1.0):
    """Mélange `color` (RGB 0..255) dans S (float 0..65535) selon la couverture cov (h,w) posée en (x0,y0)."""
    h, w = cov.shape
    ax0, ay0 = max(x0, 0), max(y0, 0)
    ax1, ay1 = min(x0 + w, S.shape[1]), min(y0 + h, S.shape[0])
    if ax1 <= ax0 or ay1 <= ay0:
        return
    c = cov[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0] * float(opacity)
    roi = S[ay0:ay1, ax0:ax1]
    roi += (rgb16(color) - roi) * c[..., None]


def cov1d(lo, hi, i0, n):
    """Couverture exacte de l'intervalle [lo, hi) sur les pixels i0 .. i0+n-1."""
    i = np.arange(i0, i0 + n, dtype=np.float32)
    return np.clip(np.minimum(hi, i + 1) - np.maximum(lo, i), 0, 1)


def rect_cov(x0, y0, x1, y1):
    """(cov, ix, iy) : couverture exacte d'un rectangle aligné aux axes (coordonnées flottantes)."""
    ix, iy = int(np.floor(x0)), int(np.floor(y0))
    nx, ny = int(np.ceil(x1)) - ix, int(np.ceil(y1)) - iy
    if nx <= 0 or ny <= 0:
        return np.zeros((1, 1), np.float32), ix, iy
    return np.outer(cov1d(y0, y1, iy, ny), cov1d(x0, x1, ix, nx)), ix, iy


def paint_rect(S, x0, y0, x1, y1, color, opacity=1.0):
    cov, ix, iy = rect_cov(x0, y0, x1, y1)
    paint(S, cov, ix, iy, color, opacity)


# ------------------------------------------------------------------ texte
@lru_cache(maxsize=None)
def _cap_px_per_px(weight):
    """Hauteur de capitale / corps (em) de la police."""
    from fontTools.ttLib import TTFont
    f = tk.load(FACE[weight])
    return tk._cap_height(f) / f["head"].unitsPerEm


@lru_cache(maxsize=2048)
def layout(text, size, weight=400, tracking=0.0):
    """Glyphes positionnés (px, y vers le haut, ligne de base y=0), origine x=0, et boîte d'encre.
    Espaces : ' ' = une chasse, U+202F = espace fine insécable (0,30 em), U+2009 = 0,20 em."""
    cap = _cap_px_per_px(weight) * size
    adv_cell = 0.6 * size
    x = 0.0
    out = []
    for i, ch in enumerate(text):
        if ch == " ":
            x += NARROW * size
            continue
        if ch == " ":
            x += THIN * size
            continue
        if ch == " ":
            x += adv_cell + tracking * size
            continue
        g = tk.outlines(ch, FACE[weight], cap)[0]
        out += tk.transform([g], 1.0, 1.0, x, 0.0)
        x += adv_cell + tracking * size
    ink = tk.bounds(out) if out else (0, 0, 0, 0)
    return out, ink, x


@lru_cache(maxsize=4096)
def _text_cov(text, size, weight, tracking, fx):
    """Couverture du texte, ink-gauche à la fraction fx (0..1) du pixel ; renvoie (cov, ox, oy) avec
    ox,oy = position de l'origine (x=0, ligne de base) dans le tableau."""
    glyphs, ink, _ = layout(text, size, weight, tracking)
    x0, y0, x1, y1 = ink
    pad = 3
    ox = pad + fx - x0
    top = int(np.ceil(y1)) + pad
    bot = int(np.ceil(-y0)) + pad
    w = int(np.ceil(x1 - x0 + fx)) + 2 * pad + 1
    h = top + bot
    cov = tk.coverage_array(glyphs, w, h, scale=1.0, origin=(ox, float(top)), ss=8)
    return cov, ox, top


def draw_text(S, text, x, baseline, size=20, color=X.CREAM, opacity=1.0, align="l", weight=400, tracking=0.06):
    """Texte aligné sur son ENCRE : align 'l' -> bord gauche de l'encre en x ; 'r' -> bord droit en x ;
    'c' -> centre de l'encre en x. Ligne de base à `baseline` (entier recommandé).
    Renvoie la boîte d'encre sur la feuille (x0, y0, x1, y1)."""
    glyphs, ink, _ = layout(text, size, weight, tracking)
    if not glyphs:
        return (x, baseline, x, baseline)
    iw = ink[2] - ink[0]
    if align == "l":
        left = x
    elif align == "r":
        left = x - iw
    else:
        left = x - iw / 2
    ix = int(np.floor(left))
    fx = round(float(left - ix) * 16) / 16.0
    if fx >= 1.0:
        ix, fx = ix + 1, 0.0
    cov, ox, top = _text_cov(text, size, weight, tracking, fx)
    # origine du tableau : (ix - pad) ; l'encre gauche tombe à ix + fx
    pad = 3
    x_arr = ix - pad
    y_arr = int(round(baseline)) - top
    paint(S, cov, x_arr, y_arr, color, opacity)
    return (left, baseline - ink[3], left + iw, baseline - ink[1])


def text_width(text, size=20, weight=400, tracking=0.06):
    g, ink, _ = layout(text, size, weight, tracking)
    return ink[2] - ink[0]
