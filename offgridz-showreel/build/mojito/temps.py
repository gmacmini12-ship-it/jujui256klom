"""Temps de la séquence du mojito : correspondance entre images du film et temps physique simulé.

Le film est en temps réel, sauf pendant le versement (mesure 6, images 264 à 311) où il ralentit jusqu'à
quatre fois puis revient au temps réel sur le premier temps de la mesure 7. Toutes les simulations de la
séquence (corps rigides, liquide) et la caméra lisent ce module : une seule horloge.

    tau(f)      temps physique, en secondes, à l'image f du film (tau(216) = 0)
    vitesse(f)  fraction du temps réel écoulée pendant l'image f (1 = temps réel, 0,25 = ralenti quatre fois)
"""
IPS = 30
IMAGE_0 = 216                       # tau = 0 : premier temps de la mesure 5
RALENTI = (264, 276, 300, 312)      # début de la décélération, palier, fin du palier, retour au temps réel
PLANCHER = 0.25                     # vitesse pendant le palier


def _lisse(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3.0 - 2.0 * x)


def vitesse(f):
    a, b, c, d = RALENTI
    if f < a or f >= d:
        return 1.0
    if f < b:
        return 1.0 + (PLANCHER - 1.0) * _lisse((f + 0.5 - a) / (b - a))
    if f < c:
        return PLANCHER
    return PLANCHER + (1.0 - PLANCHER) * _lisse((f + 0.5 - c) / (d - c))


def tau(f):
    """Temps physique au début de l'image f (f peut être fractionnaire)."""
    if f <= IMAGE_0:
        return (f - IMAGE_0) / IPS
    n = int(f)
    t = sum(vitesse(g) for g in range(IMAGE_0, n)) / IPS
    return t + (f - n) * vitesse(n) / IPS


def image(t, f_max=400):
    """Inverse de tau : image (fractionnaire) du film au temps physique t."""
    if t <= 0:
        return IMAGE_0 + t * IPS
    f = IMAGE_0
    while f < f_max and tau(f + 1) <= t:
        f += 1
    return f + (t - tau(f)) / (vitesse(f) / IPS)


if __name__ == "__main__":
    for f in (168, 216, 240, 264, 276, 288, 300, 312, 318, 336, 360):
        print(f"image {f} : tau = {tau(f):.4f} s, vitesse = {vitesse(f):.3f}")
    print(f"durée physique du versement (264 à 312) : {tau(312) - tau(264):.3f} s")
    assert abs(image(tau(290.5)) - 290.5) < 1e-6
