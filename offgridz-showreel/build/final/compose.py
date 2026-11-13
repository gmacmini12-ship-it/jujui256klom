#!/opt/og/venv/bin/python
"""Compositeur final de « INSOUMISE » (600 images, 1080×1920, 30 i/s).

    /opt/og/venv/bin/python build/final/compose.py                 # tout : masters, vidéos, planche, rapport
    /opt/og/venv/bin/python build/final/compose.py --frames 70:80  # images 70 à 79 seulement (a inclus, b exclu), sans vidéo
    /opt/og/venv/bin/python build/final/compose.py --no-burnin     # pas de variante « revue » (incrustation)
    options : --force (tout recomposer), --no-video, --workers 1|2

Incrémental : une image n'est recomposée que si son empreinte (fichiers d'entrée de la fenêtre / de la matière,
entrées meta.json utiles, code, partition, polices, couches du logo) a changé ou si son master manque.
Sorties : out/final/master/f%04d.png (16 bits), insoumise_wip.mp4, insoumise_wip_revue.mp4, planche.png,
rapport_compositeur.json. Voir fx_common.py pour la résolution des entrées (séquences finales ou doublures).
"""
import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import argparse  # noqa: E402
import json  # noqa: E402
import multiprocessing as mp  # noqa: E402
import pathlib  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

import fx_common as X  # noqa: E402

MANIFEST = X.CACHE / "manifest.json"


def _compose_task(f):
    """Compose l'image canonique f (et ses copies exactes) ; renvoie (f, infos, durée)."""
    import fx_frame as FR
    t = time.time()
    img, info = FR.compose(f)
    FR.write_png(X.MASTER / f"f{f:04d}.png", img)
    copies = []
    if f == 0:
        for g in list(X.FLAT_HEAD)[1:] + list(X.FLAT_TAIL):
            FR.write_png(X.MASTER / f"f{g:04d}.png", img)
            copies.append(g)
    info["copies"] = copies
    return f, info, time.time() - t


def _slim(info):
    r = info["reticle"]
    return {"window": info["window"], "matiere": info["matiere"], "standin": info["standin"], "n": info["n"],
            "text_margin": round(info["text_margin"], 2),
            "reticle": {k: r[k] for k in ("phase", "identity", "cx", "cy", "r", "rot", "held")}}


def load_manifest():
    try:
        return json.loads(MANIFEST.read_text())
    except Exception:
        return {"code": None, "frames": {}}


def save_manifest(m):
    X.CACHE.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(m))
    os.replace(tmp, MANIFEST)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", default="0:600", help="a:b (a inclus, b exclu)")
    ap.add_argument("--no-burnin", action="store_true", help="ne produit pas la variante de revue avec incrustation")
    ap.add_argument("--no-video", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()
    lo, hi = (int(v) for v in a.frames.split(":"))
    lo, hi = max(lo, 0), min(hi, X.NFRAMES)
    full = (lo, hi) == (0, X.NFRAMES)
    workers = max(1, min(a.workers, 2))
    t0 = time.time()

    import fx_reticle as R
    X.MASTER.mkdir(parents=True, exist_ok=True)
    chash = X.code_hash()
    man = load_manifest()
    if man.get("code") != chash or a.force:
        man = {"code": chash, "frames": {}}
    digs = {}
    for f in range(lo, hi):
        fe = X.canonical(f)
        if fe not in digs:
            digs[fe] = X.digest(X.frame_inputs(fe, R.deps))
    todo = []
    for fe, d in sorted(digs.items()):
        group = [fe] + ([g for g in list(X.FLAT_HEAD)[1:] + list(X.FLAT_TAIL)] if fe == 0 else [])
        ok = man["frames"].get(str(fe), {}).get("digest") == d and all((X.MASTER / f"f{g:04d}.png").exists() for g in group)
        if not ok:
            todo.append(fe)
    print(f"images {lo}:{hi} -> {len(digs)} images distinctes, {len(todo)} à recomposer ({workers} fil(s))", flush=True)

    if todo:
        ctx = mp.get_context("fork")
        done = 0
        with ctx.Pool(workers) as pool:
            for f, info, dt in pool.imap_unordered(_compose_task, todo, chunksize=2):
                man["frames"][str(f)] = {"digest": digs[f], "info": _slim(info)}
                done += 1
                if done % 20 == 0 or done == len(todo):
                    save_manifest(man)
                    el = time.time() - t0
                    print(f"  {done}/{len(todo)}  (image {f}, {dt:.1f} s)  écoulé {el:.0f} s", flush=True)
        save_manifest(man)

    import fx_report as RP
    rep = RP.build(man, full, lo, hi, do_video=(full and not a.no_video), do_burn=not a.no_burnin, force=a.force)
    rep["run"] = {"command": " ".join(sys.argv), "frames_recomposed": len(todo), "elapsed_s": round(time.time() - t0, 1)}
    (X.FINAL / "rapport_compositeur.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    print(RP.summary(rep))


if __name__ == "__main__":
    main()
