"""Aperçu complet du film à partir des rendus basse définition en cours (jamais confondu avec le film final).

Agrandit les aperçus des séquences 2 et 3 à la taille de la fenêtre, comble les images non rendues en répétant la
précédente, relie les séquences déjà disponibles, puis lance le compositeur sur la racine out/apercu.

    /opt/og/venv/bin/python build/final/apercu.py     ->  out/apercu/insoumise_wip.mp4, insoumise_wip_revue.mp4, planche.png
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

import cv2

RACINE = pathlib.Path(__file__).resolve().parents[2]
APERCU = RACINE / "out" / "apercu"
SOURCES = {     # séquence -> (dossier d'aperçu, première image, dernière image)
    "seq2": (RACINE / "out" / "grains" / "apercu_seq2", 72, 215),
    "seq3": (RACINE / "out" / "mojito" / "apercu_seq3", 216, 359),
}


def agrandir(nom, dossier, a, b):
    sortie = APERCU / nom
    sortie.mkdir(parents=True, exist_ok=True)
    dernier = None
    n = 0
    for f in range(a, b + 1):
        src = dossier / f"f{f:04d}.png"
        if src.exists():
            img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
            dernier = cv2.resize(img, (1008, 1512), interpolation=cv2.INTER_LANCZOS4)
            n += 1
        if dernier is not None:
            cv2.imwrite(str(sortie / f"f{f:04d}.png"), dernier)
    meta = dossier / "meta.json"
    if meta.exists():
        shutil.copy(meta, sortie / "meta.json")
    return n


if __name__ == "__main__":
    APERCU.mkdir(parents=True, exist_ok=True)
    for nom, (dossier, a, b) in SOURCES.items():
        if dossier.exists():
            print(f"{nom} : {agrandir(nom, dossier, a, b)} images d'aperçu agrandies")
    for nom in ("seq01", "seq56"):                     # séquences livrées par ailleurs : reliées telles quelles
        src = RACINE / "out" / "final" / nom
        lien = APERCU / nom
        if src.exists() and any(src.iterdir()) and not lien.exists():
            os.symlink(src, lien)
    env = dict(os.environ, FX_FINAL_ROOT=str(APERCU), FX_ETIQUETTE="APERÇU")
    subprocess.run([sys.executable, str(RACINE / "build" / "final" / "compose.py")] + sys.argv[1:], env=env, check=True)
    print(json.dumps({"apercu": str(APERCU / "insoumise_wip.mp4")}))
