#!/usr/bin/env python
"""OFFGRIDZ master logo -> measured, layered, vector decomposition.

Run from the offgridz-showreel folder:
    /opt/og/venv/bin/python build/logo/dissect.py

Reads  assets/logo/source/offgridz-logo-1254.png  (never modified)
Writes assets/logo/*  (geometry.json, layer_*.png, *.svg, wordmark_clean.json, qa_*)

Coordinate convention
---------------------
Internally "index coordinates" (pixel centre = integer).  Everything WRITTEN
(geometry.json, SVG, JSON points) uses continuous image coordinates: pixel i
covers [i, i+1), origin top-left, y down  ==  index coordinate + 0.5.
Normalised = continuous / 1254 (the canvas is square).
"""
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage as ndi
from scipy.optimize import least_squares

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import vec  # noqa: E402

SRC = ROOT / "assets/logo/source/offgridz-logo-1254.png"
OUT = ROOT / "assets/logo"
W = H = 1254
LETTER_IDS = ["O1", "F1", "F2", "G1", "R1", "I1", "D1", "Z1"]
LETTER_THR = 117.0       # ~50 % between strip black (~9) and cream (~225), on mean(R,G,B)
BG = np.array([10, 10, 9], float)

rng = np.random.default_rng(12345)


def log(*a):
    print(*a, flush=True)


def c05(v):
    """index coords -> continuous coords"""
    return np.asarray(v, float) + 0.5


# =========================================================================
# helpers
# =========================================================================
def lum_of(img):
    return img.mean(2)


def nearest_fill(values, valid):
    """propagate values from valid pixels to all others (nearest neighbour)"""
    idx = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    return values[idx[0], idx[1]]


def norm_conv(val, weight, sigma):
    num = cv2.GaussianBlur((val * weight).astype(np.float32), (0, 0), sigma)
    den = cv2.GaussianBlur(weight.astype(np.float32), (0, 0), sigma)
    return num / np.maximum(den, 1e-6), den


def aa_polygon(poly_xy, scale=4):
    """coverage image (float 0..1) of a polygon given in INDEX coords"""
    big = np.zeros((H * scale, W * scale), np.uint8)
    p = np.round(((np.asarray(poly_xy) + 0.5) * scale - 0.5) * 16).astype(np.int32)
    cv2.fillPoly(big, [p], 255, lineType=cv2.LINE_8, shift=4)
    cov = cv2.resize(big.astype(np.float32) / 255.0, (W, H), interpolation=cv2.INTER_AREA)
    return cov


def psnr(a, b, mask=None):
    d = (a.astype(np.float64) - b.astype(np.float64)) ** 2
    if mask is not None:
        d = d[mask]
    mse = d.mean()
    return 99.0 if mse < 1e-9 else 10 * np.log10(255.0 ** 2 / mse)


def ssim_gray(a, b, mask=None):
    try:
        from skimage.metrics import structural_similarity as ss
    except Exception:
        return None
    _, full = ss(a, b, data_range=255, full=True, win_size=7)
    return float(full[mask].mean() if mask is not None else full.mean())


# =========================================================================
# 1. circle + registration marks
# =========================================================================
def ridge_points_ellipse(g, model, w):
    """Sub-pixel ridge centroids along rays; keeps only thin bright strokes."""
    from scipy.ndimage import map_coordinates
    cx, cy, a, b, th = model
    pts = []
    for ang in np.arange(0, 360, 0.5):
        t = np.deg2rad(ang)
        c, s = np.cos(t), np.sin(t)
        R0 = (a + b) / 2
        rs = np.arange(R0 - w - 15, R0 + w + 15, 0.1)
        xs, ys = cx + rs * c, cy + rs * s
        if xs.min() < 2 or xs.max() > W - 3 or ys.min() < 0 or ys.max() > H - 3:
            continue
        p = map_coordinates(g, [ys, xs], order=3)
        u = t - th
        rexp = a * b / np.hypot(b * np.cos(u), a * np.sin(u))
        m = np.abs(rs - rexp) < w
        if not m.any():
            continue
        k = np.where(m)[0][p[m].argmax()]
        sd = 40
        if p[k] < 190 or k - sd < 0 or k + sd >= len(p):
            continue
        if p[k] - 0.5 * (p[k - sd] + p[k + sd]) < 110 or max(p[k - sd], p[k + sd]) > 140:
            continue
        lo, hi = max(0, k - 12), k + 13
        seg = p[lo:hi]
        wts = np.clip(seg - 0.5 * p[k], 0, None)
        r = (rs[lo:hi] * wts).sum() / wts.sum()
        pts.append((cx + r * c, cy + r * s, ang))
    return np.array(pts)


def _ell_r(m, t):
    cx, cy, a, b, th = m
    u = t - th
    return a * b / np.hypot(b * np.cos(u), a * np.sin(u))


def measure_circle(img):
    g = lum_of(img).astype(float)
    m = np.array([624.7, 623.0, 612.0, 622.0, 0.0])
    for w in [20, 8, 4, 4]:
        pts = ridge_points_ellipse(g, m, w)

        def f(p):
            dx, dy = pts[:, 0] - p[0], pts[:, 1] - p[1]
            return np.hypot(dx, dy) - _ell_r(p, np.arctan2(dy, dx))
        m = least_squares(f, m, loss="soft_l1", f_scale=0.5).x
    # normalise ellipse so that a is the x-ish semi axis
    # plain least-squares circle on the same ridge points (robust loss, outliers rejected)
    fc = lambda p: np.hypot(pts[:, 0] - p[0], pts[:, 1] - p[1]) - p[2]
    pc = least_squares(fc, [624.5, 623.0, 615.0], loss="soft_l1", f_scale=0.5).x
    rc = fc(pc)
    keep = np.abs(rc) < 3 * 1.4826 * np.median(np.abs(rc))
    pc2 = least_squares(fc, pc, loss="linear").x if False else pc
    rc = fc(pc2)
    circ = dict(cx=pc2[0], cy=pc2[1], r=pc2[2], rms=float(np.sqrt((rc ** 2).mean())),
                rms_inliers=float(np.sqrt((rc[keep] ** 2).mean())),
                median_abs=float(np.median(np.abs(rc))), max_abs=float(np.abs(rc).max()), n=len(pts))
    # same RMS on a plain least-squares (non-robust) fit, so that the number is unambiguous
    pl = least_squares(fc, pc2, loss="linear").x
    rl = fc(pl)
    circ["ls_plain"] = dict(cx=pl[0], cy=pl[1], r=pl[2], rms=float(np.sqrt((rl ** 2).mean())))
    # ellipse
    def fe(p):
        dx, dy = pts[:, 0] - p[0], pts[:, 1] - p[1]
        return np.hypot(dx, dy) - _ell_r(p, np.arctan2(dy, dx))
    re = fe(m)
    ell = dict(cx=m[0], cy=m[1], a=abs(m[2]), b=abs(m[3]), theta_rad=float(m[4] % np.pi),
               rms=float(np.sqrt((re ** 2).mean())), median_abs=float(np.median(np.abs(re))))
    # free-form radial model around the circle centre:  r(theta) = r0 + sum_k harmonics (k<=8)
    ang = np.deg2rad(pts[:, 2])
    th = np.arctan2(pts[:, 1] - pc2[1], pts[:, 0] - pc2[0])
    r = np.hypot(pts[:, 0] - pc2[0], pts[:, 1] - pc2[1])
    K = 8
    cols = [np.ones_like(th)]
    for k in range(1, K + 1):
        cols += [np.cos(k * th), np.sin(k * th)]
    A = np.stack(cols, 1)
    wts = np.ones(len(r))
    for _ in range(6):
        coef = np.linalg.lstsq(A * wts[:, None], r * wts, rcond=None)[0]
        res = r - A @ coef
        s = max(1.4826 * np.median(np.abs(res)), 0.2)
        wts = 1 / np.maximum(1, np.abs(res) / (2.5 * s))
    res = r - A @ coef
    free = dict(centre=[pc2[0], pc2[1]], coef=coef.tolist(), K=K,
                rms=float(np.sqrt((res ** 2).mean())), median_abs=float(np.median(np.abs(res))))
    return circ, ell, free, pts


def free_r(free, th):
    coef = np.array(free["coef"])
    out = np.full_like(th, coef[0], dtype=float)
    for k in range(1, free["K"] + 1):
        out += coef[2 * k - 1] * np.cos(k * th) + coef[2 * k] * np.sin(k * th)
    return out


def refine_circle_curve(img, free, circ_pts_free):
    """Local ridge-centre r_c(theta) (1 deg bins): data where available, global
    free-form model elsewhere.  Returns theta grid and r_c."""
    g = lum_of(img).astype(float)
    from scipy.ndimage import map_coordinates
    cx, cy = free["centre"]
    ths = np.deg2rad(np.arange(0, 360, 0.5))
    r0 = free_r(free, ths)
    rc = r0.copy()
    ok = np.zeros(len(ths), bool)
    for i, (t, rr) in enumerate(zip(ths, r0)):
        rs = np.arange(rr - 5, rr + 5, 0.1)
        xs, ys = cx + rs * np.cos(t), cy + rs * np.sin(t)
        if xs.min() < 1 or xs.max() > W - 2 or ys.min() < 1 or ys.max() > H - 2:
            continue
        p = map_coordinates(g, [ys, xs], order=3)
        k = p.argmax()
        if p[k] < 200 or k < 45 or k > len(p) - 46:
            continue
        side = 0.5 * (p[k - 40] + p[k + 40])
        if p[k] - side < 110 or max(p[k - 40], p[k + 40]) > 140:
            continue
        lo, hi = max(0, k - 12), k + 13
        wts = np.clip(p[lo:hi] - 0.5 * p[k], 0, None)
        rc[i] = (rs[lo:hi] * wts).sum() / wts.sum()
        ok[i] = True
    res = rc - r0
    # reject residual outliers, then interpolate circularly + light smoothing
    med = np.median(res[ok])
    s = 1.4826 * np.median(np.abs(res[ok] - med))
    ok &= np.abs(res - med) < max(4 * s, 1.5)
    idx = np.nonzero(ok)[0]
    full = np.interp(np.arange(len(ths)), idx, res[idx], period=len(ths))
    # circular smoothing, 2 degree window
    ker = np.ones(5) / 5
    pad = np.r_[full[-2:], full, full[:2]]
    full = np.convolve(pad, ker, mode="valid")
    return ths, r0 + full, ok


def measure_line_h(g, y_est, x0, x1, half=5):
    """Horizontal thin bright line near y_est between columns x0..x1 (index).
    Returns centre-line y (mean), width, and per-column y."""
    ys = np.arange(int(y_est) - half, int(y_est) + half + 1)
    sub = g[ys[0]:ys[-1] + 1, x0:x1 + 1]
    return sub, ys


def contiguous_end(coords, c, half, from_start):
    """Sub-pixel position where contrast `c` first falls below `half`, scanning from one end of the array
    through the plateau (contiguous run only, so bright hair further along cannot extend the segment)."""
    n = len(c)
    rng_ = range(0, n) if from_start else range(n - 1, -1, -1)
    prev = None
    for i in rng_:
        if c[i] <= half:
            if prev is None:
                return float(coords[i])
            a, b = c[prev], c[i]
            t = (a - half) / max(a - b, 1e-9)
            return float(coords[prev] + t * (coords[i] - coords[prev]))
        prev = i
    return float(coords[prev])


def measure_marks(img, ths, rc, free):
    """Four registration marks as measured line segments.  Returns dict."""
    g = lum_of(img).astype(float)
    cx, cy = free["centre"]
    marks = {}

    def bgside(col, i, half=4):
        return 0.5 * (col[i - half] + col[i + half])

    def prof_width(sub, axis):
        """equivalent width = sum(contrast)/peak contrast across the line"""
        c = sub - np.minimum(sub[0], sub[-1])
        return float(np.clip(c, 0, None).sum(axis) / max(np.clip(c, 0, None).max(axis).mean(), 1))

    # ---- horizontal marks (left, right): thin line along x
    def hline(y_est, xs_range, name):
        x0, x1 = xs_range
        ys = np.arange(int(y_est) - 5, int(y_est) + 6)
        sub = g[ys[0]:ys[-1] + 1, x0:x1 + 1]
        con = sub - 0.5 * (sub[0:1] + sub[-1:])
        pk = con.max(0)
        ok = pk > 110
        cols = np.nonzero(ok)[0]
        # centre by weighted centroid per column
        w = np.clip(con, 0, None)
        yc = (w * ys[:, None]).sum(0) / np.maximum(w.sum(0), 1e-6)
        width = float((w.sum(0)[ok] / pk[ok]).mean())
        peak = float(np.median(pk[ok]))
        A = np.c_[cols + x0, np.ones(len(cols))]
        slope, icpt = np.linalg.lstsq(A, yc[cols], rcond=None)[0]
        return dict(slope=slope, icpt=icpt, width=width, peak=peak, cols=(x0 + cols.min(), x0 + cols.max()),
                    sub=sub, ys=ys, x0=x0)

    def vline(x_est, ys_range, name):
        y0, y1 = ys_range
        xs = np.arange(int(x_est) - 5, int(x_est) + 6)
        sub = g[y0:y1 + 1, xs[0]:xs[-1] + 1].T
        con = sub - 0.5 * (sub[0:1] + sub[-1:])
        pk = con.max(0)
        ok = pk > 110
        rows = np.nonzero(ok)[0]
        w = np.clip(con, 0, None)
        xc = (w * xs[:, None]).sum(0) / np.maximum(w.sum(0), 1e-6)
        width = float((w.sum(0)[ok] / pk[ok]).mean())
        A = np.c_[rows + y0, np.ones(len(rows))]
        slope, icpt = np.linalg.lstsq(A, xc[rows], rcond=None)[0]
        return dict(slope=slope, icpt=icpt, width=width, rows=(y0 + rows.min(), y0 + rows.max()), sub=sub, xs=xs, y0=y0,
                    peak=float(np.median(pk[ok])))

    def end_crossing(profile, start, step, thr_frac=0.5):
        """sub-pixel position where along-line contrast profile falls below half its plateau, scanning from `start`"""
        return None

    # circle intersection helper (index coords) : point of curve at given angle
    def circ_pt(theta):
        r = np.interp(theta % (2 * np.pi), ths, rc, period=2 * np.pi)
        return np.array([cx + r * np.cos(theta), cy + r * np.sin(theta)])

    # left mark: horizontal, from circle to x ~102
    L = hline(623.8, (30, 150), "left")
    R = hline(623.0, (1150, 1215), "right")
    T = vline(627.0, (20, 66), "top")
    B = vline(627.8, (1100, 1175), "bottom")
    # along-line extents using half-peak crossing on the contrast profile
    def along_extent_h(d, x_from, x_to, y_c):
        # contrast along the centre line, bilinear
        xs = np.arange(x_from, x_to + 1)
        yy = d["slope"] * xs + d["icpt"]
        v = np.array([np.interp(y, np.arange(H), g[:, x]) for x, y in zip(xs, yy)])
        side = np.array([0.5 * (np.interp(y - 4, np.arange(H), g[:, x]) + np.interp(y + 4, np.arange(H), g[:, x]))
                         for x, y in zip(xs, yy)])
        return xs, v - side

    xs, c = along_extent_h(L, 60, 140, 624)
    half = 0.5 * np.median(c[:30])
    xL_end_sp = contiguous_end(xs, c, half, True)
    marks["left"] = dict(orient="h", y_of_x=(L["slope"], L["icpt"]), width=L["width"], peak=L["peak"],
                         outer=None, inner_x=float(xL_end_sp))
    xs, c = along_extent_h(R, 1150, 1215, 623)
    half = 0.5 * np.median(c[-30:])
    xR_end_sp = contiguous_end(xs, c, half, False)
    marks["right"] = dict(orient="h", y_of_x=(R["slope"], R["icpt"]), width=R["width"], peak=R["peak"],
                          outer=None, inner_x=float(xR_end_sp))

    def along_extent_v(d, y_from, y_to):
        ys = np.arange(y_from, y_to + 1)
        xx = d["slope"] * ys + d["icpt"]
        v = np.array([np.interp(x, np.arange(W), g[y, :]) for x, y in zip(xx, ys)])
        side = np.array([0.5 * (np.interp(x - 4, np.arange(W), g[y, :]) + np.interp(x + 4, np.arange(W), g[y, :]))
                         for x, y in zip(xx, ys)])
        return ys, v - side, v
    ys_, c, v_raw = along_extent_v(T, 80, 200)
    # the top mark ends inside bright hair, where contrast to the sides is unreliable: use the raw centre-line level
    half = 0.5 * np.median(v_raw[:40])
    yT_end_sp = contiguous_end(ys_, v_raw, half, True)
    marks["top"] = dict(orient="v", x_of_y=(T["slope"], T["icpt"]), width=T["width"], peak=T["peak"],
                        inner_y=float(yT_end_sp))
    ys_, c, _v = along_extent_v(B, 1050, 1170)
    half = 0.5 * np.median(c[-40:])
    yB_end_sp = contiguous_end(ys_, c, half, False)
    marks["bottom"] = dict(orient="v", x_of_y=(B["slope"], B["icpt"]), width=B["width"], peak=B["peak"],
                           inner_y=float(yB_end_sp))

    # cross bars on top / bottom marks
    def crossbar(y_est, name):
        d = hline(y_est, (580, 680), name)
        # exclude the vertical line columns when taking extents: use centre-line contrast with half-peak at ends
        xs = np.arange(585, 676)
        yy = d["slope"] * xs + d["icpt"]
        v = np.array([np.interp(y, np.arange(H), g[:, x]) for x, y in zip(xs, yy)])
        side = np.array([0.5 * (np.interp(y - 4, np.arange(H), g[:, x]) + np.interp(y + 4, np.arange(H), g[:, x]))
                         for x, y in zip(xs, yy)])
        c = v - side
        half = 0.5 * np.median(np.r_[c[20:35], c[60:72]])
        sel = np.nonzero(c > half)[0]
        i0, i1 = sel.min(), sel.max()
        xa = xs[i0] - (c[i0] - half) / max(c[i0] - c[i0 - 1], 1e-6)
        xb = xs[i1] + (c[i1] - half) / max(c[i1] - c[i1 + 1], 1e-6)
        return dict(orient="h", y_of_x=(d["slope"], d["icpt"]), width=d["width"], peak=d["peak"], x0=float(xa), x1=float(xb))
    marks["top_bar"] = crossbar(69.4, "top_bar")
    marks["bottom_bar"] = crossbar(1183.6, "bottom_bar")
    return marks, circ_pt


def marks_segments(marks, circ_pt, cxy):
    """Convert measured marks to endpoints (index coords) -> continuous list."""
    segs = {}
    cx, cy = cxy

    def line_circle_hit(p_in, direction):
        # walk from inner point outward until it reaches the circle (r >= r_c(theta))
        pass

    # Left: from circle (theta = pi) to inner_x
    m = marks["left"]
    s, i0 = m["y_of_x"]
    # find where the horizontal line meets the circle curve by search in x
    def hit_h(x_start, x_stop, sgn):
        xs = np.arange(x_start, x_stop, sgn * 0.05)
        for x in xs:
            y = s * x + i0
            th = np.arctan2(y - cy, x - cx)
            p = circ_pt(th)
            if np.hypot(x - cx, y - cy) >= np.hypot(*(p - np.array([cx, cy]))):
                return x if sgn < 0 else x
        return x_stop
    # left: from x=100 moving left until outside circle
    xl = 100.0
    while True:
        y = s * xl + i0
        th = np.arctan2(y - cy, xl - cx)
        pr = circ_pt(th)
        if np.hypot(xl - cx, y - cy) >= np.hypot(*(pr - np.array([cx, cy]))) or xl < 0:
            break
        xl -= 0.05
    segs["left"] = [[(xl, s * xl + i0), (m["inner_x"], s * m["inner_x"] + i0), m["width"]]]
    m = marks["right"]
    s, i0 = m["y_of_x"]
    xr = 1170.0
    while True:
        y = s * xr + i0
        th = np.arctan2(y - cy, xr - cx)
        pr = circ_pt(th)
        if np.hypot(xr - cx, y - cy) >= np.hypot(*(pr - np.array([cx, cy]))) or xr > W:
            break
        xr += 0.05
    segs["right"] = [[(m["inner_x"], s * m["inner_x"] + i0), (xr, s * xr + i0), m["width"]]]
    m = marks["top"]
    s, i0 = m["x_of_y"]
    yt = 80.0
    while True:
        x = s * yt + i0
        th = np.arctan2(yt - cy, x - cx)
        pr = circ_pt(th)
        if np.hypot(x - cx, yt - cy) >= np.hypot(*(pr - np.array([cx, cy]))) or yt < 0:
            break
        yt -= 0.05
    bar = marks["top_bar"]
    segs["top"] = [[(s * yt + i0, yt), (s * m["inner_y"] + i0, m["inner_y"]), m["width"]],
                   [(bar["x0"], bar["y_of_x"][0] * bar["x0"] + bar["y_of_x"][1]),
                    (bar["x1"], bar["y_of_x"][0] * bar["x1"] + bar["y_of_x"][1]), bar["width"]]]
    m = marks["bottom"]
    s, i0 = m["x_of_y"]
    yb = 1170.0
    while True:
        x = s * yb + i0
        th = np.arctan2(yb - cy, x - cx)
        pr = circ_pt(th)
        if np.hypot(x - cx, yb - cy) >= np.hypot(*(pr - np.array([cx, cy]))) or yb > H:
            break
        yb += 0.05
    bar = marks["bottom_bar"]
    segs["bottom"] = [[(s * m["inner_y"] + i0, m["inner_y"]), (s * yb + i0, yb), m["width"]],
                      [(bar["x0"], bar["y_of_x"][0] * bar["x0"] + bar["y_of_x"][1]),
                       (bar["x1"], bar["y_of_x"][0] * bar["x1"] + bar["y_of_x"][1]), bar["width"]]]
    return segs


def lines_alpha(img, ths, rc, free, segs, marks):
    """alpha + colour of circle and marks, un-mixed from the local background.
    Returns alpha (H,W) float, colour (H,W,3) float, line colour."""
    I = img.astype(np.float32)
    L = lum_of(I)
    cx, cy = free["centre"]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    th = np.arctan2(dy, dx)
    rr = np.hypot(dx, dy)
    rcurve = np.interp(np.mod(th, 2 * np.pi), ths, rc, period=2 * np.pi).astype(np.float32)
    d = rr - rcurve                      # signed distance (outward positive), ~normal distance
    # distance to marks (axis aligned segments, with slight tilt neglected -> use exact segment distance)
    dm = np.full((H, W), 99.0, np.float32)
    seglist = [s for k in segs for s in segs[k]]
    for (p0, p1, _w) in seglist:
        p0 = np.array(p0, np.float32)
        p1 = np.array(p1, np.float32)
        v = p1 - p0
        t = np.clip(((xx - p0[0]) * v[0] + (yy - p0[1]) * v[1]) / (v @ v), 0, 1)
        px_, py_ = p0[0] + t * v[0], p0[1] + t * v[1]
        dm = np.minimum(dm, np.hypot(xx - px_, yy - py_))
    near_c = np.abs(d) <= 4.5
    near_m = dm <= 4.5
    near = near_c | near_m
    # background estimate per pixel: median of a ring of pixels 3.5..6 away, via morphological
    # trick: grey-level median of the non-near pixels in a local window
    ref = np.where(near, np.nan, L)
    # local minimum-ish background: use masked mean of dark neighbourhood (side values)
    wgt = (~near).astype(np.float32)
    bg_mean, den = norm_conv(np.nan_to_num(ref), wgt, 3.0)
    bg_mean = np.where(den > 0.02, bg_mean, np.median(L))
    # line colour: median colour of brightest core pixels
    core = (near_c & (np.abs(d) < 0.7) & (L > 235)) | (near_m & (dm < 0.7) & (L > 235))
    lc = np.median(I[core], axis=0)
    Lc = float(lc.mean())
    contrast = Lc - bg_mean
    a_data = np.clip((L - bg_mean) / np.maximum(contrast, 1), 0, 1)
    # model alpha from the average perpendicular profile of the circle where the background is dark
    dist_line = np.minimum(np.abs(d), dm)
    dark = near_c & (bg_mean < 40) & (np.abs(d) < 4.5)
    bins = np.arange(0, 4.51, 0.25)
    prof = np.zeros(len(bins) - 1)
    for i in range(len(bins) - 1):
        m = dark & (np.abs(d) >= bins[i]) & (np.abs(d) < bins[i + 1])
        prof[i] = np.median(a_data[m]) if m.sum() > 20 else 0
    centres = 0.5 * (bins[1:] + bins[:-1])
    a_model_all = np.interp(dist_line, centres, prof, right=0)
    a = np.where(contrast >= 70, a_data, a_model_all)
    a = np.where(near, a, 0).astype(np.float32)
    a[a < 0.03] = 0
    return a, I, lc, bg_mean, near


# =========================================================================
# 2. letters / wordmark
# =========================================================================
def letter_components(img):
    L = lum_of(img)
    m = L > LETTER_THR
    sub = np.zeros_like(m)
    sub[528:664, 120:1160] = m[528:664, 120:1160]
    lab, n = ndi.label(sub, structure=np.ones((3, 3)))
    sz = np.bincount(lab.ravel())
    sz[0] = 0
    comps = [i for i in range(1, n + 1) if sz[i] > 2000]
    comps.sort(key=lambda i: np.nonzero(lab == i)[1].min())
    assert len(comps) == 8, "expected 8 letters, got %d" % len(comps)
    return lab, comps


def letter_geometry(img):
    """Binary letter masks, filled masks, counters, per-letter sub-pixel contours."""
    from skimage import measure
    L = lum_of(img)
    lab, comps = letter_components(img)
    out = []
    for lid, ci in zip(LETTER_IDS, comps):
        cm = lab == ci
        filled = ndi.binary_fill_holes(cm)
        holes = filled & ~cm
        hl, hn = ndi.label(holes)
        hs = np.bincount(hl.ravel())
        counters = np.zeros_like(cm)
        for i in range(1, hn + 1):
            if hs[i] > 300:
                counters |= hl == i
        clean = filled & ~counters           # specks filled, true counters kept
        # erosion damage that STICKS OUT (e.g. the nub on the Z): opening with a 9x9 disk, then give back
        # only the thin slivers that opening takes from true corners (thickness <= 2 px)
        disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)).astype(bool)
        opened = ndi.binary_opening(clean, structure=disk)
        diff = clean & ~opened
        dl, dn_ = ndi.label(diff, structure=np.ones((3, 3)))
        edt = ndi.distance_transform_edt(np.pad(diff, 1))[1:-1, 1:-1]
        protr = np.zeros_like(clean)
        for i in range(1, dn_ + 1):
            comp = dl == i
            if comp.sum() >= 18 and edt[comp].max() > 1.3:
                protr |= comp
        ring_p = ndi.binary_dilation(protr, iterations=2) & ~clean
        clean = clean & ~protr
        ys, xs = np.nonzero(cm)
        y0, y1, x0, x1 = ys.min() - 4, ys.max() + 5, xs.min() - 4, xs.max() + 5
        # raw: image restricted to this letter's dilated bbox mask so neighbours never leak in
        near = ndi.binary_dilation(cm, iterations=4)
        sub_raw = np.where(near, L, 0.0)[y0:y1, x0:x1]
        # clean: specks (small holes) filled with cream, otherwise original luminance
        sub_cl = np.where(near | clean, np.where(clean & ~cm & ~ndi.binary_dilation(~filled, iterations=1), 224.0, L), 0.0)
        sub_cl = np.where(ndi.binary_dilation(filled, iterations=4), sub_cl, 0.0)[y0:y1, x0:x1]
        # make sure speck fill happens everywhere inside `filled` that is not a counter
        sp = (filled & ~counters & ~cm)[y0:y1, x0:x1]
        sub_cl = np.where(sp, 224.0, sub_cl)
        sub_cl = np.where((protr | ring_p)[y0:y1, x0:x1] & ~clean[y0:y1, x0:x1], 0.0, sub_cl)
        # neighbours of removed protrusions that were part of `clean`'s boundary are untouched
        def contours(sub, min_len, min_area):
            cs = measure.find_contours(np.pad(sub, 1), LETTER_THR)
            res = []
            for c in cs:
                c = c[:, ::-1] + np.array([x0 - 1, y0 - 1])      # x,y index coords
                if len(c) < min_len:
                    continue
                if abs(vec.signed_area(c)) < min_area:
                    continue
                res.append(c)
            return res
        raw_c = contours(sub_raw, 10, 5.0)
        cl_c = contours(sub_cl, 20, 100.0)
        out.append(dict(id=lid, comp=cm, filled=filled, counters=counters, clean=clean,
                        raw_contours=raw_c, clean_contours=cl_c))
    return out


def orient_contours(cons):
    """outer: clockwise on screen (positive shoelace in y-down), holes counter-clockwise.
    Returns list of (points, is_hole)."""
    res = []
    areas = [abs(vec.signed_area(c)) for c in cons]
    # contour containment: a contour is a hole if it is inside a bigger one
    for i, c in enumerate(cons):
        inside = 0
        pt = c[0].astype(np.float32)
        for j, c2 in enumerate(cons):
            if i != j and areas[j] > areas[i]:
                if cv2.pointPolygonTest(c2.astype(np.float32), (float(pt[0]), float(pt[1])), False) > 0:
                    inside += 1
        hole = inside % 2 == 1
        a = vec.signed_area(c)
        if (not hole and a < 0) or (hole and a > 0):
            c = c[::-1]
        res.append((c, hole))
    return res


def fit_letter_paths(cons, dp_eps, bez_tol, line_tol, corner_deg=35.0, min_edge=6.0, step=0.8):
    paths = []
    for c, hole in orient_contours(cons):
        curves, cp = vec.fit_closed(c, dp_eps=dp_eps, corner_deg=corner_deg, bez_tol=bez_tol,
                                    line_tol=line_tol, min_edge=min_edge, step=step)
        # keep orientation of the input
        s = vec.sample_curves(curves, 20)
        if (vec.signed_area(s) > 0) == hole:
            curves = [cv[::-1].copy() for cv in curves[::-1]]
        paths.append(dict(curves=curves, hole=hole, corners=cp))
    return paths


def raster_paths(path_sets, scale=4, bbox=None):
    """Rasterise letter paths (list of dicts with curves, hole) at `scale` x with even-odd via XOR, area-averaged."""
    big = np.zeros((H * scale, W * scale), np.uint8)
    for lp in path_sets:
        tmp = np.zeros_like(big)
        for p in lp:
            pts = vec.sample_curves(p["curves"], 40)
            q = np.round(((pts + 0.5) * scale - 0.5) * 16).astype(np.int32)
            m1 = np.zeros_like(big)
            cv2.fillPoly(m1, [q], 255, lineType=cv2.LINE_8, shift=4)
            tmp ^= m1
        big |= tmp
    return cv2.resize(big.astype(np.float32) / 255.0, (W, H), interpolation=cv2.INTER_AREA)


def svg_letter_masks(fname):
    """Parse the written SVG back (M / C / Z, absolute) and rasterise each <path> (index coords = svg - 0.5)."""
    import re
    txt = (OUT / fname).read_text()
    res = {}
    for m in re.finditer(r'<path id="([A-Z0-9]+)"[^>]*\sd="([^"]+)"', txt):
        pid, d = m.group(1), m.group(2)
        paths = []
        for sub in d.split("Z"):
            sub = sub.strip()
            if not sub:
                continue
            nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", sub)]
            p0 = np.array(nums[0:2])
            rest = np.array(nums[2:]).reshape(-1, 6)
            curves = []
            cur = p0
            for r_ in rest:
                c = np.array([cur, r_[0:2], r_[2:4], r_[4:6]])
                curves.append(c - 0.5)
                cur = r_[4:6]
            paths.append(dict(curves=curves, hole=False))
        res[pid] = raster_paths([paths])
    return res


# =========================================================================
# 3. torn strip
# =========================================================================
def measure_strip(img, letter_union, letter_bbox):
    L = lum_of(img).astype(np.float32)
    Lb = cv2.GaussianBlur(L, (0, 0), 1.0)
    excl = ndi.binary_dilation(letter_union, iterations=3)
    bright = (Lb > 45) & ~excl
    xa, xb = int(letter_bbox[0]) - 12, int(letter_bbox[2]) + 12
    xs = np.arange(xa, xb + 1)
    top = np.full(len(xs), np.nan)
    bot = np.full(len(xs), np.nan)
    TOP_START, TOP_LIM, BOT_START, BOT_LIM = 531, 470, 662, 722
    for k, x in enumerate(xs):
        col = bright[:, x]
        # upward scan: first bright run >= 3 px
        y = TOP_START
        while y > TOP_LIM:
            if col[y] and col[y - 1:y + 1].all() and (col[max(y - 2, 0)]):
                break
            y -= 1
        if y > TOP_LIM:
            # sub-pixel: crossing of blurred lum with level 45 between y and y+1
            a, b = Lb[y, x], Lb[y + 1, x]
            fr = (a - 45) / max(a - b, 1e-6)
            top[k] = y + np.clip(fr, 0, 1)
        y = BOT_START
        while y < BOT_LIM:
            if col[y] and col[y + 1] and col[min(y + 2, H - 1)]:
                break
            y += 1
        if y < BOT_LIM:
            a, b = Lb[y, x], Lb[y - 1, x]
            fr = (a - 45) / max(a - b, 1e-6)
            bot[k] = y - np.clip(fr, 0, 1)
    obs_top = np.isfinite(top)
    obs_bot = np.isfinite(bot)

    def fill(v, kind):
        """observed columns -> closing/opening (kills 1-D spikes caused by dark photo), long unobserved
        stretches -> constant (median) with 20 px ramps, short ones -> linear interpolation"""
        v = v.copy()
        ok = np.isfinite(v)
        med = float(np.median(v[ok]))
        idx = np.nonzero(ok)[0]
        lin = np.interp(np.arange(len(v)), idx, v[idx])
        # spike removal on the interpolated curve:
        #   top edge (y small = up): spikes are narrow minima  -> grey closing (max then min)
        #   bottom edge: spikes are narrow maxima              -> grey opening (min then max)
        w = 31
        if kind == "top":
            sm = ndi.minimum_filter1d(ndi.maximum_filter1d(lin, w, mode="nearest"), w, mode="nearest")
        else:
            sm = ndi.maximum_filter1d(ndi.minimum_filter1d(lin, w, mode="nearest"), w, mode="nearest")
        sm = ndi.median_filter(sm, 9, mode="nearest")
        # long gaps
        res = sm.copy()
        gap = ~ok
        lab, n = ndi.label(gap)
        for g_ in range(1, n + 1):
            seg = np.nonzero(lab == g_)[0]
            if len(seg) >= 40:
                a_, b_ = seg[0], seg[-1]
                const = np.full(len(seg), med)
                left = sm[a_ - 1] if a_ > 0 else med
                right = sm[b_ + 1] if b_ < len(v) - 1 else med
                ramp = np.minimum(1.0, np.arange(len(seg)) / 20.0)
                ramp_r = np.minimum(1.0, (len(seg) - 1 - np.arange(len(seg))) / 20.0)
                val = const.copy()
                if a_ > 0:
                    val = val * ramp + left * (1 - ramp)
                if b_ < len(v) - 1:
                    val = val * ramp_r + right * (1 - ramp_r)
                res[seg] = val
        return res
    topf, botf = fill(top, "top"), fill(bot, "bot")
    # a strip can never be thinner than the letters
    topf = np.minimum(topf, letter_bbox[1] - 1.0)
    botf = np.maximum(botf, letter_bbox[3] + 1.0)
    return dict(xs=xs, top=topf, bot=botf, obs_top=obs_top, obs_bot=obs_bot)


def strip_polygon(st):
    xs, top, bot = st["xs"], st["top"], st["bot"]
    # DP simplify the two edges separately (eps 0.5 px)
    tp = np.c_[xs.astype(float), top]
    bp = np.c_[xs.astype(float), bot]
    tk = vec._dp(tp, 0.5)
    bk = vec._dp(bp, 0.5)
    t2, b2 = tp[tk], bp[bk]
    # close with half-pixel vertical sides at both ends
    poly = np.vstack([t2, b2[::-1]])
    return poly, t2, b2


# =========================================================================
# 4. band
# =========================================================================
def measure_band(img):
    Q = img.astype(np.float64)
    c = Q[..., 0] - Q[..., 2]
    # --- left / right / top edges (sub-pixel, index coords): half-level crossing of the chroma profile
    def edge_x(x_lo, x_hi, rows, rising):
        xs = []
        for y in rows:
            row = c[y, x_lo:x_hi]
            hi = np.median(row[-3:] if rising else row[:3])
            lo = np.median(row[:3] if rising else row[-3:])
            if hi < 100 or lo > 40:
                continue
            half = 0.5 * (hi + lo)
            r = row if rising else row[::-1]
            k = np.nonzero(r >= half)[0][0]
            f = (half - r[k - 1]) / max(r[k] - r[k - 1], 1e-6)
            pos = k - 1 + f
            xs.append(x_lo + (pos if rising else (len(row) - 1 - pos)))
        return np.array(xs)
    rows = list(range(100, 470)) + list(range(720, 1000))
    xl = edge_x(685, 705, rows, True)
    xr = edge_x(937, 957, rows, False)
    x0, x1 = float(np.median(xl)), float(np.median(xr))
    ys_ = []
    for x in range(710, 880):
        col = c[55:80, x]
        if col.max() > 100:
            hi, lo = np.median(col[-3:]), np.median(col[:3])
            if hi < 100 or lo > 40:
                continue
            half = 0.5 * (hi + lo)
            k = np.nonzero(col >= half)[0][0]
            f = (half - col[k - 1]) / max(col[k] - col[k - 1], 1e-6)
            ys_.append(55 + k - 1 + f)
    y0 = float(np.median(ys_))
    return dict(x0=x0, x1=x1, y0=y0, edge_samples=(len(xl), len(xr), len(ys_)),
                x0_spread=float(np.std(xl)), x1_spread=float(np.std(xr)))


def band_model(img, band, hidden_mask, circ_inside):
    """alpha map + flat colour such that   out = photo * (1 - a + a*C)   (multiply with opacity)."""
    Q = img.astype(np.float64)
    R_, G_, B_ = Q[..., 0], Q[..., 1], Q[..., 2]
    x0, x1, y0 = band["x0"], band["x1"], band["y0"]
    xi0, xi1, yi0 = int(np.ceil(x0 + 0.5)), int(np.floor(x1 - 0.5)), int(np.ceil(y0 + 0.5))
    # photo warm-grey ratios measured on the un-tinted photo (chin / neck, left of the band)
    reg = np.zeros((H, W), bool)
    reg[720:1000, 250:680] = True
    o = Q[reg]
    o = o[o[:, 0] > 60]
    rho = np.array([1.0, np.median(o[:, 1] / o[:, 0]), np.median(o[:, 2] / o[:, 0])])
    # colour of the saturated part of the band
    box = np.zeros((H, W), bool)
    box[80:460, 700:940] = True
    px = Q[box]
    hi = px[px[:, 0] > 238]
    q_hi = np.median(hi, 0) / 255.0
    Cband = q_hi / rho            # flat orange: photo white (warm) * Cband = bright part of the band (gain 1)
    def alpha_raw(Ce):
        def one(ch):
            u = (Q[..., ch] / np.maximum(R_, 1)) / rho[ch]
            return (1 - u) / ((1 - Ce[ch]) - u * (1 - Ce[0]))
        aG_, aB_ = one(1), one(2)
        wG_, wB_ = (1 - Ce[1]) ** 2, (1 - Ce[2]) ** 2
        return np.clip((aG_ * wG_ + aB_ * wB_) / (wG_ + wB_), 0, 1)
    # Gain K: the photo is NOT continuous in brightness across the band edge (band side is ~1.7x brighter in R
    # for the same anatomy); estimate K from the left edge of the chin/neck (rows 740-930), iterating with the opacity.
    K = 1.0
    Ks = []
    for it in range(4):
        a_raw = alpha_raw(K * Cband)
        Ks = []
        for y in range(740, 935, 5):
            out_ = np.median(Q[y:y + 5, 672:692, 0])
            in_ = np.median(Q[y:y + 5, 698:718, 0])
            rel_ = (R_[y:y + 5, 698:718] > 45)
            if out_ < 60 or in_ < 60 or rel_.sum() < 40:
                continue
            al = np.median(a_raw[y:y + 5, 698:718][rel_])
            if al < 0.5:
                continue
            r_ = in_ / out_
            Ks.append((r_ - (1 - al)) / (al * Cband[0]))
        K = float(np.median(Ks)) if Ks else 1.0
    Ce = K * Cband
    a_raw = alpha_raw(Ce)
    K_info = dict(K=K, n_rows=len(Ks), spread_iqr=[float(np.percentile(Ks, 25)), float(np.percentile(Ks, 75))] if Ks else None)
    rect = np.zeros((H, W), bool)
    rect[yi0:, xi0:xi1 + 1] = True
    reliable = (R_ > 45) & rect & ~hidden_mask
    a_s, den = norm_conv(np.where(reliable, a_raw, 0.0), reliable.astype(np.float32), 3.0)
    # fill the rest with wide normalised convolution (dark / hidden areas)
    a_w, den_w = norm_conv(np.where(reliable, a_raw, 0.0), reliable.astype(np.float32), 18.0)
    a_map = np.where(den > 0.15, a_s, np.where(den_w > 0.02, a_w, 1.0))
    a_map = np.clip(a_map, 0, 1)
    # rectangle mask with exact sub-pixel edges (coverage), band reaches the bottom of the canvas
    xx = np.arange(W)
    cov_x = np.clip(np.minimum(xx + 0.5 - x0, x1 - (xx - 0.5) ) , 0, 1)   # pixel centre-based coverage
    cov_x = np.clip(np.minimum((xx + 1) - x0 - 0.5, x1 + 0.5 - xx) , 0, 1)
    yy = np.arange(H)
    cov_y = np.clip((yy + 1) - y0 - 0.5, 0, 1)
    rect_cov = (cov_y[:, None] * cov_x[None, :]).astype(np.float32)
    # band is clipped by the circle at the top-right corner (visible in the source): keep only what the data show
    a_final = (a_map * rect_cov).astype(np.float32)
    return dict(alpha=a_final, a_raw=a_raw, reliable=reliable, rho=rho, C=Cband, K=K, K_info=K_info, Ceff=Ce, q_hi=q_hi,
                rect_cov=rect_cov, rect=rect)


def band_model_comparison(img, band_info, hidden, sample=3000):
    """Which combination law explains the band?  Every model gets the same per-pixel
    freedom on the photo luminance p (101 levels, warm-grey ratios rho) and the band opacity is
    FIXED to 1 on the solid part of the band (where the measured opacity map is > 0.97).
    Residual = RMS over R,G,B (8-bit levels) of the best p.   Also reports the free-opacity fit for reference."""
    Q = img.astype(np.float64) / 255.0
    rect = band_info["rect"]
    yy = np.arange(H)[:, None]
    solid = rect & band_info["reliable"] & (band_info["alpha"] > 0.97) & (yy > 80) & (yy < 470)
    ys, xs = np.nonzero(solid)
    idx = np.random.default_rng(1).choice(len(ys), min(sample, len(ys)), replace=False)
    q = Q[ys[idx], xs[idx]]
    rho, C, q_hi = band_info["rho"], band_info["Ceff"], band_info["q_hi"]
    pg = np.linspace(0, 1, 201)[:, None]
    ph = pg * rho[None, :]
    models = {
        "multiply (photo x flat orange x gain K)": ph * C[None, :],
        "normal / flat orange over photo (opacity 1)": np.broadcast_to(q_hi[None, :], ph.shape),
        "screen (photo screened with orange)": 1 - (1 - ph) * (1 - q_hi[None, :]),
    }
    res = {}
    for k, m in models.items():
        err = ((q[:, None, :] - m[None, :, :]) ** 2).sum(2).min(1)
        res[k] = float(np.sqrt(err.mean() / 3) * 255)
    # free opacity (same grid as before) for reference
    ag = np.linspace(0, 1, 21)
    P2, A2 = np.meshgrid(np.linspace(0, 1, 101), ag, indexing="ij")
    P2 = P2.ravel()[:, None]
    A2 = A2.ravel()[:, None]
    ph2 = P2 * rho[None, :]
    free = {"multiply": ph2 * (1 - A2 + A2 * C[None, :]), "normal": (1 - A2) * ph2 + A2 * q_hi[None, :],
            "screen": 1 - (1 - ph2) * (1 - A2 * q_hi[None, :])}
    resf = {}
    for k, m in free.items():
        err = ((q[:, None, :] - m[None, :, :]) ** 2).sum(2).min(1)
        resf[k] = float(np.sqrt(err.mean() / 3) * 255)
    # darkest areas: a multiply keeps black black, a flat/normal or screen blend cannot
    inband = rect & band_info["reliable"] | (rect & ~hidden & (Q[..., 0] * 255 < 45))
    dk = rect & ~hidden & (Q[..., 0] * 255 < 40) & (yy > 80) & ((yy < 470) | (yy > 720))
    dark_med = (np.median(Q[dk], 0) * 255).tolist() if dk.sum() else None
    return dict(fixed_opacity_rms=res, free_opacity_rms=resf, n_pixels=int(len(idx)),
                dark_in_band_median_rgb=dark_med, dark_in_band_count=int(dk.sum()))


# =========================================================================
# main
# =========================================================================
def main():
    sha0 = hashlib.sha256(SRC.read_bytes()).hexdigest()
    bgr = cv2.imread(str(SRC), cv2.IMREAD_COLOR)
    assert bgr.shape == (H, W, 3)
    img = bgr[:, :, ::-1].astype(np.float32)            # RGB float
    L = lum_of(img)
    OUT.mkdir(parents=True, exist_ok=True)
    geo = {}
    notes = []                                          # honest list for the QA report

    # ------------------------------------------------------------ circle
    log("[1] circle ...")
    circ, ell, free, cpts = measure_circle(img)
    ths, rc, ok = refine_circle_curve(img, free, cpts)
    log("   circle LS fit centre=(%.2f,%.2f) r=%.2f rms=%.2f px | ellipse rms=%.2f | free-form rms=%.2f"
        % (circ["cx"] + .5, circ["cy"] + .5, circ["r"], circ["rms"], ell["rms"], free["rms"]))
    marks, circ_pt = measure_marks(img, ths, rc, free)
    segs = marks_segments(marks, circ_pt, free["centre"])
    a_lines, _, lc, bg_est, near = lines_alpha(img, ths, rc, free, segs, marks)
    # stroke width = integral of the alpha profile across the circle (equivalent width), dark background only
    cx, cy = free["centre"]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    th = np.arctan2(yy - cy, xx - cx)
    rr = np.hypot(xx - cx, yy - cy)
    rcurve = np.interp(np.mod(th, 2 * np.pi), ths, rc, period=2 * np.pi)
    dd = rr - rcurve
    ring = np.abs(dd) < 4.5
    dark_ring = ring & (bg_est < 40)
    # per-angle-bin integral
    thb = (np.degrees(th) % 360 // 2).astype(int)
    widths = []
    for k in range(180):
        m = ring & (thb == k)
        if m.sum() < 30 or (dark_ring & (thb == k)).sum() < 0.8 * m.sum():
            continue
        widths.append(float(a_lines[m].sum() / (m.sum() / 9.0)))
    stroke_w = float(np.median(widths))
    # also FWHM-like: width at alpha 0.5 from mean profile
    log("   stroke width (equivalent) = %.2f px (n=%d bins)" % (stroke_w, len(widths)))
    marks["_stroke"] = stroke_w
    marks["_colour"] = "#%02X%02X%02X" % tuple(int(round(v)) for v in lc)

    # ------------------------------------------------------------ letters
    log("[2] letters ...")
    lets = letter_geometry(img)
    letter_union = np.zeros((H, W), bool)
    for l in lets:
        letter_union |= l["comp"]
    for l in lets:
        l["clean_paths"] = fit_letter_paths(l["clean_contours"], dp_eps=1.0, bez_tol=0.7, line_tol=0.9)
        l["raw_paths"] = fit_letter_paths(l["raw_contours"], dp_eps=0.45, bez_tol=0.3, line_tol=0.35,
                                          corner_deg=30.0, min_edge=2.5, step=0.5)
    # per-letter bbox from the clean vector (sub-pixel), plus the raster mask extent
    lbox = []
    for l in lets:
        allp = np.vstack([vec.sample_curves(p["curves"], 60) for p in l["clean_paths"] if not p["hole"]])
        x0_, y0_ = allp.min(0)
        x1_, y1_ = allp.max(0)
        l["bbox"] = [x0_, y0_, x1_, y1_]
        lbox.append(l["bbox"])
    lbox = np.array(lbox)
    wm_bbox = [lbox[:, 0].min(), lbox[:, 1].min(), lbox[:, 2].max(), lbox[:, 3].max()]
    flat = [i for i, n in enumerate(LETTER_IDS) if n in ("F1", "F2", "R1", "I1", "D1", "Z1")]
    baseline = float(np.median(lbox[flat, 3]))
    cap_top = float(np.median(lbox[flat, 1]))
    cap_h = baseline - cap_top
    log("   wordmark bbox (idx coords) =", np.round(wm_bbox, 2), "baseline=%.2f cap=%.2f" % (baseline, cap_h))

    # ------------------------------------------------------------ strip
    log("[3] strip ...")
    st = measure_strip(img, letter_union, wm_bbox)
    poly, tpoly, bpoly = strip_polygon(st)
    # polygon sides: vertical at the extreme columns
    cov_strip = aa_polygon(poly, 4)
    log("   strip edge columns observed: top %.0f%%, bottom %.0f%%" % (100 * st["obs_top"].mean(), 100 * st["obs_bot"].mean()))

    # ------------------------------------------------------------ band
    log("[4] band ...")
    band = measure_band(img)
    hidden = cov_strip > 0.5
    # hidden for band purposes = strip silhouette
    bm = band_model(img, band, hidden, None)
    cmp_models = band_model_comparison(img, bm, hidden)
    log("   band edges x0=%.2f x1=%.2f y0=%.2f; model residual RMS:" % (band["x0"] + .5, band["x1"] + .5, band["y0"] + .5), cmp_models)

    # ------------------------------------------------------------ layers
    log("[5] layers ...")
    layers = build_layers(img, lets, letter_union, cov_strip, a_lines, lc, bm, band, hidden, notes)

    # ------------------------------------------------------------ vectors out
    log("[6] vectors ...")
    write_vectors(lets, poly, ths, rc, free, segs, marks, wm_bbox, baseline, cap_h)

    # ------------------------------------------------------------ geometry json + QA
    log("[7] qa ...")
    qa(img, layers, lets, cov_strip, hidden, circ, ell, free, stroke_w, marks, segs, band, bm, cmp_models, st, poly, tpoly,
       bpoly, wm_bbox, baseline, cap_h, cap_top, lc, ths, rc, notes)
    sha1 = hashlib.sha256(SRC.read_bytes()).hexdigest()
    assert sha0 == sha1, "source modified!"
    log("done; source sha256 unchanged:", sha1[:16])


# ---------------------------------------------------------------------------
def to_u8(x):
    return np.clip(np.round(x), 0, 255).astype(np.uint8)


def save_rgba(path, rgb, a):
    out = np.dstack([to_u8(rgb), to_u8(a * 255.0)])
    cv2.imwrite(str(path), out[:, :, [2, 1, 0, 3]])


def build_layers(img, lets, letter_union, cov_strip, a_lines, lc, bm, band, hidden, notes):
    I = img.astype(np.float64)
    Lm = lum_of(I)
    res = {}
    # ---- lines: colour & alpha
    a_l = a_lines.astype(np.float64)
    line_rgb = np.broadcast_to(lc, (H, W, 3)).copy()
    # where alpha is high take true colour: un-mix against bg
    res["lines_a"] = a_l
    res["lines_rgb"] = line_rgb
    # photo with lines removed: P = (I - a*lc)/(1-a)   for a<0.85 ; inpaint above
    P = I.copy()
    m_lo = (a_l > 0) & (a_l < 0.85)
    P[m_lo] = (I[m_lo] - a_l[m_lo, None] * lc[None, :]) / (1 - a_l[m_lo, None])
    m_hi = a_l >= 0.85
    P = np.clip(P, 0, 255)
    P8 = to_u8(P)
    if m_hi.any():
        mk = cv2.dilate(m_hi.astype(np.uint8), np.ones((3, 3), np.uint8))
        P8 = cv2.inpaint(P8[:, :, ::-1], mk, 3, cv2.INPAINT_TELEA)[:, :, ::-1]
    P = P8.astype(np.float64)
    res["photo_lines_removed"] = P
    # ---- strip & letters
    cov = cov_strip.astype(np.float64)
    core_s = ndi.binary_erosion(cov > 0.99, iterations=1)
    ring_s = (cov > 0.001) & ~core_s
    # letters
    lcore = np.zeros((H, W), bool)
    lall = np.zeros((H, W), bool)
    for l in lets:
        lcore |= ndi.binary_erosion(l["clean"], iterations=1)
        lall |= l["clean"]
    lring = ndi.binary_dilation(lall, iterations=2) & ~lcore
    # letter colour propagated from core
    idx = ndi.distance_transform_edt(~lcore, return_distances=False, return_indices=True)
    Lcol = I[idx[0], idx[1]]
    # strip base: source in strip core outside letters; inside letters+ring: inpaint black + grain
    fillmask = (lring | lcore) & (cov > 0.001)
    S8 = to_u8(I)
    fm = ndi.binary_dilation(fillmask, iterations=1).astype(np.uint8)
    S8f = cv2.inpaint(S8[:, :, ::-1], fm, 4, cv2.INPAINT_TELEA)[:, :, ::-1].astype(np.float64)
    # grain: measure std of strip black away from letters
    blk = core_s & ~ndi.binary_dilation(lall, iterations=6) & (Lm < 40)
    gs = float(np.std(Lm[blk])) if blk.sum() > 100 else 2.0
    grain = rng.normal(0, gs * 0.6, (H, W, 1))
    S = np.where(fillmask[..., None], np.clip(S8f + grain, 0, 255), I)
    # --- strip layer colour/alpha: core -> S ; ring -> unmix between S-colour U and photo colour F
    idxs = ndi.distance_transform_edt(~core_s, return_distances=False, return_indices=True)
    U = S[idxs[0], idxs[1]]
    known = cov < 0.001
    idxk = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    F = P[idxk[0], idxk[1]]
    d = U - F
    dn = (d ** 2).sum(2)
    a_un = np.clip(((I - F) * d).sum(2) / np.maximum(dn, 1e-6), 0, 1)
    a_s = np.where(dn > 900, a_un, cov)
    a_strip = np.where(core_s, 1.0, np.where(ring_s, a_s, 0.0))
    strip_rgb = np.where(core_s[..., None], S, U)
    # make letters' ring pixels (inside strip core) use S too
    strip_rgb = np.where((core_s | ring_s)[..., None] & ~(ring_s & ~core_s)[..., None], S, strip_rgb)
    # --- letters layer
    d = Lcol - S
    dn = (d ** 2).sum(2)
    a_ul = np.clip(((I - S) * d).sum(2) / np.maximum(dn, 1e-6), 0, 1)
    a_let = np.where(lcore, 1.0, np.where(lring & (dn > 900), a_ul, 0.0))
    # ring pixels that are inside counters' neighbourhood but dark -> alpha ~0 automatically
    let_rgb = np.where(lcore[..., None], I, np.clip((I - (1 - a_let[..., None]) * S) / np.maximum(a_let[..., None], 1e-3), 0, 255))
    let_rgb = np.where((a_let > 0.02)[..., None], let_rgb, Lcol)
    # ---- photo layer: alpha 0 in strip core (hidden), colour F-extrapolated in ring
    photo_rgb = P.copy()
    photo_a = np.ones((H, W))
    photo_a[core_s] = 0.0
    photo_rgb[ring_s] = F[ring_s]
    photo_rgb[core_s] = 0
    hidden_core = core_s
    # ---- band: separate tint from photo inside band
    a_b = bm["alpha"].astype(np.float64)
    C = bm["C"]
    Kg = bm["K"]
    m = 1 - a_b[..., None] + a_b[..., None] * (Kg * C)[None, None, :]
    Q = P.copy()                       # photo with lines removed (still tinted by band)
    rho = bm["rho"]
    # per-channel de-multiplication with robust fall-backs
    Pr = np.clip(Q[..., 0] / m[..., 0], 0, 255)
    Pg = np.clip(Q[..., 1] / m[..., 1], 0, 255)
    Pb_d = np.clip(Q[..., 2] / m[..., 2], 0, 255)
    # forced warm-grey estimate from R (low noise)
    pforced = Pr
    Pg_f, Pb_f = pforced * rho[1], pforced * rho[2]
    dark = Q[..., 0] < 45
    wg = np.clip((m[..., 1] - 0.1) / 0.5, 0, 1) * (~dark)
    wb = np.clip((m[..., 2] - 0.1) / 0.5, 0, 1) * (~dark)
    Pg = wg * Pg + (1 - wg) * Pg_f
    Pb = wb * Pb_d + (1 - wb) * Pb_f
    inb = a_b > 0.002
    photo_unt = np.where(inb[..., None], np.dstack([Pr, Pg, Pb]), Q)
    photo_rgb = np.where(ring_s[..., None], photo_rgb, np.where(core_s[..., None], 0, photo_unt))
    # ring pixels were F-extrapolated from the *tinted* photo: untint them too
    ring_unt = np.where(inb[..., None], np.dstack([Pr, Pg, Pb]), Q)
    res.update(K=Kg, photo_rgb=photo_rgb, photo_a=photo_a, a_b=a_b, C=C, m=m, strip_rgb=strip_rgb, a_strip=a_strip,
               let_rgb=let_rgb, a_let=a_let, core_s=core_s, ring_s=ring_s)
    # write PNGs
    save_rgba(OUT / "layer_photo.png", photo_rgb, photo_a)
    save_rgba(OUT / "layer_strip.png", strip_rgb, a_strip)
    save_rgba(OUT / "layer_wordmark.png", let_rgb, a_let)
    save_rgba(OUT / "layer_lines.png", line_rgb, a_l)
    band_rgb = np.broadcast_to(np.round(C * 255), (H, W, 3))
    save_rgba(OUT / "layer_band.png", band_rgb, a_b)
    # convenience: multiplier image (opaque, 16-bit, value/16384) = what the photo is multiplied by (includes gain K)
    cv2.imwrite(str(OUT / "layer_band_factor16.png"), np.clip(np.round(m * 16384), 0, 65535).astype(np.uint16)[:, :, ::-1])
    return res


def compose(layers, bg=BG):
    K = layers["K"]
    """Re-compose from the written PNGs (so the QA proves the files, not the in-memory arrays)."""
    def rd(n):
        a = cv2.imread(str(OUT / n), cv2.IMREAD_UNCHANGED)
        rgb = a[:, :, [2, 1, 0]].astype(np.float64)
        al = a[:, :, 3].astype(np.float64) / 255.0
        return rgb, al
    ph, pa = rd("layer_photo.png")
    bnd, ba = rd("layer_band.png")
    st, sa = rd("layer_strip.png")
    wm, wa = rd("layer_wordmark.png")
    ln, la = rd("layer_lines.png")
    out = np.broadcast_to(bg, (H, W, 3)).astype(np.float64).copy()
    out = out * (1 - pa[..., None]) + ph * pa[..., None]
    # band: multiply with opacity
    out = out * (1 - ba[..., None] + ba[..., None] * K * (bnd / 255.0))
    out = out * (1 - sa[..., None]) + st * sa[..., None]
    out = out * (1 - wa[..., None]) + wm * wa[..., None]
    out = out * (1 - la[..., None]) + ln * la[..., None]
    return np.clip(np.round(out), 0, 255)


def write_vectors(lets, poly, ths, rc, free, segs, marks, wm_bbox, baseline, cap_h):
    cream = "#EEDFD2"
    # wordmark clean / raw svg + json
    def svg_letters(key, fname, desc):
        parts = []
        for l in lets:
            d = " ".join(vec.path_d(p["curves"], 2, (0.5, 0.5)) for p in l[key])
            parts.append('  <path id="%s" fill="%s" fill-rule="nonzero" d="%s"/>' % (l["id"], cream, d))
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">\n'
               '  <title>OFFGRIDZ wordmark (%s)</title>\n<desc>%s</desc>\n%s\n</svg>\n' % (fname, desc, "\n".join(parts)))
        (OUT / fname).write_text(svg)
    svg_letters("clean_paths", "wordmark_clean.svg",
                "Clean vector letters in source pixel coordinates; outer contours clockwise, counters counter-clockwise")
    svg_letters("raw_paths", "wordmark_raw.svg", "Vector letters following the eroded raster edges (specks >= 5 px2 kept as holes)")
    # json dense polylines
    js = {"units": "source pixels, origin top-left, y down; pixel i covers [i,i+1)",
          "orientation": "outer contours clockwise on screen (positive shoelace in y-down), holes counter-clockwise",
          "letters": []}
    for l in lets:
        cons, holes = [], []
        for p in l["clean_paths"]:
            pts = vec.sample_curves(p["curves"], 40) + 0.5
            cons.append(np.round(pts, 3).tolist())
            holes.append(bool(p["hole"]))
        js["letters"].append({"id": l["id"], "contours": cons, "is_hole": holes})
    (OUT / "wordmark_clean.json").write_text(json.dumps(js))
    # strip svg
    d = vec.polyline_d(poly + 0.5, 2, True)
    (OUT / "strip.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">\n'
        '  <title>OFFGRIDZ torn strip outline</title>\n'
        '  <path id="strip" fill="#0A0A09" stroke="none" d="%s"/>\n</svg>\n' % d)
    # lines svg: circle (smooth closed curve through the measured ridge) + marks
    pts = np.c_[free["centre"][0] + rc * np.cos(ths), free["centre"][1] + rc * np.sin(ths)]
    curves, _ = vec.fit_closed(pts, dp_eps=1.0, corner_deg=179.0, bez_tol=0.15, step=2.0)
    circ_d = vec.path_d(curves, 2, (0.5, 0.5))
    sw = marks["_stroke"]
    mk = []
    for name in ["top", "bottom", "left", "right"]:
        for j, (p0, p1, w_) in enumerate(segs[name]):
            mk.append('<path id="mark_%s_%d" stroke-width="%.2f" d="M%.2f %.2f L%.2f %.2f"/>' % (name, j, w_, p0[0] + .5, p0[1] + .5, p1[0] + .5, p1[1] + .5))
    (OUT / "lines.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">\n'
        '  <title>OFFGRIDZ circle and registration marks</title>\n'
        '  <g fill="none" stroke="%s" stroke-width="%.2f" stroke-linecap="butt">\n    <path id="circle" d="%s"/>\n    %s\n  </g>\n</svg>\n'
        % (marks["_colour"], sw, circ_d, "\n    ".join(mk)))


def band_end_rows(bm, band):
    """Row where the band opacity fades out, from the measured (un-smoothed) opacity, per column group."""
    a = bm["a_raw"]
    rel = bm["reliable"]
    out = {}
    groups = {"all": (697, 944), "left_quarter": (697, 757), "mid_left": (757, 820), "mid_right": (820, 880),
              "right_quarter": (880, 944)}
    for k, (xa, xb) in groups.items():
        med = np.full(H, np.nan)
        for y in range(900, H):
            v = a[y, xa:xb][rel[y, xa:xb]]
            if len(v) > 12:
                med[y] = np.median(v)
        # fill gaps, smooth
        idx = np.nonzero(np.isfinite(med))[0]
        if len(idx) < 10:
            out[k] = None
            continue
        f = np.interp(np.arange(H), idx, med[idx])
        f = ndi.uniform_filter1d(f, 25, mode="nearest")
        def first_below(th):
            ys = np.nonzero((np.arange(H) > 900) & (f < th))[0]
            return float(ys[0]) + 0.5 if len(ys) else None
        out[k] = dict(y_a_below_0p9=first_below(0.9), y_a_below_0p5=first_below(0.5), y_a_below_0p1=first_below(0.1),
                      a_at_bottom_rows=float(f[-30:].mean()))
    return out


def norm_tree(o, skip=()):
    """scale every float in a nested structure by 1/1254"""
    if isinstance(o, dict):
        return {k: (v if k in skip else norm_tree(v, skip)) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [norm_tree(v, skip) for v in o]
    if isinstance(o, (float, np.floating)):
        return float(o) / W
    if isinstance(o, (int, np.integer)):
        return float(o) / W
    return o


def R(v, n=3):
    return np.round(np.asarray(v, float), n).tolist()


def qa(img, layers, lets, cov_strip, hidden, circ, ell, free, stroke_w, marks, segs, band, bm, cmp_models, st, poly,
       tpoly, bpoly, wm_bbox, baseline, cap_h, cap_top, lc, ths, rc, notes):
    I = img.astype(np.float64)
    src8 = I.astype(np.uint8)
    rec = compose(layers)
    rec8 = rec.astype(np.uint8)
    cv2.imwrite(str(OUT / "qa_recomposition.png"), rec8[:, :, ::-1])
    diff = np.abs(rec - I)
    cv2.imwrite(str(OUT / "qa_diff.png"), np.clip(diff * 8, 0, 255).astype(np.uint8)[:, :, ::-1])
    strip_sil = cov_strip > 0.001
    outside = ~strip_sil
    metrics = {}
    metrics["psnr_all"] = psnr(rec, I)
    metrics["psnr_outside_strip"] = psnr(rec, I, outside)
    metrics["psnr_inside_strip"] = psnr(rec, I, strip_sil)
    inbandrect = bm["rect"] & outside
    metrics["psnr_band_region_outside_strip"] = psnr(rec, I, inbandrect)
    metrics["psnr_outside_strip_and_band"] = psnr(rec, I, outside & ~bm["rect"])
    # outside the strip but excluding the 3px ring around it (edge un-mixing residue)
    ring3 = ndi.binary_dilation(strip_sil, iterations=3) & ~strip_sil
    metrics["psnr_outside_strip_ex_ring3"] = psnr(rec, I, outside & ~ring3)
    metrics["psnr_ring3"] = psnr(rec, I, ring3)
    metrics["max_abs_err_outside"] = float(diff[outside].max())
    metrics["p99_abs_err_outside"] = float(np.percentile(diff[outside], 99))
    g_rec, g_src = rec.mean(2).astype(np.uint8), I.mean(2).astype(np.uint8)
    metrics["ssim_all"] = ssim_gray(g_src, g_rec)
    metrics["ssim_outside_strip"] = ssim_gray(g_src, g_rec, outside)
    # per-layer-region psnr table
    # ---------------------------------------------------------------- IoU
    iou = {}
    vec_masks = [raster_paths([l["clean_paths"]]) for l in lets]
    raw_masks = [raster_paths([l["raw_paths"]]) for l in lets]
    Ucl = np.zeros((H, W)); Ur = np.zeros((H, W)); Umask = np.zeros((H, W)); Uclean = np.zeros((H, W))
    for l, vm, rm in zip(lets, vec_masks, raw_masks):
        mask = l["comp"].astype(float)
        clean = l["clean"].astype(float)
        def iou_(a, b):
            ia = np.minimum(a, b).sum(); ua = np.maximum(a, b).sum()
            return float(ia / ua)
        iou[l["id"]] = dict(clean_vs_raster_mask=iou_(vm, mask), clean_vs_specks_filled_mask=iou_(vm, clean),
                            raw_vs_raster_mask=iou_(rm, mask), area_px=float(mask.sum()))
        Ucl = np.maximum(Ucl, vm); Ur = np.maximum(Ur, rm); Umask = np.maximum(Umask, mask); Uclean = np.maximum(Uclean, clean)
    ioun = lambda a, b: float(np.minimum(a, b).sum() / np.maximum(a, b).sum())
    svg_masks = svg_letter_masks("wordmark_clean.svg")
    Usvg = np.zeros((H, W))
    for l in lets:
        sm = svg_masks[l["id"]]
        iou[l["id"]]["clean_svg_file_vs_raster_mask"] = float(np.minimum(sm, l["comp"].astype(float)).sum() / np.maximum(sm, l["comp"].astype(float)).sum())
        Usvg = np.maximum(Usvg, sm)
    svgraw = svg_letter_masks("wordmark_raw.svg")
    Usvgr = np.zeros((H, W))
    for l in lets:
        Usvgr = np.maximum(Usvgr, svgraw[l["id"]])
    iou["ALL"] = dict(clean_vs_raster_mask=ioun(Ucl, Umask), clean_vs_specks_filled_mask=ioun(Ucl, Uclean),
                      raw_vs_raster_mask=ioun(Ur, Umask), clean_svg_file_vs_raster_mask=ioun(Usvg, Umask),
                      raw_svg_file_vs_raster_mask=ioun(Usvgr, Umask))
    # ---------------------------------------------------------------- overlay
    x0, y0, x1, y1 = 110, 515, 1170, 680
    sc = 3
    crop = cv2.resize(src8[y0:y1, x0:x1][:, :, ::-1], None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC)
    ov = crop.copy()
    for l in lets:
        for p in l["clean_paths"]:
            pts = (vec.sample_curves(p["curves"], 30) + 0.5 - np.array([x0, y0])) * sc
            q = np.round(pts * 16).astype(np.int32)
            cv2.polylines(ov, [q], True, (255, 0, 255) if not p["hole"] else (255, 255, 0), 1, cv2.LINE_AA, 4)
            for c in p["corners"]:
                cp = ((np.asarray(c) + 0.5 - np.array([x0, y0])) * sc)
                cv2.circle(ov, (int(round(cp[0])), int(round(cp[1]))), 3, (0, 255, 0), 1, cv2.LINE_AA)
    cv2.imwrite(str(OUT / "qa_vector_overlay.png"), ov)
    # extra close-up halves for inspection
    h = ov.shape[1] // 2
    cv2.imwrite(str(OUT / "qa_vector_overlay_left.png"), ov[:, :h + 60])
    cv2.imwrite(str(OUT / "qa_vector_overlay_right.png"), ov[:, h - 60:])
    # strip overlay + circle/marks overlay for eyeballing
    so = src8[:, :, ::-1].copy()
    cv2.polylines(so, [np.round((poly + 0.5) * 16).astype(np.int32)], True, (0, 255, 255), 1, cv2.LINE_AA, 4)
    cv2.imwrite(str(OUT / "qa_strip_overlay.png"), so[440:760, 60:1200])
    # ---------------------------------------------------------------- band rows
    bend = band_end_rows(bm, band)
    # ---------------------------------------------------------------- geometry json
    cxy = free["centre"]
    ring_pts = np.c_[cxy[0] + rc * np.cos(ths), cxy[1] + rc * np.sin(ths)]
    geo = {}
    geo["_meta"] = {
        "canvas_px": [W, H],
        "convention": "continuous image coordinates: pixel i covers [i, i+1), origin top-left, y down. normalised = px / 1254 (canvas is square).",
        "source": "assets/logo/source/offgridz-logo-1254.png (read-only, sha256 %s)" % hashlib.sha256(SRC.read_bytes()).hexdigest(),
        "generated_by": "build/logo/dissect.py",
    }
    circ_px = dict(
        best_fit_circle=dict(centre=R(c05([circ["cx"], circ["cy"]])), radius=round(circ["r"], 3),
                             rms_fit_error=round(circ["rms"], 3), median_abs_error=round(circ["median_abs"], 3),
                             max_abs_error=round(circ["max_abs"], 3), n_ridge_points=circ["n"]),
        stroke_width=round(stroke_w, 3),
        stroke_width_method="equivalent width = integral of the un-mixed stroke alpha across the stroke (median over 2-degree bins on dark background)",
        best_fit_ellipse=dict(centre=R(c05([ell["cx"], ell["cy"]])), semi_axis_x=round(ell["a"], 3), semi_axis_y=round(ell["b"], 3),
                              theta_rad=round(ell["theta_rad"], 4), rms_fit_error=round(ell["rms"], 3)),
        free_form_curve=dict(description="r(theta)=r0+sum_{k<=8} harmonics about the circle centre, fitted on the same ridge points; used for the SVG and the raster layer",
                             centre=R(c05(cxy)), rms_fit_error=round(free["rms"], 3), r_min=round(float(rc.min()), 3), r_max=round(float(rc.max()), 3)),
        colour_rgb=[int(round(v)) for v in lc])
    geo["circle"] = {"px": circ_px, "norm": norm_tree(circ_px, skip=("colour_rgb", "theta_rad", "n_ridge_points", "stroke_width_method", "description"))}
    # marks
    mk_px = {}
    for name in ["top", "bottom", "left", "right"]:
        mk_px[name] = [dict(p0=R(c05(p0)), p1=R(c05(p1)), stroke_width=round(float(w), 3),
                            kind="bar" if j == 1 else "line") for j, (p0, p1, w) in enumerate(segs[name])]
    geo["registration_marks"] = {"px": mk_px, "norm": norm_tree(mk_px, skip=("kind",))}
    # band
    band_px = dict(x0=round(band["x0"] + 0.5, 3), x1=round(band["x1"] + 0.5, 3), y0=round(band["y0"] + 0.5, 3),
                   y1=bend["all"]["y_a_below_0p1"], y1_opacity_half=bend["all"]["y_a_below_0p5"], y1_canvas_bottom=H,
                   y1_note="y1 = row where the measured band opacity (median over the band width) drops below 0.1, i.e. where the orange really ends; opacity is 0.5 at y1_opacity_half; the layer rectangle itself extends to the canvas bottom with alpha ~0; left quarter of the band stays faintly tinted until opacity_fade.left_quarter.y_a_below_0p1",
                   opacity_fade={k: v for k, v in bend.items()})
    band_nongeo = dict(
        combination_estimate="MULTIPLY with gain and opacity: out = photo_untinted * (1 - a + a*K*C), C flat orange (layer_band.png RGB), a = layer_band.png alpha (1 on the upper band, fading to 0 in the lower neck), K = gain. NOT screen, NOT flat/normal blend.",
        C_multiply_rgb_0_1=R(bm["C"], 4), gain_K=round(bm["K"], 4), gain_K_estimation=bm["K_info"],
        effective_multiplier_rgb_at_full_opacity=R(bm["Ceff"], 4),
        photo_warm_grey_ratios_G_over_R_B_over_R=R(bm["rho"][1:], 4),
        median_rgb_bright_areas=[int(v) for v in np.round(bm["q_hi"] * 255)],
        median_rgb_dark_areas=[int(round(v)) for v in cmp_models["dark_in_band_median_rgb"]],
        residual_rms_levels_fixed_opacity=cmp_models["fixed_opacity_rms"],
        residual_rms_levels_free_opacity=cmp_models["free_opacity_rms"],
        dark_count=cmp_models["dark_in_band_count"], edge_samples=list(band["edge_samples"]))
    geo["orange_band"] = {"px": band_px, "norm": norm_tree(band_px, skip=("y1_note",)), "model": band_nongeo}
    # strip
    sx0, sx1 = float(poly[:, 0].min() - 0.5 + 0.5), float(poly[:, 0].max() + 0.5)
    strip_px = dict(bbox=R([poly[:, 0].min() + 0.5, poly[:, 1].min() + 0.5, poly[:, 0].max() + 0.5, poly[:, 1].max() + 0.5]),
                    top_edge=R(tpoly + 0.5, 2), bottom_edge=R(bpoly + 0.5, 2),
                    left_end_x=round(float(poly[:, 0].min() + 0.5), 2), right_end_x=round(float(poly[:, 0].max() + 0.5), 2),
                    top_edge_observed_fraction=round(float(st["obs_top"].mean()), 3),
                    bottom_edge_observed_fraction=round(float(st["obs_bot"].mean()), 3))
    geo["torn_strip"] = {"px": strip_px, "norm": norm_tree(strip_px, skip=("top_edge_observed_fraction", "bottom_edge_observed_fraction"))}
    # wordmark
    wm_px = dict(
        bbox=R([wm_bbox[0] + .5, wm_bbox[1] + .5, wm_bbox[2] + .5, wm_bbox[3] + .5]), baseline_y=round(baseline + .5, 3),
        cap_height=round(cap_h, 3), cap_top_y=round(cap_top + .5, 3),
        baseline_method="median bottom of the flat-bottomed letters F,F,R,I,D,Z (O and G overshoot below)",
        letters=[dict(id=l["id"], bbox=R([l["bbox"][0] + .5, l["bbox"][1] + .5, l["bbox"][2] + .5, l["bbox"][3] + .5]),
                      raster_mask_bbox=R([np.nonzero(l["comp"])[1].min(), np.nonzero(l["comp"])[0].min(),
                                          np.nonzero(l["comp"])[1].max() + 1, np.nonzero(l["comp"])[0].max() + 1]),
                      has_counter=bool(any(p["hole"] for p in l["clean_paths"]))) for l in lets])
    geo["wordmark"] = {"px": wm_px, "norm": norm_tree(wm_px, skip=("baseline_method", "id", "has_counter"))}
    geo["qa_metrics"] = {"psnr": metrics, "iou": iou}
    (OUT / "geometry.json").write_text(json.dumps(geo, indent=1))
    layers["_metrics"] = metrics
    layers["_iou"] = iou
    layers["_geo"] = geo
    layers["_bend"] = bend
    notes += build_notes(geo, metrics, iou, circ, ell, free, bend, cmp_models, st, bm, band, lets)
    write_report(geo, metrics, iou, circ, ell, free, bend, cmp_models, st, notes)


def build_notes(geo, metrics, iou, circ, ell, free, bend, cmp_models, st, bm, band, lets):
    N = []
    N.append("**Circle is not a true circle.** Best true circle RMS = %.2f px (target < 1 px NOT met); an ellipse gives %.2f px and the free-form radial curve %.2f px. "
             "The raster layer and `lines.svg` follow the free-form curve, so they sit on the stroke; `geometry.json` reports all three." % (circ["rms"], ell["rms"], free["rms"]))
    N.append("**Stroke width** (%.2f px) is an equivalent width from the un-mixed alpha; the source stroke is soft, so a FWHM would be somewhat smaller." % geo["circle"]["px"]["stroke_width"])
    N.append("**Band opacity fade / y1.** The orange is not a hard-edged rectangle running to the bottom: opacity is ~1 down to the ear, then fades out over the neck. "
             "Row where the measured opacity falls below 0.5 / 0.1 (all columns): %s / %s; right quarter (x 880-944): %s / %s. "
             "The band layer rectangle still extends to the canvas bottom (y1 = 1254) but its alpha is ~0 there (mean alpha of the last 30 rows = %.2f)."
             % (f2(bend["all"]["y_a_below_0p5"]), f2(bend["all"]["y_a_below_0p1"]),
                f2(bend["right_quarter"]["y_a_below_0p5"]) if bend.get("right_quarter") else "?", f2(bend["right_quarter"]["y_a_below_0p1"]) if bend.get("right_quarter") else "?",
                bend["all"]["a_at_bottom_rows"]))
    N.append("**Band combination law** is estimated, not known. With opacity fixed to 1 on the solid band, RMS residual (8-bit levels) of the best per-pixel photo level: %s. "
             "Multiply wins clearly; screen and normal blends leave %.1fx and %.1fx more residual. Dark parts of the band stay dark (median RGB %s over %d px), which a normal or screen blend cannot do. "
             "With free per-pixel opacity all three models fit about equally (%s), so that test alone does not discriminate."
             % (", ".join("%s = %.1f" % (k, v) for k, v in cmp_models["fixed_opacity_rms"].items()),
                list(cmp_models["fixed_opacity_rms"].values())[1] / list(cmp_models["fixed_opacity_rms"].values())[0],
                list(cmp_models["fixed_opacity_rms"].values())[2] / list(cmp_models["fixed_opacity_rms"].values())[0],
                [int(round(v)) for v in cmp_models["dark_in_band_median_rgb"]], cmp_models["dark_in_band_count"],
                ", ".join("%s %.1f" % (k, v) for k, v in cmp_models["free_opacity_rms"].items())))
    N.append("**Gain K = %.2f** (IQR %s over %d row blocks) assumes the photo is continuous in luminance across the band's left edge (rows 740-930). "
             "It only sets the exposure of the un-tinted photo under the band and is the least certain number here. Recomposition does not depend on it (photo and band compensate)."
             % (bm["K"], bm["K_info"]["spread_iqr"], bm["K_info"]["n_rows"]))
    N.append("**Photo under the band** = source divided by the multiply factor per channel (R and G exact; B blended with a warm-grey estimate where the factor is tiny; dark pixels use a warm-grey estimate, so ~5-8 levels of error remain in black areas under the band). "
             "Where the opacity was mis-estimated the un-tinted photo shows a slight orange/blue cast. The opacity map is smoothed (sigma 3 px) and filled by normalised convolution in dark areas and under the strip. "
             "The band layer continues UNDER the strip with extrapolated opacity (nothing there is visible in the source).")
    N.append("**Top-right corner of the band** is clipped by the circle line in the source; the layer reproduces what the data show there, not a vector corner.")
    N.append("**Torn strip edges**: only stretches where bright photo touches the strip are observable (top edge observed on %.0f%% of columns, bottom edge %.0f%%). "
             "Elsewhere the strip is black on near-black (hair shadow, far left/right) and its true edge cannot be measured: those stretches are interpolated (gaps < 40 px) or held at the median edge (longer gaps); "
             "the left/right ends are vertical cuts 12 px beyond the letters; narrow spikes caused by dark photo areas are removed by a 31 px morphological closing/opening (this also trims genuine narrow torn tips). "
             "Photo alpha is 0 inside this silhouette, so the hidden eye area is NOT reconstructed, but the silhouette is only as good as these edges (it may hide a little dark photo, or leave a little strip black in the photo layer)."
             % (100 * st["obs_top"].mean(), 100 * st["obs_bot"].mean()))
    N.append("**Strip edge ring**: the 1-2 px edge pixels are un-mixed between strip black and the nearest photo colour, which extrapolates the photo by 1-2 px under the strip edge (the only 'invented' photo pixels; PSNR of the 3 px ring around the strip = %.1f dB)." % metrics["psnr_ring3"])
    N.append("**Strip fill under the letters** is Telea inpainting of the strip's black plus deterministic grain; no real content exists there in the source.")
    N.append("**Clean wordmark**: edge nibbles and speck holes (< 300 px2) are removed, protrusions that survive a 9x9 opening and are thicker than ~2.6 px are cut (the nub at the lower right of the Z), corners are intersections of fitted straight edges, "
             "curves are cubic Beziers with 0.7 px tolerance. It is a faithful smoothing of THIS eroded artwork, not a font reconstruction: nominally identical edges can differ by up to ~1 px.")
    N.append("**Wordmark layer**: edge pixels (1-2 px) are un-mixed against the strip black; the interior keeps the original cream texture and specks at alpha 1. Colour is the source colour, not forced to #EEDFD2.")
    N.append("**Lines layer**: alpha is un-mixed against the local background; where hair or skin is brighter than ~145 next to the stroke the contrast is too low and alpha falls back to the average stroke profile. "
             "Registration marks: top and bottom marks include a short cross bar; left and right marks are plain lines. Endpoints measured at half contrast.")
    N.append("**Background**: the source has no flat background layer; `layer_photo` carries the near-black everywhere outside the strip, and the recomposition adds #0A0A09 only where alpha is 0.")
    return N


def f2(v):
    return "n/a" if v is None else "%.0f" % v


def write_report(geo, metrics, iou, circ, ell, free, bend, cmp_models, st, notes):
    f = lambda v, n=2: "n/a" if v is None else ("%.*f" % (n, v))
    L = []
    L.append("# OFFGRIDZ logo dissection - QA report\n")
    L.append("Generated by `build/logo/dissect.py` (deterministic, ~2 min). All numbers below were produced by that run.\n")
    L.append("## Recomposition vs source\n")
    L.append("Layers are re-read from the written PNGs and stacked in this order: bg #0A0A09, `layer_photo` (alpha-over), "
             "`layer_band` (MULTIPLY with opacity), `layer_strip`, `layer_wordmark`, `layer_lines` (alpha-over).\n")
    L.append("| region | PSNR dB |\n|---|---|")
    for k, lab in [("psnr_all", "whole image"), ("psnr_outside_strip", "outside the strip silhouette (target > 35)"),
                   ("psnr_outside_strip_ex_ring3", "outside strip, excluding 3 px ring around it"),
                   ("psnr_ring3", "3 px ring around the strip silhouette only"),
                   ("psnr_inside_strip", "inside the strip silhouette (strip + letters)"),
                   ("psnr_band_region_outside_strip", "band rectangle, outside strip"),
                   ("psnr_outside_strip_and_band", "neither band nor strip")]:
        L.append("| %s | %s |" % (lab, f(metrics[k])))
    L.append("\nSSIM (grayscale, 7x7): whole %s, outside strip %s.  Max abs error outside strip: %.0f levels, 99th percentile %.1f.\n"
             % (f(metrics["ssim_all"], 4), f(metrics["ssim_outside_strip"], 4), metrics["max_abs_err_outside"], metrics["p99_abs_err_outside"]))
    L.append("## Wordmark vector vs raster (IoU)\n")
    L.append("Raster mask = connected components of mean(R,G,B) > 117 inside the letter band (eroded edges and specks included). Vector rasterised at 4x with area-averaging; the 'SVG file' column re-parses the written `wordmark_clean.svg` (2-decimal coordinates) instead of the in-memory curves.\n")
    L.append("| letter | clean vector vs raster mask | clean vs mask with specks filled | raw vector vs raster mask | clean SVG file vs raster mask |\n|---|---|---|---|---|")
    for k, v in iou.items():
        L.append("| %s | %s | %s | %s | %s |" % (k, f(v["clean_vs_raster_mask"], 4), f(v["clean_vs_specks_filled_mask"], 4), f(v["raw_vs_raster_mask"], 4), f(v.get("clean_svg_file_vs_raster_mask"), 4)))
    L.append("\nRaw SVG file vs raster mask (all letters): %s" % f(iou["ALL"]["raw_svg_file_vs_raster_mask"], 4))
    L.append("\n## Circle fit\n")
    L.append("- plain least-squares **circle**: centre (%.2f, %.2f), r = %.2f px, **RMS = %.2f px** (median |e| %.2f, max %.1f; %d ridge points). The 1 px target is NOT met by a true circle: the drawn ring is not circular."
             % (circ["cx"] + .5, circ["cy"] + .5, circ["r"], circ["rms"], circ["median_abs"], circ["max_abs"], circ["n"]))
    L.append("- best-fit **ellipse**: centre (%.2f, %.2f), semi-axes x %.2f / y %.2f px, RMS = %.2f px."
             % (ell["cx"] + .5, ell["cy"] + .5, ell["a"], ell["b"], ell["rms"]))
    L.append("- smooth free-form radial curve (8 harmonics, used for `lines.svg` and the raster layer): RMS = %.2f px." % free["rms"])
    g = geo
    L.append("\n## Measured geometry (continuous px; see geometry.json for normalised values)\n")
    b = g["orange_band"]["px"]
    L.append("- orange band: x %.2f - %.2f, y0 %.2f, canvas bottom 1254; opacity half-way at y %s (all columns), %s (right quarter x 880-944); multiply C = %s, gain K = %.2f"
             % (b["x0"], b["x1"], b["y0"], f2(b["opacity_fade"]["all"]["y_a_below_0p5"]), f2(b["opacity_fade"]["right_quarter"]["y_a_below_0p5"]),
                g["orange_band"]["model"]["C_multiply_rgb_0_1"], g["orange_band"]["model"]["gain_K"]))
    w = g["wordmark"]["px"]
    L.append("- wordmark bbox %s, baseline y %.2f, cap height %.2f" % (w["bbox"], w["baseline_y"], w["cap_height"]))
    L.append("- strip bbox %s" % g["torn_strip"]["px"]["bbox"])
    L.append("\n## Approximate / uncertain (honest list)\n")
    for n in notes:
        L.append("- " + n)
    (OUT / "qa_report.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
