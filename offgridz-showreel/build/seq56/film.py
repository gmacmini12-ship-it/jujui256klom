"""film.py -- thin-film (lubrication) solver for the ink: dry-to-wet front (frames 480-503) and squeegee (504-527).

Unknown: surface height s(x, y) of the ink above the sheet plane (the window is a tray, base b = -4 mm inside it, 0 outside).
Thickness T = s - b.  Equation (shallow layer / lubrication approximation, explicit finite volumes on a staggered grid):

    ds/dt = div( T^3 / (3 mu) * grad( rho g s - sigma lap(s) ) )

 * the film is initialised, cell by cell, from the grains' height field at the moment the wetting front reaches the cell
   (front arrival time Ta(x, y): radial sweep from the centre with low-frequency noise, frames 480 -> 503);
   not-yet-wet cells are walls (no flux) and keep showing the dry grains in the renderer;
 * lateral boundaries: no flux (edge pinning); bottom edge: open (ink leaves the sheet) once the squeegee runs;
 * squeegee: a moving wall.  Cells swept by the blade tip in a substep are set to the residual thickness h_res;
   the swept excess volume is put in the K cells ahead of the tip (bead growth); edges inside the blade contact are walls;
   behind the blade the residual film drains with time constant tau_drain (non-physical sink, so that the sheet is clean at 527).
 * numerical stabilisation (stated in the report): capillary mobility uses min(T, 1.5 mm), gravity mobility min(T, 10 mm).
Units SI.  Film time = ts_film * film-frame time (default 1.0: real time).
"""
import json
import math
import os
import time

import cv2
import numpy as np

from common import (W, H, PX_M, WIN, TRAY_DEPTH, init_taichi, tip_y, RUBBER_LEN, beat_ease)

RHO, SIGMA = 1000.0, 0.030
F_WET0, F_WET1 = 480, 503
F_SQ0, F_SQ1 = 504, 527


def arrival_field(nx, ny, fpx, seed=4):
    """Frame (float) at which the wetting front reaches each film cell: radial sweep from the sheet centre, 480 -> 503."""
    xs = ((np.arange(nx) + 0.5) * fpx - W / 2) * PX_M
    ys = (H / 2 - (np.arange(ny) + 0.5) * fpx) * PX_M
    X, Y = np.meshgrid(xs, ys)           # (ny, nx)
    r = np.hypot(X, Y) / math.hypot(0.054, 0.096)
    rng = np.random.default_rng(seed)
    # one low-frequency octave only: a clean advancing line (the earlier two-octave noise gave a ragged front)
    L = 0.045
    g = rng.standard_normal((int(ny * fpx * PX_M / L) + 4, int(nx * fpx * PX_M / L) + 4)).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.0)
    g = cv2.resize(g, (nx, ny), interpolation=cv2.INTER_CUBIC)
    n = (g / max(g.std(), 1e-6)).astype(np.float32)
    Ta = F_WET0 + 20.5 * np.clip(r, 0, 1) ** 0.9 + 0.55 * n
    Ta = np.clip(Ta, F_WET0, F_WET1 - 0.5)
    return Ta.astype(np.float32)


def tray_base(nx, ny, fpx):
    xs = ((np.arange(nx) + 0.5) * fpx - W / 2) * PX_M
    ys = (H / 2 - (np.arange(ny) + 0.5) * fpx) * PX_M
    X, Y = np.meshgrid(xs, ys)
    b = np.where((np.abs(X) < (WIN[2] - WIN[0]) / 2 * PX_M) & (np.abs(Y) < (WIN[3] - WIN[1]) / 2 * PX_M), -TRAY_DEPTH, 0.0)
    return b.astype(np.float32)


def grain_height_film(zh, cover, fpx, sigma_px):
    """Smoothed height of the grain bed on the film grid (normalised convolution; empty -> nan-free via cover)."""
    z = np.nan_to_num(zh, nan=0.0) * cover
    num = cv2.GaussianBlur(z, (0, 0), sigma_px)
    den = cv2.GaussianBlur(cover, (0, 0), sigma_px)
    Hh = np.where(den > 0.02, num / np.maximum(den, 1e-6), np.nan)
    ny, nx = H // fpx, W // fpx
    Hh_f = cv2.resize(np.where(np.isnan(Hh), -9.0, Hh).astype(np.float32), (nx, ny), interpolation=cv2.INTER_AREA)
    cov_f = cv2.resize(np.minimum(den, 1.0).astype(np.float32), (nx, ny), interpolation=cv2.INTER_AREA)
    return Hh_f, cov_f


class Film:
    def __init__(self, fpx=2, mu=20.0, h_res=3e-6, tau_drain=0.10, ts_film=1.0, K=6, lc_px=40.0, threads=2, Tcg=8e-3, h_pin=2.5e-3):
        ti = init_taichi(threads)
        self.ti = ti
        self.fpx = fpx
        self.Tcg = Tcg
        self.h_pin = h_pin
        self.nx, self.ny = W // fpx, H // fpx
        self.dx = fpx * PX_M
        self.mu, self.h_res, self.tau, self.ts_film = mu, h_res, tau_drain, ts_film
        self.K = K
        self.Lc = lc_px / fpx
        nx, ny = self.nx, self.ny
        self.s = ti.field(ti.f32, (nx, ny))
        self.b = ti.field(ti.f32, (nx, ny))
        self.act = ti.field(ti.i32, (nx, ny))
        self.phi = ti.field(ti.f32, (nx, ny))
        self.qx = ti.field(ti.f32, (nx, ny))
        self.qy = ti.field(ti.f32, (nx, ny))
        self.lost = ti.field(ti.f64, ())
        self.exc = ti.field(ti.f32, nx)
        self._kernels()
        self.t = 0.0
        self.lost_sheet = 0.0

    def _kernels(self):
        ti = self.ti
        s, b, act, phi, qx, qy, lost, exc = self.s, self.b, self.act, self.phi, self.qx, self.qy, self.lost, self.exc
        nx, ny, dx = self.nx, self.ny, self.dx
        mu = self.mu
        rho, sig = RHO, SIGMA
        Tcg, Tcc = self.Tcg, 1.5e-3

        @ti.func
        def clampi(i, n):
            return ti.min(ti.max(i, 0), n - 1)

        @ti.kernel
        def fluxes(tipc: ti.f32, lc: ti.f32, blade_on: ti.i32, open_bottom: ti.i32):
            for i, j in s:
                lap = (s[clampi(i + 1, nx), j] + s[clampi(i - 1, nx), j] + s[i, clampi(j + 1, ny)] + s[i, clampi(j - 1, ny)] - 4.0 * s[i, j]) / (dx * dx)
                phi[i, j] = -sig * lap
            for i, j in s:
                Ti = s[i, j] - b[i, j]
                # x edge (i, i+1)
                qx[i, j] = 0.0
                if i < nx - 1 and act[i, j] > 0 and act[i + 1, j] > 0:
                    Te = 0.5 * (Ti + s[i + 1, j] - b[i + 1, j])
                    wall = 0
                    if blade_on > 0 and (j + 0.5) >= tipc - lc and (j + 0.5) <= tipc + 0.5:
                        wall = 1
                    if wall == 0 and Te > 1e-9:
                        mg = ti.min(Te, Tcg) ** 3 / (3.0 * mu)
                        mc = ti.min(Te, Tcc) ** 3 / (3.0 * mu)
                        qx[i, j] = -(mg * rho * 9.81 * (s[i + 1, j] - s[i, j]) + mc * (phi[i + 1, j] - phi[i, j])) / dx
                qy[i, j] = 0.0
                if j < ny - 1 and act[i, j] > 0 and act[i, j + 1] > 0:
                    Te = 0.5 * (Ti + s[i, j + 1] - b[i, j + 1])
                    wall = 0
                    if blade_on > 0 and (j + 0.5) >= tipc - lc and (j + 0.5) <= tipc + 0.5:
                        wall = 1
                    if wall == 0 and Te > 1e-9:
                        mg = ti.min(Te, Tcg) ** 3 / (3.0 * mu)
                        mc = ti.min(Te, Tcc) ** 3 / (3.0 * mu)
                        qy[i, j] = -(mg * rho * 9.81 * (s[i, j + 1] - s[i, j]) + mc * (phi[i, j + 1] - phi[i, j])) / dx
                if j == ny - 1 and open_bottom > 0 and act[i, j] > 0 and Ti > 1e-9:
                    # open edge: ghost cell with zero thickness at the base level
                    mg = ti.min(Ti, Tcg) ** 3 / (3.0 * mu)
                    qy[i, j] = mg * rho * 9.81 * Ti / dx * 0.5

        @ti.kernel
        def update(dt: ti.f32):
            for i, j in s:
                if act[i, j] > 0:
                    qxl = 0.0
                    qyl = 0.0
                    if i > 0:
                        qxl = qx[i - 1, j]
                    if j > 0:
                        qyl = qy[i, j - 1]
                    dv = -(qx[i, j] - qxl) - (qy[i, j] - qyl)
                    snew = s[i, j] + dt / dx * dv
                    s[i, j] = ti.max(snew, b[i, j])
            for i in range(nx):
                # volume leaving through the open bottom edge
                lost[None] += qy[i, ny - 1] * dt * dx

        @ti.kernel
        def spill(dt: ti.f32, hpin: ti.f32):
            # ink thicker than the pinning height h_pin runs over the sheet edges (left, right, top); bottom edge handled by the open boundary
            for i, j in s:
                if act[i, j] > 0 and (i == 0 or i == nx - 1 or j == 0):
                    T = s[i, j] - b[i, j]
                    if T > hpin:
                        mg = ti.min(T, Tcg) ** 3 / (3.0 * mu)
                        rate = mg * rho * 9.81 * (T - hpin) / (dx * dx)
                        dT = ti.min(rate * dt, T - hpin)
                        s[i, j] -= dT
                        ti.atomic_add(lost[None], dT * dx * dx)

        @ti.kernel
        def sweep(j_old: ti.i32, j_new: ti.i32, hres: ti.f32, K: ti.i32):
            # cells j_old+1 .. j_new swept by the blade: thickness -> hres, excess to the K cells ahead
            for i in range(nx):
                e = 0.0
                for j in range(j_old + 1, j_new + 1):
                    if j >= 0 and j < ny:
                        T = s[i, j] - b[i, j]
                        if T > hres:
                            e += T - hres
                            s[i, j] = b[i, j] + hres
                if e > 0.0:
                    wsum = 0.0
                    for k in range(1, K + 1):
                        wsum += 1.0 - (k - 1.0) / K
                    for k in range(1, K + 1):
                        jj = j_new + k
                        wgt = (1.0 - (k - 1.0) / K) / wsum
                        if jj < ny:
                            s[i, jj] += e * wgt
                        else:
                            lost[None] += e * wgt * dx * dx

        @ti.kernel
        def drain(jlim: ti.i32, dt: ti.f32, tau: ti.f32):
            for i, j in s:
                if j < jlim and act[i, j] > 0:
                    T = s[i, j] - b[i, j]
                    s[i, j] = b[i, j] + T * ti.exp(-dt / tau)

        @ti.kernel
        def vol() -> ti.f64:
            tot = 0.0
            for i, j in s:
                if act[i, j] > 0:
                    tot += (s[i, j] - b[i, j]) * dx * dx
            return tot

        tm = ti.field(ti.f32, ())

        @ti.kernel
        def tmax() -> ti.f32:
            tm[None] = 0.0
            for i, j in s:
                if act[i, j] > 0:
                    ti.atomic_max(tm[None], s[i, j] - b[i, j])
            return tm[None]

        self.k_flux, self.k_update, self.k_sweep, self.k_drain, self.k_vol, self.k_tmax, self.k_spill = fluxes, update, sweep, drain, vol, tmax, spill

    def volume(self):
        return float(self.k_vol()) + 0.0

    def dt_stable(self, Tm):
        dx, mu = self.dx, self.mu
        mg = min(Tm, self.Tcg) ** 3 / (3 * mu)
        mc = min(Tm, 1.5e-3) ** 3 / (3 * mu)
        d_g = 0.2 * dx * dx / max(mg * RHO * 9.81 * 4.0, 1e-30)
        d_c = 0.2 * dx ** 4 / max(mc * SIGMA * 16.0, 1e-30)
        return min(d_g, d_c)

    def advance_frame(self, f, nmax=400000):
        """Advance from film frame f-1 to f (continuous blade position from the beat easing)."""
        dtf = self.ts_film / 30.0
        t_end = self.t + dtf
        n = 0
        blade = f >= F_SQ0
        tip_prev_cell = None
        while t_end - self.t > 1e-12:
            Tm = float(self.k_tmax())
            dt = min(self.dt_stable(Tm), t_end - self.t)
            # blade position at the middle of the substep, in film cells
            ff = f - 1.0 + (self.t + 0.5 * dt - (t_end - dtf)) / dtf
            tipc = tip_y(ff) / self.fpx if blade else -1e9
            self.k_flux(float(tipc), float(self.Lc), 1 if blade else 0, 1 if blade else 0)
            self.k_update(float(dt))
            self.k_spill(float(dt), float(self.h_pin))
            if blade:
                ffe = f - 1.0 + (self.t + dt - (t_end - dtf)) / dtf
                tipe = tip_y(ffe) / self.fpx
                j_old = int(math.floor(self._tip_prev)) if self._tip_prev is not None else -1
                j_new = int(math.floor(tipe))
                if j_new > j_old:
                    self.k_sweep(j_old, j_new, float(self.h_res), self.K)
                self._tip_prev = tipe
                self.k_drain(int(max(math.floor(tipe - self.Lc), 0)), float(dt), float(self.tau))
            self.t += dt
            n += 1
            if n > nmax:
                raise RuntimeError("film: too many substeps")
        return n


def run_film(cache, out_dir, grain_frames, fpx=2, mu=20.0, ts_film=1.0, threads=2, hsigma_rel=0.9, spacing=None, log=print, film_gain=0.25,
             render_grain_fn=None, f_last=F_SQ1, fpx_sq=4, Tcg_sq=20e-3, resume=False, level_sigma_mm=18.0, h_pin=2.5e-3):
    """Run frames 480..527.  `grain_frames(f)` -> dict(zh, cover) for the grain cache frame to use at film frame f (clamped)."""
    os.makedirs(out_dir, exist_ok=True)
    fl = Film(fpx=fpx, mu=mu, ts_film=ts_film, threads=threads, h_pin=h_pin)
    fl._tip_prev = None
    nx, ny = fl.nx, fl.ny
    b = tray_base(nx, ny, fpx)
    fl.b.from_numpy(b.T.copy())
    Ta = arrival_field(nx, ny, fpx)
    s0 = b.copy()
    act = np.zeros((nx, ny), np.int32)
    fl.s.from_numpy(s0.T.copy())
    fl.act.from_numpy(act)
    sig_px = max(hsigma_rel * spacing / PX_M, 1.0)
    budget = []
    t0 = time.time()
    s_np = s0.copy()
    f_begin = F_WET0
    T_bar = None
    p503 = os.path.join(out_dir, "s%04d.npz" % F_WET1)
    if resume and os.path.exists(p503):
        # frames 480-503 (wetting stage) already computed with the same parameters: continue from the saved state
        fl.s.from_numpy(np.load(p503)["s"].astype(np.float32).T.copy())
        fl.act.from_numpy(np.ones((nx, ny), np.int32))
        f_begin = F_SQ0
        lp = os.path.join(out_dir, "film_log.json")
        if os.path.exists(lp):
            budget = [r for r in json.load(open(lp))["budget"] if r["frame"] < F_SQ0]
        log("resume: wetting stage taken from %s" % p503)
    for f in range(f_begin, f_last + 1):
        # activate the cells reached by the front during (f-1, f]
        if f <= F_WET1:
            newly = (Ta > f - 1) & (Ta <= f) if f > F_WET0 else (Ta <= f)
            if newly.any():
                g = grain_frames(f)
                Hh, cov = grain_height_film(g["zh"], g["cover"], fpx, sig_px)
                s_np = fl.s.to_numpy().T.copy()
                act_np = fl.act.to_numpy().T.copy()
                Hh_use = np.where(Hh < -8.0, 0.0, Hh)
                # thickness: bed top, at least a thin coat where the bed has gaps, never below the base
                T_raw = film_gain * np.maximum(Hh_use - b, 0.0)      # ink volume = film_gain x bulk volume of the bed
                if level_sigma_mm > 0:
                    # level the large-scale heap (launch column / dome): constant mean thickness + the relief of the bed
                    # at scales below level_sigma (low-pass by normalised convolution on the film grid)
                    if T_bar is None:
                        T_bar = float(film_gain * np.maximum(Hh_use - b, 0.0)[cov > 0.5].mean())
                    sg = level_sigma_mm * 1e-3 / fl.dx
                    num = cv2.GaussianBlur(T_raw * cov, (0, 0), sg)
                    den = cv2.GaussianBlur(cov, (0, 0), sg)
                    T_lp = num / np.maximum(den, 1e-6)
                    T_new = np.maximum(T_bar + (T_raw - T_lp), 0.3 * T_bar)
                else:
                    T_new = T_raw
                T_new = np.where(cov < 0.5, np.maximum(T_new, 0.0003), T_new)
                T_new = np.maximum(T_new, 0.0003)
                s_np = np.where(newly, b + T_new, s_np)
                act_np = np.where(newly, 1, act_np)
                fl.s.from_numpy(s_np.T.copy())
                fl.act.from_numpy(act_np.T.copy().astype(np.int32))
        if f == F_SQ0 and fpx_sq != fpx:
            # squeegee stage on a coarser grid with a much higher gravity-mobility clamp (the bead is thick)
            s_prev = fl.s.to_numpy().T.copy()
            lost_prev = float(fl.lost[None])
            fl = Film(fpx=fpx_sq, mu=mu, ts_film=ts_film, threads=threads, Tcg=Tcg_sq, h_pin=h_pin)
            fl._tip_prev = None
            nx, ny = fl.nx, fl.ny
            b = tray_base(nx, ny, fpx_sq)
            fl.b.from_numpy(b.T.copy())
            s2 = cv2.resize(s_prev, (nx, ny), interpolation=cv2.INTER_AREA)
            fl.s.from_numpy(np.maximum(s2, b).T.copy())
            fl.act.from_numpy(np.ones((nx, ny), np.int32))
            log("squeegee stage: film grid %dx%d (%.2f mm cells), Tcg=%.0f mm" % (nx, ny, fl.dx * 1e3, Tcg_sq * 1e3))
        v0 = fl.volume()
        nsub = fl.advance_frame(f)
        s_np = fl.s.to_numpy().T.copy()
        np.savez_compressed(os.path.join(out_dir, "s%04d.npz" % f), s=s_np.astype(np.float32), fpx=fl.fpx)
        v1 = fl.volume()
        lost = float(fl.lost[None])
        budget.append(dict(frame=f, substeps=nsub, volume_cm3=v1 * 1e6, lost_cm3=lost * 1e6, tmax_mm=float(fl.k_tmax()) * 1e3,
                           tip_px=float(tip_y(f)) if f >= F_SQ0 else None, wall_s=time.time() - t0))
        log("film f%d  substeps=%d  V=%.2f cm3  lost=%.2f cm3  Tmax=%.2f mm  wall=%.0fs" % (f, nsub, v1 * 1e6, lost * 1e6, budget[-1]["tmax_mm"], time.time() - t0))
    with open(os.path.join(out_dir, "film_log.json"), "w") as fo:
        json.dump(dict(h_pin_mm=h_pin * 1e3, level_sigma_mm=level_sigma_mm, T_bar_mm=(T_bar * 1e3 if T_bar else None), fpx=fpx, fpx_squeegee=fpx_sq, Tcg_squeegee_mm=Tcg_sq * 1e3, mu=mu, film_gain=film_gain, ts_film=ts_film, grid=[nx, ny], dx_mm=fl.dx * 1e3, budget=budget), fo, indent=1)
    np.save(os.path.join(out_dir, "Ta.npy"), Ta)
    return budget
