#!/bin/bash
# Animatique INSOUMISE : rendu des images, son, contrôles. Une seule commande :
#   bash build/animatique/run.sh
# Options de rendu : ajouter --no-burnin pour supprimer l'incrustation de relecture.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=/opt/og/venv/bin/python
$PY build/animatique/render.py "$@"          # -> out/animatique/video_muette.mp4 (+ render_checks.json)
$PY build/animatique/mux.py                  # -> out/animatique/animatique_v0.mp4 (maquette_v0.wav si présente, sinon clics)
$PY build/animatique/checks.py               # -> ffprobe, table des événements, planche_contact.png
