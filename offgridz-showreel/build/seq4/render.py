#!/opt/og/venv/bin/python
"""Rend la séquence 4 « Données » (images 360..455).

    /opt/og/venv/bin/python build/seq4/render.py                      # rendu complet (6 000 000 points, 1008x1512)
    /opt/og/venv/bin/python build/seq4/render.py --points 600000 --scale 0.5 --samples 2 --frames 396,404   # test rapide

Sorties : out/seq4/frames/fNNNN.png (16 bits sRGB), out/seq4/linear/fNNNN.npy (radiance linéaire float16 avant
mappage tonal), out/seq4/stats/fNNNN.json.  Ensuite : post.py (aperçu, planche, rapport).
"""
import argparse, json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import *

EXPOSURE = 1.0
CEIL = 0.88
HALF = 0.4
BG = hex_lin("#0A0A09")


def tonemap(rad, exposure=EXPOSURE):
    """radiance linéaire -> image linéaire affichable.  Bloom léger (halation de l'objectif), puis courbe de
    Reinhard sur le canal maximal (teinte conservée, plafond CEIL : jamais de blanc écrêté)."""
    x = rad.astype(np.float32) * exposure
    glow = 0.07 * cv2.GaussianBlur(x, (0, 0), 6) + 0.04 * cv2.GaussianBlur(x, (0, 0), 28)
    x = x + glow
    m = x.max(axis=2, keepdims=True)
    t = CEIL * m / (m + HALF)
    y = x * (t / np.maximum(m, 1e-9))
    return np.clip(y + BG[None, None, :], 0, 1)


def to_srgb16(lin):
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 1e-9), 1 / 2.4) - 0.055)
    return np.clip(s * 65535 + 0.5, 0, 65535).astype(np.uint16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--points", type=int, default=6_000_000)
    ap.add_argument("--scale", type=float, default=1.0, help="échelle de résolution (1 = 1008x1512)")
    ap.add_argument("--samples", type=int, default=4, help="sous-images par image (flou de bougé)")
    ap.add_argument("--shutter", type=float, default=0.5)
    ap.add_argument("--frames", type=str, default="360:455", help="a:b (inclus) ou liste a,b,c")
    ap.add_argument("--out", type=str, default=OUT)
    ap.add_argument("--dust", type=str, default=None, help="6 valeurs : fraction allumée, intensité allumée, éteinte, surcroît net, gain bokeh, plafond")
    ap.add_argument("--save-state", action="store_true", help="écrit des points de reprise de la simulation (383, 407, 431)")
    ap.add_argument("--no-resume", action="store_true")
    ap.add_argument("--end", type=str, default=None, help="gain brume orange, échelle des pics")
    ap.add_argument("--exposure", type=float, default=EXPOSURE)
    a = ap.parse_args()
    if ":" in a.frames:
        f0, f1 = [int(x) for x in a.frames.split(":")]; frames = list(range(f0, f1 + 1))
    else:
        frames = [int(x) for x in a.frames.split(",")]
    from targets import build
    import engine as E
    data = build(a.points)
    W, H = int(round(W0 * a.scale)), int(round(H0 * a.scale))
    if a.dust:
        E.DUST_PARAMS[:] = [float(x) for x in a.dust.split(',')]
    if a.end:
        E.END_PARAMS[:] = [float(x) for x in a.end.split(',')]
    eng = E.Engine(data, W, H, a.scale, a.samples, a.shutter)
    for d in ("frames", "linear", "stats"):
        os.makedirs(f"{a.out}/{d}", exist_ok=True)
    print(f"[render] N={eng.N} {W}x{H} samples={a.samples} frames={frames[0]}..{frames[-1]}", flush=True)
    tstart = time.time()
    ck = lambda f: f"{CACHE}/state_{eng.N}_{f}.npz"
    start = FIRST
    if not a.no_resume:
        for fc in (431, 407, 383):
            if fc < min(frames) and os.path.exists(ck(fc)):
                eng.load_state(ck(fc)); start = fc
                print(f"[render] état repris à l'image {fc}", flush=True)
                break
    for f in range(start, max(frames) + 1):
        t0 = time.time()
        if f > start:
            eng.step_to(f - 1, f)
            if f in (383, 407, 431) and a.save_state:
                os.makedirs(CACHE, exist_ok=True); eng.save_state(ck(f))
        t_sim = time.time() - t0
        if f not in frames:
            continue
        t1 = time.time()
        rad, nvis = eng.render(float(f))
        t_ren = time.time() - t1
        eng.strip_count(float(f))
        sc = [int(eng.cnt[0]), int(eng.cnt[1]), int(eng.cnt[2])]
        img = tonemap(rad, a.exposure)
        cv2.imwrite(f"{a.out}/frames/f{f:04d}.png", cv2.cvtColor(to_srgb16(img), cv2.COLOR_RGB2BGR))
        np.save(f"{a.out}/linear/f{f:04d}.npy", rad.astype(np.float16))
        srgb = to_srgb16(img).astype(np.float32) / 65535.0
        st = dict(frame=f, mean=float(srgb.mean()), max=float(srgb.max()), min=float(srgb.min()),
                  mean_lum=float(srgb.mean()), p999=float(np.percentile(srgb, 99.9)),
                  frac_ge_0995=float((srgb.max(axis=2) >= 0.995).mean()),
                  strip_all=sc[0], strip_settled=sc[1], strip_targets=sc[2], visible=nvis,
                  t_sim=t_sim, t_render=t_ren, t_total=time.time() - t0, points=eng.N)
        json.dump(st, open(f"{a.out}/stats/f{f:04d}.json", "w"))
        print(f"[render] f{f} sim {t_sim:.1f}s render {t_ren:.1f}s mean {st['mean']:.3f} max {st['max']:.3f} vis {nvis} strip {sc}", flush=True)
    print(f"[render] total {time.time()-tstart:.1f}s")


if __name__ == "__main__":
    main()
