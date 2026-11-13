"""Compositeur final INSOUMISE : constantes, chemins, entrées (séquences finales, meta.json), empreintes.

Les racines `out/final` (entrées + sorties) et `out/seq4` peuvent être déplacées pour les essais :
variables d'environnement FX_FINAL_ROOT (défaut out/final) et FX_SEQ4_ROOT (défaut out/seq4).
Les noms de modules ici commencent par fx_ pour ne jamais masquer ceux de l'animatique (common, sheet, reticle…).
"""
import hashlib
import json
import os
import pathlib
import sys
from functools import lru_cache

ROOT = pathlib.Path(__file__).resolve().parents[2]
ANIM = ROOT / "build" / "animatique"
HERE = pathlib.Path(__file__).resolve().parent
for p in (str(ANIM),):
    if p not in sys.path:
        sys.path.insert(0, p)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

cv2.setNumThreads(1)

import common as AC  # noqa: E402  (animatique : partition, constantes, couches du logo)

FINAL = pathlib.Path(os.environ.get("FX_FINAL_ROOT", ROOT / "out" / "final"))
SEQ4_ROOT = pathlib.Path(os.environ.get("FX_SEQ4_ROOT", ROOT / "out" / "seq4"))
MASTER = FINAL / "master"
CACHE = FINAL / ".cache"

W, H, FPS, NFRAMES = AC.W, AC.H, AC.FPS, AC.NFRAMES
WX0, WY0, WX1, WY1 = AC.WX0, AC.WY0, AC.WX1, AC.WY1
WINW, WINH = WX1 - WX0, WY1 - WY0
LOGO_X, LOGO_Y, LOGO_S, K = AC.LOGO_X, AC.LOGO_Y, AC.LOGO_S, AC.K

# palette (RGB 0..255) ; la pipeline travaille en flottants 0..65535
BLACK, CREAM, ORANGE, ORANGE_HI = AC.BLACK, AC.CREAM, AC.ORANGE, AC.ORANGE_HI
LINES_RGB = (253, 245, 237)           # couleur propre de layer_lines.png (mesurée : geometry.json)
SCALE16 = 257.0                       # 8 bits -> 16 bits exact

# fenêtres : (première image, dernière image, dossiers candidats dans l'ordre de préférence, nom de séquence)
SEQDEF = [
    (0, 71, [FINAL / "seq01"], "seq01"),
    (72, 215, [FINAL / "seq2"], "seq2"),
    (216, 359, [FINAL / "seq3"], "seq3"),
    (360, 455, [FINAL / "seq4", SEQ4_ROOT / "frames"], "seq4"),
    (456, 599, [FINAL / "seq56" / "fenetre"], "seq56"),
]
MATIERE_DIR = FINAL / "seq56" / "matiere"
MATIERE_RANGE = (456, 527)

# images imposées : logo source à plat (et copie exacte de l'image 0)
FLAT_HEAD = range(0, 6)
FLAT_TAIL = range(594, 600)


def canonical(f):
    """Les images 1–5 et 594–599 sont des copies exactes de l'image 0 (boucle fermée)."""
    return 0 if (f in FLAT_HEAD or f in FLAT_TAIL) else f


def seq_of(f):
    for a, b, dirs, name in SEQDEF:
        if a <= f <= b:
            return a, b, dirs, name
    raise KeyError(f)


def _stat(p):
    if p is None:
        return None
    try:
        s = os.stat(p)
        return [s.st_size, s.st_mtime_ns]
    except OSError:
        return None


def window_file(f):
    """Chemin de la fenêtre finale de l'image f, ou None (absente)."""
    _, _, dirs, _ = seq_of(f)
    for d in dirs:
        p = d / f"f{f:04d}.png"
        if p.exists():
            return p
    return None


def matiere_file(f):
    a, b = MATIERE_RANGE
    if not (a <= f <= b):
        return None
    p = MATIERE_DIR / f"f{f:04d}.png"
    return p if p.exists() else None


# ------------------------------------------------------------------ meta.json
@lru_cache(maxsize=None)
def _load_meta(path):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8")).get("images", {})
    except Exception:
        return {}


def _meta_candidates(f):
    _, _, dirs, name = seq_of(f)
    c = []
    for d in dirs:
        c += [d / "meta.json", d.parent / "meta.json"]
    if name == "seq56":
        c.append(MATIERE_DIR / "meta.json")
        c.append(FINAL / "seq56" / "meta.json")
    return [p for p in dict.fromkeys(c) if p.exists()]


@lru_cache(maxsize=None)
def _stats_n(f):
    p = SEQ4_ROOT / "stats" / f"f{f:04d}.json"
    try:
        return int(json.loads(p.read_text())["visible"])
    except Exception:
        return None


def meta(f):
    """Entrée meta de l'image f : dict avec éventuellement 'cible' (x,y,r en px fenêtre) et 'n'.
    Pour la séquence 4 (pas de meta.json encore) le compteur est tiré de stats/fNNNN.json `visible`
    tant qu'aucun meta.json n'existe (source indiquée par la clé '_n_source')."""
    out = {}
    for p in _meta_candidates(f):
        e = _load_meta(str(p)).get(str(f))
        if e:
            for k, v in e.items():
                out.setdefault(k, v)
    if "n" not in out and 360 <= f <= 455 and not _meta_candidates(f):
        n = _stats_n(f)
        if n is not None:
            out["n"] = n
            out["_n_source"] = "out/seq4/stats visible"
    return out


def cible_sheet(f):
    """Cercle cible de l'image f en px feuille (x, y, r) ou None."""
    c = meta(f).get("cible")
    if not c:
        return None
    return (float(c["x"]) + WX0, float(c["y"]) + WY0, float(c["r"]))


# ------------------------------------------------------------------ empreintes
def code_hash():
    """Empreinte du code et des données fixes : tout changement recompose toutes les images."""
    h = hashlib.sha256()
    files = sorted(HERE.glob("fx_*.py")) + [HERE / "compose.py"] + sorted(ANIM.glob("*.py"))
    files += [ROOT / "timeline" / "partition.json", ROOT / "build" / "type" / "typekit.py",
              ROOT / "assets" / "fonts" / "ibm-plex-mono" / "ibm-plex-mono-400.ttf",
              ROOT / "assets" / "fonts" / "ibm-plex-mono" / "ibm-plex-mono-700.ttf",
              ROOT / "assets" / "logo" / "layer_lines.png", ROOT / "assets" / "logo" / "geometry.json"]
    for p in files:
        if p.exists():
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


def frame_inputs(f, deps_fn):
    """Dictionnaire qui détermine entièrement l'image f (hors code)."""
    fe = canonical(f)
    d = {"f": fe,
         "win": _stat(window_file(fe)) if (6 <= fe and window_file(fe)) else None,
         "mat": _stat(matiere_file(fe)),
         "meta": meta(fe)}
    d["deps"] = {str(g): meta(g) for g in deps_fn(fe)}
    return d


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:20]
