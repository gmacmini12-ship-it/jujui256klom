#!/bin/bash
# OFFGRIDZ — INSOUMISE : rend sur notre machine (processeur) des images finales du mojito, une par une.
#
#   bash build/mojito/rendu_local.sh 348 359        (journal sur la sortie standard)
#
# Sert à finir sans frais ce qu'une session GPU n'a pas eu le temps de rendre. Mêmes réglages que sur la machine
# louée (1008 x 1512, 256 échantillons, liquide en résolution 256) ; l'image 347 rendue des deux façons diffère de
# 0,08 % en moyenne (mesure du 13 novembre), en dessous du bruit. Compter 17 à 21 minutes par image sur 4 cœurs.
# Chaque image est rendue dans un dossier d'attente, contrôlée, puis rangée dans out/final/seq3 avec sa cible de
# réticule. Pour arrêter proprement après l'image en cours : créer le fichier out/final/seq3_local/STOP.
# VARIANTE=c lit les images du liquide refaites (confinement) ; CIBLE=<dossier> range ailleurs que dans out/final/seq3.
cd "$(dirname "$0")/../.." || exit 1
PY=${PY:-/opt/og/venv/bin/python}
A=${1:-348}; B=${2:-359}
ATTENTE=out/final/seq3_local
CIBLE=${CIBLE:-out/final/seq3}
mkdir -p "$ATTENTE" "$CIBLE"
if [ "$A" -le "$B" ]; then LISTE=$(seq "$A" "$B"); else LISTE=$(seq "$A" -1 "$B"); fi      # 359 348 : ordre décroissant
for f in $LISTE; do
  NOM=$(printf "f%04d.png" "$f")
  [ -e "$ATTENTE/STOP" ] && { echo "LOCAL arrêt demandé avant l'image $f"; break; }
  [ -e "$CIBLE/$NOM" ] && continue
  rm -f "$ATTENTE/$NOM"
  $PY -u build/mojito/anim.py -- --frames "$f" --res 1008x1512 --spp 256 --device CPU --sim 256 ${VARIANTE:+--variante "$VARIANTE"} --out "$ATTENTE" 2>&1 \
    | grep --line-buffered -E "ANIM image|rror|Traceback"
  $PY - "$f" "$ATTENTE" "$CIBLE" <<'PY'
import json, os, shutil, sys
import cv2, numpy as np
f, attente, cible = int(sys.argv[1]), sys.argv[2], sys.argv[3]
nom = f"f{f:04d}.png"
im = cv2.imread(os.path.join(attente, nom), cv2.IMREAD_UNCHANGED)
if im is None or im.shape[:2] != (1512, 1008) or im.dtype != np.uint16 or im[..., :3].mean() < 260:
    raise SystemExit(f"LOCAL image {f} refusée : {None if im is None else (im.shape, im.dtype)}")
meta_local = json.load(open(os.path.join(attente, "meta.json")))
chemin = os.path.join(cible, "meta.json")
meta = json.load(open(chemin)) if os.path.exists(chemin) else {"images": {}}
meta["images"][str(f)] = meta_local["images"].get(str(f), {})
shutil.move(os.path.join(attente, nom), os.path.join(cible, nom))
json.dump(meta, open(chemin, "w"))
print(f"LOCAL image {f} rangée dans {cible}", flush=True)
PY
done
echo "LOCAL FIN"
