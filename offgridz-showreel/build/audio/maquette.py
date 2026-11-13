"""OFFGRIDZ / INSOUMISE : maquette sonore v0 (20 s, 48 kHz, stereo).

Lit timeline/partition.json (seule source du temps), rend les stems, le mix, le rapport et le spectrogramme.

    /opt/og/venv/bin/python build/audio/maquette.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import synth as sy
from synth import SR, SPF, NS, db, note, rng, tt

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out" / "audio"

# ==========================================================================
# Partition (seule source du temps)
# ==========================================================================


class Partition:
    def __init__(self, path: Path):
        d = json.loads(path.read_text(encoding="utf-8"))
        assert d["format"]["images"] == 600 and d["format"]["images_par_seconde"] == 30
        self.ev = d["evenements"]
        self.bars = {m["mesure"]: m["image"] for m in d["grille"]["mesures"]}
        self.ipt = d["grille"]["images_par_temps"]          # 12
        self.ipx = d["grille"]["images_par_double_croche"]  # 3

    def one(self, piste, sub, nth=0):
        m = [e for e in self.ev if e["piste"] == piste and sub in e["nom"]]
        return m[nth]

    def bar(self, n):                   # image de depart de la mesure n
        return self.bars[n]

    def step(self, n, k):               # image de la double-croche k de la mesure n
        return self.bars[n] + self.ipx * k

    def block(self, piste, sub, nth=0):  # (premiere image, echantillon de fin exclu)
        e = self.one(piste, sub, nth)
        return e["debut"], (e["fin"] + 1) * SPF


P = Partition(ROOT / "timeline" / "partition.json")
SX = P.ipx * SPF                        # une double-croche en echantillons (4800)
F5, C6 = note("F5"), note("C6")         # famille du declic : quinte parfaite

META: dict = {}                         # valeurs a reporter (niveaux des clics de caracteres, etc.)

# ==========================================================================
# Voix : percussions
# ==========================================================================


def v_kick(seed, amp=1.0, f0=57.0, f_hi=200.0, length=0.30, drive=3.0, click=1.0):
    g = rng("kick", seed)
    n = int(length * SR)
    t = tt(n)
    f = f0 + (f_hi - f0) * np.exp(-t / 0.020)
    body = np.sin(sy.TWO_PI * sy.phase(f, n) + 0.7)
    body *= np.exp(-t / 0.085)
    body = sy.softclip(body * 1.1, drive)
    mid = np.sin(sy.TWO_PI * sy.phase(f * 2.0 + 20, n) + 0.7) * np.exp(-t / 0.03) * 0.75
    tick = sy.hp(g.standard_normal(n) * np.exp(-t / 0.0014), 1800.0) * 0.55 * click
    tick += np.cos(sy.TWO_PI * 2300 * t) * np.exp(-t / 0.0018) * 0.25 * click
    y = (body + mid + tick) * sy.fade_out(n, 0.05)
    return amp * y * 0.8


def v_snare(seed, amp=1.0):
    g = rng("snare", seed)
    n = int(0.22 * SR)
    t = tt(n)
    tone = np.sin(sy.TWO_PI * sy.phase(175 + 90 * np.exp(-t / 0.012), n) + 0.5) * np.exp(-t / 0.05) * 0.7
    nz = sy.bp(g.standard_normal(n), 2300, 0.7)
    nz = sy.hp(nz, 700, 0.7) * np.exp(-t / 0.055)
    rim = sy.modal([1750, 2650, 480], [0.03, 0.02, 0.04], [0.5, 0.25, 0.3], n)
    y = (tone + nz * 0.9 + rim) * sy.fade_out(n, 0.05)
    return amp * y * 0.55


def v_rim(seed, amp=1.0, f=1650.0):
    g = rng("rim", seed)
    n = int(0.09 * SR)
    t = tt(n)
    y = sy.modal([f, f * 1.51, f * 2.34, 430], [0.022, 0.016, 0.01, 0.03], [1.0, 0.5, 0.25, 0.4], n)
    y += sy.bp(g.standard_normal(n), 3200, 1.2) * np.exp(-t / 0.002) * 0.6
    return amp * y * sy.fade_out(n, 0.02) * 0.55


def v_hat(seed, amp=1.0, open_=False):
    g = rng("hat", seed)
    tau = 0.10 if open_ else 0.011
    n = int((0.45 if open_ else 0.07) * SR)
    t = tt(n)
    nz = sy.hp(g.standard_normal(n), 7000.0, 0.7071, order=2)
    met = np.zeros(n)
    for r in (1.0, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637):
        met += sy.square(2600.0 * r, n, 0.5, g.random())
    met = sy.hp(met, 6500.0, 0.7071, order=2) / 6.0
    y = (nz * 0.8 + met * 0.9) * np.exp(-t / tau) * sy.fade_out(n, 0.012)
    return amp * y * 0.5


def v_tick(seed, f=3000.0, amp=1.0, tau=0.0012, length=0.012):
    """Clic fin et propre (groove B/C, roulement)."""
    g = rng("tick", seed)
    n = int(length * SR)
    t = tt(n)
    y = sy.bp(g.standard_normal(n), f, 2.5) * np.exp(-t / tau) * 1.8
    y += np.cos(sy.TWO_PI * f * 0.5 * t) * np.exp(-t / (tau * 1.3)) * 0.6
    return amp * y * sy.fade_out(n, 0.003) * 0.7


# ==========================================================================
# Voix : le declic du reticule (logo sonore)
# ==========================================================================


def v_rclick(f, seed, amp=1.0, dec=0.011, length=0.05):
    """Un declic de mecanisme : petit corps accorde (cos -> premier echantillon non nul) + transitoire."""
    g = rng("rclick", seed, int(f))
    n = int(length * SR)
    t = tt(n)
    body = np.cos(sy.TWO_PI * f * t + 0.2) * np.exp(-t / dec)
    body += 0.38 * np.cos(sy.TWO_PI * f * 2.0 * t + 0.4) * np.exp(-t / (dec * 0.55))
    body += 0.16 * np.cos(sy.TWO_PI * f * 3.01 * t) * np.exp(-t / (dec * 0.35))
    tick = sy.bp(g.standard_normal(n), f * 3.0, 1.5) * np.exp(-t / 0.0007) * 1.0
    thump = np.cos(sy.TWO_PI * (f * 0.25) * t) * np.exp(-t / 0.004) * 0.25
    y = (body + tick + thump) * np.minimum(1.0, 0.25 + t / 0.00025)    # attaque ~0,25 ms, demarre non nul
    return amp * y * sy.fade_out(n, 0.012) * 0.8


def v_slip(seed, amp=1.0):
    """Glissement : petite chute de hauteur, desaccordee (deux voix legerement decalees), discrete."""
    g = rng("slip", seed)
    n = int(0.18 * SR)
    t = tt(n)
    f = 1318.0 * (590.0 / 1318.0) ** (t / 0.17)
    wob = 1 + 0.006 * np.sin(sy.TWO_PI * 31 * t)
    y = np.sin(sy.TWO_PI * sy.phase(f * wob, n) + 0.3) + 0.8 * np.sin(sy.TWO_PI * sy.phase(sy.cents(f, 23) * wob, n) + 1.1)
    y += 0.2 * np.sin(sy.TWO_PI * sy.phase(f * 2.0, n))
    y = sy.lp(y, 3200, 0.7071)
    env = sy.env_points(n, [(0, 0.05), (0.004, 1), (0.05, 0.55), (0.18, 0.0)])
    return amp * y * env * sy.fade_out(n, 0.04) * 0.30


def v_dyad(n, amp=1.0):
    """Dyade douce tenue (F4 + C5) ; commence en douceur (non nul) et finit exactement a zero."""
    t = tt(n)
    f1, f2 = note("F4"), note("C5")
    y = np.sin(sy.TWO_PI * sy.phase(f1, n)) + 0.22 * np.sin(sy.TWO_PI * sy.phase(f1 * 2, n))
    y += 0.9 * np.sin(sy.TWO_PI * sy.phase(sy.cents(f2, 1.5), n)) + 0.18 * np.sin(sy.TWO_PI * sy.phase(f2 * 2, n))
    y *= (1 + 0.07 * np.sin(sy.TWO_PI * 5.2 * t))
    return nz(amp * y * sy.fade_in(n, 0.03, 0.01) * sy.fade_out(n, 0.03) * 0.30)


# ==========================================================================
# Voix : basse, nappes, notes
# ==========================================================================


def v_bass(f, dur, amp=1.0, c0=1100.0, c1=260.0, drive=2.2, glide_from=None, glide_tau=0.05,
           attack=0.004, rel=0.05, bright=1.05, seed="b"):
    n = int(dur * SR)
    t = tt(n)
    fr = f if glide_from is None else f * (glide_from / f) ** np.exp(-t / glide_tau)
    subw = np.sin(sy.TWO_PI * sy.phase(fr, n) + 0.4)
    sw = sy.saw(fr, n)
    sw = sy.sweep(sw, c1 + (c0 - c1) * np.exp(-t / 0.18), q=1.1, kind="lp")
    oc = sy.tri(fr * 2.0, n) * 0.28
    y = subw * 0.8 + sw * bright + oc
    y = sy.asym_sat(y * 0.9, drive, 0.12)
    y = sy.hp(y, 28.0, 0.7071)
    env = sy.adsr(n, attack, 0.2, 0.8, rel)
    return amp * y * env * 0.55


def v_sub(f, dur, amp=1.0, tau=1.0):
    """Sous-note finale : sinus profond + harmoniques saturees (audible sur un petit haut-parleur)."""
    n = int(dur * SR)
    t = tt(n)
    y = np.sin(sy.TWO_PI * sy.phase(f, n) + 0.5) + 0.35 * np.sin(sy.TWO_PI * sy.phase(2 * f, n) + 0.2)
    y = sy.asym_sat(y * 1.1, 2.0, 0.1)
    up = sy.sweep(sy.saw(2 * f, n), 520 + 900 * np.exp(-t / 0.4), q=0.9, kind="lp") * 0.35
    env = np.exp(-t / tau) * sy.fade_in(n, 0.012, 0.01)
    return amp * (y + up) * env * sy.fade_out(n, 0.25) * 0.55


def v_pad(freqs, dur, amp=1.0, attack=0.12, release=0.3, cutoff=1800.0, det=7.0, spread=0.8, env=None, seed="pad"):
    n = int(dur * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    k = len(freqs)
    for i, f in enumerate(freqs):
        a = sy.saw(sy.cents(f, det), n, 0.1 * i) + sy.saw(sy.cents(f, -det), n, 0.37 + 0.1 * i) + 0.9 * np.sin(sy.TWO_PI * sy.phase(f, n))
        p = (-1 + 2 * i / max(1, k - 1)) * spread if k > 1 else 0.0
        ang = (p + 1) * np.pi / 4
        L += a * np.cos(ang)
        R += a * np.sin(ang)
    st = np.stack([L, R]) / k
    st = sy.sweep_st(st, np.full(n, cutoff), q=0.8, kind="lp") if np.ndim(cutoff) == 0 else sy.sweep_st(st, cutoff, q=0.8, kind="lp")
    e = sy.adsr(n, attack, 0.3, 0.8, release) if env is None else env
    return amp * st * e[None, :] * 0.5


def v_pluck(f, dur=0.30, cutoff=2400.0, amp=1.0, seed="p"):
    n = int(dur * SR)
    t = tt(n)
    y = sy.saw(sy.cents(f, 6), n) + sy.saw(sy.cents(f, -6), n, 0.3) + 0.35 * sy.square(f, n, 0.4)
    fc = cutoff * (0.25 + 0.75 * np.exp(-t / 0.06))
    y = sy.sweep(y, fc, q=2.0, kind="lp", chunk=128)
    env = np.exp(-t / 0.085) * np.minimum(1.0, 0.1 + t / 0.002)
    return amp * y * env * sy.fade_out(n, 0.04) * 0.3


def v_bell(f, dur=0.55, idx=2.6, ratio=3.5, amp=1.0):
    """Cloche de verre : FM inharmonique + un partiel haut."""
    n = int(dur * SR)
    t = tt(n)
    ie = idx * np.exp(-t / 0.05)
    y = sy.fm(f, ratio, ie, n, 0.4) * np.exp(-t / 0.16)
    y += 0.35 * np.cos(sy.TWO_PI * f * 5.43 * t) * np.exp(-t / 0.06)
    return amp * y * sy.fade_out(n, 0.1) * 0.5


def v_blip(f, amp=1.0):
    n = int(0.012 * SR)
    t = tt(n)
    f2 = f * 1.5
    seg = (t < 0.006)
    y = np.where(seg, np.cos(sy.TWO_PI * f * t), np.cos(sy.TWO_PI * f2 * t))
    return amp * y * np.hanning(n + 2)[1:-1] ** 0.5 * 0.5 * sy.fade_in(n, 0.0005, 0.3)


# ==========================================================================
# Voix : bruitages
# ==========================================================================


def v_paper_tick():
    g = rng("papertick")
    n = int(0.03 * SR)
    t = tt(n)
    y = sy.bp(g.standard_normal(n), 3600, 1.1) * np.exp(-t / 0.0022) * 1.4
    y += sy.lp(g.standard_normal(n), 900) * np.exp(-t / 0.004) * 0.5
    return y * sy.fade_out(n, 0.008) * 0.4


def v_tear(n):
    g = rng("tear")
    t = tt(n)
    T = n / SR
    fc = 6800.0 * (1500.0 / 6800.0) ** (t / T)                       # hauteur descendante
    base = sy.sweep(g.standard_normal(n), fc, q=1.4, kind="bp")
    base /= np.std(base)
    fib = sy.lp(g.standard_normal(n), 85.0)
    fib = np.clip(fib / np.std(fib) * 0.75 + 0.55, 0.05, 1.8)          # fibres : rafales irregulieres
    env = sy.env_points(n, [(0, 0.2), (0.012, 1.0), (0.25 * T, 0.75), (0.8 * T, 0.5), (T, 0.15)])
    cr = sy.crackle(n, np.linspace(300, 55, n), g, 0.0011, 2400.0)
    body = sy.lp(g.standard_normal(n), 650.0) * 0.5
    y = (base * fib * 0.55 + body * fib * 0.3) * env + cr * 1.6 * env
    y = sy.hp(y, 150.0, 0.7071)
    y *= sy.fade_out(n, 0.045)
    return y * 0.45 / (np.max(np.abs(y)) + 1e-9) * 1.6


def v_tape(n, g):
    """Souffle de bande / piece : bruit rose + un peu de scintillement, deux canaux decorreles."""
    out = []
    for c in range(2):
        a = sy.pink(n, g)
        a = sy.hp(sy.lp(a, 5500.0, 0.7071), 55.0, 0.7071)
        h = sy.hp(g.standard_normal(n), 4500.0) * 0.12
        out.append(a + h)
    st = np.stack(out)
    wow = 1 + 0.12 * np.sin(sy.TWO_PI * 0.7 * tt(n)) + 0.05 * np.sin(sy.TWO_PI * 3.3 * tt(n))
    return st * wow[None, :] / np.std(st)


def v_air(n):
    g = rng("air")
    t = tt(n)
    T = n / SR
    chs = []
    for c in range(2):
        w = sy.pink(n, g)
        fc = 900.0 * (2600.0 / 900.0) ** (t / T)
        chs.append(sy.sweep(w, fc, q=0.9, kind="bp"))
    y = np.stack(chs)
    y /= np.std(y)
    env = np.sin(np.pi * np.clip(t / T, 0, 1)) ** 1.6 * (0.5 + 0.5 * (t / T))
    return y * env[None, :] * sy.fade_out(n, 0.04)[None, :]


def nz(y, e=2e-5):
    y = np.array(y, dtype=float)
    if y.ndim == 1 and y[0] == 0.0:
        y[0] = e
    elif y.ndim == 2 and np.all(y[:, 0] == 0.0):
        y[:, 0] = e
    return y


def _norm_rms(x, ms=30.0, target=0.12):
    k = int(ms * 1e-3 * SR)
    r = np.sqrt(np.mean(x[:k] ** 2)) + 1e-12
    return x * (target / r)


def char_click(i, seed="chr"):
    """Huit clics de caracteres, huit timbres, meme niveau (RMS des 30 premieres ms)."""
    g = rng("char", i)
    n = int(0.06 * SR)
    t = tt(n)
    if i == 0:      # Archivo (large, noir) : boisson, bois
        y = sy.modal([880, 1480, 2250], [0.025, 0.018, 0.012], [1.0, 0.6, 0.35], n)
        y += sy.bp(g.standard_normal(n), 1700, 1.6) * np.exp(-t / 0.003) * 0.7
    elif i == 1:    # Anton (haut, etroit) : membrane sourde
        f = 150 + 130 * np.exp(-t / 0.012)
        y = np.sin(sy.TWO_PI * sy.phase(f, n) + 0.8) * np.exp(-t / 0.035)
        y += sy.bp(g.standard_normal(n), 900, 1.0) * np.exp(-t / 0.002) * 0.5
    elif i == 2:    # Permanent Marker : bruit de feutre, rugueux
        y = sy.hp(g.standard_normal(n), 2800, 0.7071) * np.exp(-t / 0.011)
        y *= 0.5 + 0.5 * (sy.lp(g.standard_normal(n), 900) > 0)
    elif i == 3:    # Saira Stencil : metal
        y = sy.modal([2620, 4130, 6310, 7890], [0.045, 0.04, 0.03, 0.02], [1.0, 0.8, 0.5, 0.35], n)
    elif i == 4:    # Doto (points) : bip numerique, quantifie
        y = sy.bitcrush(sy.square(1850.0, n, 0.5), 4) * np.exp(-t / 0.009)
    elif i == 5:    # Major Mono : verre
        y = sy.modal([3150, 4630, 6190], [0.07, 0.05, 0.04], [1.0, 0.7, 0.4], n)
        y += 0.5 * np.cos(sy.TWO_PI * 3180 * t) * np.exp(-t / 0.05)       # battement
    elif i == 6:    # Instrument Serif : pincement
        y = sy.sweep(sy.saw(520.0, n), 3200.0 * np.exp(-t / 0.012) + 400, q=1.8, kind="lp") * np.exp(-t / 0.03)
    else:           # Bodoni Moda : petite cloche FM
        y = sy.fm(1250.0, 2.76, 3.0 * np.exp(-t / 0.012), n, 0.3) * np.exp(-t / 0.035)
    y = y * sy.fade_out(n, 0.02)
    y = _norm_rms(y, 30.0, 0.12)
    pk = np.max(np.abs(y))
    if pk > 1.2:                       # evite des crêtes tres differentes : compression douce de l'ecart
        y = sy.softclip(y / 1.2, 1.5) * 1.2
        y = _norm_rms(y, 30.0, 0.12)
    META.setdefault("char_rms", []).append(float(np.sqrt(np.mean(y[: int(0.03 * SR)] ** 2))))
    META.setdefault("char_peak", []).append(float(np.max(np.abs(y))))
    return nz(y)


def v_lime():
    g = rng("lime")
    n = int(0.3 * SR)
    t = tt(n)
    sq = sy.sweep(g.standard_normal(n), 1800.0 * (5200.0 / 1800.0) ** np.minimum(1, t / 0.1), q=1.3, kind="bp")
    sq = sq * np.exp(-t / 0.045) * 0.9
    thock = np.sin(sy.TWO_PI * sy.phase(110 + 90 * np.exp(-t / 0.01), n) + 0.6) * np.exp(-t / 0.02) * 0.9
    pops = np.zeros(n)
    for k in range(5):
        st = int(g.uniform(0.01, 0.2) * SR)
        b = sy.bubble(g.uniform(1800, 4600), 0.004, 0.5, g.uniform(0.2, 0.7), int(0.04 * SR))
        pops[st:st + len(b)] += b[: n - st]
    y = (sq + thock + pops) * sy.fade_out(n, 0.08)
    return y * 0.5


def v_mint():
    g = rng("mint")
    n = int(0.34 * SR)
    t = tt(n)
    leaf = sy.hp(g.standard_normal(n), 3200.0, 0.7071)
    mod = np.zeros(n)
    for k in range(22):
        c = int(g.uniform(0.0, 0.26) * SR)
        w = int(g.uniform(0.004, 0.016) * SR)
        a = g.uniform(0.3, 1.0) * np.exp(-c / SR / 0.13)
        e = min(n, c + w)
        mod[c:e] += a * np.hanning(w + 2)[1:-1][: e - c]
    muddle = np.sin(sy.TWO_PI * sy.phase(700 - 320 * np.minimum(1, t / 0.03), n) + 0.7) * np.exp(-t / 0.012) * 0.6
    y = leaf * mod * 0.8 + muddle + sy.bp(g.standard_normal(n), 1300, 1.0) * np.exp(-t / 0.004) * 0.4
    return y * sy.fade_out(n, 0.1) * 0.45


def v_ice(f, vel, seed):
    g = rng("ice", seed)
    n = int(0.5 * SR)
    t = tt(n)
    y = sy.modal([f, f * 2.32, f * 4.25, f * 6.63, f * 9.38], [0.4, 0.26, 0.15, 0.09, 0.05], [1.0, 0.7, 0.45, 0.28, 0.14], n,
                 phases=[0.3, 1.2, 2.0, 0.7, 1.7])
    y += sy.hp(g.standard_normal(n), 3000.0) * np.exp(-t / 0.0007) * 0.7
    return vel * y * sy.fade_out(n, 0.15) * 0.35


def v_straw():
    g = rng("straw")
    n = int(0.12 * SR)
    t = tt(n)
    y = np.sin(sy.TWO_PI * sy.phase(300 + 260 * np.exp(-t / 0.012), n) + 0.6) * np.exp(-t / 0.028)
    y += sy.modal([1120, 1710], [0.05, 0.03], [0.6, 0.3], n)
    y += sy.bp(g.standard_normal(n), 1900, 1.4) * np.exp(-t / 0.0022) * 0.8
    return y * sy.fade_out(n, 0.03) * 0.6


def v_suction(n):
    """Aspiration : un souffle qui chute (bruit, bande etroite descendante) RETOURNE dans le temps."""
    g = rng("suction")
    t = tt(n)
    T = n / SR
    outs = []
    for c in range(2):
        w = g.standard_normal(n)
        fc = 3600.0 * (800.0 / 3600.0) ** (t / T)
        s = sy.sweep(w, fc, q=2.2, kind="bp")
        s += 0.7 * sy.lp(sy.sweep(g.standard_normal(n), 400 + 200 * (1 - t / T), q=1.0, kind="lp"), 500)
        outs.append(s)
    y = np.stack(outs)
    y /= np.std(y)
    env = np.exp(-t / (0.22 * T)) * (1 - np.exp(-t / 0.004))
    y = y * env[None, :]
    y = y[:, ::-1].copy()                  # retourne : gonflement qui culmine a la fin
    y *= sy.fade_in(n, 0.01, 0.002)[None, :] * sy.fade_out(n, 0.0015)[None, :]
    return y * 0.55


def v_friction(n):
    """Raclette sur l'encre : bruit a bande limitee, balayage lent vers le grave, collé-glissé irregulier."""
    g = rng("squeegee")
    t = tt(n)
    T = n / SR
    fc = 3300.0 * (620.0 / 3300.0) ** (t / T) ** 0.9
    w = g.standard_normal(n)
    base = sy.sweep(w, fc, q=1.6, kind="bp")
    base /= np.std(base)
    # collé-glissé : oscillateur a relaxation, periode irreguliere (~ 14 a 40 ms)
    phs = np.zeros(n)
    pos = 0
    out_saw = np.zeros(n)
    while pos < n:
        per = int(g.uniform(0.014, 0.040) * SR)
        e = min(n, pos + per)
        out_saw[pos:e] = np.linspace(0.0, 1.0, e - pos) ** g.uniform(1.4, 2.6)
        pos = e
    stick = 0.35 + 0.65 * out_saw                      # monte (colle) puis chute (glisse)
    slow = sy.lp(g.standard_normal(n), 6.0)
    slow = 1 + 0.35 * slow / np.std(slow)
    squeak_f = 2100.0 * (900.0 / 2100.0) ** (t / T)
    squeak = np.sin(sy.TWO_PI * sy.phase(squeak_f * (1 + 0.01 * (out_saw - 0.5)), n)) * out_saw ** 3 * 0.10
    y = base * stick * np.clip(slow, 0.3, 1.8) + squeak
    env = sy.env_points(n, [(0, 0.0), (0.03, 0.9), (0.2, 1.0), (T - 0.15, 0.85), (T - 0.02, 0.55), (T, 0.4)])
    y = y * env * sy.fade_in(n, 0.006, 0.2) * sy.fade_out(n, 0.006)
    y = sy.hp(y, 250.0, 0.7071)
    st = nz(np.stack([y, y]) * 0.5)
    return st


def v_wash(n, wet_curve):
    """Nappe de bruit large (stereo, decorrelee), filtree. Le timbre s'adoucit avec wet_curve (0 sec -> 1 mouille)."""
    g = rng("wash")
    t = tt(n)
    fc = 11000.0 * (2600.0 / 11000.0) ** wet_curve
    chs = []
    for c in range(2):
        w = sy.pink(n, g)
        w = sy.hp(w, 240.0, 0.7071)
        w = sy.sweep(w, fc, q=0.7071, kind="lp")
        w = sy.peak_eq(w, 1400.0, 0.8, 3.0)
        chs.append(w)
    y = np.stack(chs)
    y /= np.std(y)
    lfo = 1 + 0.10 * np.sin(sy.TWO_PI * 0.45 * t) + 0.06 * np.sin(sy.TWO_PI * 1.1 * t + 1.0)
    return y * lfo[None, :] * 0.5


# ==========================================================================
# Le score
# ==========================================================================
LV = dict(  # niveaux de depart (dB) par famille ; ajustes apres mesure
    kick=-3.5, snare=-4.0, rim=-6.0, hat=-6.5, tick=-5.0,
    bass=-2.5, sub=-11.5, pad=-12.0, pluck=-10.0, bell=-12.0, wash=-26.0, grain=-18.0, pgrain=-24.0,
    foley=-8.0, pour=-21.0, bubble=-22.0, tape=-52.0, ret=-6.0,
)


TRIM = dict(rythme=-2.0, basse=-3.0, textures=8.0, bruitages=2.0, reticule=3.0)


def sync_ev(stem, sig, frame, tag, **kw):
    stem.add(sig, frame, sync=tag, label=tag, **kw)


def cue_attempt(R, frame, tag, up=True, level_db=0.0, seed=0, pan_a=-0.12, pan_b=0.12):
    """Declic de verrouillage : deux clics distants de 60 ms, le second une quinte parfaite au-dessus."""
    lo, hi = F5, F5 * 1.5
    a, b = (lo, hi) if up else (hi, lo)
    R.add(v_rclick(a, seed), frame, gain_db=LV["ret"] + level_db, pan_pos=pan_a, sync=tag + "_a", label=tag + " clic 1",
          send={"room": 0.10})
    R.add(v_rclick(b, seed + 1), frame, off=int(0.060 * SR), gain_db=LV["ret"] + level_db, pan_pos=pan_b,
          sync=tag + "_b", label=tag + " clic 2 (+60 ms)", send={"room": 0.10})


def build(stems):
    R, RY, BA, TX, BR = stems["reticule"], stems["rythme"], stems["basse"], stems["textures"], stems["bruitages"]
    bar = P.bar
    step = P.step
    ret = {e["nom"]: e for e in P.ev if e["piste"] == "reticule"}
    ret_events = [e for e in P.ev if e["piste"] == "reticule" and "image" in e]

    # ---------------------------------------------------------------- 0-23 levee
    fb = P.block("musique", "souffle")
    n = fb[1]
    g = rng("tapebed")
    bed = v_tape(n, g)
    curve = (np.linspace(0, 1, n) ** 3)                           # sort du silence absolu (echantillon 0 = 0)
    # le souffle se retire doucement apres l'entree du rythme
    tail_n = int(0.5 * SR)
    bed_all = np.concatenate([bed * curve[None, :] * db(LV["tape"]),
                              v_tape(tail_n, g) * np.linspace(1, 0, tail_n) ** 2 * db(LV["tape"])], axis=1)
    TX.add(bed_all, 0, at=0, label="souffle de bande")

    BR.add(v_paper_tick(), P.one("bruitage", "tic de papier")["image"], gain_db=-4, pan_pos=0.1, label="tic de papier",
           sync="paper6", send={"room": 0.08})
    tear = P.one("bruitage", "déchirure")
    tn = (tear["fin"] + 1 - tear["debut"]) * SPF
    BR.add(v_tear(tn), tear["debut"], gain_db=-9, pan_pos=-0.05, label="déchirure", sync="tear12",
           send={"room": 0.10})
    # declic inverse du reticule (deux clics en ordre inverse = descendant)
    unl = P.one("reticule", "déverrouillage")
    cue_attempt(R, unl["image"], "ret12", up=False, seed=100)

    # ---------------------------------------------------------------- 24-71 mesure 1
    typo1 = P.one("typo", "roulement 1")
    clicks_blk = P.one("bruitage", "8 clics")
    for i in range(8):
        fr = clicks_blk["debut"] + P.ipx * i
        BR.add(char_click(i), fr, gain_db=-6, pan_pos=(-0.35 if i % 2 == 0 else 0.35), sync=f"char{i}",
               label=f"clic caractère {i + 1}", send={"room": 0.12})
    # le rythme entre sur le temps 1
    m1 = bar(1)
    RY.add(v_kick("m1a", 0.9), m1, gain_db=LV["kick"], sync="kick24", label="kick (entrée du rythme)", send={"room": 0.05})
    RY.add(v_rim("m1b", 0.8), step(1, 8), gain_db=LV["rim"], pan_pos=0.2, label="rim temps 3", send={"room": 0.12})
    RY.add(v_kick("m1c", 0.55), step(1, 13), gain_db=LV["kick"] - 5, label="kick syncopé m1")
    # glisse de basse autour du temps 3
    BA.add(v_bass(note("F2"), 0.42, 0.85, glide_from=note("C2"), glide_tau=0.07, c0=900, c1=300), step(1, 8),
           gain_db=LV["bass"], label="glissé de basse (temps 3)", sync="glide48")
    # souffle d'air qui suit la poussee de camera (sans whoosh)
    air = P.one("bruitage", "souffle de caméra")
    an = (air["fin"] + 1 - air["debut"]) * SPF
    BR.add(v_air(an), air["debut"], gain_db=-31, label="air (poussée de caméra)")

    # ---------------------------------------------------------------- 72-209 groove A
    ga = P.one("musique", "groove A")
    ga_end = (ga["fin"] + 1)
    vel_h = [0.9, 0.3, 0.5, 0.3, 0.7, 0.3, 0.95, 0.3, 0.8, 0.3, 0.55, 0.3, 0.7, 0.3, 0.5, 0.45]
    kicks = {2: [0, 7, 10], 3: [0, 7, 10, 15], 4: [0, 6, 10]}
    bass_fig = {2: [(0, "F2", 6), (7, "Ab2", 2.4), (10, "Eb2", 4.4)],
                3: [(0, "F2", 6), (7, "C3", 2.4), (10, "Db2", 4.4)],
                4: [(0, "F2", 6), (7, "Ab2", 2.4), (10, "Eb2", 3.6)]}
    for b in (2, 3, 4):
        last = 13 if b == 4 else 15
        for k in kicks[b]:
            if step(b, k) >= ga_end:
                continue
            tg = {"kick72": 0} if (b == 2 and k == 0) else {}
            RY.add(v_kick(f"a{b}{k}", 1.0 if k == 0 else 0.85), step(b, k), gain_db=LV["kick"],
                   sync="kick72" if (b == 2 and k == 0) else None, label=f"kick A{b}.{k}", send={"room": 0.06})
        RY.add(v_snare(f"a{b}"), step(b, 8), gain_db=LV["snare"], pan_pos=0.05, label=f"caisse claire A{b}", send={"room": 0.16, "plate": 0.05})
        for k in range(last + 1):
            if step(b, k) >= ga_end:
                break
            op = (k == 14 and b != 4)
            RY.add(v_hat(f"a{b}{k}", vel_h[k] * (1.0 if not op else 0.9), open_=op), step(b, k), gain_db=LV["hat"],
                   pan_pos=0.25 * np.sin(k * 1.3 + b), label=f"hat A{b}.{k}", send={"room": 0.05})
        for (k, nm, dur_steps) in bass_fig[b]:
            BA.add(v_bass(note(nm), dur_steps * 0.1 - 0.012, 1.0 if k == 0 else 0.8), step(b, k), gain_db=LV["bass"],
                   label=f"basse A{b}.{k} {nm}", sync="bass72" if (b == 2 and k == 0) else None)

    # tentatives et glissements (piste reticule)
    for e in ret_events:
        if e["issue"] == "échec":
            cue_attempt(R, e["image"], f"ret{e['image']}", up=True, seed=e["image"])
            R.add(v_slip(e["fin"]), e["fin"], gain_db=0.0, pan_pos=0.1, sync=f"slip{e['fin']}", label=f"glissement {e['fin']}",
                  send={"room": 0.12})
    # texture granulaire : densite = avalanche 84-119 monte, 120-167 maximum, 168-209 s'eteint
    f_a, f_b = 84, 210
    nn = (f_b - f_a) * SPF
    fr_axis = f_a + np.arange(nn) / SPF

    def dens(fr):
        d = np.zeros_like(fr)
        r = (fr >= 84) & (fr < 120)
        d[r] = ((fr[r] - 84) / 36.0) ** 1.6 * 0.80
        r = (fr >= 120) & (fr < 168)
        d[r] = 0.92 + 0.08 * np.sin((fr[r] - 120) * 0.7)
        r = (fr >= 168) & (fr < 210)
        d[r] = (1 - (fr[r] - 168) / 42.0) ** 1.3
        return d

    dn = dens(fr_axis)
    META["dens_axis"] = (f_a, dn[::SPF // 4].tolist())
    gsand = rng("sand")
    sand = sy.grain_cloud(nn, dn * 1500.0, gsand, [(2400, 5200), (4200, 9000), (1000, 2600)], 1.2, 6.0, pan_spread=0.9)
    BR.add(sand, f_a, gain_db=LV["grain"], label="grains (sable) densité = avalanche", send={"room": 0.08})
    rumble = sy.lp(rng("rumble").standard_normal(nn), 260.0, 0.7071, order=2)
    rumble = rumble / np.std(rumble) * (dn ** 2.0)
    BR.add(rumble, f_a, gain_db=-30, label="grondement d'avalanche")
    # grains accordes (gamme de fa mineur) : meme densite, plus clairsemee
    gp = rng("pgrain")
    scale = [note(x) for x in ("F5", "G5", "Ab5", "C6", "Db6", "Eb6", "F6", "G6", "Ab6")]
    pg = np.zeros((2, nn + 4096))
    hits = np.nonzero(gp.random(nn) < (dn * 90.0) / SR)[0]
    for h in hits:
        L = int(gp.uniform(8, 26) * 1e-3 * SR)
        f = scale[gp.integers(len(scale))]
        gr = np.sin(sy.TWO_PI * f * np.arange(L) / SR + gp.random() * 6) * np.hanning(L + 2)[1:-1] * gp.uniform(0.2, 1.0)
        p = gp.uniform(-0.9, 0.9)
        ang = (p + 1) * np.pi / 4
        pg[0, h:h + L] += gr * np.cos(ang)
        pg[1, h:h + L] += gr * np.sin(ang)
    TX.add(pg[:, :nn], f_a, gain_db=LV["pgrain"], label="grains accordés", send={"plate": 0.25, "hall": 0.1})

    # ---------------------------------------------------------------- 216-263 groove B
    # bruitage citron / menthe
    BR.add(v_lime(), P.one("bruitage", "citron")["image"], gain_db=LV["foley"], pan_pos=-0.25, sync="lime216", label="citron vert",
           send={"room": 0.15})
    BR.add(v_mint(), P.one("bruitage", "menthe")["image"], gain_db=LV["foley"] - 1, pan_pos=0.3, sync="mint228", label="menthe",
           send={"room": 0.15})
    # glacons : 7 tintements pres de la grille, pas robotiques
    ice = P.one("bruitage", "glaçons")
    gi = rng("icegrid")
    ice_steps = [0, 1, 2, 4, 5, 6, 7]
    ice_f = [3300, 2750, 3950, 3050, 4250, 2600, 3550]
    ice_v = [1.0, 0.55, 0.8, 0.95, 0.6, 0.85, 0.7]
    for j, (s_, f_, v_) in enumerate(zip(ice_steps, ice_f, ice_v)):
        jit = 0 if j == 0 else int(gi.integers(-110, 160))
        BR.add(v_ice(f_, v_, j), ice["debut"], off=s_ * SX + jit, gain_db=LV["foley"] + 2, pan_pos=float(np.sin(j * 2.1) * 0.55),
               sync="ice240" if j == 0 else None, label=f"glaçon {j + 1}", send={"room": 0.12, "plate": 0.12})
    # percussion reduite : clics fins et rim
    tickpat = {0: 0.9, 3: 0.5, 5: 0.7, 6: 0.4, 8: 0.9, 10: 0.5, 11: 0.8, 13: 0.4, 14: 0.6}
    for k, v in tickpat.items():
        RY.add(v_tick(f"b{k}", 3400 + 300 * (k % 3), v), step(5, k), gain_db=LV["tick"], pan_pos=0.35 * np.sin(k), label=f"clic B5.{k}",
               sync="tick216" if k == 0 else None, send={"room": 0.08})
    RY.add(v_rim("b5", 0.9, 1750), step(5, 8), gain_db=LV["rim"] + 1, pan_pos=-0.1, label="rim B5 temps 3", send={"room": 0.14})
    RY.add(v_kick("b5k", 0.6), step(5, 0), gain_db=LV["kick"] - 6, label="kick doux B5", send={"room": 0.05})
    for (k, nm, d_) in [(0, "F2", 6.0), (10, "Eb2", 4.2)]:
        BA.add(v_bass(note(nm), d_ * 0.1 - 0.01, 0.7, c0=800, c1=240), step(5, k), gain_db=LV["bass"] - 2, label=f"basse B5 {nm}",
               sync="bass216" if k == 0 else None)

    # ---------------------------------------------------------------- 264-311 mesure 6
    pour = P.one("bruitage", "versement")
    pn = (pour["fin"] + 1 - pour["debut"]) * SPF
    gpour = rng("pour")
    tp = tt(pn)
    Tp = pn / SR
    chs = []
    for c in range(2):
        w = gpour.standard_normal(pn)
        fcp = 450.0 * (2400.0 / 450.0) ** (tp / Tp)         # la hauteur monte avec le niveau du verre
        s_ = sy.sweep(w, fcp, q=1.6, kind="bp")
        turb = sy.lp(gpour.standard_normal(pn), 28.0)
        turb = 1 + 0.45 * turb / np.std(turb)
        s_ = s_ / np.std(s_) * np.clip(turb, 0.2, 2.0)
        g2 = sy.lp(gpour.standard_normal(pn), 300.0, 0.7071, order=2)
        s_ += g2 / np.std(g2) * 0.35 * np.clip(turb, 0.2, 2.0)
        chs.append(s_)
    pr = np.stack(chs)
    pr_env = sy.env_points(pn, [(0, 0.0), (0.12, 0.8), (0.6, 0.9), (Tp - 0.22, 1.0), (Tp, 0.0)])
    pr = pr * pr_env[None, :] * sy.fade_in(pn, 0.05, 0.05)[None, :] * sy.fade_out(pn, 0.1)[None, :]
    BR.add(pr, pour["debut"], gain_db=LV["pour"], label="versement", send={"room": 0.12})
    bn = int((pour["fin"] - pour["debut"] - 2) * SPF)
    brate = np.linspace(8, 70, bn) ** 1.0
    bub = sy.bubbles(bn, brate, rng("bubbles"), 500.0, 3800.0, f_bias=1.3)
    BR.add(bub, pour["debut"], gain_db=LV["bubble"], label="bulles", send={"plate": 0.18, "room": 0.1})
    # arpege pince montant, filtre qui s'ouvre
    arp_notes = ["F3", "C4", "Ab3", "Eb4", "C4", "F4", "Eb4", "Ab4", "F4", "C5", "Ab4", "Eb5", "C5", "F5", "Eb5", "Ab5"]
    arp_vel = [1.0, .5, .6, .85, .5, .7, .5, .9, .55, .65, .5, .85, .55, .7, .6, .9]
    cut_arp = np.geomspace(600.0, 9000.0, 16)
    for k in range(16):
        v = v_pluck(note(arp_notes[k]), 0.30, cut_arp[k], arp_vel[k])
        pp = 0.55 * np.sin(k * 1.2)
        TX.add(v, step(6, k), gain_db=LV["pluck"], pan_pos=pp, label=f"arpège 6.{k}", sync="arp264" if k == 0 else None,
               send={"plate": 0.22, "room": 0.08})
        ec = sy.delay_taps(v, 3 * SX, 0.38, 4, 3500.0)
        TX.add(ec * 0.35, step(6, k), gain_db=LV["pluck"] - 4, label="écho arpège")
    BA.add(v_bass(note("F2"), 1.5, 0.6, c0=600, c1=200, rel=0.15), bar(6), gain_db=LV["bass"] - 5, label="basse tenue m6")

    # ---------------------------------------------------------------- 312-359 mesure 7
    straw = P.one("bruitage", "paille")["image"]
    BR.add(v_straw(), straw, gain_db=-4, pan_pos=0.05, sync="straw312", label="paille (toc)", send={"room": 0.1})
    chord_end = P.block("musique", "accord ouvert")[1]
    cn = chord_end - straw * SPF
    chord = v_pad([note(x) for x in ("C4", "Eb4", "G4", "Ab4", "Eb5")], cn / SR, 1.0, attack=0.07, release=0.22, cutoff=1700, det=8, spread=0.9)
    # attaque douce mais premier echantillon non nul : adsr part de 1e-3
    TX.add(chord, straw, gain_db=LV["pad"], label="accord ouvert (Fm9)", sync="chord312", send={"hall": 0.28, "plate": 0.08})
    BA.add(v_sub(note("F1"), cn / SR, 0.9, tau=3.0) * sy.fade_out(cn, 0.06), straw, gain_db=LV["sub"] - 2, label="sous-basse F1", sync="sub312")
    BA.add(v_bass(note("F2"), cn / SR, 0.75, c0=700, c1=300, rel=0.08, drive=1.7), straw, gain_db=LV["bass"] - 2, label="basse F2 tenue", sync="bass312")
    lk = P.one("reticule", "tentative 3")
    cue_attempt(R, lk["image"], "ret318", up=True, level_db=0.0, seed=300)
    dn_ = (lk["fin"] - lk["image"]) * SPF
    R.add(v_dyad(dn_), lk["image"], gain_db=LV["ret"] - 2, pan_pos=0.0, sync="dyad318", label="dyade tenue (318-342)", send={"hall": 0.1})
    rc = v_rclick(F5 * 1.5, 77, 1.0, dec=0.02, length=0.07)[::-1].copy() * sy.fade_out(int(0.07 * SR), 0.0008)[::-1]
    R.add(rc, end_at=lk["fin"] * SPF, gain_db=LV["ret"] + 1, pan_pos=0.1, sync="rev342", label="clic inversé (relâchement)")
    asp = P.one("bruitage", "aspiration")
    an2 = (asp["fin"] + 1 - asp["debut"]) * SPF
    BR.add(v_suction(an2), asp["debut"], gain_db=-17, sync="suck_end", label="aspiration (inversée)", send={"room": 0.05})

    # ---------------------------------------------------------------- 360-407 groove C
    for k in (0, 10):
        RY.add(v_kick(f"c{k}", 0.8), step(8, k), gain_db=LV["kick"] - 3, sync="kick360" if k == 0 else None, label=f"kick C.{k}",
               send={"hall": 0.08})
    BA.add(v_bass(note("F2"), 0.5, 0.6, c0=700, c1=200), step(8, 0), gain_db=LV["bass"] - 4, label="basse C.0")
    BA.add(v_bass(note("Ab2"), 0.3, 0.5, c0=700, c1=200), step(8, 10), gain_db=LV["bass"] - 5, label="basse C.10")
    RY.add(v_rim("c8", 0.55, 2100), step(8, 8), gain_db=LV["rim"] - 4, pan_pos=0.3, label="rim C.8", send={"plate": 0.15})
    bell_notes = ["F5", "Ab5", "C6", "G5", "Eb6", "C6", "Ab5", "F6", "C6", "Eb6", "G5", "Ab5", "C6", "F6", "Eb6", "Ab5"]
    accents = {0, 3, 6, 9, 12}
    for k in range(16):
        a = 1.0 if k in accents else 0.45
        b = v_bell(note(bell_notes[k]), 0.5, 2.4, 3.5, a)
        TX.add(b, step(8, k), gain_db=LV["bell"], pan_pos=0.85 * np.sin(k * 1.7), label=f"cloche C.{k}", send={"plate": 0.4, "hall": 0.15})
        ec = sy.delay_taps(b, 4 * SX, 0.42, 3, 6000.0)
        TX.add(ec * 0.5, step(8, k), gain_db=LV["bell"] - 3, label="écho cloche")
    gb = rng("blips")
    blip_steps = sorted(gb.choice(np.arange(1, 16), 9, replace=False).tolist())
    for j, k in enumerate(blip_steps):
        f = [2093, 2637, 3136, 3951, 4186, 5274][int(gb.integers(6))]
        BR.add(v_blip(f, gb.uniform(0.5, 1.0)), step(8, k), gain_db=-17, pan_pos=float(gb.uniform(-0.9, 0.9)), label="blip de données",
               send={"plate": 0.2})

    # ---------------------------------------------------------------- 408-452 montée
    for k in range(8):
        RY.add(v_tick(f"r{k}", 2300 + 250 * k, 0.35 + 0.05 * k), step(9, k), gain_db=LV["tick"] + 1, pan_pos=0.3 * np.sin(k * 2), label=f"roulement 16e {k}",
               sync="roll408" if k == 0 else None)
    r2 = P.step(9, 8)
    nroll = 14
    for k in range(nroll):
        fr = r2 + 1.5 * k                       # triples-croches : 1,5 image
        RY.add(v_tick(f"r2{k}", 3200 + 170 * k, 0.55 + 0.035 * k, tau=0.001), fr, gain_db=LV["tick"] + 1, pan_pos=0.4 * np.sin(k * 1.9), label=f"roulement 32e {k}",
               sync="roll432" if k == 0 else None)
    RY.add(v_kick("r9k", 0.7), bar(9), gain_db=LV["kick"] - 4, label="kick doux m9", send={"room": 0.05})
    RY.add(v_kick("r9l", 0.6), step(9, 4), gain_db=LV["kick"] - 6, label="kick doux m9.4")
    sw = P.one("bruitage", "roulement, souffle")
    sn = (sw["fin"] + 1 - sw["debut"]) * SPF
    gs = rng("swell")
    tsw = tt(sn)
    Ts = sn / SR
    cs = []
    for c in range(2):
        cs.append(sy.sweep(gs.standard_normal(sn), 1800.0 * (5200.0 / 1800.0) ** (tsw / Ts), q=0.9, kind="bp"))
    swl = np.stack(cs)
    swl = swl / np.std(swl) * ((tsw / Ts) ** 2.2)[None, :] * sy.fade_in(sn, 0.01, 0.01)[None, :] * sy.fade_out(sn, 0.002)[None, :]
    BR.add(swl, sw["debut"], gain_db=-27, label="souffle de la montée", sync="swell_end")
    BA.add(v_bass(note("F2"), (453 - 408) * SPF / SR, 0.7, c0=2200.0, c1=500.0, rel=0.02, drive=1.8), bar(9), gain_db=LV["bass"] - 4, label="basse tenue m9")

    # ---------------------------------------------------------------- 456-503 plein
    full = P.one("musique", "plein")
    f0 = full["debut"]
    wet_f = lambda fr: float(np.clip((fr - 480.0) / 24.0, 0, 1))
    kicks10 = [0, 6, 10, 13]
    for k in kicks10:
        fr = step(10, k)
        w = wet_f(fr)
        RY.add(sy.lp(v_kick(f"f{k}", 1.0 if k == 0 else 0.85), 20000 - 14000 * w, 0.7071), fr, gain_db=LV["kick"], sync="kick456" if k == 0 else None,
               label=f"kick F.{k}", send={"room": 0.05 + 0.2 * w, "hall": 0.03 + 0.3 * w})
    sn_fr = step(10, 8)
    RY.add(sy.lp(v_snare("f8"), 20000 - 14000 * wet_f(sn_fr), 0.7071), sn_fr, gain_db=LV["snare"], label="caisse claire F",
           send={"room": 0.16 + 0.2 * wet_f(sn_fr), "hall": 0.1 + 0.35 * wet_f(sn_fr)})
    for k in (4, 12):
        fr = step(10, k)
        RY.add(sy.lp(v_rim(f"fr{k}", 0.6), 20000 - 14000 * wet_f(fr), 0.7071), fr, gain_db=LV["rim"] - 1, pan_pos=-0.2 if k == 4 else 0.25,
               label=f"rim fantôme F.{k}", send={"room": 0.1 + 0.2 * wet_f(fr), "hall": 0.05 + 0.3 * wet_f(fr)})
    vel_f = [1.0, .35, .6, .35, .75, .35, 1.0, .35, .85, .35, .6, .35, .8, .35, .65, .5]
    for k in range(16):
        fr = step(10, k)
        w = wet_f(fr)
        h = sy.lp(v_hat(f"f{k}", vel_f[k], open_=(k in (6, 14))), 20000 - 15500 * w, 0.7071)
        RY.add(h, fr, gain_db=LV["hat"], pan_pos=0.3 * np.sin(k * 1.1), label=f"hat F.{k}", send={"room": 0.05 + 0.15 * w, "hall": 0.03 + 0.2 * w})
    # nappe de bruit large + pedale de basse + nappe d'accord
    wn = (full["fin"] + 1 - full["debut"]) * SPF
    wcur = np.clip((np.arange(wn) / SPF - 24.0) / 24.0, 0, 1)
    wash = v_wash(wn, wcur) * sy.fade_in(wn, 0.2, 0.01)[None, :]
    TX.add(wash, f0, gain_db=LV["wash"], label="nappe de bruit large", sync="wash456",
           send={"hall": 0.1 + 0.5 * wcur})
    bn10 = wn / SR
    BA.add(v_bass(note("F2"), bn10, 0.8, c0=900.0, c1=420.0, rel=0.02, drive=2.0, bright=0.9), f0, gain_db=LV["bass"], label="basse tenue F", sync="bass456")
    BA.add(v_sub(note("F1"), bn10, 0.6, tau=5.0), f0, gain_db=LV["sub"] - 3, label="sous-note F1 m10")
    pd = v_pad([note(x) for x in ("F3", "C4", "Eb4", "Ab4")], bn10, 1.0, attack=0.05, release=0.04, cutoff=np.geomspace(2400, 1100, wn), det=9, spread=1.0)
    TX.add(pd, f0, gain_db=LV["pad"] - 1, label="nappe d'accord m10", send={"hall": 0.12 + 0.4 * wcur})

    # ---------------------------------------------------------------- 504-527 : la raclette, seule
    fr_ = P.one("bruitage", "raclette")
    frn = (fr_["fin"] + 1 - fr_["debut"]) * SPF
    META["friction"] = (fr_["debut"], frn)

    # ---------------------------------------------------------------- 528-599 signature
    fl = P.one("reticule", "verrouillage final")
    fr0 = fl["image"]
    cue_attempt(R, fr0, "ret528", up=True, level_db=3.0, seed=528, pan_a=-0.05, pan_b=0.05)
    acc = P.one("bruitage", "second appui")["image"]
    cue_attempt(R, acc, "ret540", up=True, level_db=-3.5, seed=540, pan_a=0.08, pan_b=-0.08)
    ch_tail = (P.one("musique", "accord final")["fin"] + 1) * SPF - fr0 * SPF
    stab_env = lambda m, tau: (np.exp(-np.arange(m) / SR / tau) * sy.fade_in(m, 0.006, 0.01))
    m = int(2.2 * SR)
    cf = v_pad([note(x) for x in ("F3", "Ab3", "C4", "Eb4", "C5")], m / SR, 1.0, cutoff=2600.0, det=6, spread=0.8, env=stab_env(m, 0.55) * sy.fade_out(m, 0.3))
    TX.add(cf, fr0, gain_db=LV["pad"] + 3, label="accord de fa mineur (final)", sync="chord528", send={"hall": 0.45, "plate": 0.1})
    BA.add(v_sub(note("F1"), 2.6, 0.95, tau=0.9), fr0, gain_db=LV["sub"], label="sous-note F1 (final)", sync="sub528")
    BA.add(v_bass(note("F2"), 1.4, 0.7, c0=900, c1=300, rel=0.3, drive=1.9), fr0, gain_db=LV["bass"] - 3, label="basse F2 (final)", sync="bass528")
    cf2 = v_pad([note(x) for x in ("Ab3", "C4", "F4", "Eb5")], m / SR, 1.0, cutoff=2300.0, det=6, spread=0.8, env=stab_env(m, 0.45) * sy.fade_out(m, 0.3))
    TX.add(cf2, acc, gain_db=LV["pad"] - 2, label="second appui (accord)", sync="chord540", send={"hall": 0.45, "plate": 0.1})
    BA.add(v_sub(note("F1"), 1.2, 0.5, tau=0.6), acc, gain_db=LV["sub"] - 3, label="sous-note second appui", sync="sub540")
    tail = int((600 - 528 - 4) * SPF)
    gtail = rng("tailtape")
    tb = v_tape(tail, gtail) * (np.exp(-np.arange(tail) / SR / 1.0))[None, :]
    TX.add(tb, fr0, gain_db=LV["tape"] + 8, label="grain de bande (queue)")


# ==========================================================================
# Rendu, mixage, mesures
# ==========================================================================
def render():
    t0 = time.time()
    sy.EVENTS.clear()
    META.clear()
    rev = {"room": sy.Reverb(0.55, 0.008, 0.35, 1.0, 220.0, 0.8, "room"),
           "hall": sy.Reverb(2.6, 0.022, 0.40, 1.1, 260.0, 0.35, "hall"),
           "plate": sy.Reverb(1.3, 0.004, 0.85, 0.9, 400.0, 0.2, "plate")}
    names = ["rythme", "basse", "textures", "bruitages", "reticule"]
    stems = {k: sy.Stem(k, rev) for k in names}
    build(stems)
    print(f"[{time.time() - t0:5.1f}s] voix placees ({len(sy.EVENTS)} evenements)")

    out = {k: stems[k].render() for k in names}
    print(f"[{time.time() - t0:5.1f}s] reverbs rendues")

    # silences musicaux (partition) : 210-215 et 453-455 ; retrait 504-527 ; fin 596-599
    gates = []
    for e in P.ev:
        if e["piste"] == "musique" and e["nom"] == "silence":
            f0 = e["debut"]
            gates.append((f0 * SPF - int(0.008 * SR), f0 * SPF, (e["fin"] + 1) * SPF))
    ret = P.one("musique", "retrait")
    cut_a = ret["debut"] * SPF
    cut_c = (ret["fin"] + 1) * SPF
    fin_a, fin_b = 580 * SPF, 596 * SPF            # les 4 dernieres images (596-599) : silence absolu
    for k in names:
        out[k] *= db(TRIM[k])
        x = out[k]
        for a, b, c in gates:
            x[:, a:b] *= np.linspace(1, 0, b - a)[None, :]
            x[:, b:c] = 0.0
        d = int(0.050 * SR)                         # tout le reste disparait en ~50 ms a l'image 504
        x[:, cut_a:cut_a + d] *= np.linspace(1, 0, d)[None, :] ** 1.5
        x[:, cut_a + d:cut_c] = 0.0
        x[:, fin_a:fin_b] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fin_b - fin_a)))[None, :]
        x[:, fin_b:] = 0.0
    # raclette : seule, ajoutee APRES la coupe
    f_start, f_n = META["friction"]
    fric = v_friction(f_n)
    fr_stem = sy.Stem("bruitages_friction")
    fr_stem.add(fric, f_start, gain_db=-14, sync="fric504", label="raclette (frottement)")
    out["bruitages"] += fr_stem.dry
    # evenement de la raclette dans le registre sous le nom du stem bruitages
    sy.EVENTS[-1]["stem"] = "bruitages"
    print(f"[{time.time() - t0:5.1f}s] coupes et raclette")
    return out, rev, t0


def mix_and_write(out, t0):
    names = ["rythme", "basse", "textures", "bruitages", "reticule"]
    # gain de mix commun : -14 LUFS integres apres limiteur
    summ = sum(out[k] for k in names)
    g = 1.0
    for it in range(8):
        lim, gsm = sy.soft_limit(summ * g, -1.3)
        L = sy.lufs(lim)
        if abs(L + 14.0) < 0.05:
            break
        g *= 10 ** ((-14.0 - L) / 20.0)
    mixed = lim
    print(f"[{time.time() - t0:5.1f}s] gain {20 * np.log10(g):+.2f} dB, LUFS {L:.2f}, reduction max {20 * np.log10(gsm.min()):.2f} dB")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "stems").mkdir(exist_ok=True)
    sf.write(OUT / "maquette_v0.wav", mixed.T, SR, subtype="PCM_24")
    for k in names:
        sf.write(OUT / "stems" / f"{k}.wav", (out[k] * g).T, SR, subtype="PCM_24")
    return mixed, g, gsm


if __name__ == "__main__":
    out, rev, t0 = render()
    mixed, g, gsm = mix_and_write(out, t0)
    import rapport
    rapport.make(out, mixed, g, gsm, P, sy.EVENTS, META)
    print(f"[{time.time() - t0:5.1f}s] termine")
