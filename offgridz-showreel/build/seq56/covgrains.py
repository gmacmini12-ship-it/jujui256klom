"""covgrains.py -- cheap coverage metric on a grain cache (no rendering): fraction of the sheet covered by grains per frame.
  python build/seq56/covgrains.py cache/seq56/grains_s0.01 [f0 f1]
Sheet cells of one grain spacing; a cell is covered if a free grain centre lies inside it (or one of its 8 neighbours: grains
overlap).  Also the 20 px edge bands (top, bottom, left, right) and the first frame at which each band is >= 90 % covered."""
import json, os, sys
import numpy as np
cache = sys.argv[1]
r = json.load(open(os.path.join(cache, "run.json")))
sp = r["info"]["spacing"]
nx, ny = int(0.108 / sp), int(0.192 / sp)
fa, fb = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (456, 479)
first = {}
for f in range(fa, fb + 1):
    p = os.path.join(cache, "f%04d.npz" % f)
    if not os.path.exists(p):
        continue
    P = np.load(p)["pos"]
    i = ((P[:, 0] + 0.054) / 0.108 * nx).astype(int); j = ((0.096 - P[:, 1]) / 0.192 * ny).astype(int)
    ok = (i >= 0) & (i < nx) & (j >= 0) & (j < ny)
    g = np.zeros((ny, nx), np.uint8); g[j[ok], i[ok]] = 1
    from scipy.ndimage import maximum_filter
    g = maximum_filter(g, size=3)
    e = max(int(round(0.002 / (0.192 / ny))), 1)
    bands = dict(top=g[:e].mean(), bottom=g[-e:].mean(), left=g[:, :max(int(0.002 / (0.108 / nx)), 1)].mean(), right=g[:, -max(int(0.002 / (0.108 / nx)), 1):].mean())
    for k, v in bands.items():
        if v >= 0.9 and k not in first:
            first[k] = f
    if f >= fb - 6:
        print(f, "sheet %.3f" % g.mean(), {k: round(float(v), 2) for k, v in bands.items()})
print("first frame with band >= 90%:", first)
