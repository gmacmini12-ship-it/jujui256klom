#!/opt/og/venv/bin/python
"""Après le rendu : aperçu mp4, planche-contact et rapport (mesures lues dans out/seq4/stats et frames).

    /opt/og/venv/bin/python build/seq4/post.py [--out out/seq4]
"""
import argparse, glob, json, os, subprocess, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import *


def word_mask(f, W=W0, H=H0, ss=2):
    """Masque exact du mot (pastilles de Doto projetées par la caméra de l'image f)."""
    d = np.load(f"{CACHE}/targets_6000000.npz") if os.path.exists(f"{CACHE}/targets_6000000.npz") else None
    if d is None:
        raise SystemExit("cache des cibles absent")
    dots, rtab = d["dots"], d["rtab"]
    k = float(np.clip(f - WORD_F0, 0, 22.999)); i = int(k); a = k - i
    c = dots[i] * (1 - a) + dots[i + 1] * a
    r = rtab[i] * (1 - a) + rtab[i + 1] * a
    cam = camera(float(f))
    pc = np.concatenate([c, np.zeros((len(c), 1))], 1) - cam["C"][None]
    zc = pc @ cam["fwd"]
    sx = W / 2 + FOCAL * (pc @ cam["right"]) / zc
    sy = H / 2 - FOCAL * (pc @ cam["up"]) / zc
    rr = r * FOCAL / zc
    m = np.zeros((H * ss, W * ss), np.uint8)
    for x, y, q in zip(sx, sy, rr):
        cv2.circle(m, (int(round(x * ss * 16)), int(round(y * ss * 16))), int(round(q * ss * 16)), 255, -1, cv2.LINE_AA, 4)
    m = cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    return m


def legibility(out, f):
    """Contraste du mot : luminance moyenne sur les pastilles / luminance moyenne autour (boîte du mot élargie)."""
    img = cv2.imread(f"{out}/frames/f{f:04d}.png", -1).astype(np.float32) / 65535.0
    lum = img[..., ::-1] @ np.array([0.2126, 0.7152, 0.0722], np.float32)       # sRGB (codé)
    m = word_mask(f)
    ys, xs = np.nonzero(m > 0.5)
    y0, y1, x0, x1 = ys.min() - 40, ys.max() + 40, xs.min() - 40, xs.max() + 40
    box = np.zeros_like(m, bool); box[y0:y1, x0:x1] = True
    ink = m > 0.5
    ring = box & (cv2.dilate(m, np.ones((9, 9), np.uint8)) < 0.01)
    li, lo = float(lum[ink].mean()), float(lum[ring].mean())
    cov = float((lum[ink] > 0.5 * li + 0.5 * lo).mean())                         # part des pixels d'encre nettement allumés
    return li, lo, li / max(lo, 1e-4), cov, float(m[ink].size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    out = a.out
    stats = [json.load(open(p)) for p in sorted(glob.glob(f"{out}/stats/f*.json"))]
    frames = [s["frame"] for s in stats]
    # aperçu
    if len(frames) == 96:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-start_number", "360",
                        "-i", f"{out}/frames/f%04d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14",
                        "-preset", "slow", f"{out}/apercu.mp4"], check=True)
    # planche : 16 images
    pick = [360, 366, 372, 380, 388, 392, 396, 402, 408, 416, 424, 431, 438, 444, 450, 455]
    tiles = []
    for f in pick:
        p = f"{out}/frames/f{f:04d}.png"
        if not os.path.exists(p):
            continue
        im = (cv2.imread(p, -1) / 257).astype(np.uint8)
        im = cv2.resize(im, (252, 378), interpolation=cv2.INTER_AREA)
        cv2.putText(im, f"{f}", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(im, f"{f}", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 20, 20), 1, cv2.LINE_AA)
        tiles.append(im)
    if tiles:
        while len(tiles) % 8:
            tiles.append(np.zeros_like(tiles[0]))
        rows = [np.hstack(tiles[i:i + 8]) for i in range(0, len(tiles), 8)]
        cv2.imwrite(f"{out}/planche.png", np.vstack(rows))
    # rapport
    N = stats[0]["points"]
    tt = np.array([s["t_total"] for s in stats]); tr = np.array([s["t_render"] for s in stats]); ts = np.array([s["t_sim"] for s in stats])
    L = ["# Séquence 4 « Données » : rapport de rendu", "",
         f"- Images : {frames[0]} à {frames[-1]} ({len(frames)} images), 1008 x 1512, 30 images/s.",
         f"- **Nombre de points : {N:,}**".replace(",", " ") + " (tous simulés et rendus ; chaque point est projeté à l'écran à un moment ou un autre).",
         f"- Points projetés dans la fenêtre (échantillon central de l'obturateur) : de {min(s['visible'] for s in stats):,} à {max(s['visible'] for s in stats):,} selon l'image.".replace(",", " "),
         f"- Temps par image (cette machine, 4 cœurs partagés avec d'autres tâches) : moyenne {tt.mean():.1f} s, médiane {np.median(tt):.1f} s, max {tt.max():.1f} s "
         f"(simulation {ts.mean():.1f} s + rendu {tr.mean():.1f} s en moyenne). Total mesuré {tt.sum()/60:.1f} min pour {len(stats)} images (hors préparation des cibles, une fois : voir ci-dessous).",
         "", "## Contrôles par image", "",
         "| image | moyenne | max | min | part des px >= 0,995 | zone vide : points dans le frustum | dont posés sur le relief | cibles dans la zone | temps (s) |",
         "|---|---|---|---|---|---|---|---|---|"]
    for s in stats:
        L.append(f"| {s['frame']} | {s['mean']:.3f} | {s['max']:.3f} | {s['min']:.3f} | {s['frac_ge_0995']:.5f} | "
                 f"{s['strip_all'] if 408 <= s['frame'] <= 431 else '-'} | {s['strip_settled'] if 408 <= s['frame'] <= 431 else '-'} | "
                 f"{s['strip_targets'] if 408 <= s['frame'] <= 431 else '-'} | {s['t_total']:.1f} |")
    L += ["", f"- Moyenne la plus basse {min(s['mean'] for s in stats):.3f}, la plus haute {max(s['mean'] for s in stats):.3f} (valeurs sRGB 0..1 sur les trois canaux) ; "
          f"minimum absolu {min(s['min'] for s in stats):.4f} (fond #0A0A09 = 0,039) ; maximum absolu {max(s['max'] for s in stats):.3f} (plafond du mappage tonal : aucun pixel n'atteint le blanc).",
          ""]
    w = [f for f in frames if 384 <= f <= 407]
    if w:
        L += ["## Lisibilité du mot (images 384 à 407)", "",
              "Mesure : luminance (sRGB) moyenne sur les pastilles réelles de Doto (masque projeté par la caméra) / luminance moyenne autour, "
              "dans la boîte du mot élargie de 40 px, et part des pixels d'encre au-dessus du milieu des deux niveaux.", "",
              "| image | wght | luminance encre | luminance fond | rapport | part d'encre allumée |", "|---|---|---|---|---|---|"]
        for f in w:
            li, lo, ra, cov, _ = legibility(out, f)
            L.append(f"| {f} | {wght_at(f):.0f} | {li:.3f} | {lo:.3f} | {ra:.2f} | {cov:.2f} |")
    open(f"{out}/rapport_mesures.md", "w").write("\n".join(L) + "\n")
    print("\n".join(L[:12]))


if __name__ == "__main__":
    main()
