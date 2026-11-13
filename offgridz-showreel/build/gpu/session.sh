#!/bin/bash
# OFFGRIDZ — INSOUMISE : étapes de calcul sur la machine GPU louée.
#
#   bash session.sh <étape>      (journal : logs/<étape>.log ; dernière ligne : "ETAPE <étape> FIN <code> <secondes>")
#
# Les étapes longues se lancent en arrière-plan depuis l'extérieur :
#   nohup bash session.sh dalle > /dev/null 2>&1 &
# puis on suit le journal. Variables : ECH (échelle des grains), IMAGES, SPP.
W=${OG_DIR:-$HOME/og}; mkdir -p "$W/logs"; cd "$W" || exit 1
export PATH="$HOME/.local/bin:$PATH"
[ -f venv/bin/activate ] && . venv/bin/activate
ECH=${ECH:-0.25}
SPP=${SPP:-128}
ARCH=${ARCH:-cuda}          # cpu pour une répétition locale
DEVICE=${DEVICE:-OPTIX}     # CPU pour une répétition locale
RES=${RES:-1008x1512}
ETAPE=$1
T0=$(date +%s)
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"

fin() { echo "ETAPE $ETAPE FIN $1 $(( $(date +%s) - T0 ))"; }

envoyer() {   # envoyer <fichier> <numéro de créneau> : dépôt sur un créneau d'envoi préparé (creneaux.txt, une adresse par ligne)
  URL=$(sed -n "${2}p" creneaux.txt | tr -d '\n')
  [ -z "$URL" ] && { echo "pas de créneau $2"; return 1; }
  curl -sS -m 900 -o /dev/null -w "envoi $1 ($(du -h "$1" | cut -f1)) -> HTTP %{http_code}\n" -X PUT -H "Content-Type: application/octet-stream" --data-binary @"$1" "$URL"
}

{
case "$ETAPE" in
  installer)
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | head -2
    echo "coeurs=$(nproc) memoire=$(free -g | awk '/Mem/{print $2}')G disque=$(df -h . | awk 'END{print $4}')"
    if [ ! -x venv/bin/python ]; then
      (python3 -m pip install -q uv 2>&1 || pip3 install -q uv 2>&1 || (curl -LsSf https://astral.sh/uv/install.sh | sh) 2>&1) | tail -1
      uv venv --python 3.13 venv 2>&1 | tail -1
      . venv/bin/activate
    fi
    uv pip install -q bpy==5.3.0 taichi numpy scipy 2>&1 | tail -2
    if ! python -c "import bpy" 2>/dev/null; then
      # mesuré le 13 novembre : apt échoue tant que /tmp n'est pas inscriptible par tous, et son bac à sable doit tourner en root
      $SUDO chmod 1777 /tmp
      $SUDO apt-get update -qq -o APT::Sandbox::User=root 2>&1 | tail -1
      DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq -o APT::Sandbox::User=root libxrender1 libxxf86vm1 libxfixes3 libxi6 libxkbcommon0 libsm6 libice6 libgl1 libegl1 libgomp1 xz-utils zip unzip 2>&1 | tail -1
    fi
    python -c "import bpy, taichi, scipy; print('bpy', bpy.app.version_string, 'taichi', taichi.__version__)" 2>&1 | tail -1
    ;;
  essai)        # le solveur de grains sur le GPU, en tout petit : quelques secondes
    python build/grains/sim.py dalle --arch "$ARCH" --scale 0.004 --frames 72:92 --fresh --out out/essai_dalle 2>&1 | tail -4
    ;;
  dalle)
    # la caméra quitte l'atelier vers l'image 176 et le filet n'est plus alimenté après l'image 182 : inutile d'aller plus loin
    python build/grains/sim.py dalle --arch "$ARCH" --scale "$ECH" --frames "${IMAGES_DALLE:-72:184}" --fresh 2>&1 | grep -E "frame (7[2-9]|[0-9]*[05]) |GRAINS|rror|Traceback" | cut -c1-200
    ;;
  filet)
    python build/grains/sim.py filet --arch "$ARCH" --scale "$ECH" --frames "${IMAGES_FILET:-128:222}" --fresh 2>&1 | grep -E "frame [0-9]*[05] |GRAINS|rror|Traceback" | cut -c1-200
    ;;
  deferlement)
    python build/sim/scenes.py deferlement --variant seq56 --arch "$ARCH" --scale "${ECH5:-0.25}" --out "cache/seq56/grains_final" --frames 456:503 --fresh 2>&1 | grep -E "frame [0-9]*[05] |rror|Traceback|\{" | cut -c1-200
    ;;
  rendu2)       # séquence 2 : atelier, avalanche, filet
    python build/grains/scene.py -- --frames "${IMAGES:-72:215}" --res "$RES" --spp "$SPP" --device "$DEVICE" --out out/final/seq2 2>&1 | grep -E "GRAINS image|rror|Traceback"
    ;;
  rendu3)       # séquence 3 : mojito
    python build/mojito/anim.py -- --frames "${IMAGES:-216:359}" --res "$RES" --spp "${SPP3:-256}" --device "$DEVICE" --sim "${SIM:-256}" --out out/final/seq3 2>&1 | grep -E "ANIM image|rror|Traceback"
    ;;
  rendu01)      # séquences 0 et 1 : papier
    python build/seq01/scene.py -- --frames "${IMAGES:-0:71}" --res "$RES" --spp "${SPP01:-128}" --device "$DEVICE" --out out/final/seq01 2>&1 | grep -E "image|frame|rror|Traceback" | cut -c1-160
    ;;
  paquet)       # paquet <nom> <créneau> <chemins...> : archive sans compression (les PNG le sont déjà) et envoi
    shift; NOM=$1; CRENEAU=$2; shift 2
    zip -q -0 -r "$NOM.zip" "$@" && envoyer "$NOM.zip" "$CRENEAU"
    ;;
  *) echo "étape inconnue : $ETAPE" ;;
esac
fin $?
} 2>&1 | tee -a "logs/$ETAPE.log"
