"""squeegee.py -- the screen-printing squeegee seen from straight above (procedural 2D shading, NOT simulated, NOT path traced).

Tool coordinates: rows run downward, the tip (leading edge of the rubber blade) is at row `tip`; behind it (smaller y):
the visible rubber blade (cream #EEDFD2, RUBBER_LEN px) then the brushed-aluminium holder (HOLDER_LEN px, palette greys).
It is wider than the sheet.  A soft cast shadow (key light from the left/top, tool ~18 mm high) and a contact shadow at the
tip are drawn as black alpha.  Output premultiplied linear RGBA (H, W, 4).
"""
import math

import cv2
import numpy as np

from common import (W, H, RUBBER_LEN, HOLDER_LEN, CREAM, GREY_D, GREY_M, GREY_L, ORANGE, col_lin)

PAD = 150            # sprite margin (rows) for the shadow below the tip


def _lerp3(v):
    """palette ramp dark -> mid -> light, v in 0..1 (array) -> linear RGB"""
    d, m, l = col_lin(GREY_D), col_lin(GREY_M), col_lin(GREY_L)
    v = np.clip(v, 0, 1)[..., None]
    lo = d + (m - d) * np.clip(v * 2, 0, 1)
    hi = m + (l - m) * np.clip(v * 2 - 1, 0, 1)
    return np.where(v < 0.5, lo, hi).astype(np.float32)


def build_sprite(seed=21):
    """Static texture of the tool in its own frame: rows 0..L-1 from the back of the holder to the tip (row L-1 = tip)."""
    rng = np.random.default_rng(seed)
    L = int(HOLDER_LEN + RUBBER_LEN)
    Wx = W + 400
    spr = np.zeros((L, Wx, 4), np.float32)
    # ---- brushed aluminium holder
    hl = int(HOLDER_LEN)
    n = rng.standard_normal((hl, Wx)).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), sigmaX=140, sigmaY=0.55)
    n /= max(n.std(), 1e-6)
    n2 = cv2.GaussianBlur(rng.standard_normal((hl, Wx)).astype(np.float32), (0, 0), sigmaX=14, sigmaY=0.4)
    n2 /= max(n2.std(), 1e-6)
    u = (np.arange(hl, dtype=np.float32) + 0.5) / hl            # 0 back .. 1 front
    prof = 0.52 + 0.20 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.8          # gentle rounded top
    prof = prof.copy()
    bev = 9.0 / hl
    prof = np.where(u > 1 - bev, 0.84 + 0.14 * (u - (1 - bev)) / bev, prof)    # front bevel catches the key light
    prof = np.where(u < bev, 0.26 + 0.26 * u / bev, prof)                      # back bevel falls into shade
    x = np.arange(Wx, dtype=np.float32)
    refl = 0.06 * np.sin(x / 260.0 + 1.0) + 0.04 * np.sin(x / 97.0)
    v = prof[:, None] + 0.075 * n + 0.03 * n2 + refl[None, :]
    spr[:hl, :, :3] = _lerp3(v)
    spr[:hl, :, 3] = 1.0
    # ---- slot between holder and rubber (dark, narrow)
    slot0 = hl
    rl = int(RUBBER_LEN)
    # ---- cream rubber blade, matte, very slightly longitudinally streaked
    r = np.arange(rl, dtype=np.float32)
    ur = (r + 0.5) / rl
    cream = col_lin(CREAM)
    shade = 0.80 + 0.17 * ur ** 1.5
    shade = np.where(r < 7, 0.30 + 0.50 * r / 7.0, shade)                       # shadowed slot against the holder
    shade = np.where(r > rl - 5, shade * (1.0 - 0.45 * (r - (rl - 5)) / 5.0), shade)   # rolled edge toward the contact line
    streak = cv2.GaussianBlur(rng.standard_normal((1, Wx)).astype(np.float32), (0, 0), sigmaX=2.5)
    streak = 0.012 * streak[0] / max(streak.std(), 1e-6)
    spr[slot0:, :, :3] = cream[None, None, :] * (shade[:, None, None] + streak[None, :, None])
    spr[slot0:, :, 3] = 1.0
    spr[..., :3] *= spr[..., 3:4]
    return spr


_SPR = None


def tool_layer(tip, shadow=True):
    """Premultiplied linear RGBA (H, W, 4) of the squeegee with its tip at row `tip` (float, may be outside the frame)."""
    global _SPR
    if _SPR is None:
        _SPR = build_sprite()
    spr = _SPR
    L = spr.shape[0]
    out = np.zeros((H, W, 4), np.float32)
    top = tip - L              # sprite row 0 lands on frame row `top` (float)
    x0 = 200
    # --- shadow: footprint rows [top, tip] shifted down by the light rake and blurred
    if shadow:
        fp0, fp1 = top, tip
        dy = 70.0
        dx = 0.0
        y0 = int(max(math.floor(fp0 + dy - 140), 0))
        y1 = int(min(math.ceil(fp1 + dy + 140), H))
        if y1 > y0:
            rows = np.arange(y0, y1, dtype=np.float32) + 0.5
            cs = np.exp(-0.5 * ((rows - (tip + 3.0)) / 5.0) ** 2) * (rows > tip - 1)
            # unblurred rows outside the footprint+shift would need padding for the blur: rebuild properly
            big0 = int(y0 - 140)
            big1 = int(y1 + 140)
            rr = np.arange(big0, big1, dtype=np.float32) + 0.5
            ins = np.clip(np.minimum(rr - (fp0 + dy), (fp1 + dy) - rr) + 0.5, 0, 1)
            colb = cv2.GaussianBlur(ins[:, None], (0, 0), sigmaX=0.01, sigmaY=32.0)[:, 0]
            colb = colb[y0 - big0:y0 - big0 + (y1 - y0)]
            a = np.clip(0.50 * colb, 0, 1)
            a = np.maximum(a, 0.55 * cs)
            out[y0:y1, :, 3] = a[:, None]
    # --- tool sprite with sub-pixel vertical placement
    r0 = int(math.floor(top))
    fr = top - r0
    # bilinear vertical shift of the sprite
    s0 = spr
    sh = np.zeros((L + 1, spr.shape[1], 4), np.float32)
    sh[:L] += s0 * (1 - fr)
    sh[1:] += s0 * fr
    ya = max(r0, 0)
    yb = min(r0 + L + 1, H)
    if yb > ya:
        seg = sh[ya - r0:yb - r0, x0:x0 + W, :]
        a_t = seg[..., 3:4]
        out[ya:yb] = seg + out[ya:yb] * (1 - a_t)
    return out
