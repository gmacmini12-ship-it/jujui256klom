"""inkrender.py -- shading of the ink film (height field from film.py) as premultiplied linear RGBA 1080x1920, 2.5D (no ray tracing).

Per pixel: thickness T = s - b gives the opacity (Beer-Lambert, h_opaque = 0.12 mm), the slope of s gives (a) a soft diffuse term
with the same key light as the grains and (b) a glossy reflection: the mirror direction R = reflect(view = straight down, n)
looks up a hand-built studio environment (two soft boxes + a long strip + faint ceiling), Fresnel F0 = 0.12 (art-directed
'wet varnish' gloss), reflection colour = cream.  The shading model is drawn, the height field is computed.
"""
import math

import cv2
import numpy as np

from common import W, H, PX_M, WIN, TRAY_DEPTH, ORANGE, ORANGE_L, CREAM, col_lin, smoothstep

H_OPAQUE = 0.12e-3
LIGHT_AZ = math.radians(160.0)
LIGHT_EL = math.radians(40.0)
AMB, DIFF = 0.36, 0.64
F0 = 0.12
_B1 = None


def base_1x():
    global _B1
    if _B1 is None:
        xs = (np.arange(W) + 0.5 - W / 2) * PX_M
        ys = (H / 2 - (np.arange(H) + 0.5)) * PX_M
        X, Y = np.meshgrid(xs, ys)
        _B1 = np.where((np.abs(X) < (WIN[2] - WIN[0]) / 2 * PX_M) & (np.abs(Y) < (WIN[3] - WIN[1]) / 2 * PX_M), -TRAY_DEPTH, 0.0).astype(np.float32)
    return _B1


def env(rx, ry):
    def g(cx, cy, sx, sy, a):
        return a * np.exp(-0.5 * (((rx - cx) / sx) ** 2 + ((ry - cy) / sy) ** 2))
    e = 0.05 + g(-0.55, 0.35, 0.30, 0.30, 1.0) + g(0.45, -0.12, 0.24, 0.24, 0.55) + g(0.08, 0.0, 0.06, 0.70, 0.45)
    return e


def film_pm(s_film, thin_cut=0.05e-3, spec_gain=1.4, sigma_px=1.6):
    """s_film: (ny, nx) film-grid surface height (m).  Returns premultiplied linear RGBA (H, W, 4)."""
    ny_f, nx_f = s_film.shape
    fpx = W // nx_f
    xs = ((np.arange(nx_f) + 0.5) * fpx - W / 2) * PX_M
    ys = (H / 2 - (np.arange(ny_f) + 0.5) * fpx) * PX_M
    Xg, Yg = np.meshgrid(xs, ys)
    b_f = np.where((np.abs(Xg) < (WIN[2] - WIN[0]) / 2 * PX_M) & (np.abs(Yg) < (WIN[3] - WIN[1]) / 2 * PX_M), -TRAY_DEPTH, 0.0).astype(np.float32)
    # upsample the THICKNESS (smooth) and not s (which has the 4 mm tray step: cubic ringing would paint lines on the tray rim)
    T = np.maximum(cv2.resize((s_film - b_f).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC), 0.0)
    b1 = base_1x()
    s1 = T + cv2.GaussianBlur(b1, (0, 0), 8.0)
    ss = cv2.GaussianBlur(s1, (0, 0), sigma_px)
    gy_row, gx = np.gradient(ss)
    gx = gx / PX_M
    gy = -gy_row / PX_M                  # world Y is up
    # the tray rim creates a step in b but not in s; slopes come from s only
    nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    nx_, ny_ = -gx * nz, -gy * nz
    Lv = np.array([math.cos(LIGHT_AZ) * math.cos(LIGHT_EL), math.sin(LIGHT_AZ) * math.cos(LIGHT_EL), math.sin(LIGHT_EL)], np.float32)
    ndl = np.clip(nx_ * Lv[0] + ny_ * Lv[1] + nz * Lv[2], 0, 1)
    diff = (AMB + DIFF * ndl) / (AMB + DIFF * Lv[2])
    ink = col_lin(ORANGE)
    lightc = col_lin(ORANGE_L)
    lo = np.minimum(diff, 1.0)[..., None]
    hi = np.clip((diff - 1.0) / 0.35, 0, 1)[..., None]
    rgb = ink[None, None, :] * lo * (1 + hi * (lightc / ink - 1)[None, None, :])
    alpha = 1.0 - np.exp(-T / H_OPAQUE)
    # mirror reflection of the studio environment (view straight down)
    rx = 2 * nz * nx_
    ry = 2 * nz * ny_
    fres = F0 + (1 - F0) * (1 - nz) ** 5
    spec = spec_gain * fres * env(rx, ry) * smoothstep(T / thin_cut)
    cream = col_lin(CREAM)
    pm_rgb = rgb * alpha[..., None] + cream[None, None, :] * spec[..., None]
    a_out = alpha + (1 - alpha) * np.clip(spec * 1.0, 0, 1)
    return np.concatenate([pm_rgb, a_out[..., None]], 2).astype(np.float32), T, (gx, gy)
