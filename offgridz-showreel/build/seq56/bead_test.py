"""bead_test.py -- squeegee stage of the film solver alone, from a uniform film (fast, coarse), to tune bead height.
  python build/seq56/bead_test.py --tbar 1.6 [--fpx 6] [--mu 20] [--tcg 20] [--hpin 2.5]
Prints, per frame 504-527, the maximum ink thickness (the bead) and the volume budget."""
import argparse, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import film
from common import init_taichi
ap = argparse.ArgumentParser()
ap.add_argument("--tbar", type=float, default=1.6)
ap.add_argument("--fpx", type=int, default=6)
ap.add_argument("--mu", type=float, default=20.0)
ap.add_argument("--tcg", type=float, default=20.0)
ap.add_argument("--hpin", type=float, default=2.5)
ap.add_argument("--threads", type=int, default=1)
A = ap.parse_args()
init_taichi(A.threads)
fl = film.Film(fpx=A.fpx, mu=A.mu, threads=A.threads, Tcg=A.tcg * 1e-3, h_pin=A.hpin * 1e-3)
fl._tip_prev = None
b = film.tray_base(fl.nx, fl.ny, A.fpx)
fl.b.from_numpy(b.T.copy())
fl.s.from_numpy((b + A.tbar * 1e-3).T.copy())
fl.act.from_numpy(np.ones((fl.nx, fl.ny), np.int32))
v0 = fl.volume()
t0 = time.time()
for f in range(504, 528):
    n = fl.advance_frame(f)
    print("f%d substeps=%d V=%.1f/%.1f cm3 lost=%.1f Tmax=%.1f mm wall=%.0fs" % (f, n, fl.volume() * 1e6, v0 * 1e6, float(fl.lost[None]) * 1e6, float(fl.k_tmax()) * 1e3, time.time() - t0), flush=True)
