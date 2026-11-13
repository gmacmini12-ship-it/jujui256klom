"""Séquence 2 — simulations de grains du film final : la dalle qui s'effondre et le filet qui tombe dans le verre.

Mêmes solveur et lanceur que build/sim (méthode des points matériels, sable de Drucker-Prager) ; la géométrie et
l'horloge sont celles de build/grains/monde.py :

- la dalle a les proportions de la bande du logo ; un front de décohésion la descend entre les images 84 et 128 ;
- le sol s'arrête à 115 mm du mur ; une fente centrale de 14 mm, le bec, laisse couler les grains comme un sablier ;
- les grains passés par le bec sont repris par la simulation « filet » et tombent de 80 cm dans le verre du mojito ;
- l'horloge revient du ralenti au temps réel entre les images 198 et 216.

    /opt/og/venv/bin/python build/grains/sim.py dalle --scale 0.008 --threads 3
    /opt/og/venv/bin/python build/grains/sim.py filet --scale 0.008          (après dalle, même --scale)
    ... --arch cuda --scale 0.25 sur le GPU loué

Sorties : out/grains/<scène>/f####.npz, run.json, exits.npz (dalle).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, "..", ".."))
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(RACINE, "build", "sim"))
sys.path.insert(0, os.path.join(RACINE, "build", "type"))

import monde as M                                                            # noqa: E402
import mpm                                                                   # noqa: E402
import taichi as ti                                                          # noqa: E402
from mpm import BoxC, Collider, CupC, ExtrudeC, KinBox, MPM, Runner, SceneBase, PINNED, UNBORN, lattice, random_quats, sand_material   # noqa: E402
from scenes import RHO_BULK, spacing_of, value_noise3                        # noqa: E402

SORTIE = os.path.join(RACINE, "out", "grains")
G = 9.81
SABLE_E = 1.0e5            # raideur du sable : assez pour un tas de quelques centimètres, pas de quoi imposer des pas minuscules
D_GRAIN = 0.3e-3           # diamètre du grain à l'échelle 1
PHI = 30.0                 # angle de frottement interne (degrés)
# verre du mojito (cotes intérieures, voir build/mojito/scene.py)
VERRE_R_BAS, VERRE_R_HAUT, VERRE_H, VERRE_PAROI, VERRE_FOND = 0.0318, 0.0363, 0.131, 0.0022, 0.012


@ti.data_oriented
class EntonnoirC(Collider):
    """Entonnoir conique d'axe vertical : paroi d'épaisseur `paroi` entre la bouche (rayon r1 à z1) et le col (rayon r0 à z0).
    Distance : celle du point au segment qui porte la paroi dans le demi-plan (rayon, hauteur), moins la demi-épaisseur."""
    kind_name = "entonnoir"

    def __init__(self, cx, cy, r0, z0, r1, z1, paroi, bc="sep", mu=0.4):
        super().__init__(bc, mu)
        self.c = (float(cx), float(cy))
        self.a = (float(r0 + paroi / 2), float(z0))       # bas de la paroi (col)
        self.b = (float(r1 + paroi / 2), float(z1))       # haut de la paroi (bouche)
        self.demi = float(paroi / 2)

    @ti.func
    def sdf(self, p):
        rx = p[0] - self.c[0]
        ry = p[1] - self.c[1]
        rho = ti.sqrt(rx * rx + ry * ry)
        a = ti.Vector([self.a[0], self.a[1]])
        b = ti.Vector([self.b[0], self.b[1]])
        q = ti.Vector([rho, p[2]])
        ab = b - a
        u = ti.min(ti.max((q - a).dot(ab) / ab.dot(ab), 0.0), 1.0)
        e = q - (a + u * ab)
        dist = e.norm()
        n2 = ti.Vector([1.0, 0.0])
        if dist > 1e-9:
            n2 = e / dist
        rh = ti.Vector([1.0, 0.0])
        if rho > 1e-9:
            rh = ti.Vector([rx / rho, ry / rho])
        return dist - self.demi, ti.Vector([n2[0] * rh[0], n2[0] * rh[1], n2[1]])


class Horloge:
    """Horloge de l'atelier : ralenti, puis retour au temps réel (monde.t_de)."""
    f_ref = M.IMAGE_0
    ts = M.RALENTI

    def t_of(self, f):
        return M.t_de(f)


class Dalle(Horloge, SceneBase):
    name = "dalle"
    f_sim0 = 72
    export_range = (72, 228)
    records_exits = True
    NOISE_AMP = 0.05
    CHUNK = 0.018
    COH0 = 3000.0
    COH_TAU = 0.040
    KILL_Z = -0.03

    def __init__(self, scale=0.008, seed=7):
        self.scale = scale
        self.seed = seed
        self.dz = M.DALLE_HI[2]

    def letter_polys(self, step_tol=3e-5):
        chemin = os.path.join(RACINE, "cache", "grains", "lettres.json")
        if os.path.exists(chemin):          # contours déjà calculés (build/grains/lettres.py) : pas besoin des polices ici
            info = json.load(open(chemin))["anton"]
            self.letter_info = dict(width=info["largeur"], height=info["hauteur"], source="cache/grains/lettres.json")
            return [np.asarray(c["points"], float) for c in info["contours"]]
        import typekit as tk
        g0 = tk.outlines("OFFGRIDZ", "anton", size=M.LETTRES_CAP, tracking=0.0)
        b0 = tk.bounds(g0)
        trk = (M.LETTRES_LARGEUR - (b0[2] - b0[0])) / 7.0
        g = tk.outlines("OFFGRIDZ", "anton", size=M.LETTRES_CAP, tracking=trk)
        b = tk.bounds(g)
        pl = tk.polylines(g, step_tol)
        xc = 0.5 * (b[0] + b[2])
        polys = [np.asarray(p["points"], float) - [xc, 0.0] for p in pl]
        self.letter_info = dict(tracking=trk, width=b[2] - b[0], height=b[3] - b[1], ymin=b[1])
        return polys

    def build(self):
        rng = np.random.default_rng(self.seed)
        sp = spacing_of(D_GRAIN, self.scale)
        dx = 2.0 * sp
        self.sp, self.dx = sp, dx
        roi_lo = np.array([-0.12, M.SOL_BORD - 0.02, self.KILL_Z])
        roi_hi = np.array([0.12, 0.012, 0.27])
        pad = 6 * dx
        lo, hi = roi_lo - pad, roi_hi + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        polys = self.letter_polys()
        letters = ExtrudeC(polys, M.LETTRES_Y - M.LETTRES_EP, M.LETTRES_Y, step=min(1e-4, dx / 6), mu=0.5)
        # le sol : une grande dalle jusqu'au bec, puis deux avancées de part et d'autre de la fente
        sol = BoxC((-0.5, M.BEC_Y, -0.3), (0.5, 0.5, 0.0), mu=0.5)
        avancee_g = BoxC((-0.5, M.SOL_BORD, -0.3), (-M.BEC_DEMI, M.BEC_Y + 1e-4, 0.0), mu=0.5)
        avancee_d = BoxC((M.BEC_DEMI, M.SOL_BORD, -0.3), (0.5, M.BEC_Y + 1e-4, 0.0), mu=0.5)
        avant = BoxC((-M.BEC_DEMI - 1e-4, M.SOL_BORD, -0.3), (M.BEC_DEMI + 1e-4, M.BEC_AVANT, 0.0), mu=0.5)      # ferme la fente à l'avant
        wall = BoxC((-0.5, M.MUR_Y, -0.3), (0.5, 0.6, 0.6), mu=0.3)
        self.kbox = KinBox(bc="sticky")
        X = lattice(M.DALLE_LO, M.DALLE_HI, sp, rng, jitter=0.3)      # empilement irrégulier : pas de trame visible sur la dalle
        Np = len(X)
        # blocs : cellules de Voronoï autour de germes décalés
        from scipy.spatial import cKDTree
        lo_s, hi_s = np.array(M.DALLE_LO), np.array(M.DALLE_HI)
        nc = np.maximum(np.round((hi_s - lo_s) / self.CHUNK).astype(int), 1)
        cell = (hi_s - lo_s) / nc
        ax = [lo_s[i] + (np.arange(nc[i]) + 0.5) * cell[i] for i in range(3)]
        seeds = np.stack(np.meshgrid(*ax, indexing="ij"), -1).reshape(-1, 3)
        seeds = seeds + (rng.random(seeds.shape) - 0.5) * 0.9 * cell
        extra = lo_s + rng.random((max(len(seeds) // 4, 1), 3)) * (hi_s - lo_s)
        seeds = np.vstack([seeds, extra])
        cid = cKDTree(seeds).query(X)[1]
        ucid, cid = np.unique(cid, return_inverse=True)
        nchunk = len(ucid)
        cen = np.zeros((nchunk, 3))
        np.add.at(cen, cid, X)
        cen /= np.bincount(cid, minlength=nchunk)[:, None]
        # front : hauteur de libération de chaque bloc = sa hauteur + un bruit
        nz = value_noise3(cen, (0.035, 0.02, 0.05), self.seed + 1)
        nz = nz / max(np.abs(nz).max(), 1e-6)
        zr = cen[:, 2] + self.NOISE_AMP * (0.8 * nz + 0.2 * rng.uniform(-1, 1, nchunk))
        z0 = float(zr.max())
        u = np.sqrt(np.clip((z0 - zr) / (z0 - 0.02), 0, None))          # départ lent, puis le front accélère
        u = np.where(u > 1.0, np.inf, u)
        f_rel = M.FRONT[0] + (M.FRONT[1] - M.FRONT[0]) * u
        t_chunk = np.array([M.t_de(f) if np.isfinite(f) else 1e9 for f in f_rel])
        t_ev = t_chunk[cid]
        order = np.argsort(t_ev)
        ts_sorted = t_ev[order]
        zmin_cum = np.minimum.accumulate(X[order, 2])
        keep = ts_sorted < 1e8
        self.ev_t, self.ev_z = ts_sorted[keep], zmin_cum[keep]
        mats = [sand_material(E=SABLE_E, phi_deg=PHI, rho=RHO_BULK)]
        P = dict(x=X, v=np.zeros((Np, 3), np.float32), q=random_quats(Np, rng), mat=np.zeros(Np, np.int32),
                 state=np.full(Np, PINNED, np.int32), coh0=np.full(Np, self.COH0, np.float32),
                 cohtau=np.full(Np, self.COH_TAU, np.float32), t_ev=t_ev.astype(np.float32))
        s = MPM(lo, n, dx, Np, sp ** 3, mats, statics=[sol, avancee_g, avancee_d, avant, wall, letters], kins=[self.kbox],
                roi_lo=roi_lo, roi_hi=roi_hi, cfl=0.4, solid_mu=0.3)
        self.info = dict(N=Np, spacing=sp, dx=dx, grid=[int(a) for a in n], chunks=int(nchunk),
                         released_fraction=float(np.mean(t_ev < 1e8)), letters=self.letter_info)
        self._tb = (0.0, 1.0, self.dz, self.dz)
        return s, P

    def zb_at(self, t):
        k = int(np.searchsorted(self.ev_t, t, side="right"))
        return self.dz if k == 0 else float(min(self.ev_z[k - 1], self.dz))

    def begin_frame(self, s, f, t0, t1):
        zb1 = self.zb_at(t1 + 1e-9)
        self._tb = (t0, t1, self.zb_at(t0), zb1)
        s.build_solid(zb1 - 2 * s.dx)

    def update_kinematics(self, s, t):
        t0, t1, zb0, zb1 = self._tb
        a = 0.0 if t1 <= t0 else min(max((t - t0) / (t1 - t0), 0.0), 1.0)
        top = zb0 + a * (zb1 - zb0)
        vz = 0.0 if t1 <= t0 else (zb1 - zb0) / (t1 - t0)
        self.kbox.set((M.DALLE_LO[0], M.DALLE_LO[1], -0.01), (M.DALLE_HI[0], M.MUR_Y - 1e-4, top), (0, 0, vz))

    def export_extra(self, s, f):
        return dict(z_box_top=np.float32(self._tb[3]))


class Filet(Horloge, SceneBase):
    name = "filet"
    export_range = (128, 236)

    def __init__(self, scale=0.008, dalle_dir=None, seed=11):
        self.scale = scale
        self.dalle_dir = dalle_dir or os.path.join(SORTIE, "dalle")
        self.seed = seed

    def build(self):
        rng = np.random.default_rng(self.seed)
        Z = np.load(os.path.join(self.dalle_dir, "exits.npz"))
        assert abs(float(Z["scale"]) - self.scale) < 1e-9, "filet doit tourner à la même échelle que dalle"
        # grains tombés par le bec (sous le sol, dans l'emprise de la fente), avant l'image de fin
        ok = ((Z["cause"] == 1) & (np.abs(Z["pos"][:, 0]) < M.BEC_DEMI + 0.004) & (Z["pos"][:, 1] > M.BEC_AVANT - 0.004)
              & (Z["pos"][:, 1] < M.BEC_Y + 0.004) & (Z["t"] >= 0) & (Z["t"] < M.t_de(M.IMAGE_FIN_FILET)))
        ex_pos = Z["pos"][ok].astype(np.float64); ex_vel = Z["vel"][ok].astype(np.float64); ex_t = Z["t"][ok].astype(np.float64)
        self.n_exits_total = int(np.sum(Z["cause"] >= 1))
        assert ok.sum() > 0, "aucun grain n'est passé par le bec"
        order = np.argsort(ex_t, kind="stable")
        ex_pos, ex_vel, ex_t = ex_pos[order], ex_vel[order], ex_t[order]
        sp = spacing_of(D_GRAIN, self.scale)
        dx = 2 * sp
        z_bot = -M.DENIVELE
        cx, cy = 0.0, M.ENTONNOIR_Y                       # le verre est à l'aplomb du col de l'entonnoir
        r_out = VERRE_R_HAUT + VERRE_PAROI
        roi_lo = np.array([cx - r_out - 0.014, cy - r_out - 0.014, z_bot - VERRE_FOND - 0.02])
        roi_hi = np.array([cx + r_out + 0.014, cy + r_out + 0.014, 0.004])
        pad = 6 * dx
        lo, hi = roi_lo - pad, roi_hi + pad
        n = np.ceil((hi - lo) / dx).astype(int) + 1
        wall_eff = max(VERRE_PAROI, 3.0 * dx)       # une paroi de moins de trois mailles fuit : épaissie vers l'extérieur
        cup = CupC(cx, cy, z_bot, VERRE_H, VERRE_R_BAS, VERRE_R_HAUT, wall_eff, bottom=max(VERRE_FOND, 3.0 * dx), mu=0.4)
        paroi = max(M.ENTONNOIR_PAROI, 3.0 * dx)
        entonnoir = EntonnoirC(cx, cy, M.ENTONNOIR_BAS[0], M.ENTONNOIR_BAS[1], M.ENTONNOIR_HAUT[0], M.ENTONNOIR_HAUT[1], paroi, mu=0.35)
        tube = EntonnoirC(cx, cy, M.ENTONNOIR_BAS[0], M.ENTONNOIR_TUBE, M.ENTONNOIR_BAS[0], M.ENTONNOIR_BAS[1], paroi, mu=0.35)
        # les lèvres de la fente, au-dessus de l'entonnoir : mêmes boîtes que dans la simulation de la dalle
        sol = BoxC((-0.5, M.BEC_Y, -M.SOL_EP), (0.5, 0.5, 0.0), mu=0.5)
        avancee_g = BoxC((-0.5, M.SOL_BORD - 0.1, -M.SOL_EP), (-M.BEC_DEMI, M.BEC_Y + 1e-4, 0.0), mu=0.5)
        avancee_d = BoxC((M.BEC_DEMI, M.SOL_BORD - 0.1, -M.SOL_EP), (0.5, M.BEC_Y + 1e-4, 0.0), mu=0.5)
        avant = BoxC((-M.BEC_DEMI - 1e-4, M.SOL_BORD - 0.1, -M.SOL_EP), (M.BEC_DEMI + 1e-4, M.BEC_AVANT, 0.0), mu=0.5)
        Ne = len(ex_t)
        P = dict(x=ex_pos.astype(np.float32), v=ex_vel.astype(np.float32), q=random_quats(Ne, rng),
                 mat=np.zeros(Ne, np.int32), state=np.full(Ne, UNBORN, np.int32),
                 coh0=np.zeros(Ne, np.float32), cohtau=np.ones(Ne, np.float32), t_ev=ex_t.astype(np.float32))
        mats = [sand_material(E=SABLE_E, phi_deg=PHI, rho=RHO_BULK)]
        s = MPM(lo, n, dx, Ne, sp ** 3, mats, statics=[cup, entonnoir, tube, sol, avancee_g, avancee_d, avant], roi_lo=roi_lo, roi_hi=roi_hi, cfl=0.4)
        f_first = M.image_de(float(ex_t[0]))
        self.f_sim0 = int(math.floor(f_first)) - 1
        self.info = dict(N=Ne, spacing=sp, dx=dx, grid=[int(a) for a in n], axe_verre=[cx, cy],
                         image_premier_grain=float(f_first), image_dernier_grain=float(M.image_de(float(ex_t[-1]))),
                         volume_ml=float(Ne * sp ** 3 * 1e6), sorties_totales=self.n_exits_total, f_sim0=self.f_sim0)
        return s, P


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scene", choices=["dalle", "filet"])
    ap.add_argument("--arch", choices=["cpu", "cuda"], default="cpu")
    ap.add_argument("--scale", type=float, default=0.008)
    ap.add_argument("--frames", default=None, help="a:b (images du film, incluses)")
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--out", default=None)
    ap.add_argument("--reprise", type=int, default=100000, help="écrire un point de reprise toutes les N images (et à la dernière)")
    ap.add_argument("--leger", type=int, default=0, help="1 : images allégées (position, orientation, identifiant) et résumé d'activité")
    A = ap.parse_args()
    sc = Dalle(A.scale) if A.scene == "dalle" else Filet(A.scale)
    out = A.out or os.path.join(SORTIE, A.scene)
    # point de reprise seulement à la fin : en écrire un par image coûterait plusieurs secondes par image à l'échelle finale
    runner = Runner(sc, out, arch=A.arch, threads=A.threads, ckpt_every=A.reprise, light=bool(A.leger))
    fa, fb = sc.export_range if A.frames is None else tuple(int(v) for v in A.frames.split(":"))
    t0 = time.time()
    stats = runner.run(fa, fb, fresh=A.fresh)
    sc.scale = A.scale
    info = dict(scene=sc.name, scale=A.scale, arch=A.arch, threads=A.threads, frames=[fa, fb], wall_total=time.time() - t0,
                substeps=stats["substeps"], wall_in_substeps=stats["wall"], vmax_peak=stats["vmax_peak"], info=sc.info,
                counts=runner.solver.counts(), n_initial=runner.n_initial, n_emitted=runner.emit_ptr)
    with open(os.path.join(out, "run.json"), "w") as fh:
        json.dump(info, fh, indent=1, default=float)
    print("GRAINS " + json.dumps({k: v for k, v in info.items() if k != "info"}, default=float), flush=True)
    print("GRAINS info " + json.dumps(sc.info, default=float), flush=True)
