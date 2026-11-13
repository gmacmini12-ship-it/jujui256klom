"""common.py -- constants, colour helpers, Taichi init shared by the seq56 modules (frames 456-599 of INSOUMISE).

Sheet geometry (BIBLE.md section 3), 0.1 mm per pixel, origin of the world at the sheet centre, +X right, +Y up on screen,
+Z toward the camera (gravity is -Z, into the screen).  Pixel (u, v) <-> world:  X = (u - 540) * 1e-4,  Y = (960 - v) * 1e-4.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
W, H = 1080, 1920
PX_M = 1e-4                         # metres per pixel
WIN = (36, 204, 1044, 1716)         # window x0, y0, x1, y1 on the sheet
WIN_W, WIN_H = 1008, 1512
LOGO_Y_IN_WIN = 252                 # logo square (1008 x 1008) at window y 252..1260
TRAY_DEPTH = 0.004                  # m, the window is a recessed tray (same as build/sim/scenes.py Deferlement.DEPTH)
F_FILM_A, F_FILM_B = 456, 599

# palette (BIBLE.md section 4), RGB 0..255
BLACK = (10, 10, 9)
CREAM = (238, 223, 210)
ORANGE = (234, 71, 15)
ORANGE_L = (246, 87, 38)
GREY_D = (76, 53, 45)
GREY_M = (138, 126, 116)
GREY_L = (180, 167, 156)

_ti_ready = False


def init_taichi(threads=2):
    global _ti_ready
    import taichi as ti
    if not _ti_ready:
        ti.init(arch=ti.cpu, cpu_max_num_threads=threads, default_fp=ti.f32, offline_cache=True, log_level=ti.ERROR)
        _ti_ready = True
    return ti


def s2l(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def l2s(c):
    c = np.clip(np.asarray(c, np.float32), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def col_lin(rgb255):
    return s2l(np.asarray(rgb255, np.float32) / 255.0)


def write_png16(path, rgb_or_rgba_srgb01):
    """Write float sRGB (0..1) (H, W, 3|4) as 16-bit PNG.  RGBA is straight alpha."""
    import cv2
    a = np.clip(rgb_or_rgba_srgb01, 0, 1)
    a16 = np.round(a * 65535.0).astype(np.uint16)
    if a16.shape[2] == 3:
        a16 = a16[:, :, ::-1]
    else:
        a16 = a16[:, :, [2, 1, 0, 3]]
    tmp = path + ".tmp.png"
    cv2.imwrite(tmp, np.ascontiguousarray(a16))
    os.replace(tmp, path)


def premult_lin_to_straight_srgb(pm):
    """pm: (H, W, 4) premultiplied linear RGBA -> straight-alpha sRGB RGBA (float 0..1)."""
    a = pm[..., 3:4]
    rgb = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0.0)
    out = np.concatenate([l2s(np.clip(rgb, 0, 1)), np.clip(a, 0, 1)], axis=2)
    return out


def smoothstep(a):
    a = np.clip(a, 0, 1)
    return a * a * (3 - 2 * a)


def beat_ease(f):
    """Squeegee progress 0..1 over frames 504..527 (24 frames = two beats of 12).  Each beat covers half of the
    travel with 60 % smoothstep + 40 % linear (eased, but the speed never reaches zero between beats)."""
    u = (np.asarray(f, float) - 504.0) / 24.0
    u = np.clip(u, 0, 1)

    def e(x):
        x = np.clip(x, 0, 1)
        return 0.6 * x * x * (3 - 2 * x) + 0.4 * x
    return 0.5 * e(u * 2.0) + 0.5 * e(u * 2.0 - 1.0)


# squeegee geometry on the sheet (pixels, y down); the tip is the leading (lower) edge of the rubber blade
BLADE_Y0 = 0.0          # tip position at frame 504 (top edge of the sheet)
RUBBER_LEN = 62.0       # visible rubber blade (projection of the tilted blade), behind the tip
HOLDER_LEN = 128.0      # aluminium holder behind the rubber
BLADE_Y1 = H + RUBBER_LEN + HOLDER_LEN + 70.0      # tip position at 527: the whole tool has left the sheet


def tip_y(f):
    return BLADE_Y0 + (BLADE_Y1 - BLADE_Y0) * beat_ease(f)


def window_to_sheet_y(y):
    return y + WIN[1]
