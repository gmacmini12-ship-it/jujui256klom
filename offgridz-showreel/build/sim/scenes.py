"""scenes.py -- the three grain scenes of "INSOUMISE": dalle, filet, deferlement.

  python scenes.py dalle        --arch cpu --scale 0.004 [--frames 72:215] [--threads 1] [--fresh]
  python scenes.py filet        (needs out/sim/dalle/exits.npz produced by dalle, same --scale)
  python scenes.py deferlement  [--variant spec|adj]

--scale = fraction of the full particle count (full: dalle 7.6 M grains of 0.3 mm).  Changing it changes the
grain spacing AND the grid size together (grid spacing dx = 2 * particle spacing, 8 particles per cell).
Outputs: out/sim/<scene>/f####.npz (+ ckpt.npz, exits.npz, run.json).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "out", "sim")
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "build", "type"))

import mpm  # noqa: E402
from mpm import (BoxC, CupC, ExtrudeC, KinBox, MPM, Runner, SceneBase, FREE, PINNED, DEAD, UNBORN,  # noqa: E402
                 lattice, random_quats, sand_material)

G = 9.81
RHO_BULK = 1500.0           # kg/m3, bulk density at solid fraction 0.6
PACK = 0.6
SPACING_PER_D = (math.pi / 6 / PACK) ** (1 / 3)      # bulk volume per particle = (pi/6 d^3)/0.6 = spacing^3
SAND_E = 3.0e5


def spacing_of(d_full, scale):
    return d_full * SPACING_PER_D * scale ** (-1.0 / 3.0)


def value_noise3(P, lengths, seed, octaves=2):
    """Smooth 3D value noise in [-1, 1], correlation length ~ `lengths` (per axis)."""
    rng = np.random.default_rng(seed)
    out = np.zeros(len(P))
    amp = 1.0
    tot = 0.0
    L = np.asarray(lengths, float)
    for o in range(octaves):
        lat = rng.uniform(-1, 1, (32, 32, 32))
        u = P / (L / (2 ** o)) + rng.uniform(0, 32, 3)
        i0 = np.floor(u).astype(int)
        f = u - i0
        f = f * f * (3 - 2 * f)
        acc = 0.0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                    acc = acc + w * lat[(i0[:, 0] + dx) % 32, (i0[:, 1] + dy) % 32, (i0[:, 2] + dz) % 32]
        out += amp * acc
        tot += amp
        amp *= 0.5
    return out / tot


def smoothstep(a):
    a = np.clip(a, 0, 1)
    return a * a * (3 - 2 * a)


# ==============================================================================================
# dalle
# ==============================================================================================
class Dalle(SceneBase):
    name = "dalle"
    f_ref = 72
    f_sim0 = 72
    export_range = (72, 215)
    records_exits = True

    # scene constants (spec)
    SLAB_LO = (-0.025, -0.015, 0.0)
    SLAB_HI = (0.025, 0.0, 0.24)
    WALL_Y = 0.0005
    FLOOR_EDGE_Y = -0.075
    LETTER_Y1 = -0.045             # back face
    LETTER_THICK = 0.012
    CAP = 0.03
    WIDTH = 0.13
    FRONT_START_F = 84
    FRONT_END_F = 215
    FRONT_END_Z = 0.02
    NOISE_AMP = 0.05
    CHUNK = 0.018
    COH0 = 3000.0
    COH_TAU = 0.040
    PHI = 30.0
    D_FULL = 0.3e-3
    KILL_Z = -0.03

    def __init__(self, scale=0.004, ts=0.35, seed=7):
        self.scale = scale
        self.ts = ts
        self.seed = seed
        self.dz = self.SLAB_HI[2]

    # -- letters ---------------------------------------------------------------------------
    def letter_polys(self, step_tol=3e-5):
        import typekit as tk
        g0 = tk.outlines("OFFGRIDZ", "anton", size=self.CAP, tracking=0.0)
        b0 = tk.bounds(g0)
        trk = (self.WIDTH - (b0[2] - b0[0])) / 7.0
        g = tk.outlines("OFFGRIDZ", "anton", size=self.CAP, tracking=trk)
        b = tk.bounds(g)
        pl = tk.polylines(g, step_tol)
        xc = 0.5 * (b[0] + b[2])
        polys = [np.asarray(p["points"], float) - [xc, 0.0] for p in pl]
        self.letter_info = dict(tracking=trk, width=b[2] - b[0], height=b[3] - b[1], ymin=b[1])
        return polys, [p["hole"] for p in pl], [p["char"] for p in pl]

    def build(self):
        rng = np.random.default_rng(self.seed)
        sp = spacing_of(self.D_FULL, self.scale)
        dx = 2.0 * sp
        self.sp, self.dx = sp, dx
        roi_lo = np.array([-0.12, -0.18, self.KILL_Z])
        roi_hi = np.array([0.12, 0.012, 0.27])
        pad = 6 * dx
        lo = roi_lo - pad
        hi = roi_hi + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        polys, holes, chars = self.letter_polys()
        y1 = self.LETTER_Y1
        letters = ExtrudeC(polys, y1 - self.LETTER_THICK, y1, step=min(1e-4, dx / 6), mu=0.5)
        self.letters = letters
        self.letter_polys_xz = polys
        floor = BoxC((-0.5, self.FLOOR_EDGE_Y, -0.3), (0.5, 0.5, 0.0), mu=0.5)
        wall = BoxC((-0.5, self.WALL_Y, -0.3), (0.5, 0.6, 0.6), mu=0.3)
        self.kbox = KinBox(bc="sticky")
        # ---------------- slab particles
        X = lattice(self.SLAB_LO, self.SLAB_HI, sp, rng)
        Np = len(X)
        # chunks: jittered seeds, Voronoi cells
        from scipy.spatial import cKDTree
        lo_s, hi_s = np.array(self.SLAB_LO), np.array(self.SLAB_HI)
        nc = np.maximum(np.round((hi_s - lo_s) / self.CHUNK).astype(int), 1)
        cell = (hi_s - lo_s) / nc
        ax = [lo_s[i] + (np.arange(nc[i]) + 0.5) * cell[i] for i in range(3)]
        seeds = np.stack(np.meshgrid(*ax, indexing="ij"), -1).reshape(-1, 3)
        seeds = seeds + (rng.random(seeds.shape) - 0.5) * 0.9 * cell
        # irregularity: extra seeds so cells have unequal size
        extra = lo_s + rng.random((max(len(seeds) // 4, 1), 3)) * (hi_s - lo_s)
        seeds = np.vstack([seeds, extra])
        cid = cKDTree(seeds).query(X)[1]
        ucid, cid = np.unique(cid, return_inverse=True)
        nchunk = len(ucid)
        cen = np.zeros((nchunk, 3))
        np.add.at(cen, cid, X)
        cen /= np.bincount(cid, minlength=nchunk)[:, None]
        # front: release height of chunk = z_c + noise
        A = self.NOISE_AMP
        nz = value_noise3(cen, (0.035, 0.02, 0.05), self.seed + 1)
        nz = nz / max(np.abs(nz).max(), 1e-6)
        jit = rng.uniform(-1, 1, nchunk)
        zr = cen[:, 2] + A * (0.8 * nz + 0.2 * jit)
        z0 = float(zr.max())
        u = np.sqrt(np.clip((z0 - zr) / (z0 - self.FRONT_END_Z), 0, None))      # ease-in: z_front = z0 - (z0-zend) u^2
        u = np.where(u > 1.0, np.inf, u)
        f_rel = self.FRONT_START_F + (self.FRONT_END_F - self.FRONT_START_F) * u
        t_chunk = np.where(np.isfinite(f_rel), (f_rel - self.f_ref) / 30.0 * self.ts, 1e9)
        t_ev = t_chunk[cid]
        self.chunk_t, self.chunk_z = t_chunk, cen[:, 2]
        # lowest released initial height versus time -> kinematic box top
        order = np.argsort(t_ev)
        ts_sorted = t_ev[order]
        zmin_cum = np.minimum.accumulate(X[order, 2])
        keep = ts_sorted < 1e8
        self.ev_t, self.ev_z = ts_sorted[keep], zmin_cum[keep]
        self.zr_chunks = zr
        mats = [sand_material(E=SAND_E, phi_deg=self.PHI, rho=RHO_BULK)]
        # N includes the slab only (grains are all pinned at start)
        N = Np
        P = dict(x=X, v=np.zeros((N, 3), np.float32), q=random_quats(N, rng), mat=np.zeros(N, np.int32),
                 state=np.full(N, PINNED, np.int32), coh0=np.full(N, self.COH0, np.float32),
                 cohtau=np.full(N, self.COH_TAU, np.float32), t_ev=t_ev.astype(np.float32))
        self.chunk_id = cid
        s = MPM(lo, n, dx, N, sp ** 3, mats, statics=[floor, wall, letters], kins=[self.kbox],
                roi_lo=roi_lo, roi_hi=roi_hi, cfl=0.4, solid_mu=0.3)
        self.info = dict(N=N, spacing=sp, dx=dx, grid=[int(a) for a in n], chunks=int(nchunk),
                         released_fraction=float(np.mean(t_ev < 1e8)), letters=self.letter_info)
        self._tb = (0.0, 1.0, self.dz, self.dz)
        return s, P

    def zb_at(self, t):
        k = int(np.searchsorted(self.ev_t, t, side="right"))
        return self.dz if k == 0 else float(min(self.ev_z[k - 1], self.dz))

    def begin_frame(self, s, f, t0, t1):
        zb0 = self.zb_at(t0)
        zb1 = self.zb_at(t1 + 1e-9)
        self._tb = (t0, t1, zb0, zb1)
        s.build_solid(zb1 - 2 * s.dx)

    def update_kinematics(self, s, t):
        t0, t1, zb0, zb1 = self._tb
        a = 0.0 if t1 <= t0 else min(max((t - t0) / (t1 - t0), 0.0), 1.0)
        top = zb0 + a * (zb1 - zb0)
        vz = 0.0 if t1 <= t0 else (zb1 - zb0) / (t1 - t0)
        self.kbox.set((self.SLAB_LO[0], self.SLAB_LO[1], -0.01), (self.SLAB_HI[0], self.WALL_Y - 1e-4, top), (0, 0, vz))

    def export_extra(self, s, f):
        return dict(z_box_top=np.float32(self._tb[3]))


# ==============================================================================================
# filet
# ==============================================================================================
class Filet(SceneBase):
    name = "filet"
    f_ref = 72                  # same physical clock as dalle
    export_range = (168, 215)
    ts = 0.35
    X_MAX = 0.01
    GLASS_R_BOT, GLASS_R_TOP, GLASS_H, GLASS_WALL = 0.032, 0.034, 0.129, 0.0025
    DROP = 0.30

    def __init__(self, scale=0.004, dalle_dir=None, seed=11):
        self.scale = scale
        self.dalle_dir = dalle_dir or os.path.join(OUT, "dalle")
        self.seed = seed

    def build(self):
        rng = np.random.default_rng(self.seed)
        Z = np.load(os.path.join(self.dalle_dir, "exits.npz"))
        assert abs(float(Z["scale"]) - self.scale) < 1e-9, "filet must run at the same --scale as dalle"
        ok = (Z["pos"][:, 1] < -0.07) & (np.abs(Z["pos"][:, 0]) < self.X_MAX) & (Z["t"] >= 0) & (Z["cause"] <= 2) & (Z["cause"] >= 1)
        # world frame of exit
        ex_pos = Z["pos"][ok].astype(np.float64)
        ex_vel = Z["vel"][ok].astype(np.float64)
        ex_t = Z["t"][ok].astype(np.float64)
        self.n_exits_total = int(np.sum((Z["cause"] >= 1) & (Z["cause"] <= 2) & (Z["pos"][:, 1] < -0.07)))
        self.n_exits_stream = int(ok.sum())
        assert self.n_exits_stream > 0, "no grains left dalle through the front edge inside |x|<0.01"
        order = np.argsort(ex_t, kind="stable")
        ex_pos, ex_vel, ex_t = ex_pos[order], ex_vel[order], ex_t[order]
        self.ex_ids = Z["id"][ok][order]
        sp = spacing_of(Dalle.D_FULL, self.scale)
        dx = 2 * sp
        # glass axis: mean ballistic landing position at the glass bottom level
        z_bot = -self.DROP
        zl = z_bot + 0.03
        disc = ex_vel[:, 2] ** 2 - 2 * (-G) * (ex_pos[:, 2] - zl) * (-1)   # v^2 + 2g(z0 - zl)
        tl = (ex_vel[:, 2] + np.sqrt(ex_vel[:, 2] ** 2 + 2 * G * (ex_pos[:, 2] - zl))) / G
        land = ex_pos[:, :2] + ex_vel[:, :2] * tl[:, None]
        cx = float(np.median(land[:, 0]))
        cy = float(np.median(land[:, 1]))
        self.glass_axis = (0.0, cy)
        r_out = self.GLASS_R_TOP + self.GLASS_WALL
        inside = (np.hypot(land[:, 0] - 0.0, land[:, 1] - cy) < self.GLASS_R_BOT).mean()
        self.info = dict(n_exits_total=self.n_exits_total, n_exits_stream=self.n_exits_stream, glass_axis=[0.0, cy],
                         landing_median=[cx, cy], landing_std=[float(land[:, 0].std()), float(land[:, 1].std())],
                         fraction_ballistic_inside_inner_radius=float(inside),
                         exit_speed_mean=float(np.linalg.norm(ex_vel, axis=1).mean()),
                         exit_vy_mean=float(ex_vel[:, 1].mean()), exit_vz_mean=float(ex_vel[:, 2].mean()),
                         t_first_exit=float(ex_t[0]), t_last_exit=float(ex_t[-1]))
        # domain: glass footprint + landing spread, from emission plane down to below the glass
        zt = float(ex_pos[:, 2].max()) + 0.012
        xs = np.concatenate([land[:, 0], [-r_out, r_out]])
        ys = np.concatenate([land[:, 1], ex_pos[:, 1], [cy - r_out, cy + r_out]])
        # emission volume lies on a ballistic arc: bound it
        tt = np.linspace(0, 0.3, 40)
        arcx = (ex_pos[:, None, 0] + ex_vel[:, None, 0] * tt[None]).ravel()
        arcy = (ex_pos[:, None, 1] + ex_vel[:, None, 1] * tt[None]).ravel()
        roi_lo = np.array([min(xs.min(), arcx.min()) - 0.01, min(ys.min(), arcy.min()) - 0.01, z_bot - self.GLASS_WALL - 0.02])
        roi_hi = np.array([max(xs.max(), arcx.max()) + 0.01, max(ys.max(), arcy.max()) + 0.01, zt])
        # restrict to the region that is actually reached: clip arc where z < glass bottom
        pad = 6 * dx
        lo = roi_lo - pad
        hi = roi_hi + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        wall_eff = max(self.GLASS_WALL, 3.0 * dx)      # a wall thinner than ~3 grid cells leaks (thin-slab normals): thicken OUTWARD at coarse scale
        cup = CupC(0.0, cy, z_bot, self.GLASS_H, self.GLASS_R_BOT, self.GLASS_R_TOP, wall_eff, bottom=wall_eff, mu=0.4)
        self.wall_eff = wall_eff
        Ne = len(ex_t)
        jit = (rng.random((Ne, 3)) - 0.5) * 0.0
        P = dict(x=ex_pos.astype(np.float32), v=ex_vel.astype(np.float32), q=random_quats(Ne, rng),
                 mat=np.zeros(Ne, np.int32), state=np.full(Ne, UNBORN, np.int32),
                 coh0=np.zeros(Ne, np.float32), cohtau=np.ones(Ne, np.float32), t_ev=ex_t.astype(np.float32))
        mats = [sand_material(E=SAND_E, phi_deg=Dalle.PHI, rho=RHO_BULK)]
        s = MPM(lo, n, dx, Ne, sp ** 3, mats, statics=[cup], roi_lo=roi_lo, roi_hi=roi_hi, cfl=0.4)
        # simulation starts one frame before the first exit
        f_first = self.f_ref + ex_t[0] / self.ts * 30.0
        self.f_sim0 = int(math.floor(f_first)) - 1
        self.info.update(f_first_exit=float(f_first), glass_wall_effective=float(wall_eff), f_sim0=self.f_sim0, N=Ne, spacing=sp, dx=dx, grid=[int(a) for a in n])
        self.cup = cup
        return s, P


# ==============================================================================================
# deferlement
# ==============================================================================================
class Deferlement(SceneBase):
    name = "deferlement"
    f_ref = 456
    f_sim0 = 456
    export_range = (456, 479)
    VIS = (0.054, 0.096)                 # visible half extents
    TRAY = (0.0504, 0.0756)
    DEPTH = 0.004
    VENT_R = 0.012
    D_FULL = 0.4e-3
    PHI = 28.0
    EMIT_FRAMES = 10

    def __init__(self, scale=0.01, variant="spec", ts=None, seed=5, vol_factor=None):
        self.scale = scale
        self.variant = variant
        self.seed = seed
        if variant == "spec":
            self.ts = 0.5 if ts is None else ts
            self.v_lo, self.v_hi, self.cone = 2.0, 2.6, 25.0
            self.vol_factor = 1.0 if vol_factor is None else vol_factor
        else:       # adjusted: see report (slower vent speed, more material)
            self.ts = 0.5 if ts is None else ts
            self.v_lo, self.v_hi, self.cone = 0.9, 1.2, 25.0
            self.vol_factor = 1.6 if vol_factor is None else vol_factor

    def volumes(self):
        tray = 2 * self.TRAY[0] * 2 * self.TRAY[1] * self.DEPTH
        sheet = 2 * self.VIS[0] * 2 * self.VIS[1] * 0.003
        return tray, sheet

    def build(self):
        rng = np.random.default_rng(self.seed)
        sp = spacing_of(self.D_FULL, self.scale)
        dx = 2 * sp
        self.sp, self.dx = sp, dx
        roi_lo = np.array([-0.11, -0.15, -self.DEPTH - 0.004])
        roi_hi = np.array([0.11, 0.15, 0.35])
        pad = 6 * dx
        lo = roi_lo - pad
        hi = roi_hi + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        tx, ty, dp = self.TRAY[0], self.TRAY[1], self.DEPTH
        big = 1.0
        # sheet (z<0) with a recessed tray: floor of the tray at -dp + four slabs around it
        statics = [
            BoxC((-big, -big, -0.3), (big, big, -dp), mu=0.45),
            BoxC((-big, -big, -0.3), (-tx, big, 0.0), mu=0.45),
            BoxC((tx, -big, -0.3), (big, big, 0.0), mu=0.45),
            BoxC((-tx, -big, -0.3), (tx, -ty, 0.0), mu=0.45),
            BoxC((-tx, ty, -0.3), (tx, big, 0.0), mu=0.45),
        ]
        tray_v, sheet_v = self.volumes()
        V = (tray_v + sheet_v) * self.vol_factor
        Ne = int(round(V / sp ** 3))
        T_emit = self.EMIT_FRAMES / 30.0 * self.ts
        # emission times uniform over [0, T_emit], positions uniform in the vent disc (area-uniform)
        te = np.sort(rng.random(Ne) * T_emit)
        r = self.VENT_R * np.sqrt(rng.random(Ne))
        a = rng.random(Ne) * 2 * np.pi
        pos = np.stack([r * np.cos(a), r * np.sin(a), np.full(Ne, 0.0 - dp + 0.5 * sp)], 1)
        # direction: uniform in solid angle within the cone (half-angle `cone`), speed uniform
        cth = 1 - rng.random(Ne) * (1 - math.cos(math.radians(self.cone)))
        sth = np.sqrt(1 - cth ** 2)
        ph = rng.random(Ne) * 2 * np.pi
        spd = self.v_lo + rng.random(Ne) * (self.v_hi - self.v_lo)
        vel = np.stack([spd * sth * np.cos(ph), spd * sth * np.sin(ph), spd * cth], 1)
        P = dict(x=pos.astype(np.float32), v=vel.astype(np.float32), q=random_quats(Ne, rng), mat=np.zeros(Ne, np.int32),
                 state=np.full(Ne, UNBORN, np.int32), coh0=np.zeros(Ne, np.float32), cohtau=np.ones(Ne, np.float32),
                 t_ev=te.astype(np.float32))
        mats = [sand_material(E=SAND_E, phi_deg=self.PHI, rho=RHO_BULK)]
        s = MPM(lo, n, dx, Ne, sp ** 3, mats, statics=statics, roi_lo=roi_lo, roi_hi=roi_hi, cfl=0.4)
        self.info = dict(N=Ne, spacing=sp, dx=dx, grid=[int(a) for a in n], variant=self.variant, volume_emitted=Ne * sp ** 3,
                         volume_tray=tray_v, volume_sheet_3mm=sheet_v, v_range=[self.v_lo, self.v_hi], cone=self.cone,
                         time_scale=self.ts)
        return s, P


# ==============================================================================================
def make_scene(name, scale, **kw):
    if name == "dalle":
        return Dalle(scale=scale)
    if name == "filet":
        return Filet(scale=scale)
    if name == "deferlement":
        return Deferlement(scale=scale, variant=kw.get("variant", "spec"), vol_factor=kw.get("vol_factor"))
    raise SystemExit(f"unknown scene {name}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scene", choices=["dalle", "filet", "deferlement"])
    ap.add_argument("--arch", choices=["cpu", "cuda"], default="cpu")
    ap.add_argument("--scale", type=float, default=0.004)
    ap.add_argument("--frames", default=None, help="a:b (film frames, inclusive)")
    ap.add_argument("--threads", type=int, default=1, help="CPU threads (1 = bitwise deterministic)")
    ap.add_argument("--fresh", action="store_true", help="ignore checkpoint")
    ap.add_argument("--variant", default="spec", choices=["spec", "adj"])
    ap.add_argument("--vol-factor", type=float, default=None, help="deferlement: emitted volume / (tray + 3 mm sheet)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--ckpt-every", type=int, default=1)
    ap.add_argument("--export-dead", action="store_true")
    A = ap.parse_args(argv)
    sc = make_scene(A.scene, A.scale, variant=A.variant, vol_factor=A.vol_factor)
    outdir = A.out or os.path.join(OUT, A.scene if not (A.scene == "deferlement" and A.variant != "spec") else A.scene + "_" + A.variant)
    runner = Runner(sc, outdir, arch=A.arch, threads=A.threads, export_dead=A.export_dead, ckpt_every=A.ckpt_every)
    fa, fb = sc.export_range
    if A.frames:
        fa, fb = [int(v) for v in A.frames.split(":")]
    t0 = time.time()
    stats = runner.run(fa, fb, fresh=A.fresh)
    wall = time.time() - t0
    sc.scale = A.scale
    info = dict(scene=A.scene, scale=A.scale, arch=A.arch, threads=A.threads, frames=[fa, fb], wall_total=wall,
                setup_time=runner.setup_time, substeps=stats["substeps"], wall_in_substeps=stats["wall"],
                vmax_peak=stats["vmax_peak"], info=getattr(sc, "info", {}), counts=runner.solver.counts(),
                n_initial=runner.n_initial, n_emitted=runner.emit_ptr)
    with open(os.path.join(outdir, "run.json"), "w") as f:
        json.dump(info, f, indent=1, default=float)
    print(json.dumps({k: v for k, v in info.items() if k != "info"}, default=float))


if __name__ == "__main__":
    main()
