#!/opt/og/venv/bin/python
"""Séquence 1 (images 0-71) : préparation des données du rendu Blender.

Tourne avec le Python de production (numpy, cv2, shapely, mapbox_earcut, fontTools, skimage) et écrit tout
dans cache/seq01/ ; le script de scène (Blender) ne lit que ce cache.

  /opt/og/venv/bin/python build/seq01/prep.py

Monde : unités = pixels de fenêtre dans le plan z = 0 vu de face (x droite, y haut, z vers la caméra).
Le centre de la fenêtre (504, 756) est l'origine ; le logo (1008x1008) occupe y = -504 ... +504.
Sorties : textures pleine fenêtre 1008x1512 (PNG 16 bits), géométrie (geo.npz), référence à plat (ref_flat.png).
"""
import json, math, os, sys
import numpy as np
import cv2
from shapely.geometry import Polygon, MultiPolygon, LineString
from shapely.ops import unary_union
from shapely.geometry.polygon import orient
import mapbox_earcut as earcut
from skimage import measure

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "build", "type"))
import typekit as tk  # noqa: E402

CACHE = os.path.join(ROOT, "cache", "seq01")
LOGO = os.path.join(ROOT, "assets", "logo")
WW, WH = 1008, 1512
LS = 1008                     # logo en fenêtre
SRC = 1254
K = LS / SRC
LOGO_Y0 = 252                 # ligne fenêtre du haut du logo
BG = np.array([10, 10, 9], np.float32) / 255.0
GEO = json.load(open(os.path.join(LOGO, "geometry.json")))
SHEET_T = 22.0                # épaisseur de la feuille noire
ROLL = ["archivo-var", "anton", "permanent-marker", "saira-stencil-one", "doto-var",
        "major-mono-display", "instrument-serif-italic", "bodoni-moda-var"]


def to_w(X, Y):
    """px source (1254, y bas) -> monde."""
    return np.asarray(X) * K - 504.0, 504.0 - np.asarray(Y) * K


def save16(path, a):
    a = np.clip(a, 0, 1)
    cv2.imwrite(path, (a * 65535 + 0.5).astype(np.uint16))


# ------------------------------------------------------------------ couches
def layer(name):
    """Couche RGBA prémultipliée (float), 1008x1008, Lanczos."""
    im = cv2.imread(os.path.join(LOGO, f"layer_{name}.png"), cv2.IMREAD_UNCHANGED).astype(np.float32) / 255.0
    rgb = im[..., 2::-1].copy()
    a = im[..., 3:4]
    pm = np.concatenate([rgb * a, a], 2)
    out = cv2.resize(pm, (LS, LS), interpolation=cv2.INTER_LANCZOS4)
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    out[..., :3] = np.clip(out[..., :3], 0, out[..., 3:4])
    return out


def band_const():
    m = GEO["orange_band"]["model"]
    return np.array(m["C_multiply_rgb_0_1"], np.float32), float(m["gain_K"])


def band_factor(a):
    C, Kg = band_const()
    return 1 - a[..., None] + a[..., None] * Kg * C


def over(base, lay):
    return lay[..., :3] + base * (1 - lay[..., 3:4])


def window(img_logo, fill):
    out = np.empty((WH, WW, img_logo.shape[2]), np.float32)
    out[:] = fill
    out[LOGO_Y0:LOGO_Y0 + LS] = img_logo
    return out


def make_textures():
    L = {n: layer(n) for n in ("photo", "band", "strip", "wordmark")}
    bgb = np.broadcast_to(BG, (LS, LS, 3)).copy()
    ph = over(bgb, L["photo"])                                   # photo non teintée sur noir
    base = np.clip(ph * band_factor(L["band"][..., 3]), 0, 1)    # photo teintée par la bande (multiply)
    ref = over(over(base, L["strip"]), L["wordmark"])            # recomposition à plat, sans traits
    save16(os.path.join(CACHE, "tex_base.png"), window(base, BG)[..., ::-1])
    save16(os.path.join(CACHE, "tex_photo.png"), window(ph, BG)[..., ::-1])
    save16(os.path.join(CACHE, "ref_flat.png"), window(ref, BG)[..., ::-1])
    for n in ("strip", "wordmark"):
        pm = L[n]
        a = pm[..., 3:4]
        st = np.where(a > 1e-4, pm[..., :3] / np.maximum(a, 1e-4), 0)
        rgba = np.concatenate([st[..., ::-1], a], 2)
        win = window(rgba, 0.0)
        save16(os.path.join(CACHE, f"tex_{n}.png"), win)
    # bord supérieur de la bande déchirée (lueur des images 6-11) : bande de 4 px sous le premier pixel de chaque colonne
    a = L["strip"][..., 3] > 0.5
    lab = measure.label(a, connectivity=2)
    sizes = np.bincount(lab.ravel()); sizes[0] = 0
    main = lab == sizes.argmax()
    edge = np.zeros_like(main, np.float32)
    top = np.argmax(main, axis=0)
    has = main.any(0)
    for x in np.nonzero(has)[0]:
        edge[top[x]:top[x] + 4, x] = 1.0
    edge = cv2.GaussianBlur(edge, (0, 0), 0.9)
    edge = np.clip(edge * 1.3, 0, 1)
    g3 = window(edge[..., None], 0.0)[..., 0]
    save16(os.path.join(CACHE, "tex_edge.png"), g3)
    # liseré de déchirure de la bande : 1 au bord de la silhouette, 0 à 3,5 px à l'intérieur (la tranche claire du papier)
    inside = (L["strip"][..., 3] > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(inside, cv2.DIST_L2, 3)
    rim = np.clip(1.0 - (dist - 0.5) / 3.0, 0, 1) * inside
    rim = np.maximum(rim, cv2.GaussianBlur(rim, (0, 0), 0.6))
    save16(os.path.join(CACHE, "tex_rim.png"), window(rim[..., None].astype(np.float32), 0.0)[..., 0])
    # masque pleine résolution (1254) pour le contour de la fente
    a0 = cv2.imread(os.path.join(LOGO, "layer_strip.png"), cv2.IMREAD_UNCHANGED)[..., 3] > 127
    lab0 = measure.label(a0, connectivity=2)
    sz = np.bincount(lab0.ravel()); sz[0] = 0
    return lab0 == sz.argmax()


# ------------------------------------------------------------------ fente
def smooth_noise(n, scale, seed, closed=True):
    """Bruit 1D périodique lisse (valeur entre -1 et 1), n échantillons, longueur d'onde `scale` échantillons."""
    rng = np.random.default_rng(seed)
    m = max(int(n / scale), 4)
    pts = rng.uniform(-1, 1, m)
    xs = np.linspace(0, m, n, endpoint=False)
    i0 = xs.astype(int) % m
    i1 = (i0 + 1) % m
    t = xs - np.floor(xs)
    t = t * t * (3 - 2 * t)
    return pts[i0] * (1 - t) + pts[i1] * t


def hole_polygon(main):
    """Contour de la bande déchirée (px source), ré-échantillonné ~1 px, orienté anti-horaire en monde (y haut)."""
    a = np.pad(main.astype(np.float32), 2)
    a = cv2.GaussianBlur(a, (0, 0), 0.7)
    cs = measure.find_contours(a, 0.5)
    c = max(cs, key=lambda q: len(q))
    pts = np.stack([c[:, 1] - 2 + 0.5, c[:, 0] - 2 + 0.5], 1)    # (X, Y) continus
    poly = Polygon(pts).buffer(0)
    poly = poly.simplify(0.35)
    ring = np.array(poly.exterior.coords)[:-1]
    # ré-échantillonnage à pas constant
    ls = LineString(np.vstack([ring, ring[:1]]))
    n = int(ls.length / 1.2)
    ds = np.linspace(0, ls.length, n, endpoint=False)
    rs = np.array([ls.interpolate(d).coords[0] for d in ds])
    X, Y = to_w(rs[:, 0], rs[:, 1])
    P = np.stack([X, Y], 1)
    if Polygon(P).exterior.is_ccw is False:
        P = P[::-1].copy()
    return P


def ring_normals(P):
    """Normales sortantes (vers l'extérieur du polygone, c'est-à-dire vers la matière) d'un anneau anti-horaire."""
    t = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    return np.stack([t[:, 1], -t[:, 0]], 1)        # pour un anneau CCW, la normale droite pointe vers l'extérieur


POCKET_D = 6.0


def make_pockets():
    """Le lit de la bande orange : une alvéole à bords déchirés (rectangle de la bande, privé de la fente), en pièces CCW."""
    ob = GEO["orange_band"]["px"]
    xa, ya = to_w(ob["x0"], ob["y0"])
    xb, yb = to_w(ob["x1"], ob["y1"])
    ring = np.array([[xa, yb], [xb, yb], [xb, ya], [xa, ya], [xa, yb]], float)
    ls = LineString(ring)
    n = int(ls.length / 1.5)
    R = np.array([ls.interpolate(d).coords[0] for d in np.linspace(0, ls.length, n, endpoint=False)])
    if not Polygon(R).exterior.is_ccw:
        R = R[::-1].copy()
    N = ring_normals(R)
    d = 2.6 * smooth_noise(n, 16, 31) + 1.2 * smooth_noise(n, 4.5, 32) + 0.5 * smooth_noise(n, 1.8, 33)
    R = R + N * d[:, None]
    return Polygon(R).buffer(0)


def build_sheet(P, geo, pocket=None):
    """Feuille épaisse trouée : faces avant (z=0) / arrière (z=-T), parois déchirées (3 anneaux irréguliers)."""
    n = len(P)
    N = ring_normals(P)
    s = np.arange(n)
    # irrégularité de la déchirure : décalage le long de la normale (positif = trou plus petit)
    d1 = 1.6 * smooth_noise(n, 9, 11) + 0.9 * smooth_noise(n, 3.2, 12)
    d2 = 2.2 * smooth_noise(n, 12, 21) + 1.1 * smooth_noise(n, 3.5, 22) + 1.2
    rings = [P.copy(), P + N * d1[:, None], P + N * d2[:, None]]
    zs = [0.0, -SHEET_T * 0.5, -SHEET_T]
    R = 4500.0
    outer = np.array([[-R, -R], [R, -R], [R, R], [-R, R]])
    V, F, M = [], [], []

    def add_verts(arr2, z):
        i0 = len(V)
        for p in arr2:
            V.append((p[0], p[1], z))
        return i0

    # face avant : anneau extérieur (4) + trou (anneau 0, sens horaire)
    pieces = []
    if pocket is not None:
        pg = pocket.difference(Polygon(P).buffer(4.0))
        pieces = [orient(g, 1.0) for g in (pg.geoms if hasattr(pg, "geoms") else [pg]) if g.area > 50]
    prings = [np.array(g.exterior.coords)[:-1] for g in pieces]
    geo["pocket_rings"] = np.concatenate(prings).astype(np.float32) if prings else np.zeros((0, 2), np.float32)
    geo["pocket_len"] = np.array([len(r) for r in prings], np.int32)
    for face, (hole, z, nz) in enumerate(((rings[0], 0.0, 1), (rings[2], -SHEET_T, -1))):
        o0 = add_verts(outer, z)
        h = hole[::-1]
        h0 = add_verts(h, z)
        holes = [h] + ([r[::-1] for r in prings] if face == 0 else [])
        for hh in holes[1:]:
            add_verts(hh, z)
        verts2 = np.vstack([outer] + holes)
        ends = np.cumsum([4] + [len(q) for q in holes]).astype(np.uint32)
        tri = earcut.triangulate_float64(verts2, ends).reshape(-1, 3)
        for t in tri:
            a, b, c = [o0 + int(q) for q in t]
            # orientation : normale +z pour l'avant, -z pour l'arrière
            pa, pb, pc = np.array(V[a]), np.array(V[b]), np.array(V[c])
            cz = np.cross(pb - pa, pc - pa)[2]
            if (cz > 0) != (nz > 0):
                b, c = c, b
            F.append((a, b, c))
            M.append(0 if face == 0 else 1)
    # côtés extérieurs (non vus) : quatre parois
    for z0, z1 in ((0.0, -SHEET_T),):
        i0 = add_verts(outer, z0)
        i1 = add_verts(outer, z1)
        for k in range(4):
            k2 = (k + 1) % 4
            F.append((i0 + k, i1 + k, i1 + k2)); M.append(1)
            F.append((i0 + k, i1 + k2, i0 + k2)); M.append(1)
    # parois du trou : normales vers l'intérieur du trou (donc vers le centre du polygone)
    base = []
    for r, z in zip(rings, zs):
        base.append(add_verts(r, z))
    for lv in range(2):
        a0, b0 = base[lv], base[lv + 1]
        for k in range(n):
            k2 = (k + 1) % n
            # anneau CCW vu du dessus : le quad avant->arrière tourne de façon à ce que la normale pointe vers l'intérieur
            F.append((a0 + k, b0 + k, b0 + k2)); M.append(2)
            F.append((a0 + k, b0 + k2, a0 + k2)); M.append(2)
    # alvéole de la bande : plancher (matériau 3) et parois déchirées (matériau 2), 3 anneaux irréguliers
    for k, R in enumerate(prings):
        nR = len(R)
        NR = ring_normals(R)
        dd1 = 1.4 * smooth_noise(nR, 8, 41 + k) + 0.7 * smooth_noise(nR, 3, 51 + k)
        dd2 = 1.8 * smooth_noise(nR, 10, 61 + k) + 0.8 * smooth_noise(nR, 3.5, 71 + k) + 0.8
        rr = [R, R + NR * dd1[:, None], R + NR * dd2[:, None]]
        zz = [0.0, -POCKET_D * 0.5, -POCKET_D]
        b0 = [add_verts(q, z) for q, z in zip(rr, zz)]
        for lv in range(2):
            a0, c0 = b0[lv], b0[lv + 1]
            for j in range(nR):
                j2 = (j + 1) % nR
                F.append((a0 + j, c0 + j, c0 + j2)); M.append(2)
                F.append((a0 + j, c0 + j2, a0 + j2)); M.append(2)
        fl0 = add_verts(rr[2], -POCKET_D)
        tri = earcut.triangulate_float64(rr[2], np.array([nR], np.uint32)).reshape(-1, 3)
        for t in tri:
            a, b, c = [fl0 + int(q) for q in t]
            pa, pb, pc = np.array(V[a]), np.array(V[b]), np.array(V[c])
            if np.cross(pb - pa, pc - pa)[2] < 0:
                b, c = c, b
            F.append((a, b, c)); M.append(3)
    geo["sheet_v"] = np.array(V, np.float32)
    geo["sheet_f"] = np.array(F, np.int32)
    geo["sheet_m"] = np.array(M, np.int8)
    geo["hole_front"] = rings[0].astype(np.float32)
    geo["hole_normals"] = N.astype(np.float32)
    return rings


def build_fibres(P, geo, count=2600, seed=5, pockets=None):
    """Fibres de papier arrachées le long du bord de la fente : petites courbes qui dépassent vers l'intérieur du trou."""
    rng = np.random.default_rng(seed)
    N = ring_normals(P)
    n = len(P)
    out = []
    for _ in range(count):
        i = rng.integers(0, n)
        base = P[i] + rng.uniform(-0.3, 0.3, 2)
        inward = -N[i]
        ang = rng.normal(0, 0.55)
        c, s = math.cos(ang), math.sin(ang)
        d = np.array([inward[0] * c - inward[1] * s, inward[0] * s + inward[1] * c])
        L = float(np.clip(rng.lognormal(math.log(4.5), 0.55), 1.5, 22.0))
        lift = rng.uniform(-0.5, 2.5)
        bend = rng.normal(0, 0.35, 2)
        z0 = -rng.uniform(0.0, 2.0)
        pts = []
        for tt in (0.0, 0.35, 0.7, 1.0):
            p = base + d * L * tt + np.array([-d[1], d[0]]) * bend[0] * L * tt * tt
            pts.append((p[0], p[1], z0 + lift * tt + 0.8 * bend[1] * tt * tt))
        out.append(pts)
    # fibres blanches le long du bord de l'alvéole de la bande
    if "pocket_rings" in geo and len(geo["pocket_rings"]):
        PR, ln = geo["pocket_rings"].astype(float), geo["pocket_len"]
        o = 0
        for L in ln:
            R = PR[o:o + L]; o += L
            NR = ring_normals(R)
            for _ in range(int(2200 * L / len(PR))):
                i = rng.integers(0, L)
                inward = -NR[i]
                ang = rng.normal(0, 0.6)
                c, s_ = math.cos(ang), math.sin(ang)
                d = np.array([inward[0] * c - inward[1] * s_, inward[0] * s_ + inward[1] * c])
                Lf = float(np.clip(rng.lognormal(math.log(5.0), 0.55), 1.5, 24.0))
                lift = rng.uniform(0.0, 3.0)
                bend = rng.normal(0, 0.35, 2)
                pts = []
                for tt in (0.0, 0.35, 0.7, 1.0):
                    p = R[i] + d * Lf * tt + np.array([-d[1], d[0]]) * bend[0] * Lf * tt * tt
                    pts.append((p[0], p[1], 0.2 + lift * tt + 0.8 * abs(bend[1]) * tt * tt))
                out.append(pts)
    geo["fibres"] = np.array(out, np.float32)


# ------------------------------------------------------------------ bande déchirée (maillage de tissu)
def build_strip(geo, dx=8.0):
    te = np.array(GEO["torn_strip"]["px"]["top_edge"])
    be = np.array(GEO["torn_strip"]["px"]["bottom_edge"])
    x0, x1 = GEO["torn_strip"]["px"]["left_end_x"], GEO["torn_strip"]["px"]["right_end_x"]
    nx = int((x1 - x0) * K / dx) + 1
    ny = 15
    xs = np.linspace(x0, x1, nx)
    top = np.interp(xs, te[:, 0], te[:, 1])
    bot = np.interp(xs, be[:, 0], be[:, 1])
    # sur-couverture : min/max glissants (la forme exacte vient de l'alpha de la texture)
    w = 6
    topm = np.array([np.interp(np.linspace(x - w, x + w, 9), te[:, 0], te[:, 1]).min() for x in xs]) - 3
    botm = np.array([np.interp(np.linspace(x - w, x + w, 9), be[:, 0], be[:, 1]).max() for x in xs]) + 3
    V = np.zeros((nx, ny, 3), np.float32)
    for i in range(nx):
        Ys = np.linspace(topm[i], botm[i], ny)
        X, Y = to_w(np.full(ny, xs[i]), Ys)
        V[i, :, 0], V[i, :, 1], V[i, :, 2] = X, Y, 0.5
    F = []
    for i in range(nx - 1):
        for j in range(ny - 1):
            a, b, c, d = i * ny + j, (i + 1) * ny + j, (i + 1) * ny + j + 1, i * ny + j + 1
            F.append((a, d, c)); F.append((a, c, b))
    geo["strip_v"] = V.reshape(-1, 3)
    geo["strip_f"] = np.array(F, np.int32)
    geo["strip_grid"] = np.array([nx, ny], np.int32)
    # pose : colonne de gauche = ancrage (partie retenue)
    geo["strip_u"] = np.repeat(np.linspace(0, 1, nx), ny).astype(np.float32)


# ------------------------------------------------------------------ lettres
def polys_to_mesh(polys):
    """Liste de shapely Polygon (monde) -> (verts2d, tris, rings) ; anneaux: liste (indices, est_trou)."""
    verts, tris, rings = [], [], []
    for pg in polys:
        pg = orient(pg, 1.0)
        ext = np.array(pg.exterior.coords)[:-1]
        holes = [np.array(h.coords)[:-1] for h in pg.interiors]
        allr = [ext] + holes
        v2 = np.vstack(allr)
        ends = np.cumsum([len(r) for r in allr]).astype(np.uint32)
        t = earcut.triangulate_float64(v2, ends).reshape(-1, 3)
        o = sum(len(v) for v in verts)
        tris.append(t + o)
        idx = o
        for k, r in enumerate(allr):
            rings.append((np.arange(idx, idx + len(r)), k > 0))
            idx += len(r)
        verts.append(v2)
    V = np.vstack(verts).astype(np.float64)
    T = np.vstack(tris).astype(np.int32)
    return V, T, rings


def put_letters(geo, key, polys):
    V, T, rings = polys_to_mesh(polys)
    geo[f"let/{key}/v"] = V.astype(np.float32)
    geo[f"let/{key}/t"] = T
    geo[f"let/{key}/ring_idx"] = np.concatenate([r for r, _ in rings]).astype(np.int32)
    geo[f"let/{key}/ring_len"] = np.array([len(r) for r, _ in rings], np.int32)
    geo[f"let/{key}/ring_hole"] = np.array([h for _, h in rings], np.int8)


def clean(g):
    g = g.buffer(0)
    if g.is_empty:
        return []
    return list(g.geoms) if isinstance(g, MultiPolygon) else [g]


def build_letters(geo):
    # lettrage d'origine : contours vectoriels du wordmark_clean.json
    w = json.load(open(os.path.join(LOGO, "wordmark_clean.json")))
    allp = []
    for L in w["letters"]:
        outers, holes = [], []
        for c, ish in zip(L["contours"], L["is_hole"]):
            c = np.array(c)
            X, Y = to_w(c[:, 0], c[:, 1])
            P = Polygon(np.stack([X, Y], 1)).buffer(0)
            (holes if ish else outers).append(P)
        g = unary_union(outers)
        if holes:
            g = g.difference(unary_union(holes))
        allp += clean(g)
    put_letters(geo, "orig", allp)
    wm = GEO["wordmark"]["px"]
    x0, y0, x1, y1 = wm["bbox"]
    wx0, _ = to_w(x0, 0)
    wx1, _ = to_w(x1, 0)
    width = float(wx1 - wx0)
    cx = float((wx0 + wx1) / 2)
    cy = float(504.0 - (wm["cap_top_y"] + wm["baseline_y"]) / 2 * K)
    geo["word_fit"] = np.array([width, cx, cy], np.float64)
    info = {}
    for face in ROLL:
        axes = dict(tk.faces()[face].get("showcase_axes") or {})
        g = tk.outlines("OFFGRIDZ", face, 1.0, **axes)
        x0_, y0_, x1_, y1_ = tk.bounds(g)
        s = width / (x1_ - x0_)
        pl = tk.polylines(g, 0.0012)
        by_glyph = {}
        for p in pl:
            by_glyph.setdefault(p["glyph_index"], []).append(p)
        polys = []
        for gi, lst in by_glyph.items():
            outers = [Polygon(np.array(q["points"]) * s) for q in lst if not q["hole"]]
            holes = [Polygon(np.array(q["points"]) * s) for q in lst if q["hole"]]
            outers = [o.buffer(0) for o in outers]
            gg = unary_union(outers)
            if holes:
                gg = gg.difference(unary_union([h.buffer(0) for h in holes]))
            polys += clean(gg)
        cap = 1.0 * s                              # hauteur de capitale en px monde
        # recentrage : x par la boîte d'encre, y : centre de la bande de capitales sur le centre du lettrage d'origine
        U = unary_union(polys)
        bx0, by0, bx1, by1 = U.bounds
        ox = cx - (bx0 + bx1) / 2
        oy = cy - cap / 2
        from shapely import affinity
        polys = [affinity.translate(p, ox, oy).simplify(0.08) for p in polys]
        if face == "doto-var":          # points plus gras : on épaissit chaque point de 0,9 px pour la lisibilité en 1008x1512
            polys = [q for p in polys for q in clean(p.buffer(0.9, join_style=2))]
            polys = clean(unary_union(polys))
        put_letters(geo, face, polys)
        info[face] = dict(scale=float(s), cap=float(cap), n_poly=len(polys))
        # centre du premier contre-forme du O (premier glyphe) pour la plongée
        if face == "bodoni-moda-var":
            first = [p for p in polys if p.bounds[0] < (cx - width / 2) + width * 0.2]
            O = max(first, key=lambda p: p.area)
            if O.interiors:
                h = Polygon(O.interiors[0])
                geo["O_counter"] = np.array(list(h.bounds) + [h.centroid.x, h.centroid.y, O.bounds[0], O.bounds[1], O.bounds[2], O.bounds[3]], np.float64)
                geo["O_counter_poly"] = np.array(h.exterior.coords, np.float32)
    return info


def main():
    os.makedirs(CACHE, exist_ok=True)
    main_mask = make_textures()
    geo = {}
    P = hole_polygon(main_mask)
    build_sheet(P, geo, make_pockets())
    build_fibres(P, geo)
    build_strip(geo)
    info = build_letters(geo)
    geo["slab_dims"] = np.array([(GEO["orange_band"]["px"]["x1"] - GEO["orange_band"]["px"]["x0"]) * K,
                                 (GEO["orange_band"]["px"]["y1"] - GEO["orange_band"]["px"]["y0"]) * K,
                                 0.3 * (GEO["orange_band"]["px"]["x1"] - GEO["orange_band"]["px"]["x0"]) * K], np.float64)
    bx0, by0 = to_w(GEO["orange_band"]["px"]["x0"], GEO["orange_band"]["px"]["y0"])
    bx1, by1 = to_w(GEO["orange_band"]["px"]["x1"], GEO["orange_band"]["px"]["y1"])
    geo["slab_rest_bbox"] = np.array([bx0, by1, bx1, by0], np.float64)      # xmin, ymin, xmax, ymax (monde)
    geo["sheet_T"] = np.array([SHEET_T])
    # fente : intervalle libre commun sur la largeur de la dalle (pour le plan de la manœuvre)
    hp = Polygon(P)
    xs = np.arange(bx0 + 2, bx1 - 2, 2.0)
    lo, hi = -1e9, 1e9
    for x in xs:
        seg = LineString([(x, -400), (x, 400)]).intersection(hp)
        if seg.is_empty:
            continue
        lo = max(lo, seg.bounds[1]); hi = min(hi, seg.bounds[3])
    geo["slit_common"] = np.array([lo, hi])
    np.savez_compressed(os.path.join(CACHE, "geo.npz"), **geo)
    json.dump(dict(letters=info, slit_common=[float(lo), float(hi)], hole_pts=int(len(P)),
                   word_fit=[float(v) for v in geo["word_fit"]], O_counter=[float(v) for v in geo["O_counter"]]),
              open(os.path.join(CACHE, "prep_info.json"), "w"), indent=1)
    print("ok", json.dumps(json.load(open(os.path.join(CACHE, "prep_info.json")))))


if __name__ == "__main__":
    main()
