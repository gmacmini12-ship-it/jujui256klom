"""Réticule final : le cercle et les repères du logo (layer_lines.png) en espace écran.

* machine à états pilotée par la partition (piste `reticule`), mouvement mécanique : points de passage
  posés sur les temps (un par temps de 12 images, atteints en 5 images puis tenus), accroche avec léger
  dépassement, secousse alternée à l'échec ; aucune ondulation continue ;
* cibles : cercle `cible` de meta.json (px fenêtre -> px feuille) quand il existe, sinon cibles par défaut ;
* dessin : la couche du logo est rééchantillonnée (pyramide + 2x de suréchantillonnage, bicubique),
  à l'identité on pose exactement la couche redimensionnée comme l'animatique le fait pour le logo ;
* axes gradués (360–455) : traits à couverture exacte, positions sous-pixel.
"""
import math
from functools import lru_cache

import cv2
import numpy as np

import fx_common as X
import fx_draw as D
from common import find, instants, smooth, ease_out_back, lerp, logo_circle

SNAP, SHAKE, RELEASE = 6, 6, 12

DEFAULT_TARGETS = [(540.0, 1040.0, 400.0, "BANDE"), (540.0, 620.0, 130.0, "FLUX"), (540.0, 1080.0, 450.0, "VERRE")]

LOCK = find("reticule", "verrouillé", "b")
UNLOCK = find("reticule", "déverrouillage")["image"]
ATT = [e for e in instants("reticule") if e["nom"].startswith("tentative")]
AXES = find("reticule", "repère d'axes", "b")
FINAL = find("reticule", "verrouillage final")["image"]
LOGO_C = logo_circle()                       # cx, cy, r du cercle du logo en px feuille


# ------------------------------------------------------------------ mouvement libre
@lru_cache(maxsize=None)
def _waypoint(b):
    rng = np.random.default_rng(7000 + b)
    cx = 540 + round(rng.uniform(-30, 30))
    cy = 960 + round(rng.uniform(-24, 24))
    r = 452 + round(rng.uniform(-8, 8))
    rot = 4.0 + round(rng.uniform(-2.5, 2.5) * 2) / 2
    return (float(cx), float(cy), float(r), float(rot))


def drift(f):
    """Dérive du réticule libre : un point de passage par temps, rejoint en 5 images (lissé) puis tenu."""
    b = f // X.AC.PER_BEAT
    u = smooth((f - b * X.AC.PER_BEAT) / 5.0)
    a, c = _waypoint(b - 1), _waypoint(b)
    return tuple(lerp(p, q, u) for p, q in zip(a, c))


# ------------------------------------------------------------------ cibles
def target_at(f, k):
    """Cercle visé (cx, cy, r) à l'image f pour la tentative k : `cible` de l'image, sinon la plus proche
    de la tentative (d'abord en arrière, puis en avant), sinon la cible par défaut."""
    s, end = ATT[k]["image"], ATT[k]["fin"]
    c = X.cible_sheet(f)
    if c is None:
        for g in range(f - 1, s - 1, -1):
            c = X.cible_sheet(g)
            if c is not None:
                break
    if c is None:
        for g in range(f + 1, end + 1):
            c = X.cible_sheet(g)
            if c is not None:
                break
    return c if c is not None else DEFAULT_TARGETS[k][:3]


def deps(f):
    """Images dont le meta (cible) peut changer le réticule de l'image f."""
    d = []
    for e in ATT:
        if e["image"] <= f < e["fin"] + RELEASE + 1:
            d += list(range(e["image"], e["fin"] + 1))
    return d


# ------------------------------------------------------------------ état
def state(f):
    """Paramètres du réticule à l'image f : cx, cy, r, rot (°), gap (°), gap_rot (°), color, axes (0..1),
    ring (opacité du cercle), identity (bool), held, phase, target (nom)."""
    L = (LOGO_C[0], LOGO_C[1], LOGO_C[2], 0.0)
    st = dict(cx=L[0], cy=L[1], r=L[2], rot=0.0, gap=0.0, gap_rot=0.0, color=X.LINES_RGB, axes=0.0, ring=1.0,
              identity=True, held=True, phase="locked", target=None)
    if f <= LOCK["fin"]:
        return st
    if f >= FINAL:
        st["phase"] = "locked-final"
        return st
    st.update(identity=False, held=False, phase="free")
    p = drift(f)
    first = ATT[0]["image"]
    if f < first:
        u = smooth((f - UNLOCK) / 12.0)
        p = tuple(lerp(a, b, u) for a, b in zip(L, p))
        st["gap"] = 38 * (1 - smooth((f - UNLOCK) / 22.0))
        st["gap_rot"] = 20.0
        st["phase"] = "unlock"
    for k, e in enumerate(ATT):
        s, end = e["image"], e["fin"]
        name = DEFAULT_TARGETS[k][3]
        if not (s <= f < end + RELEASE):
            continue
        t = f - s
        if f < s + SNAP:
            T = target_at(f, k) + (0.0,)
            start = drift(s)
            u = ease_out_back((t + 1) / SNAP)
            p = tuple(lerp(a, b, u) for a, b in zip(start, T))
            st.update(phase=f"snap:{name}", target=name)
        elif f < end:
            T = target_at(f, k) + (0.0,)
            p = T
            st.update(held=True, phase=f"hold:{name}", target=name)
            if e["issue"] == "échec" and f >= end - SHAKE:
                kk = (end - f) / SHAKE
                sgn = 1.0 if (f % 2 == 0) else -1.0
                p = (T[0] + 14 * kk * sgn, T[1], T[2], 3.5 * kk * sgn)
                st["phase"] = f"shake:{name}"
            if e["issue"] == "tenu":
                st["color"] = X.ORANGE_HI
        else:
            T = target_at(end - 1, k) + (0.0,)
            u = smooth((f - end) / float(RELEASE))
            p = tuple(lerp(x, y, u) for x, y in zip(T, drift(f)))
            p = (p[0], p[1], p[2] * (1 + 0.16 * (1 - u)), p[3])
            st["gap"] = (55 if e["issue"] == "échec" else 26) * (1 - smooth((f - end) / 26.0))
            st["gap_rot"] = 20 + 90 * (f - end) / 26.0
            st["phase"] = f"open:{name}"
            if e["issue"] == "tenu":
                st["color"] = tuple(lerp(a, b, u) for a, b in zip(X.ORANGE_HI, X.LINES_RGB))
    a0, a1 = AXES["debut"], AXES["fin"]
    if a0 <= f <= a1:
        st["axes"] = smooth((f - a0) / 8.0) * (1 - smooth((f - (a1 - 7)) / 7.0))
        st["ring"] = 1.0 - st["axes"]
        st["phase"] = "axes"
    if f >= FINAL - SNAP:
        start = drift(FINAL - SNAP)
        u = ease_out_back((f - (FINAL - SNAP)) / float(SNAP))
        p = tuple(lerp(a, b, u) for a, b in zip(start, L))
        st.update(phase="snap-final", gap=0.0, axes=0.0, ring=1.0, color=X.LINES_RGB)
    st["cx"], st["cy"], st["r"], st["rot"] = p
    return st


# ------------------------------------------------------------------ dessin
RING_W = 2.5          # px feuille : épaisseur du cercle (équivalent du tracé du logo : 3,15 px × K)
MARK_MIN_W = 1.5
SS = 4                # suréchantillonnage du masque (coordonnées en 1/16 de pixel de masque)


@lru_cache(maxsize=1)
def _vector():
    """Géométrie vectorielle du logo (assets/logo/lines.svg, issue de layer_lines.png) : polyligne du cercle
    (courbe radiale libre, légèrement elliptique comme le logo) et six repères, en px du logo 1254²."""
    import re
    s = (X.ROOT / "assets" / "logo" / "lines.svg").read_text()
    d = re.search(r'id="circle" d="([^"]+)"', s).group(1)
    tok = re.findall(r"[MCLZ]|-?\d+\.?\d*", d)
    pts, i, cur = [], 0, None
    while i < len(tok):
        t = tok[i]
        if t == "M":
            cur = np.array([float(tok[i + 1]), float(tok[i + 2])]); pts.append(cur); i += 3
        elif t == "C":
            i += 1
            while i < len(tok) and tok[i] not in "MCLZ":
                c1 = np.array([float(tok[i]), float(tok[i + 1])]); c2 = np.array([float(tok[i + 2]), float(tok[i + 3])])
                p = np.array([float(tok[i + 4]), float(tok[i + 5])])
                u = np.linspace(0, 1, 13)[1:, None]
                seg = (1 - u) ** 3 * cur + 3 * (1 - u) ** 2 * u * c1 + 3 * (1 - u) * u ** 2 * c2 + u ** 3 * p
                pts.extend(list(seg)); cur = p; i += 6
        elif t == "L":
            cur = np.array([float(tok[i + 1]), float(tok[i + 2])]); pts.append(cur); i += 3
        else:
            i += 1
    ring = np.array(pts)
    if np.allclose(ring[0], ring[-1]):
        ring = ring[:-1]
    marks = []
    for m in re.finditer(r'id="mark_[a-z]+_\d" stroke-width="([\d.]+)" d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"', s):
        w, x0, y0, x1, y1 = map(float, m.groups())
        marks.append((np.array([x0, y0]), np.array([x1, y1]), max(w * X.K, MARK_MIN_W)))
    return ring, marks


def _affine(st):
    """Transformation logo-1254 px -> px feuille : (matrice 2×2, translation)."""
    s = st["r"] / LOGO_C[2]
    th = math.radians(st["rot"])
    c, sn = math.cos(th), math.sin(th)
    Rm = np.array([[c, -sn], [sn, c]]) * s
    P0 = np.array([X.LOGO_X, X.LOGO_Y], float)
    cc = np.array([LOGO_C[0], LOGO_C[1]], float)
    # P_sheet = LOGO + K*p ; P' = ctr + Rm (P_sheet - cc)
    A = Rm * X.K
    t = np.array([st["cx"], st["cy"]]) + Rm @ (P0 - cc)
    return A, t


def _fill(mask, polys, val):
    for p in polys:
        cv2.fillPoly(mask, [np.round(p * (16 * SS)).astype(np.int32)], val, cv2.LINE_8, shift=4)


def _alpha_layer(st):
    """(opacité (h,w), x0, y0) du réticule vectoriel : cercle d'épaisseur constante (avec trou éventuel) et repères."""
    ring, marks = _vector()
    A, t = _affine(st)
    cx, cy, r = st["cx"], st["cy"], st["r"]
    s = r / LOGO_C[2]
    half = s * (LOGO_C[2] + 16) + 6
    ix0, iy0 = int(math.floor(cx - half)), int(math.floor(cy - half))
    ix1, iy1 = int(math.ceil(cx + half)), int(math.ceil(cy + half))
    w, h = ix1 - ix0, iy1 - iy0
    off = np.array([ix0, iy0], float)
    P = (ring @ A.T + t - off)
    d = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    n = np.stack([-d[:, 1], d[:, 0]], 1)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    outer, inner = P + n * RING_W / 2, P - n * RING_W / 2
    ctr = np.array([cx, cy]) - off
    if np.linalg.norm(outer - ctr, axis=1).mean() < np.linalg.norm(inner - ctr, axis=1).mean():
        outer, inner = inner, outer
    mring = np.zeros((h * SS, w * SS), np.uint8)
    _fill(mring, [outer], 255)
    _fill(mring, [inner], 0)
    mmarks = np.zeros_like(mring)
    for p0, p1, wm in marks:
        q0, q1 = p0 @ A.T + t - off, p1 @ A.T + t - off
        dv = q1 - q0
        nv = np.array([-dv[1], dv[0]]) / max(np.linalg.norm(dv), 1e-9) * wm / 2
        _fill(mmarks, [np.array([q0 + nv, q1 + nv, q1 - nv, q0 - nv])], 255)
    a_ring = cv2.resize(mring, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    a_marks = cv2.resize(mmarks, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    if st["gap"] > 0.5:
        yy, xx = np.mgrid[iy0:iy1, ix0:ix1].astype(np.float32)
        dx, dy = xx + 0.5 - cx, yy + 0.5 - cy
        rho = np.hypot(dx, dy)
        ang = np.degrees(np.arctan2(dy, dx))
        g0 = st["gap_rot"] + st["rot"]
        dd = np.abs((ang - g0 + 180.0) % 360.0 - 180.0)
        gapamt = np.clip((st["gap"] / 2 - dd) * (np.pi / 180.0) * rho + 0.5, 0, 1)
        a_ring = a_ring * (1.0 - gapamt)
    a = 1.0 - (1.0 - a_ring) * (1.0 - a_marks)
    return a * st["ring"], ix0, iy0


def draw(S, st):
    """Pose le réticule sur la feuille S (float 0..65535). À l'identité : couche du logo redimensionnée."""
    if st["identity"]:
        lay = X.AC.logo_layers()["lines"] * 65535.0            # prémultiplié (LOGO_S², 4 canaux)
        roi = S[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S]
        roi[:] = lay[..., :3] + roi * (1.0 - lay[..., 3:4] / 65535.0)
        return
    if st["ring"] > 0.003:
        a, ix0, iy0 = _alpha_layer(st)
        D.paint(S, a.astype(np.float32), ix0, iy0, st["color"], 1.0)
    if st["axes"] > 0.003:
        draw_axes(S, st["cx"], st["cy"], st["axes"])


def draw_axes(S, cx, cy, amount, color=X.LINES_RGB):
    """Deux axes gradués sur toute la feuille : filet de 1 px, graduation fine tous les 27 px (±3), moyenne
    tous les 135 px (±7), croix franche au centre. Couverture exacte, positions sous-pixel."""
    op = 0.78 * amount
    W_, H_ = X.W, X.H
    for horizontal in (True, False):
        c = cy if horizontal else cx
        o = cx if horizontal else cy
        n = W_ if horizontal else H_
        half = 12
        i0 = int(math.floor(c)) - half
        cov = np.zeros((2 * half + 2, n), np.float32)           # (épaisseur, longueur) dans le repère de l'axe
        rows = np.arange(i0, i0 + cov.shape[0], dtype=np.float32)
        prof = lambda lo, hi: np.clip(np.minimum(hi, rows + 1) - np.maximum(lo, rows), 0, 1)[:, None]
        line_prof = prof(c - 0.5, c + 0.5)
        cov = np.maximum(cov, line_prof * 0.55)                 # filet continu, plus discret que les repères
        for k in range(-int(o // 27) - 1, int((n - o) // 27) + 2):
            pos = o + k * 27.0
            if pos < -1 or pos > n + 1:
                continue
            ln = 7.0 if k % 5 == 0 else 3.0
            if k == 0:
                ln = 11.0
            xs = np.arange(max(int(pos) - 1, 0), min(int(pos) + 2, n))
            cx_ = np.clip(np.minimum(pos + 0.5, xs + 1) - np.maximum(pos - 0.5, xs), 0, 1)[None, :]
            tick = prof(c - ln, c + ln) * cx_
            cov[:, xs] = np.maximum(cov[:, xs], tick)
        if horizontal:
            D.paint(S, cov, 0, i0, color, op)
        else:
            D.paint(S, np.ascontiguousarray(cov.T), i0, 0, color, op)
