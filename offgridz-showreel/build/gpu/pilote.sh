#!/bin/bash
# OFFGRIDZ — INSOUMISE : session GPU autonome de la séquence des grains (palier 3).
#
#   T_REF=<heure Unix de la location> LIMITE=1290 setsid nohup bash build/gpu/pilote.sh > logs/pilote.log 2>&1 &
#
# Une seule commande lance tout, et plus aucune n'est nécessaire ensuite : installation, simulations, rendu, envoi des
# images au fil de l'eau. L'incident du 13 novembre l'impose : une commande restée en attente d'autorisation a laissé la
# machine tourner à vide. La machine est facturée à la minute : passé T_REF + LIMITE, on n'entame plus aucune image et
# on envoie ce qui est prêt. L'avancement se lit de l'extérieur, sans commande : les journaux sont déposés à intervalles
# réguliers sur des créneaux d'envoi (creneaux.txt, lignes 12 et suivantes). Le journal se termine par « PILOTE FIN ».
W=${OG_DIR:-$HOME/og}; cd "$W" || exit 1; mkdir -p logs
T0=$(date +%s)
T_REF=${T_REF:-$T0}
LIMITE=${LIMITE:-1290}
export ARRET=$(( T_REF + LIMITE ))
el() { echo "[t+$(( $(date +%s) - T_REF ))s] $*"; }
etape() { el "DEBUT $*"; bash build/gpu/session.sh "$@" > /dev/null 2>&1; el "FIN $1 : $(tail -1 "logs/$1.log")"; }
reussi() { tail -1 "logs/$1.log" | grep -q "FIN 0 "; }
paquet() {   # paquet <nom> <créneau> <chemins...> : jusqu'à 3 tentatives ; renvoie 0 si le dépôt a répondu 200
  local nom=$1 k
  for k in 1 2 3; do
    bash build/gpu/session.sh paquet "$@" > /dev/null 2>&1
    if grep 'envoi' "logs/paquet_$nom.log" | tail -1 | grep -q "HTTP 200"; then return 0; fi
    sleep 3
  done
  return 1
}
dernier_envoi() { grep 'envoi' "logs/paquet_$1.log" 2>/dev/null | tail -1; }

# Tranches d'images et leurs créneaux d'envoi : 1 à 6 pour les images, 9 le filet, 10 les journaux de fin.
TRANCHES="72:95:1 96:119:2 120:143:3 144:167:4 168:191:5 192:215:6"
envoyer_tranches() {      # envoie les tranches complètes pas encore envoyées ; « tout » : envoie aussi les tranches incomplètes
  for t in $TRANCHES; do
    IFS=: read -r a b c <<< "$t"
    [ -f "logs/envoye_$c" ] || [ -f "logs/abandon_$c" ] && continue
    n=0; liste=""
    for f in $(seq "$a" "$b"); do p=$(printf "out/final/seq2/f%04d.png" "$f"); [ -f "$p" ] && { n=$(( n + 1 )); liste="$liste $p"; }; done
    if [ "$n" -eq $(( b - a + 1 )) ] || { [ "$1" = "tout" ] && [ "$n" -gt 0 ]; }; then
      sleep 2                      # la dernière image de la tranche peut être en cours d'écriture
      if paquet "seq2_$c" "$c" $liste; then touch "logs/envoye_$c"; else touch "logs/abandon_$c"; fi
      el "tranche $a-$b ($n images) : $(dernier_envoi "seq2_$c")"
    fi
  done
}

# Battements : les journaux partent à heures fixes sur les créneaux 12 et suivants, pour suivre la session sans commande.
BATTEMENTS=${BATTEMENTS:-"150:12 300:13 450:14 600:15 780:16 960:17 1110:18 1250:19"}
( for b in $BATTEMENTS; do
    IFS=: read -r quand creneau <<< "$b"
    while [ $(( $(date +%s) - T_REF )) -lt "$quand" ]; do sleep 5; [ -f logs/pilote_fini ] && exit 0; done
    nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader > logs/gpu.txt 2>&1
    ls out/final/seq2 2>/dev/null | grep -c png > logs/images.txt
    bash build/gpu/session.sh paquet "battement_$creneau" "$creneau" logs > /dev/null 2>&1
  done ) &

terminer() {   # journaux de fin, puis tentative d'arrêt de la machine par elle-même (la facturation s'arrête avec elle)
  cp out/final/seq2/meta.json logs/meta_seq2.json 2>/dev/null
  for s in dalle filet; do
    cp "out/grains/$s/run.json" "logs/run_$s.json" 2>/dev/null
  done
  cp out/grains/dalle/activite.json out/grains/dalle/exits.npz logs/ 2>/dev/null
  el "images rendues : $(ls out/final/seq2/f*.png 2>/dev/null | wc -l) sur 144"
  el "PILOTE FIN $1"
  touch logs/pilote_fini
  paquet journaux 10 logs; echo "[journaux] $(dernier_envoi journaux)"
  if [ "${AUTO_ARRET:-0}" = 1 ] && [ -f /tmp/.higgs-gpu-log-relay.py ]; then      # jamais ailleurs que sur la machine louée
    # Tout est envoyé : on arrête le processus d'accueil de la machine pour qu'elle s'éteigne sans attendre.
    # Sans effet si la machine ne le permet pas : elle s'arrête alors seule après son délai d'inactivité.
    sleep 2
    pkill -f higgs-gpu-log-relay 2>/dev/null
    kill -TERM 1 2>/dev/null
  fi
}

el "PILOTE DEBUT arrêt des rendus à t+${LIMITE}s, échelle ${ECH:-0.15}, ${SPP:-128} échantillons"
etape installer
if ! venv/bin/python -c "import taichi, scipy, cv2" > /dev/null 2>&1; then el "INSTALLATION ECHOUEE"; tail -8 logs/installer.log; terminer echec; exit 1; fi
( etape installer_rendu ) &          # Blender s'installe pendant que la dalle se simule
INSTALLATION=$!
etape dalle
if ! reussi dalle || [ ! -f out/grains/dalle/exits.npz ]; then el "SIMULATION DE LA DALLE ECHOUEE"; tail -6 logs/dalle.log; terminer echec; exit 1; fi
etape filet
if reussi filet; then
  paquet filet 9 out/grains/filet; el "filet : $(dernier_envoi filet)"
else
  el "SIMULATION DU FILET ECHOUEE : rendu de l'atelier seul"; tail -4 logs/filet.log
fi

wait $INSTALLATION 2>/dev/null
if ! venv/bin/python -c "import bpy" > /dev/null 2>&1; then el "INSTALLATION DE BLENDER ECHOUEE"; tail -8 logs/installer_rendu.log; terminer echec; exit 1; fi

# Rendu : l'atelier d'abord (il ne peut être rendu qu'ici, la simulation de la dalle ne quitte pas la machine),
# puis la descente vers le verre. Les tranches partent dès qu'elles sont complètes.
( while [ ! -f logs/rendu_fini ]; do envoyer_tranches; sleep 10; done ) &
SURVEILLANT=$!
IMAGES=72:167 etape rendu2
if reussi filet && [ "$(date +%s)" -lt "$ARRET" ]; then IMAGES=168:215 etape rendu2; fi
touch logs/rendu_fini; wait $SURVEILLANT 2>/dev/null
envoyer_tranches tout
terminer
