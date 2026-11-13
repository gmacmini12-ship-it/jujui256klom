"""mpm.py -- MLS-MPM (APIC) 3D granular / fluid solver for OFFGRIDZ "INSOUMISE".

Single precision, Taichi.  Same code on CPU and CUDA (`--arch cpu|cuda`).

Contents
  * colliders (SDF): plane, axis-aligned box, capped cylinder (frustum, inside/outside), cup (hollow
    glass), extruded 2D polygon set baked into an SDF grid (letters), kinematic box (moves in time);
  * MPM class: Drucker-Prager sand (Klar et al. 2016, SVD return mapping, optional decaying
    cohesion) and weakly compressible fluid on the same grid (per-particle material id);
  * particle states: PINNED (not simulated, not on the grid), FREE, DEAD, UNBORN (waiting for emission);
  * Runner: adaptive substeps (CFL), per-frame export, checkpoints / resume.

Conventions: metres, Z up, gravity (0,0,-9.81). Film frame f -> physical time
t(f) = (f - f_ref) / fps * time_scale.

Cohesion `coh` is a stress threshold added to the Drucker-Prager cone:
    || dev(tau) || + alpha * tr(tau) - coh <= 0      (tau = Kirchhoff stress, Pa)
i.e. shear strength at zero pressure = coh (Frobenius norm of the deviator).

Determinism: on CPU with 1 thread (default) runs are bit-reproducible (fixed seeds, no ti.random,
no float atomics race).  With --threads > 1 (or CUDA) float atomic ordering makes runs
statistically but not bitwise reproducible.
"""
import json
import math
import os
import time

import numpy as np
import taichi as ti

FREE, PINNED, DEAD, UNBORN = 0, 1, 2, 3
SAND, FLUID = 0, 1
BC_SEP, BC_STICKY = 1, 2
STATE_NAMES = {FREE: "free", PINNED: "pinned", DEAD: "dead", UNBORN: "unborn"}

_INITED = {}


def init_taichi(arch="cpu", threads=1):
    if _INITED:
        return
    kw = dict(default_fp=ti.f32, default_ip=ti.i32, log_level=ti.ERROR)
    if arch == "cuda":
        ti.init(arch=ti.cuda, **kw)
    else:
        ti.init(arch=ti.cpu, cpu_max_num_threads=int(threads), **kw)
    _INITED["arch"] = arch
    _INITED["threads"] = threads


# ----------------------------------------------------------------------------------------------
# SDF helpers.  Convention: d < 0 inside the solid, n = outward normal of the solid (grad d).
# ----------------------------------------------------------------------------------------------
@ti.func
def _sgn(a):
    return 1.0 if a >= 0.0 else -1.0


@ti.func
def box_sdf(p, c, h):
    q = ti.abs(p - c) - h
    qo = ti.max(q, ti.Vector([0.0, 0.0, 0.0]))
    out = qo.norm()
    inn = ti.min(ti.max(q[0], ti.max(q[1], q[2])), 0.0)
    s = p - c
    n = ti.Vector([0.0, 0.0, 1.0])
    if out > 1e-12:
        n = ti.Vector([qo[0] * _sgn(s[0]), qo[1] * _sgn(s[1]), qo[2] * _sgn(s[2])]) / out
    else:
        if q[0] >= q[1] and q[0] >= q[2]:
            n = ti.Vector([_sgn(s[0]), 0.0, 0.0])
        elif q[1] >= q[2]:
            n = ti.Vector([0.0, _sgn(s[1]), 0.0])
        else:
            n = ti.Vector([0.0, 0.0, _sgn(s[2])])
    return out + inn, n


@ti.func
def cyl_sdf(p, cx, cy, z0, z1, r0, r1):
    """Capped (frustum) cylinder, axis +z, radius r0 at z0 and r1 at z1; d<0 inside."""
    s = (r1 - r0) / (z1 - z0)
    k = 1.0 / ti.sqrt(1.0 + s * s)
    rx = p[0] - cx
    ry = p[1] - cy
    rho = ti.sqrt(rx * rx + ry * ry)
    zc = 0.5 * (z0 + z1)
    rz = ti.min(ti.max(p[2], z0), z1)
    rr = r0 + s * (rz - z0)
    dr = (rho - rr) * k
    dz = ti.abs(p[2] - zc) - 0.5 * (z1 - z0)
    qr = ti.max(dr, 0.0)
    qz = ti.max(dz, 0.0)
    out = ti.sqrt(qr * qr + qz * qz)
    d = out + ti.min(ti.max(dr, dz), 0.0)
    rh = ti.Vector([1.0, 0.0])
    if rho > 1e-9:
        rh = ti.Vector([rx / rho, ry / rho])
    n_side = ti.Vector([rh[0] * k, rh[1] * k, -s * k])
    n_cap = ti.Vector([0.0, 0.0, _sgn(p[2] - zc)])
    n = n_cap
    if out > 1e-12:
        n = (qr * n_side + qz * n_cap) / out
    else:
        if dr >= dz:
            n = n_side
    return d, n


@ti.func
def bc_apply(v, vc, n, kind: ti.i32, mu: float):
    vr = v - vc
    if kind == 2:
        vr = ti.Vector([0.0, 0.0, 0.0])
    else:
        vn = vr.dot(n)
        if vn < 0.0:
            vt = vr - vn * n
            vtn = vt.norm()
            sc = 0.0
            if vtn > 1e-12:
                sc = ti.max(0.0, 1.0 + mu * vn / vtn)
            vr = vt * sc
    return vr + vc


# ----------------------------------------------------------------------------------------------
# Static colliders
# ----------------------------------------------------------------------------------------------
@ti.data_oriented
class Collider:
    kind_name = "?"

    def __init__(self, bc="sep", mu=0.5):
        self.bc = BC_STICKY if bc == "sticky" else BC_SEP
        self.mu = float(mu)


@ti.data_oriented
class PlaneC(Collider):
    """Solid half-space {(p - point) . n < 0}, n = unit normal pointing out of the solid."""
    kind_name = "plane"

    def __init__(self, normal=(0, 0, 1), offset=0.0, bc="sep", mu=0.5):
        super().__init__(bc, mu)
        nn = np.asarray(normal, float)
        nn = nn / np.linalg.norm(nn)
        self.n = tuple(float(a) for a in nn)
        self.off = float(offset)       # plane: n . p = off

    @ti.func
    def sdf(self, p):
        n = ti.Vector([self.n[0], self.n[1], self.n[2]])
        return p.dot(n) - self.off, n


@ti.data_oriented
class BoxC(Collider):
    kind_name = "box"

    def __init__(self, lo, hi, bc="sep", mu=0.5):
        super().__init__(bc, mu)
        lo = np.asarray(lo, float)
        hi = np.asarray(hi, float)
        self.c = tuple(float(a) for a in (lo + hi) / 2)
        self.h = tuple(float(a) for a in (hi - lo) / 2)

    @ti.func
    def sdf(self, p):
        return box_sdf(p, ti.Vector([self.c[0], self.c[1], self.c[2]]),
                       ti.Vector([self.h[0], self.h[1], self.h[2]]))


@ti.data_oriented
class CylC(Collider):
    """Capped cylinder / frustum along z.  inside=True: solid inside; False: solid outside."""
    kind_name = "cylinder"

    def __init__(self, cx, cy, z0, z1, r0, r1=None, inside=True, bc="sep", mu=0.5):
        super().__init__(bc, mu)
        self.p = (float(cx), float(cy), float(z0), float(z1), float(r0), float(r0 if r1 is None else r1))
        self.sign = 1.0 if inside else -1.0

    @ti.func
    def sdf(self, p):
        d, n = cyl_sdf(p, self.p[0], self.p[1], self.p[2], self.p[3], self.p[4], self.p[5])
        return self.sign * d, self.sign * n


@ti.data_oriented
class CupC(Collider):
    """Hollow open-top glass: inner radius r_bot at inner bottom z_in, r_top at z_in+h_in; wall thickness
    `wall`, bottom thickness `bottom`."""
    kind_name = "cup"

    def __init__(self, cx, cy, z_in, h_in, r_bot, r_top, wall, bottom=None, bc="sep", mu=0.4):
        super().__init__(bc, mu)
        bottom = wall if bottom is None else bottom
        s = (r_top - r_bot) / h_in
        self.cx, self.cy = float(cx), float(cy)
        self.z_in, self.h_in = float(z_in), float(h_in)
        self.r_bot, self.r_top, self.wall, self.bottom = float(r_bot), float(r_top), float(wall), float(bottom)
        # outer solid frustum
        zo0 = z_in - bottom
        ro0 = r_bot + wall - s * bottom * 0.0
        ro0 = r_bot - s * bottom + wall
        self.outer = (self.cx, self.cy, zo0, z_in + h_in, ro0, r_top + wall)
        # inner void: same slope, extended 0.5 m above the rim
        ext = 0.5
        self.inner = (self.cx, self.cy, z_in, z_in + h_in + ext, r_bot, r_top + s * ext)

    @ti.func
    def sdf(self, p):
        d1, n1 = cyl_sdf(p, self.outer[0], self.outer[1], self.outer[2], self.outer[3], self.outer[4], self.outer[5])
        d2, n2 = cyl_sdf(p, self.inner[0], self.inner[1], self.inner[2], self.inner[3], self.inner[4], self.inner[5])
        d2 = -d2
        n2 = -n2
        d = d1
        n = n1
        if d2 > d1:
            d = d2
            n = n2
        return d, n


@ti.data_oriented
class ExtrudeC(Collider):
    """Closed 2D polygon set in the (x, z) plane (u = x, w = z), extruded along y in [y0, y1].
    The 2D signed distance is baked into a grid (step `h`) and sampled bilinearly."""
    kind_name = "extrusion"

    def __init__(self, polys, y0, y1, step=1e-4, pad=3e-3, bc="sep", mu=0.5, holes_even_odd=True):
        super().__init__(bc, mu)
        import cv2
        from scipy.ndimage import distance_transform_edt
        allp = np.concatenate([np.asarray(p, float) for p in polys], 0)
        u0, w0 = allp.min(0) - pad
        u1, w1 = allp.max(0) + pad
        ss = 4                                   # supersampling for the raster
        nu = int(math.ceil((u1 - u0) / step)) + 1
        nw = int(math.ceil((w1 - w0) / step)) + 1
        H, W = nw * ss, nu * ss
        img = np.zeros((H, W), np.uint8)
        # even-odd fill through XOR of each polygon (holes = nested contours)
        for p in polys:
            m = np.zeros((H, W), np.uint8)
            q = np.round(((np.asarray(p) - [u0, w0]) / step + 0.5) * ss - 0.5).astype(np.int32)  # pixel centres
            cv2.fillPoly(m, [q.reshape(-1, 1, 2)], 1)
            img ^= m
        ins = img.astype(bool)
        # signed distance on the supersampled grid (pixel size step/ss), then decimate to the bake grid
        d_out = distance_transform_edt(~ins)
        d_in = distance_transform_edt(ins)
        sd = np.where(ins, -(d_in - 0.5), d_out - 0.5) * (step / ss)
        sd = sd[ss // 2::ss, ss // 2::ss][:nw, :nu]
        sd = np.ascontiguousarray(sd.astype(np.float32))
        self.u0, self.w0, self.h = float(u0), float(w0), float(step)
        self.nu, self.nw = sd.shape[1], sd.shape[0]
        self.y0, self.y1 = float(y0), float(y1)
        self.field = ti.field(float, (self.nu, self.nw))
        self.field.from_numpy(sd.T.copy())
        self.sd2d = sd

    @ti.func
    def _s2(self, u, w):
        fu = (u - self.u0) / self.h
        fw = (w - self.w0) / self.h
        cu = ti.min(ti.max(fu, 0.0), float(self.nu - 1) - 1e-3)
        cw = ti.min(ti.max(fw, 0.0), float(self.nw - 1) - 1e-3)
        iu = int(cu)
        iw = int(cw)
        a = cu - iu
        b = cw - iw
        v = (self.field[iu, iw] * (1 - a) * (1 - b) + self.field[iu + 1, iw] * a * (1 - b)
             + self.field[iu, iw + 1] * (1 - a) * b + self.field[iu + 1, iw + 1] * a * b)
        # outside the baked grid: add distance to the grid rectangle
        ou = fu - cu
        ow = fw - cw
        return v + ti.sqrt(ou * ou + ow * ow) * self.h

    @ti.func
    def sdf(self, p):
        d2 = self._s2(p[0], p[2])
        e = self.h
        gx = (self._s2(p[0] + e, p[2]) - self._s2(p[0] - e, p[2])) / (2 * e)
        gz = (self._s2(p[0], p[2] + e) - self._s2(p[0], p[2] - e)) / (2 * e)
        g = ti.Vector([gx, gz])
        gn = g.norm()
        if gn > 1e-9:
            g = g / gn
        yc = 0.5 * (self.y0 + self.y1)
        dy = ti.abs(p[1] - yc) - 0.5 * (self.y1 - self.y0)
        sy = _sgn(p[1] - yc)
        d = 0.0
        n = ti.Vector([0.0, 0.0, 1.0])
        if d2 < 0.0 and dy < 0.0:
            if d2 > dy:
                d = d2
                n = ti.Vector([g[0], 0.0, g[1]])
            else:
                d = dy
                n = ti.Vector([0.0, sy, 0.0])
        else:
            a = ti.max(d2, 0.0)
            b = ti.max(dy, 0.0)
            d = ti.sqrt(a * a + b * b)
            n = ti.Vector([g[0] * a, sy * b, g[1] * a]) / ti.max(d, 1e-12)
        return d, n


@ti.data_oriented
class KinBox(Collider):
    """Kinematic box: lo/hi/vel are fields updated from the host each substep."""
    kind_name = "kinbox"

    def __init__(self, bc="sticky", mu=0.5):
        super().__init__(bc, mu)
        self.lo = ti.Vector.field(3, float, ())
        self.hi = ti.Vector.field(3, float, ())
        self.vel = ti.Vector.field(3, float, ())
        self.lo[None] = [1e9, 1e9, 1e9]
        self.hi[None] = [1e9, 1e9, 1e9]
        self.vel[None] = [0.0, 0.0, 0.0]

    def set(self, lo, hi, vel=(0, 0, 0)):
        self.lo[None] = [float(a) for a in lo]
        self.hi[None] = [float(a) for a in hi]
        self.vel[None] = [float(a) for a in vel]

    @ti.func
    def sdf(self, p):
        c = 0.5 * (self.lo[None] + self.hi[None])
        h = 0.5 * (self.hi[None] - self.lo[None])
        return box_sdf(p, c, h)


# ----------------------------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------------------------
def sand_material(E=3.0e5, nu=0.3, phi_deg=30.0, rho=1500.0):
    mu = E / (2 * (1 + nu))
    lam = E * nu / ((1 + nu) * (1 - 2 * nu))
    s = math.sin(math.radians(phi_deg))
    alpha = math.sqrt(2.0 / 3.0) * 2 * s / (3 - s)
    K = lam + 2 * mu / 3
    c = math.sqrt((K + 4 * mu / 3) / rho)
    return dict(type=SAND, mu=mu, lam=lam, K=K, alpha=alpha, rho=rho, gamma=0.0, c=c, phi=phi_deg, E=E, nu=nu)


def fluid_material(rho=1000.0, c0=30.0, gamma=7.0):
    K = rho * c0 * c0 / gamma
    return dict(type=FLUID, mu=0.0, lam=0.0, K=K, alpha=0.0, rho=rho, gamma=gamma, c=c0, phi=0.0, E=0.0, nu=0.0)


# ----------------------------------------------------------------------------------------------
# Solver
# ----------------------------------------------------------------------------------------------
@ti.data_oriented
class MPM:
    def __init__(self, lo, n, dx, n_part, pvol, mats, statics=(), kins=(), roi_lo=None, roi_hi=None,
                 gravity=(0.0, 0.0, -9.81), cfl=0.4, solid_mu=0.3, bc_margin=3, coh_hold=0.0):
        self.lo = tuple(float(a) for a in lo)
        self.n = tuple(int(a) for a in n)
        self.dx = float(dx)
        self.inv_dx = 1.0 / float(dx)
        self.N = int(n_part)
        self.pvol = float(pvol)
        self.mats = list(mats)
        self.g = tuple(float(a) for a in gravity)
        self.cfl = float(cfl)
        self.solid_mu = float(solid_mu)
        self.bcm = int(bc_margin)
        self.coh_hold = float(coh_hold)
        hi = [self.lo[i] + self.n[i] * self.dx for i in range(3)]
        self.roi_lo = tuple(float(a) for a in (roi_lo if roi_lo is not None else [self.lo[i] + (self.bcm + 1) * self.dx for i in range(3)]))
        self.roi_hi = tuple(float(a) for a in (roi_hi if roi_hi is not None else [hi[i] - (self.bcm + 1) * self.dx for i in range(3)]))
        self.statics = list(statics)
        self.kins = list(kins)
        self.c_max = max(m["c"] for m in self.mats)
        self.t = 0.0
        N = self.N
        self.x = ti.Vector.field(3, float, N)
        self.v = ti.Vector.field(3, float, N)
        self.C = ti.Matrix.field(3, 3, float, N)
        self.F = ti.Matrix.field(3, 3, float, N)
        self.q = ti.Vector.field(4, float, N)
        self.Jf = ti.field(float, N)
        self.mat = ti.field(ti.i32, N)
        self.state = ti.field(ti.i32, N)
        self.coh0 = ti.field(float, N)
        self.cohtau = ti.field(float, N)
        self.t_ev = ti.field(float, N)
        self.tdead = ti.field(float, N)
        self.dcause = ti.field(ti.i32, N)
        self.gv = ti.Vector.field(3, float, self.n)
        self.gm = ti.field(float, self.n)
        self.sdf = ti.field(float, self.n)
        self.snorm = ti.Vector.field(3, float, self.n)
        self.sbc = ti.field(ti.i32, self.n)
        self.smu = ti.field(float, self.n)
        self.solid = ti.field(ti.i32, self.n)
        self.vmax = ti.field(float, ())
        nm = max(len(self.mats), 1)
        self.m_type = ti.field(ti.i32, nm)
        self.m_mu = ti.field(float, nm)
        self.m_lam = ti.field(float, nm)
        self.m_K = ti.field(float, nm)
        self.m_alpha = ti.field(float, nm)
        self.m_rho = ti.field(float, nm)
        self.m_gamma = ti.field(float, nm)
        for i, m in enumerate(self.mats):
            self.m_type[i] = m["type"]
            self.m_mu[i] = m["mu"]
            self.m_lam[i] = m["lam"]
            self.m_K[i] = m["K"]
            self.m_alpha[i] = max(m["alpha"], 1e-4)
            self.m_rho[i] = m["rho"]
            self.m_gamma[i] = m["gamma"]
        self.cnt = ti.field(ti.i32, 4)
        self.bake_static()

    # ------------------------------------------------------------------ host <-> fields
    def load(self, P):
        """P: dict of numpy arrays (x, v, mat, state, coh0, cohtau, t_ev, q) length N."""
        N = self.N
        self.x.from_numpy(P["x"].astype(np.float32))
        self.v.from_numpy(P["v"].astype(np.float32))
        self.q.from_numpy(P["q"].astype(np.float32))
        self.mat.from_numpy(P["mat"].astype(np.int32))
        self.state.from_numpy(P["state"].astype(np.int32))
        self.coh0.from_numpy(P["coh0"].astype(np.float32))
        self.cohtau.from_numpy(P["cohtau"].astype(np.float32))
        self.t_ev.from_numpy(P["t_ev"].astype(np.float32))
        self.F.from_numpy(np.tile(np.eye(3, dtype=np.float32), (N, 1, 1)))
        self.C.from_numpy(np.zeros((N, 3, 3), np.float32))
        self.Jf.from_numpy(np.ones(N, np.float32))
        self.tdead.from_numpy(-np.ones(N, np.float32))
        self.dcause.from_numpy(np.zeros(N, np.int32))

    FIELDS = ("x", "v", "C", "F", "q", "Jf", "state", "tdead", "dcause")

    def get_state(self):
        return {k: getattr(self, k).to_numpy() for k in self.FIELDS}

    def set_state(self, S):
        for k in self.FIELDS:
            getattr(self, k).from_numpy(S[k])

    # ------------------------------------------------------------------ kernels
    @ti.kernel
    def bake_static(self):
        for I in ti.grouped(self.sdf):
            pos = ti.Vector([self.lo[0] + I[0] * self.dx, self.lo[1] + I[1] * self.dx, self.lo[2] + I[2] * self.dx])
            phi = 1e9
            nn = ti.Vector([0.0, 0.0, 1.0])
            bc = 0
            mu = 0.0
            for c in ti.static(self.statics):
                d, n = c.sdf(pos)
                if d < phi:
                    phi = d
                    nn = n
                    bc = c.bc
                    mu = c.mu
            self.sdf[I] = phi
            self.snorm[I] = nn
            self.sbc[I] = bc
            self.smu[I] = mu

    @ti.kernel
    def clear(self):
        self.vmax[None] = 0.0
        for I in ti.grouped(self.gm):
            self.gv[I] = ti.Vector([0.0, 0.0, 0.0])
            self.gm[I] = 0.0

    @ti.kernel
    def p2g(self, dt: float, t: float):
        for p in self.x:
            if self.state[p] == FREE:
                mt = self.mat[p]
                Xp = ti.Vector([(self.x[p][0] - self.lo[0]) * self.inv_dx, (self.x[p][1] - self.lo[1]) * self.inv_dx,
                                (self.x[p][2] - self.lo[2]) * self.inv_dx])
                base = int(Xp - 0.5)
                fx = Xp - base
                w = [0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2]
                m = self.m_rho[mt] * self.pvol
                stress = ti.Matrix.zero(float, 3, 3)
                if self.m_type[mt] == 0:
                    # ---------------- Drucker-Prager sand
                    F = (ti.Matrix.identity(float, 3) + dt * self.C[p]) @ self.F[p]
                    U, sig, V = ti.svd(F)
                    e0 = ti.log(ti.min(ti.max(sig[0, 0], 0.05), 5.0))
                    e1 = ti.log(ti.min(ti.max(sig[1, 1], 0.05), 5.0))
                    e2 = ti.log(ti.min(ti.max(sig[2, 2], 0.05), 5.0))
                    mu_ = self.m_mu[mt]
                    lam_ = self.m_lam[mt]
                    K_ = self.m_K[mt]
                    al = self.m_alpha[mt]
                    c = 0.0
                    if self.coh0[p] > 0.0:
                        age = t - self.t_ev[p] - self.coh_hold
                        c = self.coh0[p]
                        if age > 0.0:
                            c = self.coh0[p] * ti.max(0.0, 1.0 - age / self.cohtau[p])
                    tr = e0 + e1 + e2
                    d0 = e0 - tr / 3.0
                    d1 = e1 - tr / 3.0
                    d2 = e2 - tr / 3.0
                    dn = ti.sqrt(d0 * d0 + d1 * d1 + d2 * d2)
                    apex = c / (3.0 * K_ * al)
                    n0 = e0
                    n1 = e1
                    n2 = e2
                    if tr >= apex:
                        n0 = apex / 3.0
                        n1 = apex / 3.0
                        n2 = apex / 3.0
                    else:
                        dg = dn + (3.0 * K_ * al * tr - c) / (2.0 * mu_)
                        if dg > 0.0 and dn > 1e-9:
                            f = ti.max(0.0, 1.0 - dg / dn)
                            n0 = tr / 3.0 + d0 * f
                            n1 = tr / 3.0 + d1 * f
                            n2 = tr / 3.0 + d2 * f
                    ntr = n0 + n1 + n2
                    S = ti.Matrix([[ti.exp(n0), 0.0, 0.0], [0.0, ti.exp(n1), 0.0], [0.0, 0.0, ti.exp(n2)]])
                    self.F[p] = U @ S @ V.transpose()
                    T = ti.Matrix([[2 * mu_ * n0 + lam_ * ntr, 0.0, 0.0], [0.0, 2 * mu_ * n1 + lam_ * ntr, 0.0],
                                   [0.0, 0.0, 2 * mu_ * n2 + lam_ * ntr]])
                    stress = U @ T @ U.transpose()
                else:
                    # ---------------- weakly compressible fluid (Tait)
                    J = self.Jf[p]
                    pr = self.m_K[mt] * (ti.pow(J, -self.m_gamma[mt]) - 1.0)
                    stress = -J * pr * ti.Matrix.identity(float, 3)
                affine = (-dt * self.pvol * 4.0 * self.inv_dx * self.inv_dx) * stress + m * self.C[p]
                for o in ti.static(ti.ndrange(3, 3, 3)):
                    off = ti.Vector([o[0], o[1], o[2]])
                    wt = w[o[0]][0] * w[o[1]][1] * w[o[2]][2]
                    dpos = (off - fx) * self.dx
                    node = base + off
                    self.gv[node] += wt * (m * self.v[p] + affine @ dpos)
                    self.gm[node] += wt * m

    @ti.kernel
    def grid_op(self, dt: float):
        for I in ti.grouped(self.gm):
            if self.gm[I] > 0.0:
                gvec = ti.Vector([self.g[0], self.g[1], self.g[2]])
                v = self.gv[I] / self.gm[I] + dt * gvec
                pos = ti.Vector([self.lo[0] + I[0] * self.dx, self.lo[1] + I[1] * self.dx, self.lo[2] + I[2] * self.dx])
                zero = ti.Vector([0.0, 0.0, 0.0])
                if self.sdf[I] < 0.0:
                    v = bc_apply(v, zero, self.snorm[I], self.sbc[I], self.smu[I])
                for k in ti.static(self.kins):
                    d, n = k.sdf(pos)
                    if d < 0.0:
                        v = bc_apply(v, k.vel[None], n, k.bc, k.mu)
                if True:
                    if self.solid[I] > 0:
                        gx = 0.0
                        gy = 0.0
                        gz = 0.0
                        ix = I[0]
                        iy = I[1]
                        iz = I[2]
                        gx = float(self.solid[ti.min(ix + 1, self.n[0] - 1), iy, iz] - self.solid[ti.max(ix - 1, 0), iy, iz])
                        gy = float(self.solid[ix, ti.min(iy + 1, self.n[1] - 1), iz] - self.solid[ix, ti.max(iy - 1, 0), iz])
                        gz = float(self.solid[ix, iy, ti.min(iz + 1, self.n[2] - 1)] - self.solid[ix, iy, ti.max(iz - 1, 0)])
                        gg = ti.Vector([-gx, -gy, -gz])
                        gn = gg.norm()
                        if gn < 1e-6:
                            v = zero
                        else:
                            v = bc_apply(v, zero, gg / gn, 1, self.solid_mu)
                for d in ti.static(range(3)):
                    if I[d] < self.bcm and v[d] < 0:
                        v[d] = 0.0
                    if I[d] > self.n[d] - self.bcm - 1 and v[d] > 0:
                        v[d] = 0.0
                self.gv[I] = v

    @ti.kernel
    def g2p(self, dt: float, tnext: float):
        for p in self.x:
            if self.state[p] == FREE:
                Xp = ti.Vector([(self.x[p][0] - self.lo[0]) * self.inv_dx, (self.x[p][1] - self.lo[1]) * self.inv_dx,
                                (self.x[p][2] - self.lo[2]) * self.inv_dx])
                base = int(Xp - 0.5)
                fx = Xp - base
                w = [0.5 * (1.5 - fx) ** 2, 0.75 - (fx - 1) ** 2, 0.5 * (fx - 0.5) ** 2]
                nv = ti.Vector([0.0, 0.0, 0.0])
                nC = ti.Matrix.zero(float, 3, 3)
                for o in ti.static(ti.ndrange(3, 3, 3)):
                    off = ti.Vector([o[0], o[1], o[2]])
                    wt = w[o[0]][0] * w[o[1]][1] * w[o[2]][2]
                    dpos = (off - fx) * self.dx
                    gg = self.gv[base + off]
                    nv += wt * gg
                    nC += 4.0 * self.inv_dx * self.inv_dx * wt * gg.outer_product(dpos)
                self.v[p] = nv
                self.C[p] = nC
                xn = self.x[p] + dt * nv
                self.x[p] = xn
                if self.m_type[self.mat[p]] == 1:
                    self.Jf[p] = ti.min(ti.max(self.Jf[p] * (1.0 + dt * nC.trace()), 0.5), 1.5)
                # orientation: integrate angular velocity = 1/2 curl v
                om = 0.5 * ti.Vector([nC[2, 1] - nC[1, 2], nC[0, 2] - nC[2, 0], nC[1, 0] - nC[0, 1]])
                wn = om.norm()
                ang = wn * dt
                if ang > 1e-7:
                    ax = om / wn
                    sh = ti.sin(0.5 * ang)
                    ch = ti.cos(0.5 * ang)
                    q = self.q[p]
                    # dq (ch, sh*ax) * q   (w, x, y, z)
                    aw = ch
                    ax_ = sh * ax[0]
                    ay_ = sh * ax[1]
                    az_ = sh * ax[2]
                    nw_ = aw * q[0] - ax_ * q[1] - ay_ * q[2] - az_ * q[3]
                    nx_ = aw * q[1] + ax_ * q[0] + ay_ * q[3] - az_ * q[2]
                    ny_ = aw * q[2] - ax_ * q[3] + ay_ * q[0] + az_ * q[1]
                    nz_ = aw * q[3] + ax_ * q[2] - ay_ * q[1] + az_ * q[0]
                    qq = ti.Vector([nw_, nx_, ny_, nz_])
                    self.q[p] = qq / qq.norm()
                sp = nv.norm()
                ti.atomic_max(self.vmax[None], sp)
                bad = (sp != sp) or (xn[0] != xn[0]) or (xn[1] != xn[1]) or (xn[2] != xn[2])
                if bad:
                    self.state[p] = DEAD
                    self.dcause[p] = 9
                    self.tdead[p] = tnext
                    self.x[p] = ti.Vector([self.roi_lo[0], self.roi_lo[1], self.roi_lo[2]])
                    self.v[p] = ti.Vector([0.0, 0.0, 0.0])
                else:
                    cause = 0
                    if xn[2] < self.roi_lo[2]:
                        cause = 1
                    elif xn[0] < self.roi_lo[0] or xn[0] > self.roi_hi[0] or xn[1] < self.roi_lo[1] or \
                            xn[1] > self.roi_hi[1] or xn[2] > self.roi_hi[2]:
                        cause = 2
                    if cause > 0:
                        self.state[p] = DEAD
                        self.dcause[p] = cause
                        self.tdead[p] = tnext

    @ti.kernel
    def release(self, t: float):
        for p in self.x:
            if self.state[p] == PINNED and self.t_ev[p] <= t:
                self.state[p] = FREE
                self.v[p] = ti.Vector([0.0, 0.0, 0.0])
                self.C[p] = ti.Matrix.zero(float, 3, 3)

    @ti.kernel
    def activate(self, i0: int, i1: int, t: float):
        """Emission: UNBORN slots i0..i1-1 are born with state FREE; positions advanced ballistically
        from their birth time t_ev to t (x0, v0 given at t_ev)."""
        for p in range(i0, i1):
            if self.state[p] == UNBORN:
                s = ti.max(t - self.t_ev[p], 0.0)
                gvec = ti.Vector([self.g[0], self.g[1], self.g[2]])
                self.x[p] = self.x[p] + self.v[p] * s + 0.5 * gvec * s * s
                self.v[p] = self.v[p] + gvec * s
                self.state[p] = FREE

    @ti.kernel
    def clear_solid(self):
        for I in ti.grouped(self.solid):
            self.solid[I] = 0

    @ti.kernel
    def mark_solid(self, zmin: float):
        for p in self.x:
            if self.state[p] == PINNED and self.x[p][2] > zmin:
                I = ti.Vector([int((self.x[p][0] - self.lo[0]) * self.inv_dx + 0.5),
                               int((self.x[p][1] - self.lo[1]) * self.inv_dx + 0.5),
                               int((self.x[p][2] - self.lo[2]) * self.inv_dx + 0.5)])
                if I[0] >= 0 and I[1] >= 0 and I[2] >= 0 and I[0] < self.n[0] and I[1] < self.n[1] and I[2] < self.n[2]:
                    self.solid[I] = 1

    def build_solid(self, zmin):
        self.clear_solid()
        self.mark_solid(float(zmin))

    @ti.kernel
    def count_states(self):
        for i in range(4):
            self.cnt[i] = 0
        for p in self.x:
            ti.atomic_add(self.cnt[self.state[p]], 1)

    def counts(self):
        self.count_states()
        c = self.cnt.to_numpy()
        return dict(free=int(c[FREE]), pinned=int(c[PINNED]), dead=int(c[DEAD]), unborn=int(c[UNBORN]))

    def substep(self, dt):
        self.clear()
        self.p2g(dt, self.t)
        self.grid_op(dt)
        self.g2p(dt, self.t + dt)
        self.t += dt
        return float(self.vmax[None])

    def cfl_dt(self, vmax):
        return self.cfl * self.dx / (self.c_max + vmax)


# ----------------------------------------------------------------------------------------------
# Runner (frames, export, checkpoint)
# ----------------------------------------------------------------------------------------------
class Runner:
    def __init__(self, scene, outdir, arch="cpu", threads=1, log=print, export_dead=False, ckpt_every=1,
                 max_substeps_per_frame=10_000_000, light=False):
        self.scene = scene
        self.outdir = outdir
        os.makedirs(outdir, exist_ok=True)
        self.log = log
        self.export_dead = export_dead
        self.ckpt_every = ckpt_every
        self.light = light                    # lean frames (what the renderer reads) + per-frame activity summary
        self.activity = {}
        init_taichi(arch, threads)
        t0 = time.time()
        self.solver, self.P = scene.build()
        self.setup_time = time.time() - t0
        self.sim = self.solver
        self.stats = dict(substeps=0, wall=0.0, vmax_peak=0.0, frames=[])
        # emission schedule (sorted by t_ev over UNBORN slots, contiguous at the end of the array)
        st = self.P["state"]
        ub = np.nonzero(st == UNBORN)[0]
        self.emit_idx0 = int(ub[0]) if len(ub) else self.solver.N
        self.emit_t = self.P["t_ev"][ub] if len(ub) else np.zeros(0)
        if len(ub):
            assert ub[-1] - ub[0] + 1 == len(ub), "UNBORN slots must be contiguous"
            assert np.all(np.diff(self.emit_t) >= 0), "emission times must be sorted"
        self.emit_ptr = 0                     # number of UNBORN slots already activated
        self.n_initial = int(np.sum((st == FREE) | (st == PINNED)))
        self.n_total_emit = len(ub)
        self.pinned_event_t = np.sort(self.P["t_ev"][st == PINNED]) if np.any(st == PINNED) else np.zeros(0)

    # ---------------------------------------------------------------- export
    def export_frame(self, f, extra=None):
        s = self.solver
        S = s.get_state()
        keep = (S["state"] == FREE) | (S["state"] == PINNED)
        if self.export_dead:
            keep |= S["state"] == DEAD
        idx = np.nonzero(keep)[0]
        d = dict(
            frame=np.int32(f), t=np.float64(s.t),
            pos=S["x"][idx].astype(np.float32), vel=S["v"][idx].astype(np.float32),
            quat=S["q"][idx].astype(np.float32), id=idx.astype(np.uint32),
            state=S["state"][idx].astype(np.uint8), mat=self.P["mat"][idx].astype(np.uint8),
            n_free=np.int64(np.sum(S["state"] == FREE)), n_pinned=np.int64(np.sum(S["state"] == PINNED)),
            n_dead=np.int64(np.sum(S["state"] == DEAD)), n_emitted=np.int64(self.emit_ptr),
            n_initial=np.int64(self.n_initial),
        )
        if extra:
            d.update(extra)
        if self.light:
            # at final scale a full frame weighs tens of megabytes: keep what the renderer reads (pos, quat, id)
            # and summarise the velocities, which the soundtrack reads (moving grains, mean speed, kinetic sum)
            v = np.linalg.norm(d.pop("vel"), axis=1)
            mov = v > 0.02
            self.activity[int(f)] = [int(mov.sum()), float(v[mov].mean()) if mov.any() else 0.0, float((v[mov] ** 2).sum())]
            with open(os.path.join(self.outdir, "activite.json"), "w") as fh:
                json.dump(dict(seuil=0.02, colonnes=["n_mobiles", "vitesse_moyenne", "somme_v2"], images=self.activity), fh)
            d["quat"] = d["quat"].astype(np.float16)
            del d["state"], d["mat"]
        tmp = os.path.join(self.outdir, f"f{f:04d}.tmp.npz")
        np.savez(tmp, **d)
        os.replace(tmp, os.path.join(self.outdir, f"f{f:04d}.npz"))
        return S

    def exits_arrays(self, S):
        dead = np.nonzero(S["state"] == DEAD)[0]
        return dict(id=dead.astype(np.uint32), t=S["tdead"][dead], cause=S["dcause"][dead].astype(np.int8),
                    pos=S["x"][dead], vel=S["v"][dead])

    # ---------------------------------------------------------------- checkpoint
    def ckpt_path(self):
        return os.path.join(self.outdir, "ckpt.npz")

    def save_ckpt(self, f, S):
        meta = dict(frame=f, t=self.solver.t, emit_ptr=self.emit_ptr, stats=self.stats,
                    scene_state=self.scene.get_state())
        tmp = os.path.join(self.outdir, "ckpt.tmp.npz")
        np.savez(tmp, meta=np.array(json.dumps(meta)), **S)
        os.replace(tmp, self.ckpt_path())

    def load_ckpt(self, fb):
        p = self.ckpt_path()
        if not os.path.exists(p):
            return None
        Z = np.load(p, allow_pickle=False)
        meta = json.loads(str(Z["meta"]))
        if meta["frame"] > fb:
            return None
        S = {k: Z[k] for k in MPM.FIELDS}
        self.solver.set_state(S)
        self.solver.t = float(meta["t"])
        self.emit_ptr = int(meta["emit_ptr"])
        self.stats = meta["stats"]
        self.scene.set_state(meta["scene_state"])
        return meta["frame"]

    # ---------------------------------------------------------------- main loop
    def advance_to(self, t_end, f):
        s = self.solver
        sc = self.scene
        n_sub = 0
        t_wall = time.time()
        vmax = self.last_vmax
        while t_end - s.t > 1e-12:
            # emission due now
            if self.emit_ptr < self.n_total_emit:
                k = int(np.searchsorted(self.emit_t, s.t, side="right"))
                if k > self.emit_ptr:
                    s.activate(self.emit_idx0 + self.emit_ptr, self.emit_idx0 + k, s.t)
                    self.emit_ptr = k
            sc.update_kinematics(s, s.t)
            dtc = s.cfl_dt(vmax + 9.81 * 0.0)
            rem = t_end - s.t
            if rem <= dtc:
                dt = rem
            elif rem < 2 * dtc:
                dt = 0.5 * rem
            else:
                dt = dtc
            # do not step past the next emission time (so newborn start at their t_ev within one substep)
            vmax = s.substep(dt)
            if not (vmax == vmax) or vmax > 200.0:
                raise RuntimeError(f"runaway/NaN velocity vmax={vmax} at t={s.t} frame {f}")
            n_sub += 1
            self.stats["vmax_peak"] = max(self.stats["vmax_peak"], vmax)
        self.last_vmax = vmax
        return n_sub, time.time() - t_wall

    def run(self, fa, fb, fresh=False):
        sc = self.scene
        s = self.solver
        self.last_vmax = 0.0
        f_start = sc.f_sim0
        done = None
        if not fresh:
            done = self.load_ckpt(fb)
        if done is None:
            s.load(self.P)
            s.t = sc.t_of(f_start)
            self.stats = dict(substeps=0, wall=0.0, vmax_peak=0.0, frames=[])
            self.emit_ptr = 0
            sc.reset_state()
            cur = f_start - 1
            self.log(f"[{sc.name}] start from scratch: N={s.N} initial={self.n_initial} emit={self.n_total_emit} "
                     f"grid={s.n} dx={s.dx*1e3:.3f}mm")
        else:
            cur = done
            self.log(f"[{sc.name}] resume from checkpoint frame {done}")
            self.last_vmax = self.stats.get("last_vmax", 0.0)
        for f in range(cur + 1, fb + 1):
            t_end = sc.t_of(f)
            n_sub = 0
            wall = 0.0
            if f > f_start or s.t < t_end - 1e-12:
                t_start = s.t
                s.release(t_start)
                sc.begin_frame(s, f, t_start, t_end)
                # fast-forward when nothing is simulated
                cc = s.counts()
                nothing = cc["free"] == 0 and (self.emit_ptr >= self.n_total_emit or self.emit_t[self.emit_ptr] > t_end)
                nxt = self.pinned_event_t
                nothing = nothing and not (len(nxt) and np.any((nxt > t_start - 1e-12) & (nxt <= t_end)))
                if nothing:
                    s.t = t_end
                else:
                    n_sub, wall = self.advance_to(t_end, f)
            self.stats["substeps"] += n_sub
            self.stats["wall"] += wall
            self.stats["last_vmax"] = self.last_vmax
            self.stats["frames"].append([f, n_sub, wall])
            S = None
            if f >= fa:
                S = self.export_frame(f, sc.export_extra(s, f))
            if (f % self.ckpt_every == 0) or f == fb:
                S = S if S is not None else s.get_state()
                if S is None:
                    S = s.get_state()
                self.save_ckpt(f, S)
                if sc.records_exits:
                    np.savez(os.path.join(self.outdir, "exits.npz"), **self.exits_arrays(S),
                             f_ref=sc.f_ref, time_scale=sc.ts, scale=sc.scale, fps=30)
            cc = s.counts()
            self.log(f"[{sc.name}] frame {f}  t={s.t:.4f}s  substeps={n_sub}  wall={wall:.1f}s  vmax={self.last_vmax:.2f}  "
                     f"free={cc['free']} pinned={cc['pinned']} dead={cc['dead']}")
        return self.stats


class SceneBase:
    """Interface between a scene and the Runner."""
    name = "scene"
    f_ref = 0            # film frame at physical time 0
    ts = 0.35            # real seconds per film second
    fps = 30
    f_sim0 = 0           # first simulated frame
    export_range = (0, 0)
    records_exits = False
    scale = 1.0

    def t_of(self, f):
        return (f - self.f_ref) / self.fps * self.ts

    def build(self):
        raise NotImplementedError

    def reset_state(self):
        pass

    def get_state(self):
        return {}

    def set_state(self, d):
        pass

    def begin_frame(self, s, f, t0, t1):
        pass

    def update_kinematics(self, s, t):
        pass

    def export_extra(self, s, f):
        return {}


def random_quats(n, rng):
    q = rng.normal(size=(n, 4)).astype(np.float32)
    return q / np.linalg.norm(q, axis=1, keepdims=True)


def lattice(lo, hi, spacing, rng, jitter=0.1):
    """Cell-centred cubic lattice filling the box [lo,hi] with random jitter (fraction of spacing)."""
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.maximum(np.round((hi - lo) / spacing).astype(int), 1)
    ax = [lo[i] + (np.arange(n[i]) + 0.5) * (hi[i] - lo[i]) / n[i] for i in range(3)]
    X = np.stack(np.meshgrid(*ax, indexing="ij"), -1).reshape(-1, 3)
    X = X + (rng.random(X.shape) - 0.5) * jitter * spacing
    return X.astype(np.float32)
