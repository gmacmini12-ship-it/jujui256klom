"""Séquence 1 : chronologie et poses (fonctions pures du numéro d'image).

Monde : unités = pixels de fenêtre dans le plan z = 0 de la feuille vue de face ; x droite, y haut, z vers le spectateur.
Origine = centre de la fenêtre (504, 756). Importé par sim_strip.py (numpy) et par scene.py (Blender).
"""
import math

FPS = 30
D0 = 1800.0                       # distance de la caméra au plan de la feuille au départ ; focale en px = D0
WIN_W, WIN_H = 1008, 1512

# ---- constantes de mise en scène (une seule source de vérité)
SHEET_T = 22.0
LET_ZBACK = 150.0                 # z de la face arrière des lettres une fois levées
LET_DEPTH = 55.0                  # épaisseur d'extrusion
SLAB_W, SLAB_H, SLAB_T = 202.45, 818.8, 60.74
SLAB_X0, SLAB_Y0 = 155.75, 41.64  # centre au repos (x, y), mesuré sur la bande du logo
SLIT_MID = 24.6                   # milieu de l'intervalle libre commun de la fente sur la largeur de la dalle
THETA_POST = math.radians(58.0)   # inclinaison de la dalle pendant le passage dans la fente
DRIFT = (26.0, -45.0)             # dérive de la feuille (dx, dz) en parallaxe
FLOOR_Y = SLAB_Y0 - SLAB_H / 2.0  # sol : la dalle debout y repose
SLAB_F = (-200.0, SLAB_Y0, -1050.0)   # position finale (centre) de la dalle, monde
F_END = 800.0                     # focale finale (px)
CAM_END = (-300.0, -60.0, -150.0)
O_CENTRE = (-345.8, 23.2)         # centre de la contre-forme du O de Bodoni (mesuré dans le cache)
Z_LET_MID = LET_ZBACK + LET_DEPTH / 2.0


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ss(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def sss(x):
    x = clamp01(x)
    return x * x * x * (x * (6 * x - 15) + 10)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp3(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(3))


def pchip(xs, ys, x):
    """Interpolation monotone de Hermite (Fritsch-Carlson), bornée aux extrémités."""
    n = len(xs)
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else 2 * d[i - 1] * d[i] / (d[i - 1] + d[i])
    for i in range(n - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / h[i]
            h00 = 2 * t**3 - 3 * t**2 + 1
            h10 = t**3 - 2 * t**2 + t
            h01 = -2 * t**3 + 3 * t**2
            h11 = t**3 - t**2
            return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
    return ys[-1]


# ---------------------------------------------------------------- éclairage : "à plat" (0) -> éclairé (1)
def light_mix(f):
    return ss((f - 11.0) / 11.0)


# ---------------------------------------------------------------- lueur (images 6-11)
def glint_pos(f, x_a=-436.0, x_b=436.0):
    """Abscisse monde du centre de la lueur, ou None. Traverse la fente de gauche à droite sur les images 6 à 11."""
    p = (f - 6.0) / 5.0
    if p < 0 or p > 1.05:
        return None
    return lerp(x_a - 30, x_b + 30, p)


# ---------------------------------------------------------------- dérive de la feuille
def sheet_drift(f):
    s = ss((f - 24.0) / 20.0)
    return (DRIFT[0] * s, 0.0, DRIFT[1] * s)


# ---------------------------------------------------------------- lettres
def letters_state(f):
    """(z_arrière, profondeur, échelle dans le plan) du mot ; l'échelle garde l'empreinte de la face avant."""
    a = ss((f - 12.0) / 12.0)
    b = ss((f - 12.0) / 10.0)
    zb = lerp(0.8, LET_ZBACK, a)
    dp = lerp(0.6, LET_DEPTH, b)
    if f == 45:                       # calage mécanique d'une image, 2 % en profondeur
        zb -= 0.02 * (zb + dp)
    s = (D0 - (zb + dp)) / D0
    return zb, dp, s


def letters_face(f):
    """Identifiant du jeu de lettres à l'image f (None avant l'image 12)."""
    roll = ["archivo-var", "anton", "permanent-marker", "saira-stencil-one", "doto-var",
            "major-mono-display", "instrument-serif-italic", "bodoni-moda-var"]
    if f < 12:
        return None
    if f < 24:
        return "orig"
    return roll[min((int(f) - 24) // 3, 7)]


# ---------------------------------------------------------------- dalle orange
def _rot_u(theta):
    """axe long (de bas en haut) et normale de la face avant pour une inclinaison theta (haut vers l'arrière)."""
    return (0.0, math.cos(theta), -math.sin(theta)), (0.0, math.sin(theta), math.cos(theta))


def slab_print_mix(f):
    """0 = encore l'impression de la bande (image 12), 1 = pigment pressé."""
    return ss((f - 12.5) / 7.5)


def _slab_local(f):
    """Pose dans le repère de la feuille : (cx, cy, cz, theta, epaisseur)."""
    hl = SLAB_H / 2.0
    zf = lerp(0.5, 70.0, ss((f - 12.0) / 11.0))                 # face avant
    th = lerp(1.0, SLAB_T, ss((f - 12.0) / 12.0))               # épaisseur
    ez0 = zf - th / 2.0                                        # z du centre
    # point d'attaque (milieu de la tranche supérieure) : la droite d'insertion passe par le milieu de la fente à z = 0
    tt = THETA_POST
    u, n = _rot_u(tt)
    zE = 40.0
    yE0 = SLIT_MID - zE * math.cos(tt) / math.sin(tt)           # E_y quand E_z = zE pour que la droite passe par (SLIT_MID, 0)
    s_end = 920.0
    if f <= 24:
        return (SLAB_X0, SLAB_Y0, ez0, 0.0, th)
    if f <= 32:                                                # glissement vers le bas : la tranche haute vient devant la fente
        a = ss((f - 24.0) / 8.0)
        cy = lerp(SLAB_Y0, yE0 - hl, a)
        return (SLAB_X0, cy, lerp(ez0, zE, a), 0.0, th)
    if f <= 38:                                                # bascule vers l'arrière autour de la tranche haute
        a = ss((f - 32.0) / 6.0)
        t = tt * a
        u, n = _rot_u(t)
        E = (SLAB_X0, yE0, zE)
        c = (E[0] - u[0] * hl, E[1] - u[1] * hl, E[2] - u[2] * hl)
        return (c[0], c[1], c[2], t, th)
    # poussée le long de l'axe : la tranche haute traverse la fente en premier
    a = ss((f - 38.0) / 8.0)
    s = s_end * a
    E = (SLAB_X0, yE0 + s * u[1], zE + s * u[2])
    c = (E[0] - u[0] * hl, E[1] - u[1] * hl, E[2] - u[2] * hl)
    return (c[0], c[1], c[2], tt, th)


def slab_pose(f):
    """Pose monde : (cx, cy, cz, theta, épaisseur). La dérive de la feuille s'applique jusqu'à la poussée incluse."""
    f0 = min(f, 46.0)
    cx, cy, cz, th, t = _slab_local(f0)
    dx, _, dz = sheet_drift(f0)
    cx, cz = cx + dx, cz + dz
    if f <= 46:
        return (cx, cy, cz, th, t)
    # derrière la feuille : se redresse et vole jusqu'à la position finale, se pose sur le sol
    a = ss((f - 46.0) / 12.0)
    ang = lerp(th, 0.0, ss((f - 46.0) / 10.0))
    pos = lerp3((cx, cy, cz), SLAB_F, a)
    # petit calage à l'arrivée : la base ne descend jamais sous le sol
    hl = SLAB_H / 2.0
    ymin = pos[1] - hl * math.cos(ang) - t / 2 * math.sin(ang)
    if ymin < FLOOR_Y:
        pos = (pos[0], pos[1] + (FLOOR_Y - ymin), pos[2])
    return (pos[0], pos[1], pos[2], ang, t)


# ---------------------------------------------------------------- caméra
_ZK = [(24, 1800.0), (47, 1580.0), (50, 1210.0), (53, 780.0), (56, 380.0), (58, 215.0), (60, 125.0),
       (62, 50.0), (63.5, -25.0), (65, -85.0), (68, -122.0), (71, CAM_END[2])]


def cam_z(f):
    if f <= 24:
        return D0
    xs = [k[0] for k in _ZK]
    ys = [k[1] for k in _ZK]
    return pchip(xs, ys, f)


def cam_focal(f):
    return lerp(D0, F_END, ss((f - 54.0) / 12.0))


def cam_state(f):
    """(position, cible, focale px). Caméra de niveau (haut = +y), pas de roulis."""
    z = cam_z(f)
    z47 = cam_z(47)
    zc = Z_LET_MID
    ox, oy = O_CENTRE
    x47, y47 = -40.0, 6.0
    if f <= 47:
        s = ss((f - 24.0) / 23.0)
        x, y = lerp(0.0, x47, s), lerp(0.0, y47, s)
    elif z > zc:
        h = ss((z47 - z) / (z47 - zc))
        x, y = lerp(x47, ox, h), lerp(y47, oy, h)
    else:
        g = ss(clamp01((-60.0 - z) / (-60.0 - CAM_END[2])))
        x, y = lerp(ox, CAM_END[0], g), lerp(oy, CAM_END[1], g)
    pos = (x, y, z)
    straight = (x, y, z - 1000.0)
    tc = (ox, oy, zc)
    ahead = (ox, oy, z - 800.0)
    if f <= 47:
        tgt = straight
    else:
        q = ss((zc + 250.0 - z) / 250.0)
        toward = lerp3(tc, ahead, q) if z > zc else ahead
        tgt = lerp3(straight, toward, ss((f - 47.0) / 3.0))
        w = ss((f - 60.0) / 9.0)
        tgt = lerp3(tgt, SLAB_F, w)
    return pos, tgt, cam_focal(f)
