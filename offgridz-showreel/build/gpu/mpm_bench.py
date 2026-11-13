"""MLS-MPM throughput benchmark (weakly compressible fluid, 3D), CPU or CUDA.

  python mpm_bench.py --arch cuda --n 4000000 --grid 192 --steps 40

Prints one line beginning with BENCH. Must be run from a file (Taichi needs the source).
"""
import argparse, time

import numpy as np
import taichi as ti

ap = argparse.ArgumentParser()
ap.add_argument("--arch", choices=["cpu", "cuda"], default="cpu")
ap.add_argument("--n", type=int, default=400_000)
ap.add_argument("--grid", type=int, default=96)
ap.add_argument("--steps", type=int, default=20)
A = ap.parse_args()

ti.init(arch=ti.cuda if A.arch == "cuda" else ti.cpu, log_level=ti.ERROR)
n, ng = A.n, A.grid
dx, inv_dx, dt = 1 / ng, float(ng), 1e-4 * 96 / ng
pvol = dx ** 3 * 0.25
x = ti.Vector.field(3, float, n); v = ti.Vector.field(3, float, n)
C = ti.Matrix.field(3, 3, float, n); J = ti.field(float, n)
gv = ti.Vector.field(3, float, (ng, ng, ng)); gm = ti.field(float, (ng, ng, ng))


@ti.kernel
def init():
    for i in x:
        x[i] = ti.Vector([ti.random() * 0.4 + 0.3, ti.random() * 0.4 + 0.4, ti.random() * 0.4 + 0.3])
        J[i] = 1.0


@ti.kernel
def step():
    for I in ti.grouped(gm):
        gv[I] = ti.Vector.zero(float, 3); gm[I] = 0.0
    for p in x:
        Xp = x[p] * inv_dx; base = int(Xp - 0.5); fx = Xp - base
        w = [0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2]
        stress = -dt * 4 * 400.0 * (J[p] - 1) * inv_dx * inv_dx * pvol
        aff = ti.Matrix.identity(float, 3) * stress + pvol * C[p]
        for o in ti.static(ti.ndrange(3, 3, 3)):
            off = ti.Vector(o); wt = w[o[0]][0] * w[o[1]][1] * w[o[2]][2]; dpos = (off - fx) * dx
            gv[base + off] += wt * (pvol * v[p] + aff @ dpos); gm[base + off] += wt * pvol
    for I in ti.grouped(gm):
        if gm[I] > 0:
            gv[I] /= gm[I]; gv[I].y -= dt * 9.8
            for d in ti.static(range(3)):
                if I[d] < 3 and gv[I][d] < 0: gv[I][d] = 0
                if I[d] > ng - 3 and gv[I][d] > 0: gv[I][d] = 0
    for p in x:
        Xp = x[p] * inv_dx; base = int(Xp - 0.5); fx = Xp - base
        w = [0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2]
        nv = ti.Vector.zero(float, 3); nC = ti.Matrix.zero(float, 3, 3)
        for o in ti.static(ti.ndrange(3, 3, 3)):
            off = ti.Vector(o); wt = w[o[0]][0] * w[o[1]][1] * w[o[2]][2]; dpos = (off - fx) * dx; g = gv[base + off]
            nv += wt * g; nC += 4 * inv_dx * inv_dx * wt * g.outer_product(dpos)
        v[p] = nv; C[p] = nC; J[p] *= 1 + dt * nC.trace(); x[p] += dt * nv


init(); step(); ti.sync()
t = time.time()
for _ in range(A.steps):
    step()
ti.sync()
el = time.time() - t
xs = x.to_numpy()
print(f"BENCH mpm arch={A.arch} particles={n} grid={ng} ms_per_substep={el / A.steps * 1000:.1f} "
      f"finite={bool(np.isfinite(xs).all())} mean_height={xs[:, 1].mean():.3f}", flush=True)
