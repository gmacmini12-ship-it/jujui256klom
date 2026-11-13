#!/opt/og/venv/bin/python
"""Raccord 71 -> 72 : compare l'image 71 de la séquence 1 à la première image de la séquence 2 (cv2, numpy).
  /opt/og/venv/bin/python build/seq01/raccord_cmp.py [f71.png] [f72.png] [sortie.png]"""
import os, sys
import numpy as np
import cv2
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
a = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, "out/final/seq01/f0071.png")
b = sys.argv[2] if len(sys.argv) > 2 else os.path.join(R, "out/final/seq2/f0072.png")
o = sys.argv[3] if len(sys.argv) > 3 else os.path.join(R, "out/final/seq01/raccord_71_72.png")
A = cv2.imread(a, cv2.IMREAD_UNCHANGED).astype(np.float64); B = cv2.imread(b, cv2.IMREAD_UNCHANGED).astype(np.float64)[..., :3]
mse = np.mean((A - B) ** 2)
print(f"PSNR 71 vs 72 (16 bits) : {10 * np.log10(65535.0 ** 2 / mse):.2f} dB ; luminance moyenne {A.mean() / 257:.2f} vs {B.mean() / 257:.2f} (8 bits)")
for name, sl in (("mur et dalle (haut)", (slice(0, 1100), slice(None))), ("sol (bas)", (slice(1100, 1512), slice(None)))):
    m = np.mean((A[sl] - B[sl]) ** 2)
    print(f"  {name} : PSNR {10 * np.log10(65535.0 ** 2 / m):.2f} dB")
d = np.clip(np.abs(A - B).mean(2) / 257 * 4, 0, 255)
side = np.concatenate([(A / 257).astype(np.uint8), (B / 257).astype(np.uint8), np.repeat(d[..., None], 3, 2).astype(np.uint8)], 1)
cv2.imwrite(o, cv2.resize(side, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
print("écrit", o)
