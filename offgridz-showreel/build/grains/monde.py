"""Séquence 2 — géométrie et horloge de l'atelier, partagées par la simulation (Taichi) et par le rendu (Blender).
Python pur : aucun import lourd ici.

Repère de l'atelier (mètres) : le sol est le plan z = 0, la dalle orange est adossée au mur y = 0, la caméra
regarde vers +y. Le sol s'arrête à y = SOL_BORD ; une fente dans le sol, le bec, laisse couler un filet de grains
vers un entonnoir, puis vers le verre posé DENIVELE plus bas (voir build/mojito).
"""
import math

IPS = 30
IMAGE_0 = 72                    # t = 0 : premier temps de la mesure 2
RALENTI = 0.35                  # temps réel écoulé par seconde de film dans l'atelier
RAMPE = (198, 216)              # retour progressif au temps réel avant la séquence du mojito

DALLE_LO = (-0.030, -0.012, 0.0)     # la bande du logo devenue dalle de pigment pressé : 60 x 12 x 240 mm
DALLE_HI = (0.030, 0.0, 0.240)
MUR_Y = 0.0005
SOL_BORD = -0.150               # bord avant du sol
BEC_AVANT = -0.115              # la fente du bec, dans le sol, va d'ici...
BEC_Y = -0.068                  # ... jusqu'ici
BEC_DEMI = 0.007                # demi-largeur de la fente
SOL_EP = 0.022                  # épaisseur du sol
# sous la fente, un entonnoir de plâtre resserre les grains en un filet vertical (col de sablier)
ENTONNOIR_Y = 0.5 * (BEC_AVANT + BEC_Y)      # axe de l'entonnoir, et donc du verre, 80 cm plus bas
ENTONNOIR_HAUT = (0.034, -0.022)             # rayon et hauteur de la bouche
ENTONNOIR_BAS = (0.009, -0.080)              # rayon et hauteur du col
ENTONNOIR_TUBE = -0.130                       # sous le col, un tube vertical redresse le filet
ENTONNOIR_PAROI = 0.004
LETTRES_Y = -0.040              # face arrière des lettres monumentales
LETTRES_EP = 0.012              # épaisseur des lettres
LETTRES_CAP = 0.030             # hauteur de capitale
LETTRES_LARGEUR = 0.130         # largeur du mot
DENIVELE = 0.80                 # du sol de l'atelier au fond intérieur du verre
FRONT = (84, 128)               # la cohésion de la dalle est annulée par un front qui descend entre ces images
IMAGE_FIN_FILET = 182           # les grains qui passent le bec après cette image ne sont plus suivis : le filet s'éteint avant le mojito

ROULEMENT_2 = ["archivo-var", "permanent-marker", "saira-stencil-one", "doto-var", "major-mono-display",
               "instrument-serif-italic", "bodoni-moda-var", "anton"]


def caractere_lettres(f):
    """Roulement typographique n° 2 : un caractère toutes les 3 images de l'image 96 à l'image 119, arrêt sur Anton."""
    if f < 96:
        return "bodoni-moda-var"
    if f <= 119:
        return ROULEMENT_2[(f - 96) // 3]
    return "anton"


def _lisse(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3.0 - 2.0 * x)


def vitesse(f):
    a, b = RAMPE
    if f < a:
        return RALENTI
    if f >= b:
        return 1.0
    return RALENTI + (1.0 - RALENTI) * _lisse((f + 0.5 - a) / (b - a))


def t_de(f):
    """Temps physique (s) au début de l'image f (f peut être fractionnaire)."""
    if f <= RAMPE[0]:
        return (f - IMAGE_0) / IPS * RALENTI
    n = int(f)
    t = (RAMPE[0] - IMAGE_0) / IPS * RALENTI + sum(vitesse(g) for g in range(RAMPE[0], n)) / IPS
    return t + (f - n) * vitesse(n) / IPS


def image_de(t):
    """Inverse de t_de."""
    t_rampe = t_de(RAMPE[0])
    if t <= t_rampe:
        return IMAGE_0 + t * IPS / RALENTI
    f = RAMPE[0]
    while t_de(f + 1) <= t:
        f += 1
    return f + (t - t_de(f)) / (vitesse(f) / IPS)


if __name__ == "__main__":
    for f in (72, 84, 128, 168, 198, 205, 216, 228):
        print(f"image {f} : t = {t_de(f):.4f} s, vitesse {vitesse(f):.2f}")
    assert abs(image_de(t_de(207.3)) - 207.3) < 1e-6 and abs(image_de(t_de(100.0)) - 100.0) < 1e-9
    print(f"chute du filet ({DENIVELE} m) : {math.sqrt(2 * DENIVELE / 9.81):.3f} s, soit {math.sqrt(2 * DENIVELE / 9.81) / RALENTI * IPS:.0f} images au ralenti")
