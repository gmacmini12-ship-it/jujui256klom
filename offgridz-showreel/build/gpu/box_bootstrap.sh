#!/bin/bash
# OFFGRIDZ — GPU calibration, runs unattended on the rented box. Everything is logged to stdout.
W=$HOME/ogtest; mkdir -p "$W"; cd "$W" || exit 1
T0=$(date +%s); el(){ echo "[t+$(( $(date +%s)-T0 ))s] $*"; }
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
el "START"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>&1 | head -2
echo "cores=$(nproc) ram=$(free -g | awk '/Mem/{print $2}')G disk=$(df -h . | awk 'END{print $4}') user=$(whoami) os=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
python3 -V 2>&1; for p in python3.13 python3.12 python3.11 uv pip3 conda unzip; do command -v $p; done
echo "nvidia libs: $(ls /usr/lib/x86_64-linux-gnu 2>/dev/null | grep -E 'libnvoptix|libnvidia-rtcore|libcuda\.so' | tr '\n' ' ')"
for h in https://pypi.org/simple/bpy/ https://download.blender.org/release/ https://github.com/; do curl -sS -m 8 -o /dev/null -w "$h -> %{http_code}\n" -I "$h" 2>&1 | tail -1; done

# ---- Python 3.13 + Blender module ----
export PATH="$HOME/.local/bin:$PATH"
if command -v python3.13 >/dev/null; then
  python3.13 -m venv venv 2>&1 | tail -1
fi
if [ ! -x venv/bin/python ]; then
  el "no usable python3.13 venv; using uv"
  (python3 -m pip install -q uv 2>&1 || pip3 install -q uv 2>&1 || (curl -LsSf https://astral.sh/uv/install.sh | sh) 2>&1) | tail -1
  uv venv --python 3.13 venv 2>&1 | tail -1
fi
. venv/bin/activate || { el "VENV FAILED"; exit 1; }
el "venv ready: $(python -V 2>&1)"
if command -v uv >/dev/null; then uv pip install -q bpy==5.3.0 taichi numpy 2>&1 | tail -2
else python -m pip install -q bpy==5.3.0 taichi numpy 2>&1 | tail -2; fi
el "packages installed"
if ! python -c "import bpy" 2>/dev/null; then
  el "bpy import failed: $(python -c 'import bpy' 2>&1 | tail -1)"
  # Mesuré le 13 novembre sur la L40S louée : apt échoue tant que /tmp n'est pas inscriptible par tous,
  # et son bac à sable doit tourner en root. Ne pas enchaîner update et install par && : update peut
  # signaler une erreur sur un dépôt secondaire sans empêcher l'installation.
  $SUDO chmod 1777 /tmp
  $SUDO apt-get update -qq -o APT::Sandbox::User=root 2>&1 | tail -1
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq -o APT::Sandbox::User=root libxrender1 libxxf86vm1 libxfixes3 libxi6 libxkbcommon0 libsm6 libice6 libgl1 libegl1 libgomp1 xz-utils 2>&1 | tail -1
fi
python -c "import bpy; print('bpy', bpy.app.version_string)" 2>&1 | tail -1
el "blender module ready"

# ---- benchmarks ----
B(){ el "RUN $*"; timeout 240 python "$@" 2>&1 | grep -E "^BENCH|^DEVICE|Error|RuntimeError|Traceback|failed|Failed" | tail -12; }
B bench_scene.py --scene glass --device CUDA --spp 256 --frames 2 --out "$W/o"
B bench_scene.py --scene glass --device OPTIX --spp 256 --frames 3 --out "$W/o"   # débruitage OpenImageDenoise : voir bench_scene.py
DEV=CUDA; [ -f "$W/o_glass_OPTIX_f2.png" ] && DEV=OPTIX
el "preferred device: $DEV"
B bench_scene.py --scene grains --device $DEV --spp 128 --frames 2 --grains 3000000 --out "$W/o"
B bench_scene.py --scene glass --device $DEV --spp 512 --frames 2 --out "$W/q"
B mpm_bench.py --arch cuda --n 4000000 --grid 192 --steps 40
el "CORE DONE"

# ---- optional: official Blender build, to check its liquid solver (only if time allows) ----
if [ $(( $(date +%s)-T0 )) -lt 400 ]; then
  URL=https://download.blender.org/release/Blender5.3/blender-5.3.0-linux-x64.tar.xz
  if curl -sS -m 10 -o /dev/null -f -I "$URL" 2>/dev/null; then
    curl -sS -m 150 -o b.tar.xz "$URL" && tar -xf b.tar.xz && el "official build unpacked"
    BL=$(ls blender-5.3.0-linux-x64/blender 2>/dev/null)
    [ -n "$BL" ] && timeout 150 "$BL" -b -P fluid_smoke.py 2>&1 | grep -E "^SMOKE|Error" | tail -3
  else
    el "official build not reachable from this box"
  fi
fi

# ---- send results back ----
cp "$W/o_glass_${DEV}_f2.png" "$W/glass.png" 2>/dev/null; cp "$W/o_grains_${DEV}_f2.png" "$W/grains.png" 2>/dev/null
cp "$W/q_glass_${DEV}_f2.png" "$W/glass512.png" 2>/dev/null
python - <<'PY'
import zipfile, os
with zipfile.ZipFile("results.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for n in ("log.txt", "glass.png", "grains.png", "glass512.png"):
        if os.path.exists(n): z.write(n)
print("results.zip", os.path.getsize("results.zip"), "bytes")
PY
if [ -s upload_url.txt ]; then
  curl -sS -m 120 -o /dev/null -w "upload HTTP %{http_code}\n" -X PUT -H "Content-Type: application/octet-stream" --data-binary @results.zip "$(tr -d '\n' < upload_url.txt)"
fi
el "ALL DONE"
