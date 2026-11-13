"""Récupère les résultats d'une session GPU des grains depuis les créneaux de dépôt, les range et les vérifie.

    python build/gpu/recevoir.py <resultats.json> [--session nom]

- tranches d'images (créneaux 1 à 6)  ->  out/final/seq2/f####.png
- simulation du filet (créneau 9)      ->  out/grains/final/filet/
- journaux de fin (créneau 10)         ->  out/gpu/<session>/logs/  (dont le résumé d'activité et les sorties de la dalle,
                                           copiés dans out/grains/final/dalle/ pour la bande son)
Puis : contrôle de chaque image (présence, 1008 x 1512, 16 bits, non noire), planche de contrôle et aperçu animé.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile

import cv2
import numpy as np

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap = argparse.ArgumentParser()
ap.add_argument("resultats")
ap.add_argument("--session", default="session_grains")
A = ap.parse_args()
creneaux = json.load(open(A.resultats))
depot = os.path.join(RACINE, "out", "gpu", A.session)
os.makedirs(depot, exist_ok=True)


def telecharger(k):
    c = creneaux[str(k)]
    cible = os.path.join(depot, c["nom"] + ".zip")
    if os.path.exists(cible) and os.path.getsize(cible) > 0:
        return cible
    r = subprocess.run(["curl", "-sS", "-m", "900", "-o", cible, "-w", "%{http_code}", c["url"]], capture_output=True, text=True)
    if r.stdout.strip() != "200":
        if os.path.exists(cible):
            os.remove(cible)
        return None
    return cible


def deplier(chemin_zip, dossier):
    """Déplie l'archive dans un dossier neuf, en refusant tout chemin qui en sortirait."""
    if os.path.exists(dossier):
        shutil.rmtree(dossier)
    os.makedirs(dossier)
    with zipfile.ZipFile(chemin_zip) as z:
        for nom in z.namelist():
            cible = os.path.realpath(os.path.join(dossier, nom))
            if not cible.startswith(os.path.realpath(dossier) + os.sep):
                raise SystemExit(f"chemin refusé dans {chemin_zip} : {nom}")
        z.extractall(dossier)
    return dossier


seq2 = os.path.join(RACINE, "out", "final", "seq2")
os.makedirs(seq2, exist_ok=True)
for k in range(1, 7):
    z = telecharger(k)
    if z is None:
        print(f"tranche {k} : absente")
        continue
    d = deplier(z, os.path.join(depot, f"tranche_{k}"))
    src = os.path.join(d, "out", "final", "seq2")
    n = 0
    for nom in sorted(os.listdir(src)) if os.path.isdir(src) else []:
        if nom.endswith(".png"):
            shutil.copy2(os.path.join(src, nom), os.path.join(seq2, nom)); n += 1
    print(f"tranche {k} : {n} images")

z = telecharger(9)
if z:
    d = deplier(z, os.path.join(depot, "filet"))
    src = os.path.join(d, "out", "grains", "filet")
    cible = os.path.join(RACINE, "out", "grains", "final", "filet")
    if os.path.exists(cible):
        shutil.rmtree(cible)
    shutil.copytree(src, cible)
    print(f"filet : {len([f for f in os.listdir(cible) if f.startswith('f') and f.endswith('.npz')])} images de simulation, {os.path.getsize(z) / 1e6:.0f} Mo")
else:
    print("filet : absent")

z = telecharger(10)
if z:
    d = deplier(z, os.path.join(depot, "journaux"))
    logs = os.path.join(d, "logs")
    dalle = os.path.join(RACINE, "out", "grains", "final", "dalle"); os.makedirs(dalle, exist_ok=True)
    for nom, cible in (("activite.json", "activite.json"), ("exits.npz", "exits.npz"), ("run_dalle.json", "run.json")):
        if os.path.exists(os.path.join(logs, nom)):
            shutil.copy2(os.path.join(logs, nom), os.path.join(dalle, cible))
    if os.path.exists(os.path.join(logs, "meta_seq2.json")):
        shutil.copy2(os.path.join(logs, "meta_seq2.json"), os.path.join(seq2, "meta.json"))
    print("journaux :", ", ".join(sorted(os.listdir(logs))))
else:
    print("journaux de fin : absents")

# ---- contrôle des images
manquantes, defauts, moyennes = [], [], {}
for f in range(72, 216):
    p = os.path.join(seq2, f"f{f:04d}.png")
    if not os.path.exists(p):
        manquantes.append(f); continue
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None or im.shape[:2] != (1512, 1008) or im.dtype != np.uint16:
        defauts.append((f, None if im is None else (im.shape, str(im.dtype)))); continue
    m = float(im[..., :3].mean()) / 65535
    moyennes[f] = m
    if m < 0.004:
        defauts.append((f, f"image presque noire ({m:.4f})"))
print(f"images présentes : {144 - len(manquantes)} sur 144 ; manquantes : {manquantes if manquantes else 'aucune'}")
print(f"défauts : {defauts if defauts else 'aucun'}")
if moyennes:
    v = np.array(list(moyennes.values()))
    print(f"luminance moyenne : de {v.min():.3f} à {v.max():.3f}")
    sauts = [(f, round(abs(moyennes[f] - moyennes[f - 1]), 4)) for f in sorted(moyennes) if f - 1 in moyennes and abs(moyennes[f] - moyennes[f - 1]) > 0.03]
    print(f"sauts de luminance d'une image à l'autre (> 0,03) : {sauts if sauts else 'aucun'}")

# ---- planche de contrôle et aperçu animé
choix = [f for f in (72, 84, 96, 108, 120, 132, 140, 150, 160, 167, 172, 178, 184, 190, 200, 215) if f in moyennes]
if choix:
    vignettes = []
    for f in choix:
        im = cv2.imread(os.path.join(seq2, f"f{f:04d}.png"), cv2.IMREAD_UNCHANGED)
        im = (im[..., :3] / 257).astype(np.uint8)
        im = cv2.resize(im, (252, 378), interpolation=cv2.INTER_AREA)
        cv2.putText(im, str(f), (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        vignettes.append(im)
    while len(vignettes) % 8:
        vignettes.append(np.zeros_like(vignettes[0]))
    rangs = [np.hstack(vignettes[i:i + 8]) for i in range(0, len(vignettes), 8)]
    cv2.imwrite(os.path.join(seq2, "planche.png"), np.vstack(rangs))
    print("planche :", os.path.join("out", "final", "seq2", "planche.png"))
if not manquantes and shutil.which("ffmpeg"):
    sortie = os.path.join(seq2, "apercu.mp4")
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-start_number", "72", "-i", os.path.join(seq2, "f%04d.png"),
                        "-vf", "scale=504:756:flags=area", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", sortie], capture_output=True, text=True)
    print("aperçu animé :", os.path.join("out", "final", "seq2", "apercu.mp4") if r.returncode == 0 else r.stderr[:300])
