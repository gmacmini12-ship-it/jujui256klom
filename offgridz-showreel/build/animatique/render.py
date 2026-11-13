#!/opt/og/venv/bin/python
"""Rend l'animatique : 600 images 1080×1920, envoyées brutes à ffmpeg (H.264 yuv420p, CRF 16).

    python build/animatique/render.py                # rend la vidéo muette + les contrôles de rendu
    python build/animatique/render.py --png 0,36,100 # images isolées en PNG (out/animatique/frames/)
    python build/animatique/render.py --no-burnin    # sans incrustation de relecture (haut droite)

Le son est ajouté ensuite par mux.py (étape séparée, sans rendre les images à nouveau).
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as C  # noqa: E402
import reticle  # noqa: E402
import scenes  # noqa: E402
import sheet  # noqa: E402
from common import W, H, WX0, WY0, WX1, WY1, NFRAMES, FPS  # noqa: E402

OUT = C.ROOT / "out" / "animatique"
SILENT = OUT / "video_muette.mp4"

_BASE = None


def compose(f, burn=True):
    """Image f complète (feuille 1080×1920). Renvoie (avec incrustation, sans incrustation, infos)."""
    global _BASE
    if _BASE is None:
        _BASE = sheet.base_sheet()
    F = _BASE.copy()
    rs = reticle.state(f)
    S, cnt = scenes.window(f)
    seq = scenes.seq_index(f)
    shown = None
    sheet_cnt = cnt if (cnt is not None and ((seq == 2 and f >= scenes.T_CRUMBLE) or seq == 4)) else None
    # annotations de marge d'abord : l'encre de la séquence 5 les recouvre
    shown = sheet_cnt
    if seq == 5 and f < scenes.T_INK:
        shown = scenes._burst()["v"].shape[0]
    sheet.annotations(F, f, rs, shown)
    F[WY0:WY1, WX0:WX1] = S[WY0:WY1, WX0:WX1]
    if seq == 5:
        scenes.seq5_overlay(f, F)
    if f >= scenes.T_SIG:
        scenes.draw_signature(F, f, sheet.fade_signature(f))
    reticle.draw(F, rs)
    clean = F.copy()
    if burn:
        sheet.burn_in(F, f)
    return F, clean, dict(reticle=rs["phase"], seq=seq)


def ffmpeg_cmd(out):
    return ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
            "-i", "-", "-an",
            "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p",
            "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-movflags", "+faststart", str(out)]


def render_all(burn=True):
    OUT.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(ffmpeg_cmd(SILENT), stdin=subprocess.PIPE)
    clean0 = None
    loop_diff = {}
    still_diff = {}
    t0 = time.time()
    per = []
    for f in range(NFRAMES):
        t1 = time.time()
        F, clean, info = compose(f, burn)
        if f == 0:
            clean0 = clean.copy()
            box = clean0[C.LOGO_Y:C.LOGO_Y + C.LOGO_S, C.LOGO_X:C.LOGO_X + C.LOGO_S]
            logo_equal = bool(np.array_equal(box, C.logo_source()))
            logo_maxdiff = int(np.abs(box.astype(int) - C.logo_source().astype(int)).max())
        if f <= 5:
            still_diff[f] = int(np.abs(clean.astype(int) - clean0.astype(int)).max())
        if f >= 594:
            loop_diff[f] = int(np.abs(clean.astype(int) - clean0.astype(int)).max())
        proc.stdin.write(F.tobytes())
        per.append(time.time() - t1)
        if f % 50 == 0:
            print(f"frame {f:3d}  {time.time() - t0:6.1f}s  ({per[-1] * 1000:.0f} ms)", flush=True)
    proc.stdin.close()
    rc = proc.wait()
    res = dict(render_s=round(time.time() - t0, 1), ffmpeg_rc=rc, burn_in=burn,
               loop_max_abs_diff_594_599_vs_0=loop_diff, still_0_5_max_abs_diff=still_diff,
               logo_frame0_identical_to_lanczos=logo_equal, logo_frame0_max_abs_diff=logo_maxdiff,
               ms_per_frame_mean=round(1000 * float(np.mean(per)), 1), ms_per_frame_max=round(1000 * float(np.max(per)), 1))
    (OUT / "render_checks.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(json.dumps(res, indent=1))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", default="", help="liste d'images à écrire en PNG, ex. 0,36,100")
    ap.add_argument("--no-burnin", action="store_true", help="supprime l'incrustation de relecture")
    a = ap.parse_args()
    burn = not a.no_burnin
    if a.png:
        from PIL import Image
        d = OUT / "frames"
        d.mkdir(parents=True, exist_ok=True)
        for tok in a.png.split(","):
            f = int(tok)
            F, _, info = compose(f, burn)
            Image.fromarray(F).save(d / f"f{f:03d}.png")
            print(f, info)
        return
    render_all(burn)


if __name__ == "__main__":
    main()
