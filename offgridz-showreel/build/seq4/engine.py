"""Moteur de points (Taichi, CPU) de la séquence 4 : simulation (champ sans divergence + ressorts amortis vers
les cibles) et rendu (projection perspective, profondeur de champ par disques, flou de bougé par
sous-échantillonnage temporel, brume) -> radiance linéaire flottante.
"""
import math
import numpy as np
import taichi as ti
import cv2

from common import *

ti.init(arch=ti.cpu, cpu_max_num_threads=4, default_fp=ti.f32, default_ip=ti.i32, offline_cache=False, log_level=ti.WARN)

J_WAVES = 16
DT = 1.0 / 120.0            # pas de simulation (s) : 4 pas par image
FPS = 30.0
KF = 7.5                    # relaxation de la vitesse vers le champ (1/s)
KS_W, KS_R, KS_S = 250.0, 420.0, 520.0
BIRTH0 = 360.0
LC = 7.5                    # traînée du lancement (1/s)
FLOW_RMS = 22.0
NLEV = 8
VPX, VPY, VPZ = float(VP[0]), float(VP[1]), float(VP[2])
ZNEAR = 60.0
GX0, GX1, GZ0, GZ1 = -3200.0, 3200.0, -4600.0, 1400.0
NGX, NGZ = 64, 60
K_LOGO = LOGO / LOGO_PX     # unités monde par pixel du calque

# populations de disques d'orange (fractions des points orange) : géants, grands, moyens, reste = brume
POP_G, POP_L, POP_M = 6e-6, 1.4e-5, 1.3e-4
P_G, P_L, P_M = 1.2, 0.8, 0.5
G_SMALL = 1.2
END_PARAMS = [7.0, 1.0]     # gain de la brume orange, échelle des pics des grands disques
# poussière du champ : fraction allumée, intensité allumée, intensité éteinte, surcroît net, gain bokeh, plafond bokeh
DUST_PARAMS = [0.0015, 50.0, 0.02, 0.8, 0.08, 40.0]


@ti.data_oriented
class Engine:
    def __init__(self, data, out_w, out_h, scale, n_samples=4, shutter=0.5, expo=0.12):
        N = int(len(data["P0"]))
        self.N, self.S, self.shutter = N, n_samples, shutter
        self.scale = scale
        self.W, self.H = out_w, out_h
        self.Wp = int(math.ceil(out_w / 128.0) * 128)
        self.Hp = int(math.ceil(out_h / 128.0) * 128)
        self.gain_norm = (6e6 / N) * scale ** 2 * expo
        self.nd = data["dots"].shape[1]
        self.fl = scale * FOCAL
        # --- états
        V3 = lambda: ti.Vector.field(3, ti.f32, N)
        self.pos, self.vel, self.trel, self.col = V3(), V3(), V3(), V3()
        self.wuv = ti.Vector.field(2, ti.f32, N)
        self.wdot = ti.field(ti.i32, N)
        self.i0 = ti.field(ti.f32, N)
        self.i0.from_numpy(data["i0"])
        self.kind = ti.field(ti.i32, N)
        self.pos.from_numpy(data["P0"]); self.trel.from_numpy(data["trel"]); self.col.from_numpy(data["col"])
        self.wuv.from_numpy(data["wuv"]); self.wdot.from_numpy(data["wdot"]); self.kind.from_numpy(data["kind"])
        self.vel.fill(0.0)
        self.dots = ti.field(ti.f32, 24 * self.nd * 2)
        self.dots.from_numpy(data["dots"].astype(np.float32).ravel())
        self.rtab = ti.field(ti.f32, 24)
        self.rtab.from_numpy(data["rtab"].astype(np.float32))
        # --- champ de vitesse (ondes transversales = rotationnel d'un potentiel vecteur de bande étroite)
        rng = np.random.default_rng(99)
        lam = np.exp(rng.uniform(np.log(650.0), np.log(2800.0), J_WAVES))
        kh = rng.standard_normal((J_WAVES, 3)); kh /= np.linalg.norm(kh, axis=1, keepdims=True)
        e = rng.standard_normal((J_WAVES, 3)); e -= (e * kh).sum(1, keepdims=True) * kh
        e /= np.linalg.norm(e, axis=1, keepdims=True)
        amp = (lam / 1200.0) ** 0.5
        amp *= FLOW_RMS * math.sqrt(2.0 / np.sum(amp ** 2))
        self.wk = ti.Vector.field(3, ti.f32, J_WAVES); self.we = ti.Vector.field(3, ti.f32, J_WAVES)
        self.wa = ti.field(ti.f32, J_WAVES); self.wo = ti.field(ti.f32, J_WAVES); self.wp = ti.field(ti.f32, J_WAVES)
        self.wk.from_numpy((kh * (2 * np.pi / lam)[:, None]).astype(np.float32))
        self.we.from_numpy(e.astype(np.float32)); self.wa.from_numpy(amp.astype(np.float32))
        self.wo.from_numpy((rng.uniform(0.25, 0.7, J_WAVES) * rng.choice([-1, 1], J_WAVES)).astype(np.float32))
        self.wp.from_numpy(rng.uniform(0, 2 * np.pi, J_WAVES).astype(np.float32))
        self.flow = ti.Vector.field(3, ti.f32, (NGX, NGX, NGZ))
        # --- zone vide (bande déchirée) : sdf et gradient, 627x627 (pas de 2 px du calque)
        from targets import strip_sdf
        sdf, gx, gy, _ = strip_sdf()
        self.sdf = ti.field(ti.f32, (627, 627)); self.sgx = ti.field(ti.f32, (627, 627)); self.sgy = ti.field(ti.f32, (627, 627))
        self.sdf.from_numpy(sdf.astype(np.float32)); self.sgx.from_numpy(gx.astype(np.float32)); self.sgy.from_numpy(gy.astype(np.float32))
        # --- caméra (sim et rendu) : C(3) R(3) U(3) F(3) zf A focal vel(3)
        self.scam = ti.field(ti.f32, 24)
        self.rcam = ti.field(ti.f32, 24)
        # --- tampons de rendu : pyramide
        offs, ws, hs = [], [], []
        o = 0
        for L in range(NLEV):
            w, h = self.Wp >> L, self.Hp >> L
            offs.append(o); ws.append(w); hs.append(h); o += w * h * 3
        self.lvl = ti.field(ti.i32, (3, NLEV))
        self.lvl.from_numpy(np.array([offs, ws, hs], np.int32))
        self.buf = ti.field(ti.f32, o)
        self.ws, self.hs, self.offs = ws, hs, offs
        self.cnt = ti.field(ti.i64, 8)
        self.rcfg = ti.field(ti.f32, 8)
        self.dp = ti.field(ti.f32, 8)
        self.dp.from_numpy(np.array(list(DUST_PARAMS) + list(END_PARAMS), np.float32))

    # ------------------------------------------------------------------ outils
    @ti.func
    def hash01(self, i: ti.u32, salt: ti.u32) -> ti.f32:
        x = i * ti.u32(747796405) + salt * ti.u32(2891336453) + ti.u32(1013904223)
        x = ((x >> ((x >> ti.u32(28)) + ti.u32(4))) ^ x) * ti.u32(277803737)
        x = (x >> ti.u32(22)) ^ x
        return ti.cast(x >> ti.u32(8), ti.f32) * (1.0 / 16777216.0)

    @ti.func
    def sm(self, x: ti.f32) -> ti.f32:
        y = ti.min(ti.max(x, 0.0), 1.0)
        return y * y * (3.0 - 2.0 * y)

    # ------------------------------------------------------------------ champ
    @ti.kernel
    def build_flow(self, ts: ti.f32):
        for i, j, k in self.flow:
            x = GX0 + (GX1 - GX0) * i / (NGX - 1.0)
            y = GX0 + (GX1 - GX0) * j / (NGX - 1.0)
            z = GZ0 + (GZ1 - GZ0) * k / (NGZ - 1.0)
            p = ti.Vector([x, y, z])
            v = ti.Vector([0.0, 0.0, 0.0])
            for q in ti.static(range(J_WAVES)):
                ph = self.wk[q].dot(p) + self.wo[q] * ts + self.wp[q]
                v += self.wa[q] * ti.cos(ph) * self.we[q]
            self.flow[i, j, k] = v

    @ti.func
    def sample_flow(self, p):
        fx = ti.min(ti.max((p[0] - GX0) / (GX1 - GX0) * (NGX - 1.0), 0.0), NGX - 1.001)
        fy = ti.min(ti.max((p[1] - GX0) / (GX1 - GX0) * (NGX - 1.0), 0.0), NGX - 1.001)
        fz = ti.min(ti.max((p[2] - GZ0) / (GZ1 - GZ0) * (NGZ - 1.0), 0.0), NGZ - 1.001)
        i0 = ti.cast(ti.floor(fx), ti.i32); j0 = ti.cast(ti.floor(fy), ti.i32); k0 = ti.cast(ti.floor(fz), ti.i32)
        tx, ty, tz = fx - i0, fy - j0, fz - k0
        c00 = self.flow[i0, j0, k0] * (1 - tx) + self.flow[i0 + 1, j0, k0] * tx
        c10 = self.flow[i0, j0 + 1, k0] * (1 - tx) + self.flow[i0 + 1, j0 + 1, k0] * tx
        c01 = self.flow[i0, j0, k0 + 1] * (1 - tx) + self.flow[i0 + 1, j0, k0 + 1] * tx
        c11 = self.flow[i0, j0 + 1, k0 + 1] * (1 - tx) + self.flow[i0 + 1, j0 + 1, k0 + 1] * tx
        return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz

    # ------------------------------------------------------------------ rampes (images)
    @ti.func
    def word_ramp(self, ii: ti.u32, t: ti.f32) -> ti.f32:
        dw = 5.0 * self.hash01(ii, ti.u32(11)); dd = 5.0 * self.hash01(ii, ti.u32(12))
        return self.sm((t - (376.0 + dw)) / 9.0) * (1.0 - self.sm((t - (407.0 + dd)) / 6.0))

    @ti.func
    def relief_ramp(self, ii: ti.u32, t: ti.f32, orange: ti.i32, ty: ti.f32) -> ti.f32:
        dr = 6.0 * self.hash01(ii, ti.u32(13))
        up = self.sm((t - (406.0 + dr)) / 10.0)
        yn = ti.min(ti.max((ty + 504.0) / 1008.0, 0.0), 1.0)
        h = self.hash01(ii, ti.u32(14))
        rel = 0.0
        if orange == 1:
            rel = self.sm((t - (432.0 + 10.0 * (0.5 * h + 0.5 * (1.0 - yn)))) / 5.0)
        else:
            rel = self.sm((t - (434.0 + 8.0 * h)) / 8.0)
        return up * (1.0 - rel)

    @ti.func
    def surge_ramp(self, ii: ti.u32, t: ti.f32) -> ti.f32:
        return self.sm((t - (436.0 + 6.0 * self.hash01(ii, ti.u32(15)))) / 12.0)

    @ti.func
    def word_target(self, i: ti.i32, t: ti.f32):
        f = ti.min(ti.max(t - 384.0, 0.0), 22.999)
        k = ti.cast(ti.floor(f), ti.i32)
        a = f - k
        d = self.wdot[i]
        nd = self.nd
        cx = self.dots[((k * nd + d) * 2)] * (1 - a) + self.dots[(((k + 1) * nd + d) * 2)] * a
        cy = self.dots[((k * nd + d) * 2) + 1] * (1 - a) + self.dots[(((k + 1) * nd + d) * 2) + 1] * a
        r = self.rtab[k] * (1 - a) + self.rtab[k + 1] * a
        uv = self.wuv[i]
        return ti.Vector([cx + r * uv[0], cy + r * uv[1], 0.0])

    @ti.func
    def aim_depth(self, ii: ti.u32) -> ti.f32:
        # profondeur d'arrivée devant l'objectif (population géante / grande / moyenne / brume)
        u = self.hash01(ii, ti.u32(17)); h = self.hash01(ii, ti.u32(18))
        z = 1600.0 + 2600.0 * h
        if u < POP_G:
            z = 300.0 + 200.0 * h
        elif u < POP_G + POP_L:
            z = 560.0 + 500.0 * h
        elif u < POP_G + POP_L + POP_M:
            z = 900.0 + 700.0 * h
        return z

    @ti.func
    def strip_dist(self, p):
        # frustum de la caméra neutre : coordonnées dans le plan du logo
        comp = ti.max(1.0 - p[2] / D, 0.1)
        xl = p[0] / comp; yl = p[1] / comp
        gu = (xl / K_LOGO + LOGO_PX / 2.0) / 2.0 - 0.5
        gv = (LOGO_PX / 2.0 - yl / K_LOGO) / 2.0 - 0.5
        inside = gu > 0.0 and gu < 625.0 and gv > 0.0 and gv < 625.0
        d = 1e4; gx = 0.0; gy = 0.0
        if inside:
            i0 = ti.cast(ti.floor(gu), ti.i32); j0 = ti.cast(ti.floor(gv), ti.i32)
            tx, ty = gu - i0, gv - j0
            d = (self.sdf[j0, i0] * (1 - tx) + self.sdf[j0, i0 + 1] * tx) * (1 - ty) + (self.sdf[j0 + 1, i0] * (1 - tx) + self.sdf[j0 + 1, i0 + 1] * tx) * ty
            gx = (self.sgx[j0, i0] * (1 - tx) + self.sgx[j0, i0 + 1] * tx) * (1 - ty) + (self.sgx[j0 + 1, i0] * (1 - tx) + self.sgx[j0 + 1, i0 + 1] * tx) * ty
            gy = (self.sgy[j0, i0] * (1 - tx) + self.sgy[j0, i0 + 1] * tx) * (1 - ty) + (self.sgy[j0 + 1, i0] * (1 - tx) + self.sgy[j0 + 1, i0 + 1] * tx) * ty
        return ti.Vector([d, gx, -gy])

    # ------------------------------------------------------------------ pas de simulation
    @ti.kernel
    def sim_step(self, t: ti.f32):
        tn = t + DT * FPS
        C = ti.Vector([self.scam[0], self.scam[1], self.scam[2]]); R = ti.Vector([self.scam[3], self.scam[4], self.scam[5]])
        U = ti.Vector([self.scam[6], self.scam[7], self.scam[8]]); F = ti.Vector([self.scam[9], self.scam[10], self.scam[11]])
        vT = ti.Vector([self.scam[18], self.scam[19], self.scam[20]])
        kbt = self.sm((tn - 408.0) / 6.0) * (1.0 - self.sm((tn - 432.0) / 4.0))
        fo = self.sm((tn - 434.0) / 21.0)
        for i in range(self.N):
            ii = ti.cast(i, ti.u32)
            birth = BIRTH0 + 6.0 * self.hash01(ii, ti.u32(1))
            p = self.pos[i]; v = self.vel[i]
            alive = tn >= birth
            if t < birth and tn >= birth:
                # lancement depuis le point de fuite, vitesse telle que la traînée ramène au repos P0
                off = ti.Vector([self.hash01(ii, ti.u32(2)) - 0.5, self.hash01(ii, ti.u32(3)) - 0.5, self.hash01(ii, ti.u32(4)) - 0.5]) * (2.0 * VP_RADIUS)
                s0 = ti.Vector([VPX, VPY, VPZ]) + off
                v = LC * (p - s0)
                p = s0
            if alive:
                kd = self.kind[i]
                orange = kd & 1
                relb = (kd >> 1) & 1
                tr = self.trel[i]
                rw = 0.0
                if self.wdot[i] >= 0:
                    rw = self.word_ramp(ii, tn)
                rr = 0.0
                if relb == 1:
                    rr = self.relief_ramp(ii, tn, orange, tr[1])
                ss = 0.0
                if orange == 1:
                    ss = self.surge_ramp(ii, tn)
                fa = 1.0 - 0.95 * ti.max(rw, rr)
                flow = self.sample_flow(p) * fa
                vt = flow * (1.0 - ss) + vT * ss
                a = KF * (vt - v)
                if rw > 0.0:
                    ks = KS_W * rw
                    a += ks * (self.word_target(i, tn) - p) - ti.max(2.0 * ti.sqrt(ks) - KF, 0.0) * v
                if rr > 0.0:
                    ks = KS_R * rr
                    a += ks * (tr - p) - ti.max(2.0 * ti.sqrt(ks) - KF, 0.0) * v
                if ss > 0.0:
                    zca = self.aim_depth(ii)
                    sx = (self.hash01(ii, ti.u32(16)) - 0.5) * 1.9 * W0
                    sy = (self.hash01(ii, ti.u32(19)) - 0.5) * 1.9 * H0
                    T = C + F * zca + (R * sx + U * sy) * (zca / FOCAL)
                    ks = KS_S * ss
                    a += ks * (T - p) - ti.max(2.0 * ti.sqrt(ks) - KF, 0.0) * (v - vT)
                if orange == 0 and fo > 0.0:
                    a += -F * (2600.0 * fo * fo)
                if kbt > 0.0:
                    sd = self.strip_dist(p)
                    if sd[0] < 0.0 and ti.abs(p[2]) < ZH + 90.0:
                        g = ti.Vector([sd[1], sd[2]])
                        gn = g.norm() + 1e-6
                        a += ti.Vector([g[0] / gn, g[1] / gn, 0.0]) * (3500.0 * kbt * ti.min(1.0 + (-sd[0]) / 20.0, 3.0))
                v += a * DT
                p += v * DT
            self.pos[i] = p; self.vel[i] = v

    # ------------------------------------------------------------------ mesures (rapport)
    @ti.kernel
    def strip_count(self, tn: ti.f32):
        """cnt[0] : points vivants dans le frustum de la zone vide (|z| < ZH+60) ; cnt[1] : parmi eux, ceux liés au relief
        et posés sur leur cible (< 4 px) ; cnt[2] : cibles de relief dans la zone vide (doit être 0)."""
        self.cnt[0] = 0; self.cnt[1] = 0; self.cnt[2] = 0
        for i in range(self.N):
            ii = ti.cast(i, ti.u32)
            if tn >= BIRTH0 + 6.0 * self.hash01(ii, ti.u32(1)):
                p = self.pos[i]
                if ti.abs(p[2]) < ZH + 60.0:
                    sd = self.strip_dist(p)
                    if sd[0] < 0.0:
                        self.cnt[0] += 1
                        if ((self.kind[i] >> 1) & 1) == 1 and (p - self.trel[i]).norm() < 4.0:
                            self.cnt[1] += 1
            if ((self.kind[i] >> 1) & 1) == 1:
                sd2 = self.strip_dist(self.trel[i])
                if sd2[0] < 0.0:
                    self.cnt[2] += 1

    # ------------------------------------------------------------------ rendu
    @ti.func
    def add_px(self, L: ti.i32, x: ti.i32, y: ti.i32, c: ti.template(), w: ti.f32):
        wl = self.lvl[1, L]; hl = self.lvl[2, L]
        if x >= 0 and x < wl and y >= 0 and y < hl:
            o = self.lvl[0, L] + (y * wl + x) * 3
            self.buf[o] += c[0] * w
            self.buf[o + 1] += c[1] * w
            self.buf[o + 2] += c[2] * w

    @ti.kernel
    def clear(self):
        for i in self.buf:
            self.buf[i] = 0.0

    @ti.kernel
    def render_sample(self, tf: ti.f32, s: ti.i32, ns: ti.i32, shutter: ti.f32, first: ti.i32):
        C = ti.Vector([self.rcam[0], self.rcam[1], self.rcam[2]]); R = ti.Vector([self.rcam[3], self.rcam[4], self.rcam[5]])
        U = ti.Vector([self.rcam[6], self.rcam[7], self.rcam[8]]); F = ti.Vector([self.rcam[9], self.rcam[10], self.rcam[11]])
        zf = self.rcam[12]; A = self.rcam[13]; fl = self.rcam[14]
        hw = 0.5 * self.W; hh = 0.5 * self.H
        for i in range(self.N):
            ii = ti.cast(i, ti.u32)
            jit = self.hash01(ii, ti.u32(100 + s))
            tau = ((s + jit) / ns - 0.5) * shutter           # images
            tt = tf + tau
            birth = BIRTH0 + 6.0 * self.hash01(ii, ti.u32(1))
            if tt >= birth:
                p = self.pos[i] + self.vel[i] * (tau / FPS)
                pc = p - C
                zc = pc.dot(F)
                if zc > ZNEAR:
                    sx = hw + fl * pc.dot(R) / zc
                    sy = hh - fl * pc.dot(U) / zc
                    b = A * fl * ti.abs(1.0 / zf - 1.0 / zc)
                    r = ti.max(0.5 * b, 0.75 * self.scale)
                    if sx + r > 0.0 and sx - r < self.W and sy + r > 0.0 and sy - r < self.H:
                        if first == 1:
                            ti.atomic_add(self.cnt[3], 1)
                        kd = self.kind[i]
                        orange = kd & 1
                        rw = 0.0
                        wq = 1.0
                        if self.wdot[i] >= 0:
                            rw = self.word_ramp(ii, tt)
                            f = ti.min(ti.max(tt - 384.0, 0.0), 22.999)
                            k = ti.cast(ti.floor(f), ti.i32)
                            rad = self.rtab[k] * (1 - (f - k)) + self.rtab[k + 1] * (f - k)
                            q = rad / self.rtab[23]
                            wq = 1.0 + rw * (q * q - 1.0)       # luminance de surface constante quand la pastille gonfle
                        up = 0.0
                        if ((kd >> 1) & 1) == 1:
                            up = self.sm((tt - (406.0 + 6.0 * self.hash01(ii, ti.u32(13)))) / 10.0)
                            up *= 0.12 + 0.88 * (1.0 - self.sm((p - self.trel[i]).norm() / 500.0))
                        if rw > 0.0:
                            rw *= 0.12 + 0.88 * (1.0 - self.sm((p - self.word_target(i, tt)).norm() / 500.0))
                        sb = ti.max(rw, up)                       # fondu champ -> forme
                        amp = ti.max(rw, 0.3 * up)                # amplitude en forme (le relief est plus sage que le mot)
                        bn = b / self.scale
                        dust = self.dp[2]
                        if self.hash01(ii, ti.u32(22)) < self.dp[0]:
                            dust = self.dp[1] * (1.0 + self.dp[3] * ti.exp(-bn / 3.0) + ti.min(self.dp[4] * bn * bn, self.dp[5]))
                        haze = ti.exp(-ti.max(zc - zf, 0.0) / 4200.0)
                        fin = self.sm((tt - birth) / 1.5)
                        bk = 1.0
                        e = self.gain_norm * ((1.0 - sb) * self.i0[i] * dust * bk + amp * 0.6 * wq) * haze
                        if orange == 0:
                            e *= 1.0 - 0.99 * self.sm((tt - 432.0) / 17.0)
                        else:
                            ss = self.surge_ramp(ii, tt)
                            if ss > 0.0:
                                u = self.hash01(ii, ti.u32(17))
                                area = 3.14159 * r * r
                                gx = self.dp[6] * self.gain_norm * 0.6
                                if u < POP_G:
                                    gx = P_G * self.dp[7] * area / 0.8
                                elif u < POP_G + POP_L:
                                    gx = P_L * self.dp[7] * area / 0.8
                                elif u < POP_G + POP_L + POP_M:
                                    gx = P_M * self.dp[7] * area / 0.8
                                gx *= ti.exp(-ti.max(zc - zf, 0.0) / 9000.0) * (0.6 + 0.8 * self.hash01(ii, ti.u32(21)))
                                e = e * (1.0 - ss) + gx * ss
                        e *= fin
                        c = self.col[i] * (e / ns)
                        # niveau de la pyramide
                        L = 0
                        if r >= 3.0:
                            L = ti.min(NLEV - 1, ti.cast(ti.floor(ti.log(r / 1.5) / ti.log(2.0)), ti.i32))
                        sc_ = ti.cast(1 << L, ti.f32)
                        rl = r / sc_
                        u0 = sx / sc_ - 0.5; v0 = sy / sc_ - 0.5
                        if rl <= 0.85:
                            ix = ti.cast(ti.floor(u0), ti.i32); iy = ti.cast(ti.floor(v0), ti.i32)
                            fx = u0 - ix; fy = v0 - iy
                            self.add_px(L, ix, iy, c, (1 - fx) * (1 - fy))
                            self.add_px(L, ix + 1, iy, c, fx * (1 - fy))
                            self.add_px(L, ix, iy + 1, c, (1 - fx) * fy)
                            self.add_px(L, ix + 1, iy + 1, c, fx * fy)
                        else:
                            ed = ti.max(0.5, 0.3 * rl)
                            ext = rl + ed + 0.5
                            norm = 3.14159 * (rl * rl + ed * ed / 3.0)
                            xa = ti.cast(ti.floor(u0 - ext), ti.i32); xb = ti.cast(ti.ceil(u0 + ext), ti.i32)
                            ya = ti.cast(ti.floor(v0 - ext), ti.i32); yb = ti.cast(ti.ceil(v0 + ext), ti.i32)
                            wl = self.lvl[1, L]; hl = self.lvl[2, L]
                            xa = ti.max(xa, 0); ya = ti.max(ya, 0); xb = ti.min(xb, wl - 1); yb = ti.min(yb, hl - 1)
                            for y in range(ya, yb + 1):
                                for x in range(xa, xb + 1):
                                    d = ti.sqrt((x - u0) ** 2 + (y - v0) ** 2)
                                    w = ti.min(ti.max((rl + ed - d) / (2.0 * ed), 0.0), 1.0)
                                    if w > 0.0:
                                        self.add_px(L, x, y, c, w / norm)

    # ------------------------------------------------------------------ API haut niveau
    def _set_cam(self, field, cam, vel=(0, 0, 0), scale_focal=False):
        v = np.zeros(24, np.float32)
        v[0:3], v[3:6], v[6:9], v[9:12] = cam["C"], cam["right"], cam["up"], cam["fwd"]
        v[12], v[13] = cam["zf"], cam["aperture"] * 1.0
        v[14] = self.fl
        v[18:21] = vel
        field.from_numpy(v)

    def step_to(self, f_from, f_to):
        """avance la simulation de l'image f_from à f_to (entiers), 4 pas par image."""
        nsteps = int(round((f_to - f_from) * FPS * 0 + (f_to - f_from) * 4))
        for k in range(nsteps):
            t = f_from + k * 0.25
            tn = t + 0.25
            cam = camera(tn)
            c0 = camera(tn - 0.05)["C"]; c1 = camera(tn + 0.05)["C"]
            vel = (c1 - c0) / (0.1 / FPS)
            self._set_cam(self.scam, cam, vel)
            self.build_flow(tn / FPS)
            self.sim_step(t)

    def save_state(self, path):
        np.savez(path, pos=self.pos.to_numpy(), vel=self.vel.to_numpy())

    def load_state(self, path):
        d = np.load(path)
        self.pos.from_numpy(d["pos"]); self.vel.from_numpy(d["vel"])

    def render(self, tf):
        """Radiance linéaire (H, W, 3) float32 de l'image tf (obturateur 180 degrés centré sur tf)."""
        self.clear()
        self.cnt[3] = 0
        for s in range(self.S):
            tc = tf + ((s + 0.5) / self.S - 0.5) * self.shutter
            self._set_cam(self.rcam, camera(tc))
            self.render_sample(tf, s, self.S, self.shutter, 1 if s == 0 else 0)
        flat = self.buf.to_numpy()
        out = np.zeros((self.Hp, self.Wp, 3), np.float32)
        for L in range(NLEV):
            lv = flat[self.offs[L]: self.offs[L] + self.ws[L] * self.hs[L] * 3].reshape(self.hs[L], self.ws[L], 3)
            if L == 0:
                out += lv
            else:
                interp = cv2.INTER_LINEAR if L <= 3 else cv2.INTER_CUBIC
                up = cv2.resize(lv, (self.Wp, self.Hp), interpolation=interp)
                out += np.maximum(up, 0) * (0.25 ** L)   # le tampon de niveau L stocke de l'énergie par pixel de niveau (4^L pixels image)
        return out[:self.H, :self.W], int(self.cnt[3])
