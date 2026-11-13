#!/opt/og/venv/bin/python
"""PSNR d'une image rendue contre la recomposition à plat (cache/seq01/ref_flat.png) à 1008x1512.
  /opt/og/venv/bin/python build/seq01/psnr.py out/final/seq01/f0011.png [autre.png ...]
"""
import os, sys
import numpy as np
import cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REF = os.path.join(ROOT, "cache", "seq01", "ref_flat.png")


def psnr(a, b, peak=65535.0):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 99.0 if mse == 0 else 10 * np.log10(peak ** 2 / mse)


def main():
    ref = cv2.imread(REF, cv2.IMREAD_UNCHANGED)
    for p in sys.argv[1:]:
        im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if im.shape != ref.shape:
            im = cv2.resize(im, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        print(f"{p}: {im.dtype} PSNR 16 bits {psnr(im, ref):.2f} dB ; en 8 bits {psnr(np.round(im / 257.0), np.round(ref / 257.0), 255.0):.2f} dB ; "
              f"erreur max {np.abs(im.astype(float) - ref.astype(float)).max() / 257:.1f} niveaux")


if __name__ == "__main__":
    main()
