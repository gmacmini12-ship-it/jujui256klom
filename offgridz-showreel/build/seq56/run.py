"""run.py -- one command for sequences 5-6 (frames 456-599): grains -> film -> matiere + fenetre -> apercu/planche/meta.

  python build/seq56/run.py --grains cache/seq56/grains_s0.01 [--out out/final/seq56] [--stages all]
      stages: grains (render the grain cache), film (thin-film solver 480-527), matiere, fenetre, meta, preview, checks
      --fpx 2        film cell = 2 px (0.2 mm)        --mu 20     ink viscosity (Pa.s)       --ts-film 1.0 film time scale
      --ss 2         supersampling of the grain renderer       --threads 2
      --frames a:b   restrict matiere/fenetre frames (debug)

The grain cache comes from the Deferlement scene (variant seq56):
  python build/sim/scenes.py deferlement --variant seq56 --arch cpu|cuda --scale S --threads 2 --out cache/seq56/grains_sS
        --frames 456:503   (optional: keep the grains running while the wetting front sweeps; the renderer clamps to the last frame)
The renderer reads spacing/particle count from <cache>/run.json, so a GPU cache with several million grains works unchanged.
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import (ROOT, W, H, PX_M, WIN, init_taichi, premult_lin_to_straight_srgb, write_png16, s2l, l2s, smoothstep, tip_y)  # noqa: E402


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def work_path(work, f):
    return os.path.join(work, "dry_%04d.npz" % f)


def stage_grains(A, run, work, frames_avail):
    import grains
    last = max(frames_avail)
    fa = 456
    fb = min(503, last)
    for f in range(fa, fb + 1):
        p = work_path(work, f)
        if os.path.exists(p) and not A.force:
            continue
        t = time.time()
        if A.height_only:
            o = grains.height_only(os.path.join(A.grains, "f%04d.npz" % f), run["spacing"], ss=1, threads=A.threads)
            zh = (np.nan_to_num(o["zh"], nan=0.0) * 1e3).astype(np.float16)
            np.savez(p + ".tmp.npz", zh=zh, cover=(o["cover"] * 255).astype(np.uint8), n_free=o["n_free"])
        else:
            o = grains.render_grains(os.path.join(A.grains, "f%04d.npz" % f), run["spacing"], ss=A.ss, threads=A.threads)
            zh = (np.nan_to_num(o["zh"], nan=0.0) * 1e3).astype(np.float16)
            np.savez(p + ".tmp.npz", pm=o["pm"].astype(np.float16), zh=zh, cover=(o["cover"] * 255).astype(np.uint8), n_free=o["n_free"])
        os.replace(p + ".tmp.npz", p)
        log("grains f%d %s in %.1fs (n_free=%d)" % (f, "height field" if A.height_only else "rendered", time.time() - t, o["n_free"]))


def load_dry(work, f, last):
    d = np.load(work_path(work, min(f, last)))
    return (d["pm"].astype(np.float32) if "pm" in d.files else None), (d["zh"].astype(np.float32) * 1e-3), d["cover"].astype(np.float32) / 255.0, int(d["n_free"])


def stage_film(A, run, work, frames_avail):
    import film
    last = min(max(frames_avail), 503)
    cache = {}

    def gf(f):
        k = min(f, last)
        if k not in cache:
            _, zh, cov, _ = load_dry(work, k, last)
            cache.clear()
            cache[k] = dict(zh=zh, cover=cov)
        return cache[k]
    out = os.path.join(work, "film_fpx%d_mu%g_g%g_lv%g" % (A.fpx, A.mu, A.film_gain, A.level_sigma))
    film.run_film(A.grains, out, gf, fpx=A.fpx, mu=A.mu, ts_film=A.ts_film, threads=A.threads, spacing=run["spacing"], log=log, film_gain=A.film_gain, fpx_sq=A.fpx_sq, resume=A.resume, level_sigma_mm=A.level_sigma, h_pin=A.h_pin * 1e-3)
    return out


def comp_over(top, bot):
    a = top[..., 3:4]
    return top + bot * (1 - a)


def stage_matiere(A, run, work, frames_avail, film_dir, fa, fb):
    import inkrender
    import squeegee
    import film
    last = min(max(frames_avail), 503)
    Ta = np.load(os.path.join(film_dir, "Ta.npy"))
    Ta1 = cv2.resize(Ta, (W, H), interpolation=cv2.INTER_LINEAR)
    outdir = os.path.join(A.out, "matiere")
    os.makedirs(outdir, exist_ok=True)
    meta = {}
    sq_log = {}
    for f in range(max(fa, 456), min(fb, 527) + 1):
        t = time.time()
        pm_d, zh, cov, nfree = load_dry(work, f, last) if f <= 503 else (None, None, None, 0)
        if f <= 479:
            pm = pm_d
            n = nfree
        else:
            s = np.load(os.path.join(film_dir, "s%04d.npz" % f))["s"]
            pm_f, T, _ = inkrender.film_pm(s)
            if f <= 503:
                w = smoothstep((f - Ta1) / 3.0)[..., None]
                # a thin glint rides on the wetting front
                dF = f - Ta1
                glint = (0.45 * np.exp(-0.5 * ((dF - 1.2) / 1.1) ** 2) * (dF > -0.5)).astype(np.float32)
                cream = s2l(np.array([238, 223, 210], np.float32) / 255.0)
                pm_g = np.concatenate([cream[None, None, :] * glint[..., None], glint[..., None]], 2)
                pm_f = comp_over(pm_g * (w > 0.02), pm_f)
                pm = pm_d * (1 - w) + pm_f * w
                pm[..., 3] = np.clip(pm[..., 3], 0, 1)
                # grains still dry: count the grains whose pixel the front has not reached yet
                dd = np.load(os.path.join(A.grains, "f%04d.npz" % min(f, max(frames_avail))))
                st = dd["state"]
                P = dd["pos"][(st == 0) | (st == 1)]
                u = np.clip(((P[:, 0] / PX_M) + W / 2).astype(int), 0, W - 1)
                v = np.clip(((H / 2 - P[:, 1] / PX_M)).astype(int), 0, H - 1)
                n = int(np.sum(Ta1[v, u] > f)) if f < 503 else 0
            else:
                tip = float(tip_y(f))
                tool = squeegee.tool_layer(tip)
                pm = comp_over(tool, pm_f)
                sq_log[f] = dict(tip_px=tip, rubber_edge_px=tip - 62.0, holder_back_px=tip - 190.0)
                n = None
        rgba = premult_lin_to_straight_srgb(pm)
        write_png16(os.path.join(outdir, "f%04d.png" % f), rgba)
        if n is not None and f <= 503:
            meta[str(f)] = dict(n=int(n))
        log("matiere f%d  n=%s  %.1fs" % (f, n, time.time() - t))
    mp = os.path.join(A.out, "matiere_meta_partial.json")
    with open(mp, "w") as fo:
        json.dump(dict(images=meta, squeegee=sq_log), fo)
    return meta, sq_log


def stage_fenetre(A, fa, fb):
    import window
    outdir = os.path.join(A.out, "fenetre")
    os.makedirs(outdir, exist_ok=True)
    for f in range(max(fa, 456), min(fb, 599) + 1):
        img = window.window_frame(f)
        write_png16(os.path.join(outdir, "f%04d.png" % f), img)
    log("fenetre done")


def stage_meta(A, meta_part=None):
    p = os.path.join(A.out, "matiere_meta_partial.json")
    d = json.load(open(p))
    with open(os.path.join(A.out, "meta.json"), "w") as fo:
        json.dump(dict(images=d["images"]), fo)
    with open(os.path.join(A.out, "squeegee.json"), "w") as fo:
        json.dump(d["squeegee"], fo, indent=1)


def read16(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if a.shape[2] == 4:
        return a[:, :, [2, 1, 0, 3]].astype(np.float32) / 65535.0
    return a[:, :, ::-1].astype(np.float32) / 65535.0


def composite_frame(A, f):
    """Matter layer over the window content over a black sheet, at the resolution of the matter layer."""
    mp = os.path.join(A.matiere_dir, "f%04d.png" % f)
    m = read16(mp) if os.path.exists(mp) else None
    wd, hd = (m.shape[1], m.shape[0]) if m is not None else (W, H)
    k = wd / float(W)
    sheet = np.empty((hd, wd, 3), np.float32)
    sheet[:] = np.array([10, 10, 9], np.float32) / 255.0
    win = read16(os.path.join(A.out, "fenetre", "f%04d.png" % f))
    x0, y0, x1, y1 = [int(round(v * k)) for v in WIN]
    sheet[y0:y1, x0:x1] = cv2.resize(win, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    if m is not None:
        a = m[..., 3:4]
        sheet = sheet * (1 - a) + m[..., :3] * a
    return sheet


def stage_preview(A):
    import subprocess
    tmp = os.path.join(A.work, "preview_frames" + A.tag)
    os.makedirs(tmp, exist_ok=True)
    for f in range(456, 600):
        img = composite_frame(A, f)
        cv2.imwrite(os.path.join(tmp, "p%04d.png" % (f - 456)), (img[:, :, ::-1] * 255 + 0.5).astype(np.uint8))
    mp4 = os.path.join(A.out, "apercu%s.mp4" % A.tag)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(tmp, "p%04d.png"),
                    "-vf", "scale=540:960:flags=area", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", mp4], check=True)
    # planche: 12 labelled frames
    sel = [456, 462, 470, 477, 484, 492, 500, 510, 516, 522, 530, 574]
    tiles = []
    for f in sel:
        im = cv2.imread(os.path.join(tmp, "p%04d.png" % (f - 456)))
        im = cv2.resize(im, (324, 576), interpolation=cv2.INTER_AREA)
        cv2.putText(im, "f%d" % f, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (210, 223, 238), 2, cv2.LINE_AA)
        tiles.append(im)
    rows = [np.hstack(tiles[i:i + 6]) for i in range(0, 12, 6)]
    cv2.imwrite(os.path.join(A.out, "planche%s.png" % A.tag), np.vstack(rows))
    log("preview done")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grains", default=os.path.join(ROOT, "cache", "seq56", "grains_s0.01"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "final", "seq56"))
    ap.add_argument("--work", default=None)
    ap.add_argument("--stages", default="all")
    ap.add_argument("--fpx", type=int, default=2)
    ap.add_argument("--mu", type=float, default=20.0)
    ap.add_argument("--ts-film", type=float, default=1.0)
    ap.add_argument("--film-gain", type=float, default=0.25, help="ink volume / bulk volume of the grain bed")
    ap.add_argument("--height-only", type=int, default=0, help="grains stage: height field only (no 2.5D shading; enough for the film solver and the path-traced render)")
    ap.add_argument("--h-pin", type=float, default=2.5, help="film: pinning height (mm) above which ink spills over the sheet edges")
    ap.add_argument("--fpx-sq", type=int, default=4, help="film cell (px) during the squeegee stage")
    ap.add_argument("--resume", action="store_true", help="film: reuse frames 480-503 if present")
    ap.add_argument("--level-sigma", type=float, default=18.0, help="film init: level heaps larger than this (mm); 0 = raw bed height")
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--frames", default="456:599")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--matiere-dir", default=None, help="matter layer to composite in the preview (default <out>/matiere)")
    ap.add_argument("--tag", default="", help="suffix of the preview files, e.g. _pt")
    A = ap.parse_args()
    A.grains = os.path.abspath(A.grains)
    A.out = os.path.abspath(A.out)
    A.work = A.work or os.path.join(ROOT, "cache", "seq56", "work_" + os.path.basename(A.grains.rstrip("/")))
    A.matiere_dir = os.path.abspath(A.matiere_dir) if A.matiere_dir else os.path.join(A.out, "matiere")
    os.makedirs(A.work, exist_ok=True)
    os.makedirs(A.out, exist_ok=True)
    init_taichi(A.threads)
    import grains
    run = grains.load_run(A.grains)
    avail = grains.frames_available(A.grains)
    assert 456 in avail, "grain cache must contain frame 456"
    fa, fb = [int(v) for v in A.frames.split(":")]
    st = A.stages.split(",") if A.stages != "all" else ["grains", "film", "matiere", "fenetre", "meta", "preview"]
    log("grain cache %s: spacing %.3f mm (grain ~%.1f px), frames %d..%d, N=%d" % (A.grains, run["spacing"] * 1e3, run["spacing"] / PX_M * 1.05, min(avail), max(avail), run["n"]))
    film_dir = os.path.join(A.work, "film_fpx%d_mu%g_g%g_lv%g" % (A.fpx, A.mu, A.film_gain, A.level_sigma))
    if "grains" in st:
        stage_grains(A, run, A.work, avail)
    if "film" in st:
        film_dir = stage_film(A, run, A.work, avail)
    if "matiere" in st:
        stage_matiere(A, run, A.work, avail, film_dir, fa, fb)
    if "fenetre" in st:
        stage_fenetre(A, fa, fb)
    if "meta" in st:
        stage_meta(A)
    if "preview" in st:
        stage_preview(A)


if __name__ == "__main__":
    main()
