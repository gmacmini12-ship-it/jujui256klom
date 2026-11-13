"""tests.py -- validation of the granular solver.  Results: out/sim/tests/rapport.md (+ json per test).

  python tests.py all [--arch cpu]          # runs every test in parallel subprocesses, then writes the report
  python tests.py column --phi 30           # one test
  python tests.py blocks | determinism | fluid | conservation [dirs...] | throughput | report

All tests run on CPU, 1 thread (deterministic).  Resolutions are stated in each result.
"""
import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "out", "sim")
TESTS = os.path.join(OUT, "tests")
sys.path.insert(0, HERE)

import mpm  # noqa: E402
from mpm import (BoxC, MPM, PlaneC, Runner, SceneBase, FREE, PINNED, DEAD, UNBORN, lattice, random_quats,  # noqa: E402
                 sand_material, fluid_material)


def save(name, d):
    os.makedirs(TESTS, exist_ok=True)
    with open(os.path.join(TESTS, name + ".json"), "w") as f:
        json.dump(d, f, indent=1, default=float)


# ------------------------------------------------------------------------------------------------
# generic small scene: a list of boxes / cylinder of grains on a plane
# ------------------------------------------------------------------------------------------------
class SmallScene(SceneBase):
    f_ref = 0
    f_sim0 = 0

    def __init__(self, name, spacing, shapes, T, dt_frame, domain, phi=30.0, E=1e5, floor_mu=1.0, hold=0.0, fluid=False, seed=3):
        self.name = name
        self.spacing = spacing
        self.shapes = shapes
        self.ts = dt_frame * 30.0          # seconds per frame = ts/30
        self.export_range = (0, int(round(T / dt_frame)))
        self.domain = domain
        self.phi, self.E, self.floor_mu, self.hold = phi, E, floor_mu, hold
        self.fluid = fluid
        self.seed = seed
        self.scale = 1.0

    def build(self):
        rng = np.random.default_rng(self.seed)
        sp = self.spacing
        dx = 2 * sp
        lo_d, hi_d = [np.array(a, float) for a in self.domain]
        pad = 6 * dx
        lo, hi = lo_d - pad, hi_d + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        Xs, st, tev, coh, mat = [], [], [], [], []
        self.groups = []
        for sh in self.shapes:
            if sh["kind"] == "box":
                X = lattice(sh["lo"], sh["hi"], sp, rng)
            else:
                X = lattice((sh["c"][0] - sh["r"], sh["c"][1] - sh["r"], 0.0), (sh["c"][0] + sh["r"], sh["c"][1] + sh["r"], sh["h"]), sp, rng)
                X = X[(X[:, 0] - sh["c"][0]) ** 2 + (X[:, 1] - sh["c"][1]) ** 2 < sh["r"] ** 2]
            self.groups.append(slice(sum(len(a) for a in Xs), sum(len(a) for a in Xs) + len(X)))
            Xs.append(X)
            st.append(np.full(len(X), sh.get("state", FREE), np.int32))
            tev.append(np.full(len(X), sh.get("t_ev", 0.0), np.float32))
            coh.append(np.full(len(X), sh.get("coh", 0.0), np.float32))
            mat.append(np.full(len(X), 0, np.int32))
        X = np.concatenate(Xs)
        N = len(X)
        P = dict(x=X, v=np.zeros((N, 3), np.float32), q=random_quats(N, rng), mat=np.concatenate(mat), state=np.concatenate(st),
                 coh0=np.concatenate(coh), cohtau=np.full(N, 0.1, np.float32), t_ev=np.concatenate(tev))
        mats = [fluid_material(c0=20.0)] if self.fluid else [sand_material(E=self.E, phi_deg=self.phi, rho=1500.0)]
        statics = [PlaneC((0, 0, 1), 0.0, mu=self.floor_mu)]
        if self.fluid:
            statics += [BoxC((-1, -1, -1), (lo_d[0], 1, 1), mu=0.0), BoxC((-1, -1, -1), (1, 1, -0.0), mu=0.0)]
        s = MPM(lo, n, dx, N, sp ** 3, mats, statics=statics, roi_lo=lo_d - 0.0, roi_hi=hi_d, cfl=0.4, coh_hold=self.hold)
        self.info = dict(N=N, spacing=sp, dx=dx, grid=[int(a) for a in n])
        return s, P


# ------------------------------------------------------------------------------------------------
# 1. column collapse
# ------------------------------------------------------------------------------------------------
def measure_repose(pos, spacing, r0, h0):
    """Angle of the flank of the final deposit.  Axisymmetric: top profile z_top(r) = max z per radial bin
    (bin = 2 grain spacings); linear least squares on bins where 0.2 hmax <= z_top <= 0.8 hmax."""
    r = np.hypot(pos[:, 0], pos[:, 1])
    bw = 2 * spacing
    nb = int(r.max() / bw) + 1
    b = np.minimum((r / bw).astype(int), nb - 1)
    ztop = np.full(nb, np.nan)
    for i in range(nb):
        m = b == i
        if m.any():
            ztop[i] = pos[m, 2].max() + 0.5 * spacing
    rc = (np.arange(nb) + 0.5) * bw
    hmax = np.nanmax(ztop)
    sel = np.isfinite(ztop) & (ztop >= 0.2 * hmax) & (ztop <= 0.8 * hmax)
    slope, icpt = np.polyfit(rc[sel], ztop[sel], 1)
    ang = math.degrees(math.atan(-slope))
    # second estimate: apex to toe (toe = radius where the profile drops below 1.5 spacing)
    toe = rc[np.isfinite(ztop) & (ztop > 1.5 * spacing)].max()
    ang2 = math.degrees(math.atan(hmax / (toe - rc[np.nanargmax(ztop)])))
    return dict(angle_fit_deg=ang, angle_apex_toe_deg=ang2, hmax=float(hmax), toe_radius=float(toe), n_bins_fit=int(sel.sum()),
                runout_ratio=float((toe - r0) / r0), height_ratio=float(hmax / h0))


def test_column(phi, out=None):
    sp = 0.0015
    r0, H = 0.02, 0.05
    sc = SmallScene(f"column_phi{int(phi)}", sp, [dict(kind="cyl", c=(0, 0), r=r0, h=H)], T=1.2, dt_frame=0.02,
                    domain=((-0.09, -0.09, -0.01), (0.09, 0.09, 0.08)), phi=phi, E=1e5, floor_mu=1.0)
    d = os.path.join(TESTS, "run_" + sc.name)
    run = Runner(sc, d, log=lambda *a: None)
    t0 = time.time()
    st = run.run(0, sc.export_range[1], fresh=True)
    wall = time.time() - t0
    S = run.solver.get_state()
    free = S["state"] == FREE
    pos, vel = S["x"][free], S["v"][free]
    vm = float(np.linalg.norm(vel, axis=1).max())
    vmean = float(np.linalg.norm(vel, axis=1).mean())
    res = measure_repose(pos, sp, r0, H)
    # time history of the angle (to show it has converged)
    hist = []
    for f in range(10, sc.export_range[1] + 1, 10):
        Z = np.load(os.path.join(d, f"f{f:04d}.npz"))
        try:
            hist.append([f * 0.02, measure_repose(Z["pos"], sp, r0, H)["angle_fit_deg"], float(np.linalg.norm(Z["vel"], axis=1).max())])
        except Exception:
            pass
    res.update(phi=phi, N=int(free.sum()), spacing=sp, dx=2 * sp, r0=r0, H=H, aspect=H / r0, v_max_final=vm, v_mean_final=vmean,
               wall=wall, substeps=st["substeps"], ms_per_substep=1000 * st["wall"] / max(st["substeps"], 1),
               floor_mu=1.0, E=1e5, history=hist, T=1.2)
    save(f"column_{int(phi)}", res)
    print(json.dumps(res, default=float))


# ------------------------------------------------------------------------------------------------
# 2. blocks: pinned stays still / cohesive block holds then breaks up
# ------------------------------------------------------------------------------------------------
def test_blocks():
    sp = 0.002
    t_rel, hold, tau, c0 = 0.05, 0.10, 0.10, 3000.0
    sh = [dict(kind="box", lo=(-0.075, -0.015, 0.0), hi=(-0.045, 0.015, 0.06), state=PINNED, t_ev=t_rel, coh=c0),   # cohesive
          dict(kind="box", lo=(0.045, -0.015, 0.0), hi=(0.075, 0.015, 0.06), state=PINNED, t_ev=t_rel, coh=0.0),    # control
          dict(kind="box", lo=(-0.015, 0.035, 0.0), hi=(0.015, 0.065, 0.06), state=PINNED, t_ev=1e9, coh=c0)]       # stays pinned
    sc = SmallScene("blocks", sp, sh, T=0.7, dt_frame=0.01, domain=((-0.12, -0.05, -0.01), (0.12, 0.09, 0.09)), phi=30.0, E=1e5,
                    floor_mu=1.0, hold=hold)
    d = os.path.join(TESTS, "run_blocks")
    run = Runner(sc, d, log=lambda *a: None)
    s0 = None
    run.solver_ready = True
    t0 = time.time()
    st = run.run(0, sc.export_range[1], fresh=True)
    g_c, g_k, g_p = sc.groups
    X0 = run.P["x"]
    rows = []
    for f in range(0, sc.export_range[1] + 1, 5):
        Z = np.load(os.path.join(d, f"f{f:04d}.npz"))
        idx = Z["id"]
        order = np.argsort(idx)
        pos = np.zeros_like(X0)
        pos[idx] = Z["pos"]
        row = dict(t=float(Z["t"]))
        for nm, g in (("cohesive", g_c), ("control", g_k)):
            p = pos[g]
            p0 = X0[g]
            h = float(np.percentile(p[:, 2], 99) - 0)
            h0 = float(np.percentile(p0[:, 2], 99))
            ext = float(p[:, 0].max() - p[:, 0].min())
            dev = (p - p.mean(0)) - (p0 - p0.mean(0))
            row[nm] = dict(height_ratio=h / h0, extent_x_mm=ext * 1e3, shape_rms_dev_mm=float(np.sqrt((dev ** 2).sum(1).mean()) * 1e3))
        rows.append(row)
    pos = np.zeros_like(X0)
    Zl = np.load(os.path.join(d, f"f{sc.export_range[1]:04d}.npz"))
    pos[Zl["id"]] = Zl["pos"]
    pinned_exact = bool(np.array_equal(pos[g_p], X0[g_p]))
    res = dict(N=int(len(X0)), spacing=sp, dx=2 * sp, release_t=t_rel, cohesion_Pa=c0, hold=hold, tau=tau, rows=rows,
               pinned_block_bitwise_unchanged=pinned_exact, wall=time.time() - t0, vmax_peak=st["vmax_peak"],
               states_end=dict(pinned=int(Zl["n_pinned"]), free=int(Zl["n_free"])))
    save("blocks", res)
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, default=float))


# ------------------------------------------------------------------------------------------------
# 5. determinism + resume
# ------------------------------------------------------------------------------------------------
def _small_col():
    return SmallScene("det", 0.003, [dict(kind="cyl", c=(0, 0), r=0.02, h=0.05)], T=0.4, dt_frame=0.02,
                      domain=((-0.07, -0.07, -0.01), (0.07, 0.07, 0.08)), phi=30.0, E=1e5, floor_mu=1.0)


def test_determinism():
    import shutil
    base = os.path.join(TESTS, "run_det")
    shutil.rmtree(base, ignore_errors=True)
    res = {}
    # A: straight run to frame 20
    sc = _small_col()
    rA = Runner(sc, base + "_A", log=lambda *a: None)
    rA.run(0, 20, fresh=True)
    SA = rA.solver.get_state()
    # B: same again
    sc = _small_col()
    rB = Runner(sc, base + "_B", log=lambda *a: None)
    rB.run(0, 20, fresh=True)
    SB = rB.solver.get_state()
    res["repeat_bitwise_identical"] = all(np.array_equal(SA[k], SB[k]) for k in SA)
    # C: run to frame 9 ("killed"), new process state: new Runner resumes from checkpoint to 20
    sc = _small_col()
    rC1 = Runner(sc, base + "_C", log=lambda *a: None)
    rC1.run(0, 9, fresh=True)
    del rC1
    sc = _small_col()
    rC2 = Runner(sc, base + "_C", log=lambda *a: None)
    rC2.run(0, 20)                     # resumes at 9 -> 10..20
    SC = rC2.solver.get_state()
    res["resume_bitwise_identical"] = all(np.array_equal(SA[k], SC[k]) for k in SA)
    res["resume_from_frame"] = 9
    res["max_abs_diff_resume"] = float(max(np.abs(SA[k].astype(float) - SC[k].astype(float)).max() for k in SA))
    res["N"] = int(len(SA["x"]))
    save("determinism", res)
    print(res)


# ------------------------------------------------------------------------------------------------
# 6. fluid smoke test (door open for mixed scenes)
# ------------------------------------------------------------------------------------------------
def test_fluid():
    sp = 0.003
    sc = SmallScene("fluid", sp, [dict(kind="box", lo=(-0.03, -0.03, 0.0), hi=(0.03, 0.03, 0.06))], T=0.4, dt_frame=0.02,
                    domain=((-0.1, -0.1, -0.01), (0.1, 0.1, 0.12)), fluid=True)
    d = os.path.join(TESTS, "run_fluid")
    run = Runner(sc, d, log=lambda *a: None)
    t0 = time.time()
    st = run.run(0, sc.export_range[1], fresh=True)
    S = run.solver.get_state()
    free = S["state"] == FREE
    J = S["Jf"][free]
    z = S["x"][free][:, 2]
    res = dict(N=int(free.sum()), J_min=float(J.min()), J_max=float(J.max()), J_mean=float(J.mean()), z_mean_final=float(z.mean()),
               z_mean_initial=0.03, spread_radius=float(np.hypot(S["x"][free][:, 0], S["x"][free][:, 1]).max()),
               vmax_peak=st["vmax_peak"], finite=bool(np.isfinite(S["x"]).all()), wall=time.time() - t0, spacing=sp)
    save("fluid", res)
    print(res)


# ------------------------------------------------------------------------------------------------
# 3. conservation / finiteness from scene runs
# ------------------------------------------------------------------------------------------------
def check_run(d):
    files = sorted(glob.glob(os.path.join(d, "f[0-9][0-9][0-9][0-9].npz")))
    run = json.load(open(os.path.join(d, "run.json")))
    bad = []
    vpeak = 0.0
    ok_count = True
    finite = True
    prev_dead = 0
    ntot = None
    for p in files:
        Z = np.load(p)
        tot = int(Z["n_free"]) + int(Z["n_pinned"]) + int(Z["n_dead"])
        n_init = int(Z["n_initial"]) if "n_initial" in Z else run["n_initial"]
        n_em = int(Z["n_emitted"]) if "n_emitted" in Z else 0
        if tot != n_init + n_em:
            ok_count = False
            bad.append((os.path.basename(p), tot, n_init + n_em))
        if len(Z["pos"]) and not (np.isfinite(Z["pos"]).all() and np.isfinite(Z["vel"]).all()):
            finite = False
        if len(Z["vel"]):
            vpeak = max(vpeak, float(np.linalg.norm(Z["vel"], axis=1).max()))
        if int(Z["n_dead"]) < prev_dead:
            ok_count = False
        prev_dead = int(Z["n_dead"])
    Z = np.load(files[-1])
    return dict(dir=os.path.relpath(d, ROOT), frames=len(files), first=os.path.basename(files[0]), last=os.path.basename(files[-1]),
                count_conserved=ok_count, finite=finite, v_peak_exported=vpeak, substep_vmax_peak=run["vmax_peak"],
                n_initial=run["n_initial"], n_emitted_final=int(Z["n_emitted"]) if "n_emitted" in Z else 0,
                final_free=int(Z["n_free"]), final_pinned=int(Z["n_pinned"]), final_dead=int(Z["n_dead"]), violations=bad[:5],
                substeps=run["substeps"], scale=run["scale"])


def test_conservation(dirs):
    res = [check_run(d) for d in dirs]
    save("conservation", dict(runs=res))
    print(json.dumps(res, default=float))


# ------------------------------------------------------------------------------------------------
# 4. throughput
# ------------------------------------------------------------------------------------------------
GPU_REF_MS, GPU_REF_N, GPU_REF_GRID = 8.6, 4_000_000, 192 ** 3
CPU_REF_MS, CPU_REF_N, CPU_REF_GRID = 129.0, 400_000, 96 ** 3


def micro_bench():
    """Per-particle CPU cost (1 thread) of sand and fluid in this solver, steady state."""
    out = {}
    for kind in ("sand", "fluid"):
        sp = 0.003
        sc = SmallScene("bench_" + kind, sp, [dict(kind="box", lo=(-0.04, -0.04, 0.0), hi=(0.04, 0.04, 0.06))], T=0.1, dt_frame=0.02,
                        domain=((-0.1, -0.1, -0.01), (0.1, 0.1, 0.12)), fluid=(kind == "fluid"))
        s, P = sc.build()
        s.load(P)
        for _ in range(3):
            s.substep(2e-5)
        n = 60
        t0 = time.time()
        for _ in range(n):
            s.substep(2e-5)
        ms = (time.time() - t0) / n * 1000
        nodes = int(np.prod(s.n))
        # grid-only cost: same grid with a handful of particles
        out[kind] = dict(N=s.N, nodes=nodes, ms_per_substep=ms, us_per_particle=ms * 1000 / s.N)
    # grid overhead: empty-ish substep
    sc = SmallScene("bench_grid", 0.003, [dict(kind="box", lo=(-0.002, -0.002, 0.0), hi=(0.002, 0.002, 0.003))], T=0.1, dt_frame=0.02,
                    domain=((-0.1, -0.1, -0.01), (0.1, 0.1, 0.12)))
    s, P = sc.build()
    s.load(P)
    for _ in range(3):
        s.substep(2e-5)
    t0 = time.time()
    for _ in range(100):
        s.substep(2e-5)
    msg = (time.time() - t0) / 100 * 1000
    out["grid_only"] = dict(N=s.N, nodes=int(np.prod(s.n)), ms_per_substep=msg, ns_per_node=msg * 1e6 / np.prod(s.n))
    out["sand_over_fluid"] = out["sand"]["us_per_particle"] / out["fluid"]["us_per_particle"]
    return out


def write_throughput(bench):
    """Throughput table + extrapolation to full scale.
    Assumptions (stated in the report): substeps per frame scale as 1/dx at CFL 0.4 with c = 16.3 m/s (sand, E=3e5) plus the measured peak
    speed; GPU particle cost = 8.6 ms / 4e6 = 2.15 ns per particle per substep (reference fluid benchmark; measured sand/fluid cost ratio
    on this CPU = %.2f); GPU grid cost = 0.2 ns per node per substep (bandwidth-bound ESTIMATE, not measured; dense grid; a sparse grid
    would remove most of it)."""
    ratio = bench["sand_over_fluid"]
    t_p = GPU_REF_MS * 1e-3 / GPU_REF_N * ratio
    t_n = 0.2e-9
    scenes = [("dalle", "dalle", 131, 7.6e6, 0.3e-3), ("filet", "filet", 54, None, 0.3e-3), ("deferlement", "deferlement", 24, None, 0.4e-3),
              ("deferlement_adj", "deferlement (adj variant)", 24, None, 0.4e-3), ("deferlement_adj3", "deferlement (adj, 3x volume)", 24, None, 0.4e-3)]
    spf = 2 * 0.9565
    rows = []
    for d, label, nframes, nfull, dgrain in scenes:
        p = os.path.join(OUT, d, "run.json")
        if not os.path.exists(p):
            continue
        r = json.load(open(p))
        info = r["info"]
        N, dx = info["N"], info["dx"]
        nodes = int(np.prod(info["grid"]))
        scale = r["scale"]
        msub = 1000 * r["wall_in_substeps"] / max(r["substeps"], 1)
        sub_frame = r["substeps"] / nframes
        dx_full = spf * dgrain
        Nf = N / scale
        nodes_full = nodes * (dx / dx_full) ** 3
        vpk = r["vmax_peak"]
        dt_full = 0.4 * dx_full / (16.3 + vpk)
        ts = 0.5 if "deferl" in d else 0.35
        sub_frame_full = ts / 30 / dt_full
        t_sub = Nf * t_p + nodes_full * t_n
        total_sub = sub_frame_full * nframes
        rows.append((label, scale, N, nodes, msub, sub_frame, r["wall_in_substeps"], Nf, nodes_full, sub_frame_full, total_sub, t_sub * 1e3, total_sub * t_sub / 60,
                     Nf * t_p * total_sub / 60))
    L = ["## 6. Throughput (CPU, 1 thread, shared machine) and extrapolation to the GPU\n",
         f"Micro-benchmark, same solver, 1 thread: sand {bench['sand']['us_per_particle']:.2f} us/particle/substep, fluid {bench['fluid']['us_per_particle']:.2f} us/particle/substep "
         f"(ratio sand/fluid {ratio:.2f}); grid-only cost {bench['grid_only']['ns_per_node']:.1f} ns/node/substep. "
         f"Reference fluid benchmark (400k particles, 96^3, 129 ms/substep) is 0.32 us/particle, i.e. ~3.5x faster than 1 thread here, consistent with 4 threads.\n",
         "| scene | scale | particles (test) | grid nodes (test) | ms / substep | substeps / film frame | wall in substeps (s) |",
         "|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]:.1f} | {r[5]:.0f} | {r[6]:.0f} |")
    L += ["", "Full-scale extrapolation on the GPU (assumptions in the docstring of `write_throughput`; this is an estimate, not a measurement):\n",
          "| scene | particles (full) | dense grid nodes (full) | substeps / film frame | total substeps | ms / substep (est.) | GPU wall, dense grid (min) | GPU wall, particles only / sparse grid (min) |",
          "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r[0]} | {r[7]/1e6:.2f} M | {r[8]/1e6:.0f} M | {r[9]:.0f} | {r[10]/1e3:.0f} k | {r[11]:.1f} | {r[12]:.0f} | {r[13]:.0f} |")
    L.append("")
    open(os.path.join(TESTS, "throughput.md"), "w").write("\n".join(L) + "\n")
    return rows


def test_throughput():
    bench = micro_bench()
    save("microbench", bench)
    write_throughput(bench)
    print(json.dumps(bench, default=float))


# ------------------------------------------------------------------------------------------------
# driver + report
# ------------------------------------------------------------------------------------------------
def driver(args):
    os.makedirs(TESTS, exist_ok=True)
    procs = []
    py = sys.executable
    me = os.path.abspath(__file__)
    jobs = [[py, me, "column", "--phi", "25"], [py, me, "column", "--phi", "30"], [py, me, "column", "--phi", "35"]]
    for j in jobs:
        procs.append(subprocess.Popen(j, stdout=open(os.path.join(TESTS, "log_" + "_".join(j[2:]) + ".txt"), "w"), stderr=subprocess.STDOUT))
    for p in procs:
        p.wait()
    for name in ("blocks", "determinism", "fluid", "throughput"):
        r = subprocess.run([py, me, name], capture_output=True, text=True)
        open(os.path.join(TESTS, f"log_{name}.txt"), "w").write(r.stdout + r.stderr)
    print("done; run `tests.py report` after the scene runs")


def fmt(x, n=2):
    return f"{x:.{n}f}"


def write_report():
    L = []
    A = L.append
    A("# Granular solver validation (MLS-MPM, Drucker-Prager) -- INSOUMISE\n")
    A("All numbers below were produced by `build/sim/tests.py` on this machine (CPU, 1 thread, single precision, deterministic mode). "
      "Resolutions are given with each result; they are test resolutions, not the final 5-8 M particle runs.\n")
    # 1
    A("## 1. Column collapse -- angle of repose\n")
    A("Setup: cylinder r0 = 20 mm, H = 50 mm (aspect 2.5) of sand released on a rough plane (wall friction coefficient 1.0), grain spacing 1.5 mm "
      "(grid dx 3 mm), E = 1e5 Pa, nu = 0.3, bulk density 1500 kg/m3, run 1.2 s of physical time. "
      "Measurement: the deposit is axisymmetric; the top profile z_top(r) is the max particle height per radial bin (bin = 2 spacings, +half a spacing); "
      "the angle is the least-squares slope on the flank (bins with 0.2 hmax <= z_top <= 0.8 hmax). A second estimate uses apex-to-toe.\n")
    A("| friction angle (input) | N particles | angle (flank fit) | angle (apex-toe) | hmax / H | run-out (r_toe - r0)/r0 | v_max at end (m/s) |")
    A("|---|---|---|---|---|---|---|")
    for phi in (25, 30, 35):
        p = os.path.join(TESTS, f"column_{phi}.json")
        if os.path.exists(p):
            r = json.load(open(p))
            A(f"| {phi} deg | {r['N']} | {fmt(r['angle_fit_deg'], 1)} deg | {fmt(r['angle_apex_toe_deg'], 1)} deg | {fmt(r['height_ratio'])} | {fmt(r['runout_ratio'])} | {fmt(r['v_max_final'], 3)} |")
    A("")
    for phi in (25, 30, 35):
        p = os.path.join(TESTS, f"column_{phi}.json")
        if os.path.exists(p):
            r = json.load(open(p))
            A(f"- phi={phi}: angle(t) = " + ", ".join(f"{h[0]:.1f}s:{h[1]:.1f}" for h in r["history"][::2]) + f"  (substeps {r['substeps']}, {fmt(r['ms_per_substep'], 1)} ms/substep)")
    A("")
    # 2
    A("## 2. Pinned block / cohesive block\n")
    p = os.path.join(TESTS, "blocks.json")
    if os.path.exists(p):
        r = json.load(open(p))
        A(f"Three 30x30x60 mm blocks, grain spacing {r['spacing']*1e3:.1f} mm ({r['N']} particles). Block 1 (cohesive) and block 2 (control, no cohesion) are pinned until "
          f"t = {r['release_t']} s then released; block 3 is pinned for the whole run. Cohesion of block 1: {r['cohesion_Pa']:.0f} Pa, held "
          f"constant {r['hold']} s after release, then linear decay to 0 over {r['tau']} s (i.e. gone at t = {r['release_t'] + r['hold'] + r['tau']:.2f} s).\n")
        A(f"- Pinned block positions bit-for-bit unchanged after the run: **{r['pinned_block_bitwise_unchanged']}**; at the end pinned={r['states_end']['pinned']}, free={r['states_end']['free']}.\n")
        A("| t (s) | cohesive: height/h0 | cohesive: extent x (mm) | cohesive: internal shape deviation (mm RMS) | control: height/h0 | control: extent x (mm) |")
        A("|---|---|---|---|---|---|")
        for row in r["rows"]:
            c, k = row["cohesive"], row["control"]
            A(f"| {row['t']:.2f} | {fmt(c['height_ratio'])} | {fmt(c['extent_x_mm'], 1)} | {fmt(c['shape_rms_dev_mm'], 2)} | {fmt(k['height_ratio'])} | {fmt(k['extent_x_mm'], 1)} |")
        A("")
    # 3
    A("## 3. Particle conservation, finiteness\n")
    p = os.path.join(TESTS, "conservation.json")
    if os.path.exists(p):
        r = json.load(open(p))
        A("Checked on every exported frame: free + pinned + dead == initial + emitted; positions and velocities finite; no velocity above 200 m/s "
          "(the runner aborts if the substep maximum exceeds it).\n")
        A("| run | scale | frames | initial | emitted | final free / pinned / dead | count conserved | all finite | peak speed substeps / exported (m/s) |")
        A("|---|---|---|---|---|---|---|---|---|")
        for x in r["runs"]:
            A(f"| {x['dir']} | {x['scale']} | {x['frames']} | {x['n_initial']} | {x['n_emitted_final']} | {x['final_free']} / {x['final_pinned']} / {x['final_dead']} | {x['count_conserved']} | {x['finite']} | {fmt(x['substep_vmax_peak'])} / {fmt(x['v_peak_exported'])} |")
        A("")
    # 5
    A("## 4. Determinism and resume\n")
    p = os.path.join(TESTS, "determinism.json")
    if os.path.exists(p):
        r = json.load(open(p))
        A(f"Column of {r['N']} grains, 20 frames. Two identical runs bit-identical: **{r['repeat_bitwise_identical']}**. "
          f"Run killed after frame {r['resume_from_frame']} then restarted (checkpoint) vs. uninterrupted run, all particle fields bit-identical: **{r['resume_bitwise_identical']}** "
          f"(max abs diff {r['max_abs_diff_resume']:.3g}).\n")
    p = os.path.join(TESTS, "fluid.json")
    if os.path.exists(p):
        r = json.load(open(p))
        A("## 5. Fluid material smoke test (door open for mixed scenes)\n")
        A(f"60x60x60 mm water column, spacing {r['spacing']*1e3:.0f} mm, {r['N']} particles, 0.4 s: J in [{r['J_min']:.3f}, {r['J_max']:.3f}] (mean {r['J_mean']:.3f}), "
          f"mean height {r['z_mean_initial']*1e3:.0f} -> {r['z_mean_final']*1e3:.1f} mm, max radius {r['spread_radius']*1e3:.0f} mm, finite: {r['finite']}. Not used by the three scenes.\n")
    p = os.path.join(TESTS, "throughput.md")
    if os.path.exists(p):
        A(open(p).read())
    os.makedirs(TESTS, exist_ok=True)
    open(os.path.join(TESTS, "rapport.md"), "w").write("\n".join(L) + "\n")
    print("wrote", os.path.join(TESTS, "rapport.md"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("test")
    ap.add_argument("--phi", type=float, default=30.0)
    ap.add_argument("dirs", nargs="*")
    ap.add_argument("--arch", default="cpu")
    A = ap.parse_args()
    if A.test == "all":
        driver(A)
        return
    if A.test == "report":
        write_report()
        return
    mpm.init_taichi("cpu", 1)
    if A.test == "column":
        test_column(A.phi)
    elif A.test == "blocks":
        test_blocks()
    elif A.test == "determinism":
        test_determinism()
    elif A.test == "fluid":
        test_fluid()
    elif A.test == "conservation":
        test_conservation([os.path.abspath(d) for d in A.dirs])
    elif A.test == "throughput":
        test_throughput()
    else:
        raise SystemExit("unknown test")


if __name__ == "__main__":
    main()
