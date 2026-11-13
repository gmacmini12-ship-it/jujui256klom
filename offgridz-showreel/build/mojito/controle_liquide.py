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
print(f"CONTROLE liquide r{res}{variante} : {len(fautives)} image(s) avec du liquide hors du verre")
for f, a, b in fautives:
    print(f"   image {f} : {a} sommets hors de la paroi sous le bord, {b} hors de l'ouverture au-dessus du bord")
sys.exit(1 if fautives else 0)
