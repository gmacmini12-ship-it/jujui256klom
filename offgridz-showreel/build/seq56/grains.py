"""grains.py -- 2.5D renderer of the MPM grain cache seen from straight above (frames 456 ...).

NOT path traced.  Each free grain is drawn as an upper sphere cap (radius ~0.56 x grain spacing) into a depth-buffered
height field (atomic max), at 2x supersampling; per pixel we keep the grain index, hence its analytic sphere normal and its
own colour.  Shading = matte (Lambert, wrapped) from a soft key light with rake + ambient occlusion from the blurred height
field + soft cast shadows marched across the height field (4 azimuth samples) + hue/value variation per grain.
Output: premultiplied linear RGBA 1080x1920 (shadow on the bare sheet is black with alpha) and the height field.

Works on any cache written by build/sim/scenes.py deferlement (reads spacing from run.json); grain size in pixels follows.
"""
import glob
import json
import math
import os

import cv2
import numpy as np

from common import (W, H, PX_M, WIN, TRAY_DEPTH, ORANGE, ORANGE_L, col_lin, init_taichi, s2l)

LIGHT_AZ = math.radians(160.0)       # azimuth of the key light (direction the light comes FROM): from the left, a little from the top
LIGHT_EL = math.radians(40.0)        # elevation above the sheet plane (rake)
AMB, DIFF = 0.36, 0.64


def load_run(cache):
    with open(os.path.join(cache, "run.json")) as f:
        r = json.load(f)
    info = r["info"]
    return dict(spacing=float(info["spacing"]), scale=float(r["scale"]), n=int(info.get("N", 0)), run=r)


def frames_available(cache):
    fs = sorted(int(os.path.basename(p)[1:5]) for p in glob.glob(os.path.join(cache, "f[0-9][0-9][0-9][0-9].npz")))
    return fs


def grain_colors(ids, seed=11):
    """Per-grain linear albedo.  Hue +-4.8 deg (8 % of a 60 deg sextant) around the #EA470F hue (15.8 deg), value +-8 %,
    saturation +-4 %; deterministic from the particle id."""
    import colorsys
    ids = np.asarray(ids, np.uint64)
    h = (ids * np.uint64(2654435761) + np.uint64(seed * 40503)) & np.uint64(0xFFFFFFFF)
    h = (h ^ (h >> np.uint64(15))) * np.uint64(2246822519) & np.uint64(0xFFFFFFFF)
    h = (h ^ (h >> np.uint64(13))) * np.uint64(3266489917) & np.uint64(0xFFFFFFFF)
    u1 = ((h & np.uint64(0x3FF)).astype(np.float64) / 1023.0) * 2 - 1
    u2 = (((h >> np.uint64(10)) & np.uint64(0x3FF)).astype(np.float64) / 1023.0) * 2 - 1
    u3 = (((h >> np.uint64(20)) & np.uint64(0x3FF)).astype(np.float64) / 1023.0) * 2 - 1
    h0, s0, v0 = colorsys.rgb_to_hsv(*(np.array(ORANGE) / 255.0))
    hh = h0 + u1 * (4.8 / 360.0)
    ss = np.clip(s0 * (1 + 0.04 * u3), 0, 1)
    vv = np.clip(v0 * (1 + 0.08 * u2), 0, 1)
    # vectorised hsv->rgb
    i = np.floor(hh * 6).astype(int) % 6
    f = hh * 6 - np.floor(hh * 6)
    p = vv * (1 - ss)
    q = vv * (1 - f * ss)
    t = vv * (1 - (1 - f) * ss)
    r = np.choose(i, [vv, q, p, p, t, vv])
    g = np.choose(i, [t, vv, vv, q, p, p])
    b = np.choose(i, [p, p, t, vv, vv, q])
    rgb = np.stack([r, g, b], 1).astype(np.float32)
    return s2l(rgb)


class Splatter:
    def __init__(self, ss=2, threads=2):
        self.ti = init_taichi(threads)
        ti = self.ti
        self.ss = ss
        self.w, self.h = W * ss, H * ss
        self.Z = ti.field(ti.f32, (self.w, self.h))
        self.G = ti.field(ti.i32, (self.w, self.h))
        self.floor = ti.field(ti.f32, (self.w, self.h))
        self.pix = 1.0 / (ss * 1e4)            # metres per supersampled pixel
        self._build()

    def _build(self):
        ti = self.ti
        Z, G, floor = self.Z, self.G, self.floor
        w, h, pix = self.w, self.h, self.pix

        @ti.kernel
        def clear():
            for i, j in Z:
                Z[i, j] = -1e9
                G[i, j] = -1

        @ti.kernel
        def splat(pos: ti.types.ndarray(ndim=2), rad: ti.types.ndarray(ndim=1), n: ti.i32, tx: ti.f32, ty: ti.f32, zl: ti.f32):
            for p in range(n):
                x = pos[p, 0]
                y = pos[p, 1]
                z = pos[p, 2]
                r = rad[p]
                cu = (x / pix) + 0.5 * w
                cv = (-y / pix) + 0.5 * h
                rp = r / pix
                inside = (ti.abs(x) < tx) and (ti.abs(y) < ty) and (z < zl)
                i0 = ti.max(int(ti.floor(cu - rp)), 0)
                i1 = ti.min(int(ti.ceil(cu + rp)), w - 1)
                j0 = ti.max(int(ti.floor(cv - rp)), 0)
                j1 = ti.min(int(ti.ceil(cv + rp)), h - 1)
                for i in range(i0, i1 + 1):
                    for j in range(j0, j1 + 1):
                        dx = (i + 0.5 - cu) * pix
                        dy = (j + 0.5 - cv) * pix * -1.0
                        d2 = dx * dx + dy * dy
                        ok = True
                        if inside:
                            # grains lying in the recessed tray cannot overhang its walls
                            wx = (i + 0.5 - 0.5 * w) * pix
                            wy = -(j + 0.5 - 0.5 * h) * pix
                            ok = (ti.abs(wx) < tx) and (ti.abs(wy) < ty)
                        if ok and d2 < r * r:
                            zz = z + ti.sqrt(r * r - d2)
                            ti.atomic_max(Z[i, j], zz)

        @ti.kernel
        def ident(pos: ti.types.ndarray(ndim=2), rad: ti.types.ndarray(ndim=1), n: ti.i32, tx: ti.f32, ty: ti.f32, zl: ti.f32):
            for p in range(n):
                x = pos[p, 0]
                y = pos[p, 1]
                z = pos[p, 2]
                r = rad[p]
                cu = (x / pix) + 0.5 * w
                cv = (-y / pix) + 0.5 * h
                rp = r / pix
                inside = (ti.abs(x) < tx) and (ti.abs(y) < ty) and (z < zl)
                i0 = ti.max(int(ti.floor(cu - rp)), 0)
                i1 = ti.min(int(ti.ceil(cu + rp)), w - 1)
                j0 = ti.max(int(ti.floor(cv - rp)), 0)
                j1 = ti.min(int(ti.ceil(cv + rp)), h - 1)
                for i in range(i0, i1 + 1):
                    for j in range(j0, j1 + 1):
                        dx = (i + 0.5 - cu) * pix
                        dy = (j + 0.5 - cv) * pix * -1.0
                        d2 = dx * dx + dy * dy
                        ok = True
                        if inside:
                            # grains lying in the recessed tray cannot overhang its walls
                            wx = (i + 0.5 - 0.5 * w) * pix
                            wy = -(j + 0.5 - 0.5 * h) * pix
                            ok = (ti.abs(wx) < tx) and (ti.abs(wy) < ty)
                        if ok and d2 < r * r:
                            zz = z + ti.sqrt(r * r - d2)
                            if zz >= Z[i, j] - 1e-9:
                                G[i, j] = p

        @ti.kernel
        def make_floor(tx: ti.f32, ty: ti.f32, dp: ti.f32):
            for i, j in floor:
                x = (i + 0.5 - 0.5 * w) * pix
                y = -(j + 0.5 - 0.5 * h) * pix
                v = 0.0
                if ti.abs(x) < tx and ti.abs(y) < ty:
                    v = -dp
                floor[i, j] = v

        self.k_clear, self.k_splat, self.k_ident, self.k_floor = clear, splat, ident, make_floor
        self.k_floor((WIN[2] - WIN[0]) * 0.5 * PX_M, (WIN[3] - WIN[1]) * 0.5 * PX_M, TRAY_DEPTH)

    def height_and_ids(self, pos, rad, zl=0.0):
        pos = np.ascontiguousarray(pos, np.float32)
        rad = np.ascontiguousarray(rad, np.float32)
        self.k_clear()
        tx, ty = (WIN[2] - WIN[0]) * 0.5 * PX_M, (WIN[3] - WIN[1]) * 0.5 * PX_M
        self.k_splat(pos, rad, len(pos), tx, ty, float(zl))
        self.k_ident(pos, rad, len(pos), tx, ty, float(zl))
        return self.Z.to_numpy(), self.G.to_numpy()


class Shader:
    def __init__(self, sp: Splatter):
        ti = sp.ti
        self.sp = sp
        w, h = sp.w, sp.h
        self.shadow = ti.field(ti.f32, (w, h))
        pix = sp.pix
        shadow = self.shadow

        @ti.kernel
        def march(Zf: ti.types.ndarray(ndim=2), steps: ti.i32, tan_el: ti.f32, az: ti.f32, spread: ti.f32):
            # Zf: height with the floor filled in.  lit = fraction of 4 azimuth samples with no occluder.
            for i, j in shadow:
                z0 = Zf[i, j]
                acc = 0.0
                for k in ti.static(range(4)):
                    a = az + spread * (k - 1.5) / 1.5
                    dxp = ti.cos(a)
                    dyp = -ti.sin(a)         # pixel rows run downward, world Y upward
                    lit = 1.0
                    for s in range(1, steps + 1):
                        ii = int(i + dxp * s + 0.5)
                        jj = int(j + dyp * s + 0.5)
                        if ii < 0 or ii >= w or jj < 0 or jj >= h:
                            break
                        zc = Zf[ii, jj]
                        if zc > z0 + s * pix * tan_el:
                            lit = 0.0
                            break
                    acc += lit
                shadow[i, j] = acc * 0.25

        self.k_march = march

    def run(self, Zf, steps, el, az):
        self.k_march(np.ascontiguousarray(Zf, np.float32), int(steps), float(math.tan(el)), float(az), math.radians(9.0))
        return self.shadow.to_numpy()


_splat = None
_shader = None


def get_tools(ss=2, threads=2):
    global _splat, _shader
    if _splat is None or _splat.ss != ss:
        _splat = Splatter(ss, threads)
        _shader = Shader(_splat)
    return _splat, _shader


def render_grains(npz_path, spacing, ss=2, threads=2, r_rel=0.64, return_ids=False):
    """-> dict(pm=(H,W,4) premultiplied linear RGBA, zh=(H,W) height m (nan where no grain), n_free)"""
    sp, sh = get_tools(ss, threads)
    d = np.load(npz_path)
    st = d["state"]
    keep = (st == 0) | (st == 1)
    pos = d["pos"][keep].astype(np.float32)
    ids = d["id"][keep]
    n_free = int(d["n_free"])
    # restrict to the sheet (+ a margin so that grains straddling the edge are drawn)
    m = (np.abs(pos[:, 0]) < 0.054 + 3 * spacing) & (np.abs(pos[:, 1]) < 0.096 + 3 * spacing)
    pos, ids = pos[m], ids[m]
    rng_h = ((ids.astype(np.uint64) * np.uint64(1103515245) + np.uint64(12345)) & np.uint64(0xFFFF)).astype(np.float32) / 65535.0
    rad = (spacing * r_rel * (0.92 + 0.16 * rng_h)).astype(np.float32)
    Z, G = sp.height_and_ids(pos, rad, zl=0.3 * spacing)
    empty = G < 0
    floor = sp.floor.to_numpy()
    Zf = np.where(empty, floor, Z).astype(np.float32)
    # ---- normals of the sphere caps
    pix = sp.pix
    wS, hS = sp.w, sp.h
    ii, jj = np.nonzero(~empty)
    g = G[ii, jj]
    cx = pos[g, 0]
    cy = pos[g, 1]
    x = (ii + 0.5 - 0.5 * wS) * pix
    y = -(jj + 0.5 - 0.5 * hS) * pix
    r = rad[g]
    dx = (x - cx) / r
    dy = (y - cy) / r
    dz = np.sqrt(np.maximum(1 - dx * dx - dy * dy, 1e-4))
    nrm = np.zeros((wS, hS, 3), np.float32)
    nrm[ii, jj, 0] = dx
    nrm[ii, jj, 1] = dy
    nrm[ii, jj, 2] = dz
    # ---- light
    Lv = np.array([math.cos(LIGHT_AZ) * math.cos(LIGHT_EL), math.sin(LIGHT_AZ) * math.cos(LIGHT_EL), math.sin(LIGHT_EL)], np.float32)
    ndl = np.zeros((wS, hS), np.float32)
    ndl[ii, jj] = np.clip(nrm[ii, jj, 0] * Lv[0] + nrm[ii, jj, 1] * Lv[1] + nrm[ii, jj, 2] * Lv[2], 0, 1)
    # ---- ambient occlusion from the height field: cavity = blurred height - height
    rpx = spacing * r_rel / pix
    sig = max(0.9 * rpx, 1.0)
    blur = np.ascontiguousarray(cv2.GaussianBlur(np.ascontiguousarray(Zf.T), (0, 0), sig).T)
    cav = np.clip((blur - Zf) / (0.9 * spacing * r_rel), 0, 1)
    ao = 1.0 - 0.75 * cav
    # ---- cast shadows (the light travels from azimuth LIGHT_AZ toward the grains: march TOWARD the light)
    steps = int(min(max(3.5 * spacing * r_rel / pix / math.tan(LIGHT_EL) * 1.2, 8), 220))
    sdw = sh.run(Zf, steps, LIGHT_EL, LIGHT_AZ)
    # ---- colour
    alb = np.zeros((wS, hS, 3), np.float32)
    alb[ii, jj] = grain_colors(ids[g])
    shade = (AMB * ao + DIFF * ndl * sdw) / (AMB + DIFF * Lv[2])
    shade = shade[..., None]
    lo = np.minimum(shade, 1.0)
    hi = np.clip((shade - 1.0) / 0.35, 0, 1)
    light_l = col_lin(ORANGE_L) / col_lin(ORANGE)
    rgb = alb * lo * (1 + hi * (light_l[None, None, :] - 1))
    # tiny pigment micro-texture (matte)
    tex = cv2.GaussianBlur(np.random.default_rng(3).standard_normal((hS, wS)).astype(np.float32), (0, 0), 0.8).T
    rgb = rgb * (1 + 0.025 * tex[..., None] / max(tex.std(), 1e-6))
    a = (~empty).astype(np.float32)
    rgb = rgb * a[..., None]
    # see-through columns of a random packing: below the top layer there is always more material, so inside a bed
    # (blurred coverage > 0.6) the voids show the deep, shadowed pigment instead of the bare sheet
    cb = cv2.GaussianBlur(np.ascontiguousarray(a.T), (0, 0), max(1.6 * rpx, 2.0)).T
    void = empty & (cb > 0.6)
    rgb = np.where(void[..., None], col_lin(ORANGE)[None, None, :] * 0.07, rgb)
    a = np.where(void, 1.0, a).astype(np.float32)
    empty = empty & ~void
    # shadow on the bare sheet: black, alpha
    # a flush bed (heights < ~0.45 grain above the sheet plane) casts no shadow onto the bare margin
    kz = int(min(2 * steps + 1, 301)) | 1
    zloc = cv2.dilate(np.ascontiguousarray(Zf.T), np.ones((kz, kz), np.uint8)).T
    gate = np.clip((zloc - 0.45 * spacing) / (0.5 * spacing), 0, 1)
    sa = gate * np.where(empty, np.clip(0.55 * (1 - sdw) + 0.35 * np.clip((blur - floor) / (spacing * 0.8), 0, 1), 0, 0.85), 0.0)
    a_tot = a + (1 - a) * sa
    pm = np.concatenate([rgb, a_tot[..., None]], axis=2)
    # ---- downsample SS -> 1 (area average of premultiplied values)
    pm = pm.transpose(1, 0, 2)
    pm = pm.reshape(H, ss, W, ss, 4).mean(axis=(1, 3)).astype(np.float32)
    # height at 1x (m): mean of covered samples, 0 floor elsewhere
    e0 = G < 0
    zc = np.where(e0, 0.0, Z).T.reshape(H, ss, W, ss).sum(axis=(1, 3))
    cn = (~e0).T.reshape(H, ss, W, ss).sum(axis=(1, 3))
    zh = np.where(cn > 0, zc / np.maximum(cn, 1), np.nan).astype(np.float32)
    out = dict(pm=pm, zh=zh, cover=(cn / (ss * ss)).astype(np.float32), n_free=n_free)
    if return_ids:
        out["pos"], out["ids"] = pos, ids
    return out
