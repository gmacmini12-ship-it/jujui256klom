#!/opt/og/venv/bin/python
"""Contrôle : le liquide reste-t-il dans le verre ? Compte, image par image, les sommets de la surface du liquide
situés hors de la cavité (au-delà de la paroi intérieure sous le bord, ou hors de l'ouverture au-dessus du bord).

    /opt/og/venv/bin/python build/mojito/controle_liquide.py [résolution] [variante]      (défaut : 256 c)

Lit, pour chaque image, la variante si elle existe, sinon la finition d'origine. Doit afficher zéro image fautive.
"""
import os
import sys

import numpy as np

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
Z0, H, R_BAS, R_HAUT, E_PAROI, E_FOND = 0.003, 0.143, 0.0340, 0.0385, 0.0022, 0.012      # build/mojito/scene.py
TOLERANCE = 0.0009                    # une maille et demie de la grille de finition (0,6 mm)

res = sys.argv[1] if len(sys.argv) > 1 else "256"
variante = sys.argv[2] if len(sys.argv) > 2 else "c"
base = os.path.join(RACINE, "cache", "mojito", f"liquide_r{res}")
fautives = []
parois = []            # (image, part des sommets en retrait de la coupe, écart maximal en mm)
for f in range(258, 360):
    chemin = os.path.join(base + variante, f"f{f:04d}.npz")
    if not os.path.exists(chemin):
        chemin = os.path.join(base, f"f{f:04d}.npz")
    if not os.path.exists(chemin):
        continue
    v = np.load(chemin)["v"]
    if len(v) == 0:
        continue
    zz = v[:, 2] - Z0
    r = np.hypot(v[:, 0], v[:, 1])
    ri = R_BAS + (R_HAUT - R_BAS) * np.clip(zz, 0, H) / H - E_PAROI
    sous = (r > ri + TOLERANCE) & (zz < H - 0.0002) & (zz > E_FOND)
    dessus = (r > (R_HAUT - E_PAROI) + TOLERANCE) & (zz >= H - 0.0002)
    if sous.any() or dessus.any():
        fautives.append((f, int(sous.sum()), int(dessus.sum())))
    # Régularité de la surface du liquide contre la paroi : là où le liquide entre dans la paroi (de plus de 0,05 mm),
    # sa surface doit être celle de la coupe, 0,18 mm dedans, sans marches. On mesure la part des sommets qui s'en
    # écartent de plus de 0,01 mm.
    contre = (r > ri + 0.00005) & (zz > 0.03) & (zz < 0.12)
    if contre.sum() > 500:
        ecart = np.abs((r - ri)[contre] - 0.00018)
        parois.append((f, float((ecart > 0.00001).mean()), float(ecart.max() * 1000.0)))
print(f"CONTROLE liquide r{res}{variante} : {len(fautives)} image(s) avec du liquide hors du verre")
for f, a, b in fautives:
    print(f"   image {f} : {a} sommets hors de la paroi sous le bord, {b} hors de l'ouverture au-dessus du bord")
ondulees = [p for p in parois if p[1] > 0.01]
print(f"CONTROLE paroi : {len(ondulees)} image(s) dont la surface contre la paroi ondule (plus de 1 % des sommets à plus de 0,01 mm de la coupe), sur {len(parois)} mesurées")
for f, part, maxi in ondulees[:8]:
    print(f"   image {f} : {part * 100:.0f} % des sommets en retrait, jusqu'à {maxi:.3f} mm")
sys.exit(1 if fautives or ondulees else 0)
