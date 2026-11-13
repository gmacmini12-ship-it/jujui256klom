"""Les sept séquences de l'animatique (placeholders plats, 2D). Chaque fonction `window(f)` renvoie
(toile feuille H×W×3 uint8 dont seule la fenêtre compte, nombre de particules ou None).
Les temps viennent de la partition ; le seul état est un cache de tirages à graine fixe."""
import math
from functools import lru_cache

import cv2
import numpy as np

import common as C
from common import (W, H, WX0, WY0, WX1, WY1, BLACK, CREAM, ORANGE, ORANGE_HI, G_DARK, G_MID, G_LIGHT, AMBER, MINT,
                    LOGO_X, LOGO_Y, LOGO_S, K, smooth, lerp, clamp01, blocks, instants, find, seq_range)

CX0, CY0 = (WX0 + WX1) / 2, (WY0 + WY1) / 2           # centre de la fenêtre (540, 960)
WINW, WINH = WX1 - WX0, WY1 - WY0


def canvas():
    S = np.empty((H, W, 3), np.uint8)
    S[:] = BLACK
    return S


def rng(seed):
    return np.random.default_rng(seed)


def var_color(base, n, r, spread=0.08):
    v = 1 + r.uniform(-spread, spread, n)[:, None]
    return np.clip(np.array(base, np.float32)[None, :] * v, 0, 255).astype(np.uint8)


# ======================================================================================
# Temps dérivés de la partition
# ======================================================================================
SEQ = {i: seq_range(i) for i in range(7)}
ROLL = [e for e in blocks("typo") if e["nom"].startswith("roulement")]
ROLL1, ROLL2, ROLL3, ROLL4 = ROLL
FACES1 = list(ROLL1["caracteres"])


def roll_faces(arret):
    """Ordre des caractères d'un roulement qui s'arrête sur `arret` (même jeu que le roulement n° 1)."""
    others = [x for x in FACES1 if x != arret]
    k = len(ROLL) % len(others)
    return others[k:] + others[:k] + [arret]


FACES2 = roll_faces(ROLL2["arret"])
FACES3 = roll_faces(ROLL3["arret"])


def roll_face(f, block, faces):
    """Caractère courant d'un roulement : un changement toutes les doubles-croches (3 images)."""
    if f < block["debut"]:
        return None
    i = min((f - block["debut"]) // C.PER_16TH, len(faces) - 1)
    return faces[i]


T_CRUMBLE = find("matiere", "grains", "b")["debut"]                               # 84
T_AVAL = find("camera", "recul au ras", "b")["debut"]                             # 120
T_STREAM = [e for e in instants("reticule") if e["nom"].startswith("tentative")][1]["image"]   # 168
T_BOTTOM = [e for e in blocks("musique") if e["nom"] == "silence"][0]["debut"]    # 210
T_LIME = SEQ[3][0]
T_MINT = find("bruitage", "menthe")["image"]
T_ICE = find("bruitage", "glaçons", "b")["debut"]
T_LIQ = find("matiere", "dissoute", "b")["debut"]
T_STRAW = find("bruitage", "paille")["image"]
T_HERO0 = find("camera", "quasi fixe", "b")["debut"]
T_ENTER = find("camera", "entrée dans la paille", "b")["debut"]
T_BLACK = SEQ[3][1]
T_ROLL4 = ROLL4
T_INK = find("matiere", "encre", "b")["debut"]
T_SQ = find("typo", "lettrage d'origine", "b")
T_SIG = find("reticule", "verrouillage final")["image"]   # plus de phrase de signature (retirée par le client)
T_SIG2 = T_SIG
T_END_BURST = T_INK - 1


# ======================================================================================
# Séquences 0 et 1 : logo, déchirure, roulement n° 1, plongée dans le O
# ======================================================================================
@lru_cache(maxsize=1)
def _logo_state():
    L = C.logo_layers()
    ph = C.logo_base_photo()
    ba = L["band"][..., 3].copy()
    base = np.clip(ph * C.band_factor(ba), 0, 1).astype(np.float32)          # photo + bande, sans bande déchirée
    st = L["strip"]
    ys, xs = np.nonzero(st[..., 3] > 0.02)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    # liseré du bord de la bande déchirée (pour la lueur de l'image 6)
    a8 = (st[..., 3] > 0.5).astype(np.uint8)
    k = np.ones((5, 5), np.uint8)
    edge = (cv2.dilate(a8, k) - cv2.erode(a8, k)).astype(np.float32)
    edge = cv2.GaussianBlur(edge, (0, 0), 1.2)
    edge = np.clip(edge * 1.4, 0, 1)
    return dict(base=base, ph=ph, ba=ba, box=box, edge=edge, strip=st, L=L)


def glint(f, t0):
    """Lueur qui court le long de la bande déchirée à partir de l'image t0 : masque float (LOGO_S²)."""
    S = _logo_state()
    p = (f - t0) / 12.0
    if p < 0 or p > 1.2:
        return None
    x0, y0, x1, y1 = S["box"]
    xc = lerp(x0 - 60, x1 + 60, p)
    xs = np.arange(LOGO_S, dtype=np.float32)
    prof = np.exp(-(((xs - xc) / 55.0) ** 2))[None, :]
    return S["edge"] * prof * 0.55


def seq0(f):
    """Images 0–23 : logo source, lueur à l'image 6, bande qui s'arrache de droite à gauche."""
    S = canvas()
    s0 = SEQ[0][0]
    t_glint = s0 + 6                         # « image 6 : une lueur court le long de la bande »
    unlock = find("reticule", "déverrouillage")["image"]   # 12 : la bande s'arrache
    st = _logo_state()
    if f < unlock:
        img = C.logo_source().copy()
        g = glint(f, t_glint)
        if g is not None:
            y0, y1 = st["box"][1], st["box"][3]
            reg = img[y0:y1].astype(np.float32)
            gg = g[y0:y1, :, None]
            img[y0:y1] = np.clip(reg + (np.array(CREAM, np.float32) - reg) * gg + 0.5, 0, 255).astype(np.uint8)
        S[LOGO_Y:LOGO_Y + LOGO_S, LOGO_X:LOGO_X + LOGO_S] = img
        return S, None
    img = C.to_u8(_peel_compose(f, unlock))
    S[LOGO_Y:LOGO_Y + LOGO_S, LOGO_X:LOGO_X + LOGO_S] = img
    return S, None


def _peel_compose(f, t_peel, with_word=True):
    """Logo recomposé par couches, bande déchirée en train de s'arracher (tranches de droite à gauche)."""
    st = _logo_state()
    L = st["L"]
    out = st["base"].copy()
    x0, y0, x1, y1 = st["box"]
    sp = L["strip"].copy()
    g = glint(f, 6)
    if g is not None:
        gg = g[..., None] * sp[..., 3:4]
        sp[..., :3] = sp[..., :3] + (np.array(CREAM, np.float32) / 255 * sp[..., 3:4] - sp[..., :3]) * np.clip(gg * 2.2, 0, 1)
    ncols = 30
    edges = np.linspace(x0, x1, ncols + 1).astype(int)
    pad_y = 460                                 # marge au-dessus pour le décollage
    ry0 = max(y0 - pad_y, 0)
    dest = np.zeros((y1 - ry0 + 80, LOGO_S, 4), np.float32)
    dur, spread = 7.0, 4.0
    for i in range(ncols):
        xa, xb = edges[i], edges[i + 1]
        u = (i + 0.5) / ncols                    # 0 gauche, 1 droite
        ts = t_peel + (1 - u) * spread           # la droite part la première
        q = (f - ts) / dur
        sl = sp[y0:y1, xa:xb]
        if q <= 0:
            dest[y0 - ry0:y1 - ry0, xa:xb] = sl
        elif q < 1:
            qq = smooth(q)
            ang = -math.radians(38) * qq
            dx, dy = 70 * qq, -(380 * qq * qq + 40 * qq)
            c, s_ = math.cos(ang), math.sin(ang)
            sc = 1 + 0.35 * qq
            # tampon ancré en (x=0, y=y0) ; rotation + échelle autour du coin haut-gauche (xa, y0) de la tranche
            tile = np.zeros((y1 - y0 + 2, LOGO_S, 4), np.float32)
            tile[:y1 - y0, xa:xb] = sl
            tx = dx + xa - (c * xa - s_ * y0) * sc
            ty = (y0 - ry0) + dy - (s_ * xa + c * y0) * sc
            M4 = np.array([[c * sc, -s_ * sc, tx - s_ * sc * y0],
                           [s_ * sc, c * sc, ty + c * sc * y0]], np.float32)
            Wd = cv2.warpAffine(tile, M4, (LOGO_S, dest.shape[0]), flags=cv2.INTER_LINEAR)
            Wd *= (1 - qq ** 3)
            dest = Wd + dest * (1 - Wd[..., 3:4])
    # pose du tampon sur le logo
    h = dest.shape[0]
    reg = out[ry0:ry0 + h]
    hh = min(h, LOGO_S - ry0)
    reg[:hh] = dest[:hh, :, :3] + reg[:hh] * (1 - dest[:hh, :, 3:4])
    if with_word:
        out = C.over(out, L["wordmark"])
    out = C.over(out, L["lines"])
    return out


# --- séquence 1 : roulement n° 1, travelling avant, plongée dans le O
@lru_cache(maxsize=1)
def _slit():
    """Centre de la fente (celle du mot d'origine) en px feuille."""
    g = C.logo_geom()["wordmark"]["px"]
    x = LOGO_X + (g["bbox"][0] + g["bbox"][2]) / 2 * K
    y = LOGO_Y + (g["cap_top_y"] + g["baseline_y"]) / 2 * K
    return x, y


@lru_cache(maxsize=1)
def _slit_h():
    s = C.logo_geom()["torn_strip"]["px"]["bbox"]
    return (s[3] - s[1]) * K


def _word_lay(wp, slit):
    sx, sy = slit
    s, ox, _ = C.word_layout(wp, 1015 * K, min(150.0, _slit_h() * 0.8), sx, 0)
    return s, ox, sy + s / 2


@lru_cache(maxsize=1)
def _dive():
    wp = C.word_polys("OFFGRIDZ", ROLL1["arret"])
    lay = _word_lay(wp, _slit())
    s, ox, by = lay
    holes0 = [P for gi, P in wp[1] if gi == 0]
    hp = C.to_px(holes0[0], lay)
    centre = hp.mean(0)
    # zoom final : les quatre coins de la fenêtre dans le contre-jour du O
    z = 20.0
    poly = np.round((hp - centre) * 16).astype(np.int32)
    while True:
        ok = True
        for (dx, dy) in ((-WINW / 2, -WINH / 2), (WINW / 2, -WINH / 2), (-WINW / 2, WINH / 2), (WINW / 2, WINH / 2)):
            if cv2.pointPolygonTest(poly.reshape(-1, 1, 2).astype(np.float32), (dx / z * 16, dy / z * 16), False) < 0:
                ok = False
        if ok:
            break
        z *= 1.04
    return dict(wp=wp, lay=lay, centre=centre, zend=z * 1.05, hole_idx=0)


def _cam1(f):
    """Caméra (cx, cy, zoom, ax, ay) de la séquence 1."""
    a, b = SEQ[1]
    sx, sy = _slit()
    t_push_end = b - 24                       # 47 : fin du travelling lent
    z_slow = 2.2
    tp = clamp01((f - a) / float(t_push_end - a))
    z = math.exp(math.log(z_slow) * smooth(tp)) if f <= t_push_end else z_slow
    cx = lerp(CX0, sx, smooth(tp) * 0.9)
    cy = lerp(CY0, sy, smooth(tp) * 0.9)
    if f > t_push_end:
        D = _dive()
        t = clamp01((f - (t_push_end + 1)) / float(b - (t_push_end + 1)))
        z = math.exp(lerp(math.log(z_slow), math.log(D["zend"]), t ** 2.0))
        m = smooth(clamp01(t * 1.6))
        cx = lerp(lerp(CX0, sx, 0.9), D["centre"][0], m)
        cy = lerp(lerp(CY0, sy, 0.9), D["centre"][1], m)
    return cx, cy, z, CX0, CY0


def _warp_to_window(src, cx, cy, z, ax, ay, border):
    M = np.array([[z, 0, z * (LOGO_X - cx) + ax - WX0], [0, z, z * (LOGO_Y - cy) + ay - WY0]], np.float32)
    return cv2.warpAffine(src, M, (WINW, WINH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=border)


@lru_cache(maxsize=1)
def _scene72():
    """Image de la séquence 2 à sa première image (dalle debout), vue à travers le O."""
    return seq2(SEQ[2][0], static=True)[0]


def seq1(f):
    S = canvas()
    st = _logo_state()
    L = st["L"]
    a, b = SEQ[1]
    cx, cy, z, ax, ay = _cam1(f)
    # parallaxe : la bande orange avance un peu plus vite que la photo
    q = smooth((f - a) / float(b - a))
    ph = _warp_to_window(st["ph"].astype(np.float32), cx, cy, z, ax, ay, tuple(float(v) / 255 for v in BLACK))
    ba = _warp_to_window(st["ba"], cx, cy, z * (1 + 0.05 * q), ax, ay, 0.0)
    out = np.clip(ph * C.band_factor(ba), 0, 1)
    ln = _warp_to_window(L["lines"], cx, cy, z, ax, ay, (0, 0, 0, 0))
    out = C.over(out, ln)
    win = C.to_u8(out)
    # le mot en caractère courant (contours vectoriels : net à toute échelle)
    face = roll_face(f, ROLL1, FACES1)
    wp = C.word_polys("OFFGRIDZ", face)
    lay = _word_lay(wp, _slit())
    full = np.zeros((H, W, 3), np.uint8)
    full[WY0:WY1, WX0:WX1] = win
    cam = (cx, cy, z, ax, ay)
    # on dessine le mot sur toute la toile ; la fenêtre est découpée après coup
    C.draw_word(full, wp, lay, CREAM, 1.0, cam)
    if f > ROLL1["debut"] + (len(FACES1) - 1) * C.PER_16TH:
        D = _dive()
        # intérieur du O : la séquence 2 vue au bout du tunnel
        hp = C.to_px([P for gi, P in D["wp"][1] if gi == 0][0], D["lay"], cam)
        g = lerp(0.25, 1.0, smooth((f - (b - 24)) / 23.0))
        inner = cv2.warpAffine(_scene72(), np.array([[g, 0, CX0 - g * CX0], [0, g, CY0 - g * CY0]], np.float32), (W, H),
                               flags=cv2.INTER_LINEAR)
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [np.round(hp * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
        mm = m[..., None].astype(np.float32) / 255
        full = np.clip(full + (inner.astype(np.float32) - full) * mm + 0.5, 0, 255).astype(np.uint8)
    S[WY0:WY1, WX0:WX1] = full[WY0:WY1, WX0:WX1]
    return S, None


# ======================================================================================
# Séquence 2 : dalle, effritement, roulement n° 2, avalanche, filet, bord du verre
# ======================================================================================
SLAB = (430, 660, 650, 1500)          # x0, y_haut, x1, y_sol (planche « dalle »)
FLOOR_Y = SLAB[3]


@lru_cache(maxsize=1)
def _slab_tex():
    r = rng(21)
    w, h = SLAB[2] - SLAB[0], SLAB[3] - SLAB[1]
    n = r.normal(0, 1, (h // 4 + 1, w // 4 + 1)).astype(np.float32)
    n = cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
    fine = r.normal(0, 1, (h, w)).astype(np.float32)
    t = 1 + 0.035 * n + 0.03 * fine
    hi = np.clip(1 - np.arange(w, dtype=np.float32) / 26.0, 0, 1)[None, :]       # arête gauche éclairée
    return t, hi


def crumble_front(f):
    t0 = T_CRUMBLE
    t1 = SEQ[2][1] - 54                                  # fin de l'effritement (~162)
    return SLAB[1] + (SLAB[3] - SLAB[1]) * clamp01((f - t0) / float(t1 - t0)) ** 1.15


@lru_cache(maxsize=1)
def _grains2():
    r = rng(2)
    n = 5200
    b = np.where(r.random(n) < 0.25, r.uniform(T_CRUMBLE, T_AVAL, n), r.uniform(T_AVAL, T_STREAM - 6, n))
    x0 = r.uniform(SLAB[0] + 4, SLAB[2] - 4, n)
    y0 = np.array([crumble_front(v) for v in b]) + r.uniform(0, 36, n)
    y0 = np.minimum(y0, SLAB[3] - 6)
    xl = np.where(r.random(n) < 0.6, r.normal(540, 200, n), r.uniform(60, 1020, n))
    xl = np.clip(xl, 50, 1030)
    hp = 150 * np.exp(-(np.abs(xl - 540) / 340.0) ** 1.8)
    ry = FLOOR_Y - 4 - hp * r.random(n) ** 0.55 + r.uniform(-3, 3, n)
    vy0 = r.uniform(-1.0, 2.0, n)
    g = 0.9
    dy = np.maximum(ry - y0, 6.0)
    tl = (-vy0 + np.sqrt(vy0 ** 2 + 2 * g * dy)) / g
    rad = r.uniform(2.2, 5.0, n)
    col = var_color(ORANGE, n, r, 0.08)
    return dict(n=n, b=b, x0=x0, y0=y0, xl=xl, ry=ry, vy0=vy0, g=g, tl=tl, rad=rad, col=col)


def _grain_pos(G, f):
    tau = f - G["b"]
    alive = tau >= 0
    t = np.minimum(tau, G["tl"])
    x = G["x0"] + (G["xl"] - G["x0"]) * t / G["tl"]
    y = np.where(tau < G["tl"], G["y0"] + G["vy0"] * t + 0.5 * G["g"] * t * t, G["ry"])
    return alive, x, y


def _floor(S, oy):
    y0 = int(FLOOR_Y + oy)
    if y0 < WY1:
        yb = min(WY1, y0 + 480)                      # le sol est une bande : il quitte le cadre quand le monde glisse
        ya = max(y0, WY0)
        if yb > ya:
            gy = np.clip((np.arange(ya, yb) - y0) / 220.0, 0, 1)[:, None]
            col = np.array(G_LIGHT, np.float32) + (np.array(G_MID, np.float32) - np.array(G_LIGHT, np.float32)) * gy[..., None]
            S[ya:yb, WX0:WX1] = col.astype(np.uint8)
        cv2.line(S, (WX0, y0), (WX1, y0), G_MID, 1, cv2.LINE_AA)


def seq2(f, static=False):
    S = canvas()
    r_n = None
    a, b = SEQ[2]
    scroll_t = T_STREAM - 1
    oy = -150 * smooth((f - T_AVAL) / float(scroll_t - T_AVAL)) if f <= scroll_t else -150 - 70 * (f - scroll_t)
    if f < T_STREAM + 25:
        _floor(S, oy)
        # lettres pâles à la base (roulement n° 2)
        face = roll_face(f, ROLL2, FACES2)
        if face is not None:
            wp = C.word_polys("OFFGRIDZ", face)
            s, ox, _ = C.word_layout(wp, 880, 230, 540, 0)
            lay = (s, ox, FLOOR_Y + oy)
            C.draw_word(S, wp, lay, CREAM, 0.92)
        # dalle
        front = crumble_front(f)
        t, hi = _slab_tex()
        x0, y1 = SLAB[0], SLAB[3]
        ytop = int(round(front))
        if ytop < y1:
            # ombre de contact
            sh = np.zeros((40, 360), np.uint8)
            cv2.ellipse(sh, (180, 12), (150, 10), 0, 0, 360, 255, -1, cv2.LINE_AA)
            C.mask_blend(S, sh, BLACK, 0.45, 360, int(y1 + oy) - 8)
            ys0 = ytop - SLAB[1]
            tex = t[ys0:]
            rows = tex.shape[0]
            base = np.array(ORANGE, np.float32)
            hi_c = np.array(ORANGE_HI, np.float32)
            col = base[None, None, :] * tex[..., None]
            col = col + (hi_c - base)[None, None, :] * (hi[:, :][..., None] * 0.9)
            # arête supérieure déchiquetée pendant l'effritement
            patch = np.clip(col, 0, 255).astype(np.uint8)
            Y0 = int(ytop + oy)
            X0 = x0
            wmax = patch.shape[1]
            if f >= T_CRUMBLE:
                rr = rng(33)
                jag = (rr.uniform(0, 1, wmax // 6 + 2) * 26).astype(int)
                jag = np.repeat(jag, 6)[:wmax]
                for xi in range(wmax):
                    j = jag[xi]
                    if j > 0:
                        patch[:j, xi] = 0
                mask = (patch.sum(2) > 0)[..., None]
            else:
                mask = np.ones(patch.shape[:2] + (1,), bool)
            ys, ye = max(Y0, WY0), min(Y0 + rows, WY1)
            if ye > ys:
                sub = patch[ys - Y0:ye - Y0]
                mk = mask[ys - Y0:ye - Y0]
                reg = S[ys:ye, X0:X0 + wmax]
                S[ys:ye, X0:X0 + wmax] = np.where(mk, sub, reg)
        # grains
        if f >= T_CRUMBLE:
            G = _grains2()
            alive, x, y = _grain_pos(G, f)
            idx = np.nonzero(alive)[0]
            if f > T_STREAM + 24:
                idx = idx[:0]
            C.grains(S, x[idx], y[idx] + oy, G["rad"][idx], G["col"][idx])
            r_n = int(alive.sum())
    if f >= T_STREAM:
        _stream(S, f)
        # le compteur reprend le débit du filet
        r_n = (r_n or 0) + _stream_count(f)
    return S, r_n


STREAM_TOP, STREAM_FRONT0, STREAM_NPER = 230, 640, 6


def _stream_params():
    """Vitesse du filet : le front passe de STREAM_FRONT0 (image 168) au fond du verre (image 210)."""
    return (1470 - STREAM_FRONT0) / float(T_BOTTOM - T_STREAM)


@lru_cache(maxsize=1)
def _stream_grains():
    v = _stream_params()
    pre = (STREAM_FRONT0 - STREAM_TOP) / v
    ng = int((T_BOTTOM - T_STREAM + 24 + pre) * STREAM_NPER)
    r = rng(23)
    b = T_STREAM - pre + np.arange(ng) / STREAM_NPER
    jx = r.normal(0, 3.2, ng)
    rad = r.uniform(1.8, 3.3, ng)
    col = var_color(ORANGE, ng, r)
    return dict(b=b, jx=jx, rad=rad, col=col, j=np.arange(ng))


def _rim_cy(f):
    u = clamp01((f - T_STREAM) / 37.0)
    return lerp(1900, 1470, 1 - (1 - u) ** 3)


def _stream_alive(f):
    G = _stream_grains()
    v = _stream_params()
    y = STREAM_TOP + v * (f - G["b"])
    ok = (f >= G["b"]) & (y <= _rim_cy(f))
    return G, y, ok


def _stream_count(f):
    return int(_stream_alive(f)[2].sum())


def _stream(S, f):
    rim = _rim_cy(f)
    ell = np.zeros((H, W), np.uint8)
    cx = 540
    cv2.ellipse(ell, (cx, int(rim)), (240, 80), 0, 0, 360, 255, -1, cv2.LINE_AA)
    C.mask_blend(S, ell[WY0:WY1, WX0:WX1], (22, 17, 14), 0.96, WX0, WY0)
    for (rx, ry, th, a) in ((240, 80, 2, 0.9), (300, 110, 1, 0.45)):
        e2 = np.zeros((H, W), np.uint8)
        cv2.ellipse(e2, (cx, int(rim)), (rx, ry), 0, 0, 360, 255, th, cv2.LINE_AA)
        C.mask_blend(S, e2[WY0:WY1, WX0:WX1], CREAM, a, WX0, WY0)
    G, y, ok = _stream_alive(f)
    idx = np.nonzero(ok)[0]
    x = 540 + G["jx"][idx] + 1.8 * np.sin(0.5 * y[idx] / 40 + G["j"][idx])
    C.grains(S, x, y[idx], G["rad"][idx], G["col"][idx])
    if f >= T_BOTTOM:
        k = int(60 * smooth((f - T_BOTTOM) / 6.0)) + 8
        r2 = rng(24)
        px = 540 + r2.normal(0, 38, k)
        py = rim + r2.normal(0, 9, k)
        C.grains(S, px, py, r2.uniform(1.6, 3.0, k), var_color(AMBER, k, r2, 0.1))


# ======================================================================================
# Séquence 3 : le mojito (vue de côté)
# ======================================================================================
GL_TOP, GL_BOT = 700, 1500
GL_XL0, GL_XL1, GL_XR0, GL_XR1 = 360, 400, 720, 680       # parois (haut, bas) gauche et droite


def _wall_l(y):
    return GL_XL0 + (y - GL_TOP) * (GL_XL1 - GL_XL0) / (GL_BOT - GL_TOP)


def _wall_r(y):
    return GL_XR0 + (y - GL_TOP) * (GL_XR1 - GL_XR0) / (GL_BOT - GL_TOP)


def _liquid_level(f):
    u = smooth((f - T_LIQ) / float(find("camera", "orbite 12", "b")["fin"] - T_LIQ))
    return lerp(GL_BOT - 14, 770, u) if f >= T_LIQ else GL_BOT - 14


def _cube_poly(x, y, a, t):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    pts = np.array([[-t, -t], [t, -t], [t, t], [-t, t]], float)
    return np.stack([x + pts[:, 0] * c - pts[:, 1] * s, y + pts[:, 0] * s + pts[:, 1] * c], 1)


ICE = [(590, 1420, 25), (470, 1350, -12), (600, 1280, 5), (500, 1120, 35), (600, 960, -20), (470, 860, 18)]
LIME = [(450, 1440, 8), (560, 1458, 188), (630, 1424, 20)]
MINTL = [(480, 1350, 30), (570, 1380, -40), (620, 1330, 70), (520, 1300, -15)]


def _drop(f, b, y0, ty, g):
    """Chute avec rebond amorti : (y, a-t-on atterri, tau)."""
    tau = f - b
    if tau < 0:
        return None
    tl = math.sqrt(2 * max(ty - y0, 1) / g)
    if tau < tl:
        return y0 + 0.5 * g * tau * tau, False, tau / tl
    t2 = tau - tl
    return ty - 16 * math.exp(-0.45 * t2) * abs(math.sin(1.2 * t2)), True, 1.0


def _wedge(S, x, y, a, rad=62, col=CREAM, alpha=0.88):
    pts = []
    for d in np.linspace(0, 180, 17):
        pts.append((math.cos(math.radians(d)) * rad, math.sin(math.radians(d)) * rad * 0.8))
    pts = np.array(pts)
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    P = np.stack([x + pts[:, 0] * ca - pts[:, 1] * sa, y + pts[:, 0] * sa + pts[:, 1] * ca], 1)
    C.fill_polys(S, [P], col, alpha)
    for t in (30, 60, 90, 120, 150):
        q = (math.cos(math.radians(t)) * rad * 0.9, math.sin(math.radians(t)) * rad * 0.72)
        p2 = (x + q[0] * ca - q[1] * sa, y + q[0] * sa + q[1] * ca)
        C.line(S, (x, y), p2, G_LIGHT, 1)
    C.line(S, tuple(P[0]), tuple(P[-1]), G_LIGHT, 2)


def _leaf(S, x, y, a, L=64, Wd=24):
    t = np.linspace(0, math.pi, 14)
    top = np.stack([np.cos(t) * L, -np.sin(t) * Wd], 1)
    bot = np.stack([np.cos(t[::-1]) * L, np.sin(t[::-1]) * Wd * 0.8], 1)
    pts = np.concatenate([top, bot])
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    P = np.stack([x + pts[:, 0] * ca - pts[:, 1] * sa, y + pts[:, 0] * sa + pts[:, 1] * ca], 1)
    C.fill_polys(S, [P], MINT, 0.95)
    C.line(S, (x - L * ca, y - L * sa), (x + L * ca, y + L * sa), mix_c(MINT, CREAM, 0.35), 1)


def mix_c(a, b, t):
    return tuple(int(round(v)) for v in C.mix(a, b, t))


@lru_cache(maxsize=1)
def _bubbles():
    r = rng(31)
    n = 46
    return dict(n=n, x=r.uniform(0.1, 0.9, n), b=r.uniform(0, 40, n), v=r.uniform(4.5, 9, n), rad=r.uniform(2.5, 7.5, n),
                ph=r.uniform(0, 6.3, n))


@lru_cache(maxsize=1)
def _sugar():
    r = rng(32)
    k = 70
    return r.uniform(0, 1, k), r.uniform(0, 1, k), r.uniform(1.6, 3.2, k)


def _glass_mask():
    m = np.zeros((H, W), np.uint8)
    ins = 10
    poly = np.array([[_wall_l(GL_TOP) + ins, GL_TOP], [_wall_r(GL_TOP) - ins, GL_TOP], [_wall_r(GL_BOT - 14) - ins, GL_BOT - 14],
                     [_wall_l(GL_BOT - 14) + ins, GL_BOT - 14]])
    cv2.fillPoly(m, [np.round(poly * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    return m


@lru_cache(maxsize=1)
def _glass_mask_c():
    return _glass_mask()[GL_TOP - 20:GL_BOT + 4, 300:760].copy()


def seq3_static(f):
    """Scène du mojito sans mouvement de caméra."""
    S = canvas()
    th = math.radians(12) * smooth((f - T_LIQ) / float(find("camera", "orbite 12", "b")["fin"] - T_LIQ))
    thd = th if f >= T_LIQ else 0
    dxb = 260 * thd
    # comptoir
    S[1500:WY1, WX0:WX1] = (30, 23, 20)
    cv2.line(S, (WX0, 1500), (WX1, 1500), G_MID, 1, cv2.LINE_AA)
    # barre lumineuse orange derrière le verre
    bx0, bx1 = 640 + dxb, 790 + dxb
    halo = np.zeros((1700 - 240, 520), np.float32)
    cv2.rectangle(halo, (int(bx0 - 540 + 130 + 0), 40), (int(bx1 - 540 + 130 + 0), 1380), 1.0, -1)
    halo = cv2.GaussianBlur(halo, (0, 0), 38)
    C.mask_blend(S, (halo * 150).astype(np.uint8), ORANGE, 0.55, 540 - 130, 240)
    C.blend_rect(S, bx0, 280, bx1, 1640, ORANGE, 0.55)
    C.blend_rect(S, bx0 + 20, 280, bx0 + 34, 1640, ORANGE_HI, 0.5)
    # enseigne floue qui porte le mot (roulement n° 3)
    face = roll_face(f, ROLL3, FACES3)
    sign = np.zeros((H, W), np.uint8)
    wp = C.word_polys("OFFGRIDZ", face if face else FACES3[-1])
    s, ox, _ = C.word_layout(wp, 700, 110, 540 + dxb * 0.6, 0)
    plate = np.zeros((H, W), np.uint8)
    cv2.rectangle(plate, (int(150 + dxb * 0.6), 260), (int(930 + dxb * 0.6), 470), 255, -1)
    # fill_polys écrit des couleurs : on rend le mot dans un tampon 1 canal via 3 canaux
    sg = np.zeros((H, W, 3), np.uint8)
    C.draw_word(sg, wp, (s, ox, 390), (255, 255, 255), 1.0)
    word = sg[..., 0]
    layer = np.maximum(plate // 2, word)
    roi = layer[220:520]
    roi = cv2.GaussianBlur(roi, (0, 0), 6.0)
    pl = cv2.GaussianBlur(plate[220:520], (0, 0), 6.0)
    C.mask_blend(S, (pl * 0.0 + pl).astype(np.uint8), G_DARK, 0.5, 0, 220)
    C.mask_blend(S, roi, CREAM, 0.55, 0, 220)
    # sous-verre
    co = np.zeros((90, 560), np.uint8)
    cv2.ellipse(co, (280, 40), (270, 40), 0, 0, 360, 255, -1, cv2.LINE_AA)
    C.mask_blend(S, co, CREAM, 0.20, 260, 1490)
    # intérieur du verre
    gm = _glass_mask()
    layer = S.copy()
    lev = _liquid_level(f)
    ox0, oy0 = 0, 0
    # sucre au fond (216–263) puis liquide
    sx, sy, sr = _sugar()
    gx0, gx1 = _wall_l(GL_BOT - 14) + 14, _wall_r(GL_BOT - 14) - 14
    px = gx0 + sx * (gx1 - gx0)
    py = 1470 + sy * 14
    if f < T_LIQ + 50:
        fade = 1.0 if f < T_LIQ else 1 - smooth((f - T_LIQ) / 50.0)
        sc = np.array(AMBER, np.float32)
        n_s = len(sx)
        C.grains(layer, px, py, sr, (np.ones((n_s, 1), np.float32) * sc * fade + np.array(BLACK, np.float32) * 0).astype(np.uint8))
    # citron vert
    for i, (tx, ty, a) in enumerate(LIME):
        d = _drop(f, T_LIME + i, 520, ty, 12.0)
        if d is not None:
            _wedge(layer, tx, d[0], a + (1 - d[2]) * 80 * (1 if i % 2 else -1))
    # menthe
    for i, (tx, ty, a) in enumerate(MINTL):
        d = _drop(f, T_MINT + i, 520, ty, 12.0)
        if d is not None:
            _leaf(layer, tx, d[0], a + (1 - d[2]) * 60)
    # glaçons (les plus bas tombent d'abord)
    for i, (tx, ty, a) in enumerate(ICE):
        d = _drop(f, T_ICE + 3 * i, 560, ty, 3.2)
        if d is not None:
            ang = a + (1 - d[2]) * 90 * (1 if i % 2 else -1)
            P = _cube_poly(tx, d[0], ang, 44)
            C.fill_polys(layer, [P], CREAM, 0.42)
            cv2.polylines(layer, [np.round(P * 16).astype(np.int32)], True, CREAM, 1, cv2.LINE_AA, 4)
    # liquide : voile, teinte ambrée du sucre, surface
    if f >= T_LIQ:
        liq = np.zeros((H, W), np.uint8)
        cv2.rectangle(liq, (300, int(lev)), (780, 1500), 255, -1)
        amb = layer.copy()
        yy = np.arange(1500)[:, None]
        ramp = np.clip((yy - (lev + 30)) / max(1500 - lev - 30, 1), 0, 1) ** 1.3
        am_a = np.clip(0.10 + 0.38 * smooth((f - T_LIQ) / 60.0), 0, 0.5)
        sub = layer[:1500, 300:780].astype(np.float32)
        veil = np.array(G_LIGHT, np.float32)
        a_veil = (liq[:1500, 300:780, None] / 255.0) * 0.20
        sub = sub + (veil - sub) * a_veil
        a_am = (liq[:1500, 300:780, None] / 255.0) * ramp[:, :1, None] * am_a
        sub = sub + (np.array(AMBER, np.float32) - sub) * a_am
        layer[:1500, 300:780] = np.clip(sub, 0, 255).astype(np.uint8)
        wob = 3 * math.sin(f * 0.5)
        C.line(layer, (330, lev + wob), (750, lev - wob), CREAM, 2, 0.8)
        # volutes ambrées du sucre
        r = rng(34)
        for k in range(7):
            x0 = gx0 + r.uniform(0.05, 0.95) * (gx1 - gx0)
            hmax = r.uniform(180, 460)
            hh = hmax * smooth((f - T_LIQ - k * 2) / 40.0)
            if hh < 5:
                continue
            ys = np.linspace(1480, 1480 - hh, 14)
            xs = x0 + 22 * np.sin(ys / 38.0 + f * 0.11 + k)
            pts = np.stack([xs, ys], 1)
            for i in range(len(pts) - 1):
                if pts[i + 1][1] > lev:
                    C.line(layer, tuple(pts[i]), tuple(pts[i + 1]), AMBER, 5, 0.38 * (1 - smooth((f - 320) / 30.0)))
        # bulles
        B = _bubbles()
        for i in range(B["n"]):
            age = f - T_LIQ - B["b"][i]
            if age < 0:
                continue
            y = 1480 - ((B["v"][i] * age) % (1480 - lev + 40))
            if y < lev:
                continue
            x = gx0 + B["x"][i] * (gx1 - gx0) + 6 * math.sin(age * 0.3 + B["ph"][i])
            cv2.circle(layer, (int(x), int(y)), int(B["rad"][i]), CREAM, 1, cv2.LINE_AA)
        # versement
        jet_end = T_LIQ + 41
        if f <= jet_end + 8:
            u = clamp01((f - T_LIQ) / 8.0)
            fade = 1 - clamp01((f - jet_end) / 8.0)
            p0, p1, p2 = np.array([220, 220.]), np.array([340, 400.]), np.array([440, max(lev - 280, 520)])
            p3 = np.array([500.0, lev])
            tt = np.linspace(0, u, 24)[:, None]
            Bz = (1 - tt) ** 3 * p0 + 3 * (1 - tt) ** 2 * tt * p1 + 3 * (1 - tt) * tt ** 2 * p2 + tt ** 3 * p3
            for i in range(len(Bz) - 1):
                C.line(layer, tuple(Bz[i]), tuple(Bz[i + 1]), CREAM, 12, 0.5 * fade)
    # verre découpé
    m3 = gm[..., None].astype(np.float32) / 255
    roi0 = max(GL_TOP - 20, 0)
    sub = S[:, :].astype(np.float32)
    S[:, :] = np.clip(sub + (layer.astype(np.float32) - sub) * m3 + 0.5, 0, 255).astype(np.uint8)
    # contour du verre
    left = [(_wall_l(GL_TOP), GL_TOP), (_wall_l(GL_BOT), GL_BOT)]
    right = [(_wall_r(GL_TOP), GL_TOP), (_wall_r(GL_BOT), GL_BOT)]
    C.line(S, left[0], left[1], CREAM, 2, 0.6)
    C.line(S, right[0], right[1], CREAM, 2, 0.6)
    C.line(S, left[1], right[1], CREAM, 2, 0.6)
    ell = np.zeros((60, 440), np.uint8)
    cv2.ellipse(ell, (220, 30), (180, 16), 0, 0, 360, 255, 1, cv2.LINE_AA)
    C.mask_blend(S, ell, CREAM, 0.4, 320, GL_TOP - 30)
    C.line(S, (385, 740), (417, 1440), CREAM, 3, 0.28)
    # paille noire
    if f >= T_STRAW:
        tau = f - T_STRAW
        off = -900 * (1 - smooth(tau / 5.0)) if tau < 5 else (8 * math.exp(-0.5 * (tau - 5)) * math.sin(1.3 * (tau - 5)) if tau < 14 else 0)
        top = np.array([660.0 + dxb * 0.0, 400 + off])
        bot = np.array([570.0, 1470 + off])
        v = bot - top
        nrm = np.array([-v[1], v[0]]) / np.hypot(*v)
        w = 12
        P = np.array([top + nrm * w, top - nrm * w, bot - nrm * w, bot + nrm * w])
        C.fill_polys(S, [P], BLACK, 1.0)
        C.line(S, tuple(top + nrm * (w - 3)), tuple(bot + nrm * (w - 3)), CREAM, 2, 0.45)
        C.line(S, tuple(P[0]), tuple(P[3]), CREAM, 1, 0.25)
        ell2 = np.zeros((40, 80), np.uint8)
        cv2.ellipse(ell2, (40, 20), (15, 6), 0, 0, 360, 255, -1, cv2.LINE_AA)
        ang = math.degrees(math.atan2(v[1], v[0])) - 90
        C.mask_blend(S, ell2, (30, 24, 20), 1.0, int(top[0] - 40), int(top[1] - 20))
        cv2.ellipse(S, (int(top[0]), int(top[1])), (15, 6), 0, 0, 360, CREAM, 1, cv2.LINE_AA)
    return S


def seq3(f):
    a, b = SEQ[3]
    S = seq3_static(f)
    # caméra : bascule trois-quarts (216–263), quasi fixe (héros), puis entrée dans la paille
    cam_bas = find("camera", "bascule", "b")
    u = smooth((f - cam_bas["debut"]) / float(cam_bas["fin"] - cam_bas["debut"] + 1))
    z = 1 + 0.07 * (1 - u)
    ax, ay = CX0, 1000 + 40 * (1 - u)
    fx, fy = 540, 1000
    if f >= T_HERO0:
        z *= 1 + 0.004 * (f - T_HERO0) / 24.0
    if f >= T_ENTER:
        t = clamp01((f - T_ENTER) / float(T_BLACK - T_ENTER))
        z = math.exp(math.log(18.0) * t ** 1.6)
        fx, fy = 660, 400
        e = smooth(t * 1.3)
        ax, ay = lerp(fx, CX0, e), lerp(fy, CY0, e)
    elif f > T_ENTER - 1:
        pass
    M = np.array([[z, 0, ax - z * fx], [0, z, ay - z * fy]], np.float32)
    S2 = cv2.warpAffine(S, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=BLACK)
    if f >= T_ENTER:
        t = clamp01((f - (T_ENTER + 10)) / float(T_BLACK - (T_ENTER + 10)))
        S2 = (S2.astype(np.float32) * (1 - smooth(t))).astype(np.uint8)
        if f >= T_BLACK:
            S2[:] = BLACK
    # fondu enchaîné très court depuis la dernière image de la séquence 2
    if f < a + 4:
        prev = seq2(a - 1)[0]
        w = 1 - (f - a + 1) / 5.0
        S2 = np.clip(S2.astype(np.float32) * (1 - w) + prev.astype(np.float32) * w + 0.5, 0, 255).astype(np.uint8)
    return S2, None


# ======================================================================================
# Séquence 4 : champ de points, roulement n° 4 (graisse continue), relief du portrait
# ======================================================================================
NP = 11000


@lru_cache(maxsize=1)
def _points():
    r = rng(4)
    n = NP
    a4, b4 = SEQ[4]
    nf = b4 - a4 + 2
    # champ de vitesse sans divergence : fonction de courant en sommes de sinus
    k = 2 * math.pi / r.uniform(380, 900, 5)
    th = r.uniform(0, 2 * math.pi, 5)
    kx, ky = k * np.cos(th), k * np.sin(th)
    om = r.uniform(-0.06, 0.06, 5)
    ph = r.uniform(0, 6.28, 5)
    amp = 1.9 / k
    x = r.uniform(WX0, WX1, n)
    y = r.uniform(WY0, WY1, n)
    traj = np.empty((nf, n, 2), np.float32)
    for t in range(nf):
        traj[t, :, 0], traj[t, :, 1] = x, y
        u = np.zeros(n)
        v = np.zeros(n)
        for i in range(5):
            c = np.cos(kx[i] * x + ky[i] * y + om[i] * t + ph[i])
            u += amp[i] * ky[i] * c
            v -= amp[i] * kx[i] * c
        x = WX0 + (x + u * 1.5 - WX0) % WINW
        y = WY0 + (y + v * 1.5 - WY0) % WINH
    col = np.stack([540 + r.normal(0, 14, n), r.uniform(260, 1650, n)], 1)
    # cibles : portrait en relief échantillonné sur layer_photo, sans la zone de la bande déchirée
    L = C.logo_layers()
    ph_a = L["photo"][..., 3]
    lum = L["photo"][..., :3].mean(2)
    strip = (L["strip"][..., 3] > 0.02).astype(np.uint8)
    strip = cv2.dilate(strip, np.ones((9, 9), np.uint8)) > 0
    w = np.where((ph_a > 0.9) & (lum > 0.13) & (~strip), lum ** 0.9, 0).astype(np.float64)
    # moins de points dans le noir de fond : on retient la silhouette (cercle du logo) seulement
    cc = C.logo_geom()["circle"]["px"]["best_fit_circle"]
    yy, xx = np.mgrid[:LOGO_S, :LOGO_S]
    d = np.hypot((xx / K - cc["centre"][0]), (yy / K - cc["centre"][1]))
    w[d > cc["radius"] * 0.97] = 0
    w = w.ravel()
    w /= w.sum()
    idx = r.choice(w.size, n, p=w)
    iy, ix = np.divmod(idx, LOGO_S)
    tgt = np.stack([LOGO_X + ix + r.random(n) - 0.5, LOGO_Y + iy + r.random(n) - 0.5], 1)
    z = lum.ravel()[idx]
    band = L["band"][..., 3].ravel()[idx] > 0.6
    return dict(traj=traj, col=col, tgt=tgt, z=z, band=band, strip=strip, r=r.uniform(0.0, 1.0, n), n=n)


def seq4(f):
    S = canvas()
    a, b = SEQ[4]
    P = _points()
    t = f - a
    n = P["n"]
    field = P["traj"][t]
    # les gouttes du tube deviennent des points : colonne -> champ
    g0 = smooth(t / 18.0)
    pos = P["col"] + (field - P["col"]) * g0
    # apparition progressive des points
    vis = P["r"] < (0.18 + 0.82 * smooth(t / 24.0))
    # camera : dérive lente 360-407
    drift_f = clamp01(t / float(ROLL4["fin"] - a))
    # rassemblement vers le portrait à partir de la fin du roulement n° 4
    gs = ROLL4["fin"] + 1
    gat = smooth((f - (gs - 6)) / 28.0)
    pos = pos + (P["tgt"] - pos) * gat
    # orbite de 20 degrés (parallaxe) puis recul accéléré
    orb = find("camera", "orbite 20", "b")
    th = math.radians(20) * smooth((f - orb["debut"]) / float(orb["fin"] - orb["debut"]))
    pos = pos.copy()
    pos[:, 0] += (P["z"] - 0.4) * 120 * math.sin(th) * gat
    rec = find("camera", "recul accéléré", "b")
    u = clamp01((f - rec["debut"]) / float(rec["fin"] - rec["debut"]))
    zc = lerp(1.0, 0.62, u ** 2)
    dep = np.where(P["band"], lerp(1.0, 0.22, u ** 1.6), 1.0)
    cen = np.array([CX0, CY0])
    zoomd = 1 + 0.07 * drift_f
    scale = zc / dep * np.where(P["band"] & (gat > 0.5), 1.0, 1.0)
    pos = cen + (pos - cen) * (scale * zoomd)[:, None]
    size = (0.7 + 1.1 * P["z"]) * (1.0 / dep) ** 0.9
    # la bande de la fenêtre (strip) ne doit jamais être remplie : on retire les points qui y tombent après le rassemblement
    ok = vis.copy()
    if gat > 0.15:
        lx = np.clip(((pos[:, 0] - cen[0]) / (zc * zoomd) + cen[0] - LOGO_X).astype(int), 0, LOGO_S - 1)
        ly = np.clip(((pos[:, 1] - cen[1]) / (zc * zoomd) + cen[1] - LOGO_Y).astype(int), 0, LOGO_S - 1)
        ok &= ~(P["strip"][ly, lx] & (np.arange(n) % 1 == 0))
    # mot en Doto, graisse continue (roulement n° 4)
    if a <= f <= gs + 5 and f <= ROLL4["fin"] + 6:
        u2 = clamp01((f - ROLL4["debut"]) / float(ROLL4["fin"] - ROLL4["debut"]))
        if f >= ROLL4["debut"]:
            wgt = 500 + 400 * math.cos(2 * math.pi * u2)
            ak = C.axes_key(wght=round(wgt, 1), ROND=0)
            wp = C.word_polys("OFFGRIDZ", "doto-var", ak)
            s, ox, _ = C.word_layout(wp, 840, 130, 540, 0)
            op = 1.0 if f <= ROLL4["fin"] else 1 - (f - ROLL4["fin"]) / 6.0
            C.draw_word(S, wp, (s, ox, 1000), CREAM, op)
    # dessin des points
    cream = np.array(CREAM, np.float32)
    grey = np.array(G_MID, np.float32)
    zz = P["z"][:, None]
    cols = (grey + (cream - grey) * np.clip(zz * 1.4, 0, 1)).astype(np.uint8)
    cols[P["band"]] = np.array(ORANGE, np.uint8)
    hi = P["band"] & (P["r"] > 0.7)
    cols[hi] = np.array(ORANGE_HI, np.uint8)
    idx = np.nonzero(ok)[0]
    # points éloignés du fond : un peu plus ternes
    C.grains(S, pos[idx, 0], pos[idx, 1], size[idx] * 0.9, cols[idx])
    return S, int(len(idx))


# ======================================================================================
# Séquence 5 : déferlement, encre, raclette
# ======================================================================================
@lru_cache(maxsize=1)
def _burst():
    r = rng(5)
    n = 9000
    p0 = np.stack([540 + r.normal(0, 70, n), 960 + r.normal(0, 380, n)], 1)
    ang = np.arctan2(p0[:, 1] - CY0 + r.normal(0, 40, n), p0[:, 0] - CX0 + r.normal(0, 40, n)) + r.normal(0, 0.18, n)
    v = r.uniform(3.5, 16.0, n)
    return dict(p0=p0, ang=ang, v=v, rad=r.uniform(3.0, 7.0, n), col=var_color(ORANGE, n, r, 0.08))


@lru_cache(maxsize=1)
def _ink_grain():
    r = rng(51)
    img = np.empty((H, W, 3), np.uint8)
    img[:] = ORANGE
    n = 9000
    xs, ys = r.uniform(-5, W + 5, n), r.uniform(-5, H + 5, n)
    C.grains(img, xs, ys, r.uniform(3, 8, n), var_color(ORANGE, n, r, 0.10))
    return img


@lru_cache(maxsize=1)
def _gloss_grid():
    yy, xx = np.mgrid[:H // 2, :W // 2].astype(np.float32)
    return xx * 2, yy * 2


def ink_flat(f):
    """Film d'encre brillant : orange plat, dégradé léger et reflets qui se déplacent."""
    xx, yy = _gloss_grid()
    t = f - T_INK
    base = np.empty((H // 2, W // 2, 3), np.float32)
    base[:] = ORANGE
    shade = (1 - 0.10 * (yy / H))[..., None]
    base = base * shade
    # reflets : deux traînées diagonales qui glissent
    ph = 0.8
    u = xx * math.cos(ph) + yy * math.sin(ph)
    p1 = -400 + 52 * t
    h1 = np.exp(-(((u - p1) / 110.0) ** 2))
    h2 = np.exp(-(((u - (p1 - 380)) / 36.0) ** 2)) * 0.7
    hl = np.clip(h1 * 0.55 + h2, 0, 1)[..., None]
    hi = np.array(ORANGE_HI, np.float32)
    base = base + (hi - base) * np.clip(hl * 1.4, 0, 1)
    base = base + (np.array(CREAM, np.float32) - base) * (hl * 0.32)
    return cv2.resize(np.clip(base, 0, 255).astype(np.uint8), (W, H), interpolation=cv2.INTER_LINEAR)


def seq5_under(f):
    """Ce qui est sous l'encre : feuille noire, puis logo imprimé pendant la raclette."""
    S = canvas()
    if f >= T_SQ["debut"]:
        S[LOGO_Y:LOGO_Y + LOGO_S, LOGO_X:LOGO_X + LOGO_S] = C.logo_source()
    return S, None


def sq_geometry(f):
    """Position de la raclette (haut du tampon), constante en vitesse de au-dessus à au-dessous de la feuille."""
    d0, d1 = T_SQ["debut"], T_SQ["fin"]
    B = 92
    u = (f - d0) / float(d1 - d0)
    y0 = 24 - B                       # image d0 : la raclette entre par le haut (24 px visibles)
    return y0 + u * (H - y0), B       # image d1 : son bord haut touche le bas de la feuille ; vitesse constante


def seq5_overlay(f, F):
    """Dessine l'encre sur la feuille complète F (marges comprises). Renvoie le nombre de grains."""
    a = SEQ[5][0]
    n_g = None
    if f < T_INK:
        tau = f - a
        B = _burst()
        R = 14.6 * (tau + 1) ** 1.45
        layer = F.copy()
        cv2.circle(layer, (int(CX0), int(CY0)), int(R), tuple(int(v) for v in np.array(ORANGE) * 0.94), -1, cv2.LINE_AA)
        d = B["v"] * (tau + 1) ** 1.45
        x = B["p0"][:, 0] + np.cos(B["ang"]) * d
        y = B["p0"][:, 1] + np.sin(B["ang"]) * d
        rad = B["rad"] * (1 + 0.16 * tau)
        C.grains(layer, x, y, rad, B["col"])
        n_g = int(len(x))
        if f >= T_INK - 5:
            w = smooth((f - (T_INK - 5)) / 4.0)
            layer = np.clip(layer.astype(np.float32) * (1 - w) + _ink_grain().astype(np.float32) * w + 0.5, 0, 255).astype(np.uint8)
        if tau < 6:                                # les grains butent d'abord contre les bords de la fenêtre
            F[WY0:WY1, WX0:WX1] = layer[WY0:WY1, WX0:WX1]
        else:
            F[:] = layer
        return n_g
    # encre : grains qui fusionnent en film brillant
    flat = ink_flat(f)
    w = smooth((f - T_INK) / float(T_SQ["debut"] - T_INK - 1))
    ink = np.clip(_ink_grain().astype(np.float32) * (1 - w) + flat.astype(np.float32) * w + 0.5, 0, 255).astype(np.uint8)
    if f < T_SQ["debut"]:
        F[:] = ink
        return None
    ytop, B = sq_geometry(f)
    y_top = int(round(ytop))
    y_bot = y_top + B
    # sous la raclette : encre ; au-dessus : feuille imprimée (déjà dans F)
    if y_bot < H:
        F[max(y_bot, 0):] = ink[max(y_bot, 0):]
    # la raclette : monture d'aluminium, caoutchouc crème, bourrelet d'encre
    if y_bot > 0 and y_top < H:
        C.blend_rect(F, 0, y_top, W, y_top + 22, G_MID, 1.0)
        C.blend_rect(F, 0, y_top + 22, W, y_bot - 12, CREAM, 1.0)
        C.blend_rect(F, 0, y_bot - 12, W, y_bot, G_LIGHT, 1.0)
        C.blend_rect(F, 0, y_top + 22, W, y_top + 25, (255, 250, 244), 0.55)
        C.blend_rect(F, 0, y_bot, W, y_bot + 6, ORANGE_HI, 0.9)
    return None


# ======================================================================================
# Séquence 6 : signature
# ======================================================================================
@lru_cache(maxsize=1)
def _sig_words():
    out = []
    for txt in ("Hors-grille.", "Sous contrôle."):
        wp = C.word_polys(txt, "archivo-var", C.axes_key(wdth=125, wght=800))
        out.append((txt, wp))
    wmax = max(wp[2][2] - wp[2][0] for _, wp in out)
    s = 620.0 / wmax                              # même corps pour les deux lignes
    lays = []
    for (txt, wp), by in zip(out, (330, 410)):
        x0, _, x1, _ = wp[2]
        lays.append((wp, (s, 540 - (x0 + x1) / 2 * s, by)))
    return lays


def seq6(f):
    S = canvas()
    S[LOGO_Y:LOGO_Y + LOGO_S, LOGO_X:LOGO_X + LOGO_S] = C.logo_source()
    return S, None


def draw_signature(F, f, alpha):
    """Plus de phrase de signature : le film finit sur le logo seul (décision du client du 13/11)."""
    return


# ======================================================================================
def window(f):
    """Renvoie (toile, compteur de particules ou None) pour l'image f ; seule la fenêtre compte."""
    for i in (0, 1, 2, 3, 4, 5, 6):
        a, b = SEQ[i]
        if a <= f <= b:
            break
    if i == 0:
        return seq0(f)
    if i == 1:
        return seq1(f)
    if i == 2:
        return seq2(f)
    if i == 3:
        return seq3(f)
    if i == 4:
        return seq4(f)
    if i == 5:
        return seq5_under(f)
    return seq6(f)


def seq_index(f):
    for i in range(7):
        a, b = SEQ[i]
        if a <= f <= b:
            return i
