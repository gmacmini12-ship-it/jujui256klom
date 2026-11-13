#!/opt/og/venv/bin/python
"""Contrôle du liquide du mojito, image par image, sur les fichiers que le rendu lira.

    /opt/og/venv/bin/python build/mojito/controle_liquide.py [résolution] [variante]      (défaut : 256 c)

Pour chaque image, on lit la variante si elle existe, sinon la finition d'origine, et on vérifie deux choses :
1. le liquide reste dans le verre : aucun sommet au-delà de la paroi intérieure sous le bord, ni hors de l'ouverture
   au-dessus du bord ;
2. la surface du liquide contre la paroi est aussi régulière que dans la finition d'origine. Là où le liquide entre
   dans la paroi, sa surface doit être celle de la coupe (0,18 mm dedans). Une coupe mal faite la déplace par
   marches : vu à travers le verre, tout ondule (défaut des 55 images de la session C du 13 novembre). Pendant la
   première gerbe le contact est naturellement partiel : on compare donc à la finition d'origine de la même image.
Doit afficher zéro image fautive dans les deux cas ; le code de sortie vaut 1 sinon.
"""
import os
import sys

import numpy as np

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
Z0, H, R_BAS, R_HAUT, E_PAROI, E_FOND = 0.003, 0.143, 0.0340, 0.0385, 0.0022, 0.012      # build/mojito/scene.py
RECOUVREMENT = 0.00018                # build/mojito/surface.py
TOLERANCE = 0.0009                    # une maille et demie de la grille de finition (0,6 mm)


def mesurer(chemin):
    """(sommets hors de la paroi sous le bord, sommets hors de l'ouverture au-dessus, part des sommets en retrait de la coupe)"""
    v = np.load(chemin)["v"]
    if len(v) == 0:
        return 0, 0, 0.0
    zz = v[:, 2] - Z0
    r = np.hypot(v[:, 0], v[:, 1])
    ri = R_BAS + (R_HAUT - R_BAS) * np.clip(zz, 0, H) / H - E_PAROI
    sous = int(((r > ri + TOLERANCE) & (zz < H - 0.0002) & (zz > E_FOND)).sum())
    dessus = int(((r > (R_HAUT - E_PAROI) + TOLERANCE) & (zz >= H - 0.0002)).sum())
    contre = (r > ri + 0.00005) & (zz > 0.03) & (zz < 0.12)
    retrait = float((np.abs((r - ri)[contre] - RECOUVREMENT) > 0.00001).mean()) if contre.sum() > 500 else 0.0
    return sous, dessus, retrait


if __name__ == "__main__":
    res = sys.argv[1] if len(sys.argv) > 1 else "256"
    variante = sys.argv[2] if len(sys.argv) > 2 else "c"
    base = os.path.join(RACINE, "cache", "mojito", f"liquide_r{res}")
    dehors, ondulees, lues = [], [], 0
    for f in range(258, 360):
        origine = os.path.join(base, f"f{f:04d}.npz")
        chemin = os.path.join(base + variante, f"f{f:04d}.npz")
        if not os.path.exists(chemin):
            chemin = origine
        if not os.path.exists(chemin):
            continue
        lues += 1
        sous, dessus, retrait = mesurer(chemin)
        if sous or dessus:
            dehors.append((f, sous, dessus))
        if chemin != origine and os.path.exists(origine):
            reference = mesurer(origine)[2]
            if retrait > reference + 0.01:
                ondulees.append((f, retrait, reference))
    print(f"CONTROLE liquide r{res}{variante}, {lues} images : {len(dehors)} avec du liquide hors du verre ; "
          f"{len(ondulees)} dont la surface contre la paroi est moins régulière que l'origine")
    for f, a, b in dehors:
        print(f"   image {f} : {a} sommets hors de la paroi sous le bord, {b} hors de l'ouverture au-dessus du bord")
    for f, part, ref in ondulees:
        print(f"   image {f} : {part * 100:.0f} % des sommets en retrait de la coupe (origine : {ref * 100:.0f} %)")
    sys.exit(1 if dehors or ondulees else 0)
