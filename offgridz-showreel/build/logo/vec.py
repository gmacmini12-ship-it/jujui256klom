"""Vector helpers for the OFFGRIDZ logo dissection.

Corner-preserving closed-contour -> cubic Bezier fitting (Schneider-style),
polyline helpers, and SVG path writers.  Pure numpy, deterministic.
All coordinates are floats in whatever space the caller uses.
"""
import numpy as np


# ----------------------------------------------------------------- polylines
def resample_closed(pts, step=1.0):
    pts = np.asarray(pts, float)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    q = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(q, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    n = max(int(round(L / step)), 8)
    t = np.linspace(0, L, n, endpoint=False)
    x = np.interp(t, s, q[:, 0])
    y = np.interp(t, s, q[:, 1])
    return np.c_[x, y]


def signed_area(p):
    """Shoelace sum/2.  With image coordinates (y down) a POSITIVE value means
    clockwise as seen on screen."""
    p = np.asarray(p, float)
    x, y = p[:, 0], p[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _dp(pts, eps):
    """Douglas-Peucker on an open polyline; returns kept indices."""
    n = len(pts)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p0, p1 = pts[a], pts[b]
        d = p1 - p0
        L = np.hypot(*d)
        seg = pts[a + 1:b]
        if L < 1e-9:
            dist = np.hypot(*(seg - p0).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p0[1]) - d[1] * (seg[:, 0] - p0[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > eps:
            m = a + 1 + k
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return np.nonzero(keep)[0]


def fit_line_tls(p):
    c = p.mean(0)
    u, s, vt = np.linalg.svd(p - c, full_matrices=False)
    return c, vt[0]  # point, unit direction


def robust_line(p, iters=4, k=1.8):
    c, d = fit_line_tls(p)
    for _ in range(iters):
        r = np.abs((p[:, 0] - c[0]) * d[1] - (p[:, 1] - c[1]) * d[0])
        s = max(np.median(r) * 1.4826, 0.15)
        m = r < k * s + 0.2
        if m.sum() < 4:
            break
        c, d = fit_line_tls(p[m])
    return c, d


def intersect(c1, d1, c2, d2):
    A = np.array([d1, -d2]).T
    if abs(np.linalg.det(A)) < 1e-6:
        return None
    t = np.linalg.solve(A, c2 - c1)
    return c1 + t[0] * d1


# ------------------------------------------------------------ Bezier basics
def bez(c, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return mt ** 3 * c[0] + 3 * mt ** 2 * t * c[1] + 3 * mt * t ** 2 * c[2] + t ** 3 * c[3]


def bez_d1(c, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return 3 * mt ** 2 * (c[1] - c[0]) + 6 * mt * t * (c[2] - c[1]) + 3 * t ** 2 * (c[3] - c[2])


def bez_d2(c, t):
    t = np.asarray(t)[:, None]
    return 6 * (1 - t) * (c[2] - 2 * c[1] + c[0]) + 6 * t * (c[3] - 2 * c[2] + c[1])


def _chord_param(p):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
    return d / d[-1]


def _gen_bez(p, u, t1, t2):
    p0, p3 = p[0], p[-1]
    b0 = (1 - u) ** 3
    b1 = 3 * u * (1 - u) ** 2
    b2 = 3 * u ** 2 * (1 - u)
    b3 = u ** 3
    A1 = t1[None, :] * b1[:, None]
    A2 = t2[None, :] * b2[:, None]
    C = np.array([[np.sum(A1 * A1), np.sum(A1 * A2)], [np.sum(A1 * A2), np.sum(A2 * A2)]])
    tmp = p - (p0[None, :] * (b0 + b1)[:, None] + p3[None, :] * (b2 + b3)[:, None])
    X = np.array([np.sum(A1 * tmp), np.sum(A2 * tmp)])
    det = C[0, 0] * C[1, 1] - C[0, 1] * C[1, 0]
    seg = np.hypot(*(p3 - p0))
    if abs(det) > 1e-12:
        a1 = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det
        a2 = (C[0, 0] * X[1] - C[1, 0] * X[0]) / det
    else:
        a1 = a2 = 0.0
    eps = 1e-6 * seg
    if a1 < eps or a2 < eps:
        a1 = a2 = seg / 3.0
    return np.array([p0, p0 + t1 * a1, p3 + t2 * a2, p3])


def _reparam(c, p, u):
    for _ in range(4):
        q = bez(c, u) - p
        d1 = bez_d1(c, u)
        d2 = bez_d2(c, u)
        num = np.sum(q * d1, axis=1)
        den = np.sum(d1 * d1, axis=1) + np.sum(q * d2, axis=1)
        den = np.where(np.abs(den) < 1e-12, 1e-12, den)
        u = np.clip(u - num / den, 0, 1)
    return u


def _max_err(c, p, u):
    d = np.hypot(*(bez(c, u) - p).T)
    k = int(np.argmax(d))
    return d[k], k


def fit_cubic(p, t1, t2, tol, depth=0):
    """Fit open point run p with cubic Beziers; t1/t2 are unit tangents pointing
    INTO the curve at the start and end (t2 points backwards from the end)."""
    n = len(p)
    if n == 2:
        d = np.hypot(*(p[1] - p[0])) / 3.0
        return [np.array([p[0], p[0] + t1 * d, p[1] + t2 * d, p[1]])]
    u = _chord_param(p)
    c = _gen_bez(p, u, t1, t2)
    err, k = _max_err(c, p, u)
    if err < tol:
        return [c]
    if err < tol * 4:
        for _ in range(6):
            u = _reparam(c, p, u)
            c = _gen_bez(p, u, t1, t2)
            err, k = _max_err(c, p, u)
            if err < tol:
                return [c]
    if depth > 14 or n < 6:
        return [c]
    k = min(max(k, 2), n - 3)
    tc = p[k - 2] - p[k + 2]
    tc = tc / (np.hypot(*tc) + 1e-12)
    return fit_cubic(p[:k + 1], t1, tc, tol, depth + 1) + fit_cubic(p[k:], -tc, t2, tol, depth + 1)


def line_as_cubic(a, b):
    return np.array([a, a + (b - a) / 3, a + 2 * (b - a) / 3, b])


# ---------------------------------------------------- closed contour fitting
def _tangent(pts, i, sign, lo=2, hi=9):
    """unit tangent leaving index i in direction sign (+1 forward / -1 back)"""
    n = len(pts)
    idx = [(i + sign * k) % n for k in range(lo, hi + 1)]
    q = pts[idx] - pts[i]
    # direction by robust mean of chords
    d = q.mean(0)
    return d / (np.hypot(*d) + 1e-12)


def fit_closed(pts, dp_eps=1.0, corner_deg=35.0, bez_tol=0.8, line_tol=0.8,
               min_edge=6.0, step=0.8, refine_corners=True, tan_lo=2, tan_hi=9, far_check=True):
    """pts: closed dense polyline (any orientation).  Returns list of cubic
    Bezier arrays (4x2) forming a closed path, and the list of corner points."""
    P = resample_closed(pts, step)
    n = len(P)
    # DP starting from the rightmost point
    i0 = int(np.argmax(P[:, 0]))
    Q = np.vstack([P[i0:], P[:i0], P[i0:i0 + 1]])
    kept = _dp(Q, dp_eps)
    verts = [(i0 + k) % n for k in kept[:-1]]
    # corner test: turning angle between tangents estimated on dense points
    corners = []
    for i in verts:
        tb = _tangent(P, i, -1, tan_lo, tan_hi)   # towards previous
        tf = _tangent(P, i, +1, tan_lo, tan_hi)   # towards next
        # incoming direction = -tb, outgoing = tf
        cosang = np.clip(np.dot(-tb, tf), -1, 1)
        ang = np.degrees(np.arccos(cosang))
        if ang > corner_deg:
            # a real corner survives at a larger scale; a nibble does not
            tbf = _tangent(P, i, -1, 6, 17)
            tff = _tangent(P, i, +1, 6, 17)
            ang_far = np.degrees(np.arccos(np.clip(np.dot(-tbf, tff), -1, 1)))
            if ang_far > 0.7 * corner_deg or not far_check:
                corners.append(i)
    # merge corners closer than min_edge (nibbles): keep the sharper one
    if len(corners) > 1:
        def sharp(i):
            tb = _tangent(P, i, -1, tan_lo, tan_hi)
            tf = _tangent(P, i, +1, tan_lo, tan_hi)
            return np.degrees(np.arccos(np.clip(np.dot(-tb, tf), -1, 1)))
        changed = True
        while changed and len(corners) > 1:
            changed = False
            corners.sort()
            for a in range(len(corners)):
                i, j = corners[a], corners[(a + 1) % len(corners)]
                dist = (j - i) % n * step
                if dist < min_edge:
                    drop = i if sharp(i) < sharp(j) else j
                    corners.remove(drop)
                    changed = True
                    break
    corners.sort()
    curves = []
    if len(corners) == 0:
        # smooth closed loop: split at 4 evenly spaced points with shared tangents
        cuts = [int(k * n / 4) for k in range(4)]
        tans = []
        for c in cuts:
            d = P[(c + 3) % n] - P[(c - 3) % n]
            tans.append(d / (np.hypot(*d) + 1e-12))
        for a in range(4):
            i, j = cuts[a], cuts[(a + 1) % 4]
            idx = [(i + k) % n for k in range(((j - i) % n) + 1)]
            curves += fit_cubic(P[idx], tans[a], -tans[(a + 1) % 4], bez_tol)
        return curves, []
    pieces = []
    for a in range(len(corners)):
        i, j = corners[a], corners[(a + 1) % len(corners)]
        cnt = ((j - i) % n) if len(corners) > 1 else n
        idx = [(i + k) % n for k in range(cnt + 1)]
        pieces.append(P[idx])
    # classify pieces, fit lines
    info = []
    for p in pieces:
        c, d = fit_line_tls(p)
        r = np.abs((p[:, 0] - c[0]) * d[1] - (p[:, 1] - c[1]) * d[0])
        L = np.hypot(*(p[-1] - p[0]))
        is_line = r.max() <= line_tol and L > min_edge
        if is_line and len(p) > 12:
            c, d = robust_line(p)
        info.append((is_line, c, d))
    # corner refinement by line intersection
    cpts = [P[c].copy() for c in corners]
    if refine_corners:
        m = len(pieces)
        for a in range(m):
            prev, nxt = info[(a - 1) % m], info[a]
            if prev[0] and nxt[0] and len(pieces[a]) > 14 and len(pieces[(a - 1) % m]) > 14:
                x = intersect(prev[1], prev[2], nxt[1], nxt[2])
                if x is not None and np.hypot(*(x - cpts[a])) < 4.0:
                    cpts[a] = x
    m = len(pieces)
    for a in range(m):
        p = pieces[a].copy()
        p[0] = cpts[a]
        p[-1] = cpts[(a + 1) % m]
        if info[a][0]:
            curves.append(line_as_cubic(p[0], p[-1]))
        else:
            t1 = _tangent_piece(p, True, tan_lo, tan_hi)
            t2 = _tangent_piece(p, False, tan_lo, tan_hi)
            curves += fit_cubic(p, t1, t2, bez_tol)
    return curves, cpts


def _tangent_piece(p, start, lo, hi):
    n = len(p)
    hi = min(hi, n - 1)
    lo = min(lo, hi)
    if start:
        d = p[lo:hi + 1].mean(0) - p[0]
    else:
        d = p[n - 1 - hi:n - lo].mean(0) - p[-1]
    return d / (np.hypot(*d) + 1e-12)


# ------------------------------------------------------------------- output
def sample_curves(curves, per=24):
    out = []
    t = np.linspace(0, 1, per, endpoint=False)
    for c in curves:
        out.append(bez(c, t))
    return np.vstack(out)


def path_d(curves, nd=2, off=(0.0, 0.0)):
    o = np.asarray(off)
    f = lambda v: ("%.*f" % (nd, v)).rstrip("0").rstrip(".") if nd else "%d" % round(v)
    s = "M%s %s" % (f(curves[0][0][0] + o[0]), f(curves[0][0][1] + o[1]))
    for c in curves:
        q = c[1:] + o
        s += "C%s %s %s %s %s %s" % (f(q[0][0]), f(q[0][1]), f(q[1][0]), f(q[1][1]), f(q[2][0]), f(q[2][1]))
    return s + "Z"


def polyline_d(pts, nd=2, close=False):
    f = lambda v: ("%.*f" % (nd, v)).rstrip("0").rstrip(".")
    s = "M" + "L".join("%s %s" % (f(x), f(y)) for x, y in pts)
    return s + ("Z" if close else "")
