"""window.py -- content of the window (1008x1512, opaque) for frames 456-599.

 456-503 black (#0A0A09);  504-527 the logo (WITHOUT ring and crosshair = layer_lines) is revealed top to bottom exactly at the
 squeegee tip line;  528-573 the orange band is still wet (drawn gloss: relief shading + one soft reflection sweeping across,
 amplitude falling to 0);  574-599 exactly the flat logo.

The flat logo is the recomposition of assets/logo layers (photo, band MULTIPLY with opacity and gain K, strip, wordmark; no lines)
exactly as in assets/logo/qa_report.md, resized 1254 -> 1008 with area averaging, placed at window y = 252.
The wet sheen is DRAWN (procedural noise relief + analytic reflection), not simulated.
"""
import json
import os

import cv2
import numpy as np

from common import ROOT, WIN_W, WIN_H, LOGO_Y_IN_WIN, BLACK, CREAM, WIN, tip_y, smoothstep

LOGO_DIR = os.path.join(ROOT, "assets", "logo")
_CACHE = {}


def _rd(name):
    a = cv2.imread(os.path.join(LOGO_DIR, name), cv2.IMREAD_UNCHANGED)
    return a[:, :, [2, 1, 0]].astype(np.float64), a[:, :, 3].astype(np.float64) / 255.0


def logo_recomposed_1254():
    with open(os.path.join(LOGO_DIR, "geometry.json")) as f:
        g = json.load(f)
    K = g["orange_band"]["model"]["gain_K"]
    ph, pa = _rd("layer_photo.png")
    bnd, ba = _rd("layer_band.png")
    st, sa = _rd("layer_strip.png")
    wm, wa = _rd("layer_wordmark.png")
    bg = np.array(BLACK, np.float64)
    out = np.broadcast_to(bg, ph.shape).copy()
    out = out * (1 - pa[..., None]) + ph * pa[..., None]
    out = out * (1 - ba[..., None] + ba[..., None] * K * (bnd / 255.0))
    out = out * (1 - sa[..., None]) + st * sa[..., None]
    out = out * (1 - wa[..., None]) + wm * wa[..., None]
    out = np.clip(np.round(out), 0, 255)         # same 8-bit rounding as the QA recomposition
    band = ba * (1 - sa) * (1 - wa)
    return out, band


def flat_window():
    """-> (flat window image float32 0..1 sRGB (1512, 1008, 3), band mask (1512, 1008))"""
    if "flat" in _CACHE:
        return _CACHE["flat"]
    lg, band = logo_recomposed_1254()
    s = WIN_W
    lg_s = cv2.resize(lg.astype(np.float32), (s, s), interpolation=cv2.INTER_AREA) / 255.0
    bd_s = cv2.resize(band.astype(np.float32), (s, s), interpolation=cv2.INTER_AREA)
    win = np.empty((WIN_H, WIN_W, 3), np.float32)
    win[:] = np.array(BLACK, np.float32) / 255.0
    win[LOGO_Y_IN_WIN:LOGO_Y_IN_WIN + s] = lg_s
    mask = np.zeros((WIN_H, WIN_W), np.float32)
    mask[LOGO_Y_IN_WIN:LOGO_Y_IN_WIN + s] = bd_s
    _CACHE["flat"] = (win, mask)
    return win, mask


def _relief(seed=8):
    if "rel" in _CACHE:
        return _CACHE["rel"]
    rng = np.random.default_rng(seed)
    h = np.zeros((WIN_H, WIN_W), np.float32)
    for sig, amp in ((95, 1.0), (40, 0.45), (16, 0.12)):
        n = cv2.GaussianBlur(rng.standard_normal((WIN_H, WIN_W)).astype(np.float32), (0, 0), sig)
        h += amp * n / max(n.std(), 1e-6)
    gy, gx = np.gradient(h)
    gs = max(np.sqrt(gx ** 2 + gy ** 2).std(), 1e-6)
    _CACHE["rel"] = (gx / gs, gy / gs)
    return _CACHE["rel"]


def wetness(f):
    """1 until 528, then drying to exactly 0 at frame 574."""
    u = np.clip((f - 528.0) / 46.0, 0, 1)
    return float((1 - smoothstep(u)) ** 1.5)


def window_frame(f):
    flat, mask = flat_window()
    if f < 504:
        out = np.empty_like(flat)
        out[:] = np.array(BLACK, np.float32) / 255.0
        return out
    w = wetness(f)
    out = flat.copy()
    if w > 0:
        gx, gy = _relief()
        # wet look on the band: relief shading (+-5 %), broad glossy patches, uniform sheen, one sweeping reflection
        yy, xx = np.mgrid[0:WIN_H, 0:WIN_W].astype(np.float32)
        shade = 1.0 + 0.05 * (-gx * 0.8 + gy * 0.6) * w
        patch = np.exp(-0.5 * (((gx * 1.0 - 0.9) ** 2 + (gy * 1.0 + 0.7) ** 2) / 0.6 ** 2))
        d = xx * 0.82 + yy * 0.57
        p = -250.0 + (f - 528.0) / 22.0 * 2200.0       # the reflection crosses the window once, 528 -> 550
        sweep = np.exp(-0.5 * ((d - p) / 120.0) ** 2) * (f <= 556)
        spec = w * (0.10 + 0.35 * patch + 0.80 * sweep)
        cr = np.array(CREAM, np.float32) / 255.0
        m = mask[..., None]
        out = flat * (1 - m + m * shade[..., None]) + m * spec[..., None] * cr[None, None, :] * (1 - 0.35 * flat)
        out = np.clip(out, 0, 1)
    if f < 528:
        tip = tip_y(f)
        ysheet = np.arange(WIN_H, dtype=np.float32) + 0.5 + WIN[1]
        R = np.clip(tip - ysheet + 0.5, 0, 1)[:, None, None]
        black = np.array(BLACK, np.float32) / 255.0
        out = black[None, None, :] * (1 - R) + out * R
    return out.astype(np.float32)
