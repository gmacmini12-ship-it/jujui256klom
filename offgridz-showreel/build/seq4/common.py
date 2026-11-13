"""Constantes et fonctions de temps/caméra partagées par la séquence 4 « Données ».

Monde : unités = pixels dans le plan z = 0 vu par la caméra neutre (focale = distance = D).
x vers la droite, y vers le haut, z vers le spectateur.  Fenêtre image 1008x1512.
"""
import math
import numpy as np

ROOT = __file__.rsplit("/build/seq4/", 1)[0]
OUT = ROOT + "/out/seq4"
CACHE = OUT + "/cache"

W0, H0 = 1008, 1512            # fenêtre image (px)
F0 = 100                       # première image de la séquence : 360
FIRST, LAST = 360, 455
D = 1800.0                     # distance caméra-plan z=0 ; focale en px = D (échelle 1:1 à z=0)
FOCAL = 1800.0
LOGO = 1008.0                  # côté du logo dans la fenêtre (px)
LOGO_PX = 1254                 # côté du calque
ZH = 130.0                     # demi-profondeur du bas-relief
VP = np.array([0.0, 450.0, D - 9000.0], np.float32)   # point source (point de fuite, un peu au-dessus du centre)
VP_RADIUS = 350.0

COLORS_HEX = {"cream": "#EEDFD2", "orange": "#EA470F", "orange_hi": "#F65726"}


def srgb_to_lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_lin(h):
    h = h.lstrip("#")
    return srgb_to_lin(np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]) / 255.0).astype(np.float32)


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ temps du mot (roulement n°4)
WORD_F0, WORD_F1 = 384, 407          # images du roulement (partition.json)


def wght_at(tf):
    """Axe wght : 100 -> 900 en continu sur les images 384..407 (borné en dehors)."""
    return 100.0 + 800.0 * min(max((tf - WORD_F0) / (WORD_F1 - WORD_F0), 0.0), 1.0)


# ------------------------------------------------------------------ caméra
ORBIT_DEG = 20.0


def camera(tf):
    """Caméra à l'image (flottante) tf.  Renvoie dict : C, right, up, fwd, zf (distance de mise au point),
    aperture (diamètre d'ouverture, unités monde), focal."""
    # dérive 360-407 : translation lente freinée (amplitude -> 0 en 407)
    s = min(max((tf - 360.0) / 47.0, 0.0), 1.0)
    e = (1 - s) ** 2
    dx, dy, dz = 70.0 * e, -26.0 * e, -400.0 * e
    # orbite 408-431 (20 degrés, départ et arrivée à vitesse nulle)
    th = math.radians(ORBIT_DEG) * smooth((tf - 408.0) / 24.0)
    # recul accéléré 432-455
    q = min(max((tf - 432.0) / 23.0, 0.0), 1.0)
    pull = 2900.0 * q ** 2.2
    R = D + dz + pull
    P = np.zeros(3)
    n = np.array([math.sin(th), 0.0, math.cos(th)])
    C = P + R * n + np.array([dx, dy, 0.0])
    fwd = -n
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    # ouverture : mot (net, fond flou) -> relief (net) -> grandes bokehs à la fin
    A = 20.0
    A = lerp(A, 12.0, smooth((tf - 402.0) / 10.0))
    A = lerp(A, 230.0, smooth((tf - 436.0) / 19.0) ** 1.3)
    return dict(C=C.astype(np.float32), right=right.astype(np.float32), up=up.astype(np.float32),
                fwd=fwd.astype(np.float32), zf=float(R), aperture=float(A), focal=FOCAL)
