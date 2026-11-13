"""Préparation déterministe de la séquence 4 : champ initial, cibles du mot (points sur les pastilles de Doto),
cibles du bas-relief (échantillonnées sur layer_photo.png), couleurs, et appariement point -> cible
(bissection récursive : approximation peu coûteuse du transport optimal, trajets courts et sans croisement
grossier).  Résultat mis en cache dans out/seq4/cache/.
"""
import os, sys, time, hashlib
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

sys.path.insert(0, ROOT + "/build/type")
import typekit as tk

SEED = 20260412
PER_DOT_FULL = 4096          # points par pastille du mot à 6 M de points


def log(*a):
    print("[targets]", *a, flush=True)


# ------------------------------------------------------------------ mot : pastilles de Doto
def word_dots():
    """Pastilles du mot : centres (24, 121, 2) et rayons (24,) pour les 24 graisses des images 384..407
    (monde, y haut, mot centré, 820 px de large d'encre à chaque graisse).  Mesurés sur les contours réels
    de Doto (ROND=100 : pastilles rondes) : centre = moyenne du contour aplati, rayon = sqrt(aire/pi)."""
    cens, rtab = [], []
    prev = None
    for i in range(24):
        w = wght_at(WORD_F0 + i)
        g = tk.fit_width(tk.outlines("OFFGRIDZ", "doto-var", wght=w, ROND=100), 820.0)
        x0, y0, x1, y1 = tk.bounds(g)
        g = tk.transform(g, 1.0, 1.0, -410.0, -(y0 + y1) / 2)
        P = [tk._flatten_contour(c, 0.02) for gg in g for c in gg["contours"]]
        c = np.array([p.mean(0) for p in P])
        ar = np.array([abs(tk._area(p)) for p in P])
        if prev is not None:
            assert np.abs(c - prev).max() < 4.0, "ordre des contours incohérent entre graisses"
        prev = c
        cens.append(c); rtab.append(np.sqrt(ar / np.pi).mean())
    return np.array(cens, np.float32), np.array(rtab, np.float32)


# ------------------------------------------------------------------ appariement par bissection
def bisect_match(src, tgt, leaf=32):
    """src, tgt : (n,3).  Renvoie t (n,) : t[i] = indice de la cible attribuée à la source i."""
    n = len(src)
    assert len(tgt) == n
    def norm(a):
        lo, hi = a.min(0), a.max(0)
        return ((a - lo) / np.maximum(hi - lo, 1e-6) * 0.999).astype(np.float64)
    S, T = norm(src), norm(tgt)
    si, ti = np.arange(n), np.arange(n)
    lens = np.array([n], np.int64)
    lvl = 0
    while lens.max() > leaf:
        ax = lvl % 3
        seg = np.repeat(np.arange(len(lens), dtype=np.float64), lens)
        for idx, C in ((si, S), (ti, T)):
            o = np.argsort(seg * 2.0 + C[idx, ax], kind="stable")
            idx[:] = idx[o]
        half = (lens + 1) // 2
        nl = np.empty(2 * len(lens), np.int64); nl[0::2] = half; nl[1::2] = lens - half
        lens = nl[nl > 0]
        lvl += 1
    out = np.empty(n, np.int64)
    out[si] = ti
    return out


# ------------------------------------------------------------------ champ initial (cône de vue)
def field_positions(n, rng):
    """Positions de repos du champ : uniformes en écran (x,y) dans chaque tranche de profondeur, profondeur
    Zc in [700, 5500] avec p ~ Zc^-0.5, densité modulée par un bruit basse fréquence (filaments, nuages)."""
    from scipy.ndimage import gaussian_filter, map_coordinates
    g = rng.standard_normal((20, 26, 26))
    nz = gaussian_filter(g, 2.2, mode="wrap") + 0.5 * gaussian_filter(rng.standard_normal((20, 26, 26)), 1.0, mode="wrap")
    nz = (nz - nz.min()) / (nz.max() - nz.min())
    rho = 0.07 + 0.93 * np.clip((nz - 0.25) / 0.6, 0, 1) ** 1.5
    pmean = rho.mean()
    out = np.empty((n, 3), np.float32)
    got = 0
    a, b = np.sqrt(1000.0), np.sqrt(5500.0)
    chunk = int(min(4_000_000, max(200_000, n * 2)))
    while got < n:
        u = rng.random((chunk, 3), dtype=np.float32)
        ang = u[:, 0] * 2 * np.pi; rad = 1050.0 * np.sqrt(u[:, 1])      # disque écran de 1050 px de rayon (jaillissement circulaire)
        sx, sy = rad * np.cos(ang), rad * np.sin(ang)
        gi = np.clip((sx / 2100.0 + 0.5) * 25, 0, 25); gj = np.clip((sy / 2100.0 + 0.5) * 25, 0, 25)
        acc = map_coordinates(rho, [u[:, 2] * 19, gi, gj], order=1, mode="wrap")
        keep = rng.random(chunk) < acc
        m = min(int(keep.sum()), n - got)
        idx = np.nonzero(keep)[0][:m]
        zc = (a + u[idx, 2] * (b - a)) ** 2
        out[got:got + m, 0] = sx[idx] * zc / FOCAL
        out[got:got + m, 1] = sy[idx] * zc / FOCAL
        out[got:got + m, 2] = D - zc
        got += m
    return out


# ------------------------------------------------------------------ relief
def load_logo():
    ph = np.array(Image.open(ROOT + "/assets/logo/layer_photo.png").convert("RGBA"))
    bd = np.array(Image.open(ROOT + "/assets/logo/layer_band.png").convert("RGBA"))
    return ph, bd


def relief_samples(nr, rng):
    ph, bd = load_logo()
    alpha = ph[..., 3] > 0
    strip = (ph[..., 3] == 0).astype(np.uint8)
    dstrip = cv2.distanceTransform(1 - strip, cv2.DIST_L2, 5)
    ok = alpha & (dstrip >= 3.0)          # marge de 3 px du calque autour de la zone vide : rien n'est jamais posé contre le bord
    lum = (0.299 * ph[..., 0] + 0.587 * ph[..., 1] + 0.114 * ph[..., 2]) / 255.0
    lum = lum * alpha
    wgt = ok * (np.clip((lum - 0.10) / 0.90, 0, 1) ** 1.3)
    cdf = np.cumsum(wgt.ravel().astype(np.float64)); cdf /= cdf[-1]
    idx = np.searchsorted(cdf, rng.random(nr))
    idx = np.minimum(idx, cdf.size - 1)
    v = (idx // LOGO_PX).astype(np.float32) + rng.random(nr, dtype=np.float32)   # continus, dans le pixel
    u = (idx % LOGO_PX).astype(np.float32) + rng.random(nr, dtype=np.float32)
    # hauteur : luminance lissée normalisée + dôme léger
    lb = cv2.GaussianBlur((lum * alpha).astype(np.float32), (0, 0), 10)
    lo, hi = np.percentile(lb[alpha], [2, 99])
    hgt = np.clip((lb - lo) / (hi - lo), 0, 1)
    uu = (np.arange(LOGO_PX) + 0.5)[None, :]; vv = (np.arange(LOGO_PX) + 0.5)[:, None]
    dome = np.exp(-(((uu - 627) ** 2 + (vv - 600) ** 2) / (2 * 330.0 ** 2)))
    zmap = (ZH * 0.8 * (2 * hgt - 1) + ZH * 0.4 * dome).astype(np.float32)
    iy = np.minimum(v.astype(np.int64), LOGO_PX - 1); ix = np.minimum(u.astype(np.int64), LOGO_PX - 1)
    z = zmap[iy, ix]
    k = LOGO / LOGO_PX
    Xl = (u - LOGO_PX / 2) * k
    Yl = -(v - LOGO_PX / 2) * k
    comp = 1.0 - z / D                     # vu de face, le point retombe exactement sur sa place dans le logo
    tgt = np.stack([Xl * comp, Yl * comp, z], 1).astype(np.float32)
    band = bd[..., 3].astype(np.float32) / 255.0
    pb = band[iy, ix]
    orange = rng.random(nr) < pb
    return tgt, orange, (u, v), alpha


def strip_sdf():
    """Distance signée (px du calque) à la zone vide (alpha=0) : négative dedans.  Grille 627x627 (pas de 2 px)."""
    ph, _ = load_logo()
    strip = (ph[..., 3] == 0).astype(np.uint8)
    dist_to_strip = cv2.distanceTransform(1 - strip, cv2.DIST_L2, 5)   # distance à la zone vide (pour pixels pleins)
    dist_inside = cv2.distanceTransform(strip, cv2.DIST_L2, 5)         # distance au bord (pour pixels vides)
    sdf = np.where(strip > 0, -dist_inside, dist_to_strip).astype(np.float32)
    sdf = cv2.GaussianBlur(sdf, (0, 0), 2.0)
    gy, gx = np.gradient(sdf)
    sm = lambda a: cv2.resize(a, (627, 627), interpolation=cv2.INTER_AREA)
    return sm(sdf), sm(gx), sm(gy), strip


# ------------------------------------------------------------------ assemblage
def build(n_points=6_000_000, force=False):
    os.makedirs(CACHE, exist_ok=True)
    path = f"{CACHE}/targets_{n_points}.npz"
    if os.path.exists(path) and not force:
        log("cache", path)
        return dict(np.load(path))
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    N = int(n_points)
    nr = int(round(N * 0.9))
    cen, rtab = word_dots()
    nd = cen.shape[1]
    per_dot = max(16, int(round(PER_DOT_FULL * N / 6_000_000)))
    nw = nd * per_dot
    log(f"N={N} relief-bound={nr} word points={nw} ({nd} dots x {per_dot})")

    P0 = field_positions(N, rng)
    log("field", f"{time.time()-t0:.1f}s")
    tgt_r, orange_t, (ru, rv), alpha = relief_samples(nr, rng)
    po = orange_t.mean()
    log(f"relief samples, orange fraction {po:.3f}")

    # classes des points : N_ro orange parmi les points liés au relief + ambiants orange à la même proportion
    perm = rng.permutation(N)
    relief_ids = perm[:nr]; amb_ids = perm[nr:]
    n_ro = int(orange_t.sum())
    orange = np.zeros(N, bool)
    orange[relief_ids[rng.permutation(nr)[:n_ro]]] = True
    orange[amb_ids[rng.random(len(amb_ids)) < po]] = True
    is_relief = np.zeros(N, bool); is_relief[relief_ids] = True

    # points du mot : crème, les plus proches du mot (rectangle écran, profondeur pondérée)
    cream_ids = np.nonzero(~orange)[0]
    dxr = np.maximum(np.abs(P0[cream_ids, 0]) - 410.0, 0)
    dyr = np.maximum(np.abs(P0[cream_ids, 1]) - 60.0, 0)
    metric = dxr ** 2 + dyr ** 2 + (0.5 * P0[cream_ids, 2]) ** 2
    word_ids = cream_ids[np.argpartition(metric, nw)[:nw]]
    word_ids = np.sort(word_ids)

    # cibles du mot : pastilles x per_dot, disque uniforme dans la pastille
    R900 = rtab[-1]; cen9 = cen[-1]
    dot_of = np.repeat(np.arange(nd), per_dot)
    ang = rng.random(nw) * 2 * np.pi; rad = np.sqrt(rng.random(nw))
    uv = np.stack([rad * np.cos(ang), rad * np.sin(ang)], 1).astype(np.float32)
    wz = ((rng.random(nw) - 0.5) * 3.0).astype(np.float32)
    wpos = np.concatenate([cen9[dot_of] + R900 * uv, wz[:, None]], 1).astype(np.float32)
    m_w = bisect_match(P0[word_ids], wpos)           # source j -> échantillon m_w[j]
    wdot = np.full(N, -1, np.int32); wuv = np.zeros((N, 2), np.float32)
    wdot[word_ids] = dot_of[m_w]
    wuv[word_ids] = uv[m_w]
    log("word matched", f"{time.time()-t0:.1f}s")

    # sources proxies à 408 : mot -> position sur le mot ; autres -> champ
    proxy = P0.copy()
    proxy[word_ids] = wpos[m_w]
    trel = np.zeros((N, 3), np.float32)
    for cls in (False, True):
        s_ids = relief_ids[orange[relief_ids] == cls]
        t_ids = np.nonzero(orange_t == cls)[0]
        assert len(s_ids) == len(t_ids), (len(s_ids), len(t_ids))
        m = bisect_match(proxy[s_ids], tgt_r[t_ids])
        trel[s_ids] = tgt_r[t_ids[m]]
        log("relief matched class", int(cls), len(s_ids), f"{time.time()-t0:.1f}s")

    # couleurs (linéaires) * intensité
    cream, org, orh = hex_lin("#EEDFD2"), hex_lin("#EA470F"), hex_lin("#F65726")
    i0 = (0.6 * np.exp(0.5 * rng.standard_normal(N))).astype(np.float32)
    i0 = np.minimum(i0, 3.0)
    hi = rng.random(N) < 0.22
    col = np.where(orange[:, None], np.where(hi[:, None], orh[None], org[None]), cream[None]).astype(np.float32)
    
    kind = (orange.astype(np.int32) | (is_relief.astype(np.int32) << 1) | ((wdot >= 0).astype(np.int32) << 2))
    res = dict(i0=i0, P0=P0, trel=trel, wdot=wdot, wuv=wuv, col=col, kind=kind.astype(np.int32),
               dots=cen, rtab=rtab, n_points=np.array(N), per_dot=np.array(per_dot))
    np.savez(path, **res)
    log(f"done {time.time()-t0:.1f}s  orange={int(orange.sum())} cream={int((~orange).sum())} "
        f"word={nw} relief={nr} ambient={N-nr}")
    return res


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6_000_000
    build(n, force=True)
