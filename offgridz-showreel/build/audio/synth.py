"""OFFGRIDZ / INSOUMISE : boite a outils de synthese (numpy + scipy + soundfile).

Tout est deterministe (graines fixes), tout est place a l'echantillon pres.
Convention : un signal mono est un tableau (n,), un signal stereo est (2, n).
48 kHz, 30 images/s -> 1 image = 1600 echantillons.
"""
from __future__ import annotations

import zlib
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
FPS = 30
SPF = SR // FPS            # 1600 echantillons par image
DUR_S = 20
NS = DUR_S * SR            # 960 000
TWO_PI = 2.0 * np.pi


# --------------------------------------------------------------------------
# Utilitaires : temps, hauteurs, graines
# --------------------------------------------------------------------------
def rng(*keys) -> np.random.Generator:
    """Generateur deterministe a partir de n'importe quelle cle."""
    s = zlib.crc32("|".join(str(k) for k in keys).encode("utf-8"))
    return np.random.default_rng(s)


def frame_to_sample(frame: float) -> int:
    return int(round(frame * SPF))


def tt(n: int) -> np.ndarray:
    return np.arange(n) / SR


def db(x: float) -> float:
    return 10.0 ** (x / 20.0)


_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note(name: str) -> float:
    """'F2', 'Ab3', 'C#4' -> frequence en Hz (La4 = 440)."""
    pc = _PC[name[0]]
    i = 1
    while i < len(name) and name[i] in "b#":
        pc += -1 if name[i] == "b" else 1
        i += 1
    octave = int(name[i:])
    return 440.0 * 2.0 ** ((12 * (octave + 1) + pc - 69) / 12.0)


def cents(f, c):
    return f * 2.0 ** (c / 1200.0)


# --------------------------------------------------------------------------
# Enveloppes
# --------------------------------------------------------------------------
def env_exp(n: int, tau: float, floor: float = 0.0) -> np.ndarray:
    return np.exp(-tt(n) / tau) * (1 - floor) + floor * 0


def env_points(n: int, pts, curve: float = 1.0) -> np.ndarray:
    """Enveloppe lineaire par morceaux. pts = [(temps_s, valeur), ...]. curve>1 courbe en puissance."""
    t = tt(n)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    e = np.interp(t, xs, ys)
    if curve != 1.0:
        e = np.sign(e) * np.abs(e) ** curve
    return e


def fade_in(n: int, dur_s: float, floor: float = 1e-3, shape: str = "cos") -> np.ndarray:
    """Fondu d'entree. 'floor' garantit un premier echantillon non nul (attaque exacte)."""
    k = max(1, min(n, int(dur_s * SR)))
    r = np.linspace(0, 1, k, endpoint=False)
    c = 0.5 - 0.5 * np.cos(np.pi * r) if shape == "cos" else r
    e = np.ones(n)
    e[:k] = floor + (1 - floor) * c
    return e


def fade_out(n: int, dur_s: float, shape: str = "cos") -> np.ndarray:
    """Fondu de sortie qui atteint exactement 0 au dernier echantillon."""
    k = max(1, min(n, int(dur_s * SR)))
    r = np.linspace(1, 0, k)
    c = 0.5 - 0.5 * np.cos(np.pi * r) if shape == "cos" else r
    e = np.ones(n)
    e[n - k:] = c
    return e


def adsr(n: int, a: float, d: float, s: float, r: float, floor: float = 1e-3) -> np.ndarray:
    """ADSR exponentielle ; n = longueur totale (relachement inclus, termine a zero)."""
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, n - na - nd - nr)
    e = np.concatenate([
        floor + (1 - floor) * (np.linspace(0, 1, na, endpoint=False) if na else np.zeros(0)),
        s + (1 - s) * np.exp(-np.linspace(0, 6, nd)) if nd else np.zeros(0),
        np.full(ns, s),
        s * (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, nr))) if nr else np.zeros(0),
    ])
    if len(e) < n:
        e = np.concatenate([e, np.zeros(n - len(e))])
    return e[:n]


# --------------------------------------------------------------------------
# Oscillateurs
# --------------------------------------------------------------------------
def _freq_arr(f, n):
    f = np.asarray(f, dtype=float)
    return np.full(n, float(f)) if f.ndim == 0 else f[:n]


def phase(f, n: int, p0: float = 0.0) -> np.ndarray:
    """Phase en cycles (0..inf) pour une frequence constante ou variable."""
    fa = _freq_arr(f, n)
    return p0 + np.concatenate([[0.0], np.cumsum(fa[:-1])]) / SR


def sine(f, n: int, p0: float = 0.0) -> np.ndarray:
    return np.sin(TWO_PI * phase(f, n, p0))


def cosine(f, n: int, p0: float = 0.0) -> np.ndarray:
    return np.cos(TWO_PI * phase(f, n, p0))


def saw(f, n: int, p0: float = 0.0) -> np.ndarray:
    """Dent de scie PolyBLEP (peu d'aliasing)."""
    fa = _freq_arr(f, n)
    ph = phase(fa, n, p0) % 1.0
    dt = np.clip(fa / SR, 1e-6, 0.49)
    y = 2.0 * ph - 1.0
    t = ph / dt
    m1 = ph < dt
    m2 = ph > 1 - dt
    t2 = (ph - 1) / dt
    y = y - np.where(m1, t + t - t * t - 1.0, 0.0) - np.where(m2, t2 * t2 + t2 + t2 + 1.0, 0.0)
    return y


def square(f, n: int, pw: float = 0.5, p0: float = 0.0) -> np.ndarray:
    fa = _freq_arr(f, n)
    ph = phase(fa, n, p0) % 1.0
    dt = np.clip(fa / SR, 1e-6, 0.49)

    def blep(x):
        t = x / dt
        t2 = (x - 1) / dt
        return np.where(x < dt, t + t - t * t - 1.0, np.where(x > 1 - dt, t2 * t2 + t2 + t2 + 1.0, 0.0))

    y = np.where(ph < pw, 1.0, -1.0)
    y = y + blep(ph) - blep((ph - pw) % 1.0)
    return y


def tri(f, n: int, p0: float = 0.0) -> np.ndarray:
    ph = phase(f, n, p0) % 1.0
    return 4.0 * np.abs(ph - 0.5) - 1.0


def fm(fc, ratio: float, index, n: int, p0: float = 0.0) -> np.ndarray:
    """FM a 2 operateurs ; index scalaire ou tableau (enveloppe d'indice)."""
    fa = _freq_arr(fc, n)
    mod = np.sin(TWO_PI * phase(fa * ratio, n))
    return np.sin(TWO_PI * phase(fa, n, p0) + np.asarray(index) * mod)


def additive(f, partials, n: int):
    """partials = [(rapport, amplitude), ...]"""
    y = np.zeros(n)
    for r, a in partials:
        y += a * sine(_freq_arr(f, n) * r, n)
    return y


# --------------------------------------------------------------------------
# Bruits
# --------------------------------------------------------------------------
def white(n: int, g: np.random.Generator) -> np.ndarray:
    return g.standard_normal(n)


def pink(n: int, g: np.random.Generator) -> np.ndarray:
    """Bruit rose (Paul Kellet)."""
    w = g.standard_normal(n)
    b = np.array([0.99886, 0.0], dtype=float)
    # filtre 3 poles raffine de Kellet
    b0 = signal.lfilter([0.049922035, -0.095993537, 0.050612699, -0.004408786],
                        [1, -2.494956002, 2.017265875, -0.522189400], w)
    return b0 / (np.std(b0) + 1e-12)


def brown(n: int, g: np.random.Generator) -> np.ndarray:
    x = np.cumsum(g.standard_normal(n))
    x = signal.sosfilt(signal.butter(1, 20.0, "hp", fs=SR, output="sos"), x)
    return x / (np.std(x) + 1e-12)


def crackle(n: int, rate, g: np.random.Generator, decay_s: float = 0.0015, hp_hz: float = 1500.0) -> np.ndarray:
    """Craquements epars : impulsions de Poisson (rate en Hz, scalaire ou tableau), amplitudes irregulieres."""
    ra = _freq_arr(rate, n)
    hit = g.random(n) < ra / SR
    amp = np.where(hit, g.random(n) ** 2 * (g.random(n) * 2 - 1) * 2.0, 0.0)
    k = max(2, int(decay_s * 6 * SR))
    ker = np.exp(-np.arange(k) / (decay_s * SR)) * np.sign(np.sin(np.arange(k) * 0.9 + 0.3))
    y = signal.fftconvolve(amp, ker)[:n]
    return hp(y, hp_hz, 0.7)


# --------------------------------------------------------------------------
# Filtres bicarres (RBJ)
# --------------------------------------------------------------------------
def rbj(kind: str, f: float, q: float = 0.7071, gain_db: float = 0.0) -> np.ndarray:
    f = float(np.clip(f, 15.0, 0.46 * SR))
    w0 = TWO_PI * f / SR
    c, s = np.cos(w0), np.sin(w0)
    al = s / (2.0 * q)
    A = 10 ** (gain_db / 40.0)
    if kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + al, -2 * c, 1 - al]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + al, -2 * c, 1 - al]
    elif kind == "bp":
        b = [al, 0.0, -al]; a = [1 + al, -2 * c, 1 - al]
    elif kind == "notch":
        b = [1.0, -2 * c, 1.0]; a = [1 + al, -2 * c, 1 - al]
    elif kind == "peak":
        b = [1 + al * A, -2 * c, 1 - al * A]; a = [1 + al / A, -2 * c, 1 - al / A]
    elif kind == "lowshelf":
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
        a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
    elif kind == "highshelf":
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
        a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
    else:
        raise ValueError(kind)
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]]])


def filt(x: np.ndarray, sos: np.ndarray) -> np.ndarray:
    return signal.sosfilt(sos, x, axis=-1)


def lp(x, f, q=0.7071, order=1):
    for _ in range(order):
        x = filt(x, rbj("lp", f, q))
    return x


def hp(x, f, q=0.7071, order=1):
    for _ in range(order):
        x = filt(x, rbj("hp", f, q))
    return x


def bp(x, f, q=1.0):
    return filt(x, rbj("bp", f, q))


def notch(x, f, q=2.0):
    return filt(x, rbj("notch", f, q))


def peak_eq(x, f, q, gain_db):
    return filt(x, rbj("peak", f, q, gain_db))


def shelf(x, f, gain_db, high=True, q=0.7071):
    return filt(x, rbj("highshelf" if high else "lowshelf", f, q, gain_db))


def sweep(x: np.ndarray, fcurve, q: float = 1.0, kind: str = "lp", chunk: int = 96, q_curve=None) -> np.ndarray:
    """Filtre a frequence variable (par blocs, etat conserve). fcurve : tableau Hz de meme longueur que x (mono)."""
    n = len(x)
    fc = _freq_arr(fcurve, n)
    y = np.empty(n)
    zi = np.zeros((1, 2))
    for i in range(0, n, chunk):
        j = min(n, i + chunk)
        qq = q if q_curve is None else float(q_curve[min(n - 1, (i + j) // 2)])
        sos = rbj(kind, fc[(i + j) // 2 if j > i else i], qq)
        y[i:j], zi = signal.sosfilt(sos, x[i:j], zi=zi)
    return y


def sweep_st(x: np.ndarray, fcurve, **kw) -> np.ndarray:
    """sweep() applique a un signal stereo (2, n) ou mono."""
    if x.ndim == 1:
        return sweep(x, fcurve, **kw)
    return np.stack([sweep(x[0], fcurve, **kw), sweep(x[1], fcurve, **kw)])


# --------------------------------------------------------------------------
# Distorsion / effets simples
# --------------------------------------------------------------------------
def softclip(x, drive: float = 1.0):
    return np.tanh(drive * x) / np.tanh(drive)


def asym_sat(x, drive=1.0, bias=0.15):
    """Saturation asymetrique (harmoniques paires, utile pour que la basse passe sur un petit haut-parleur)."""
    y = np.tanh(drive * (x + bias)) - np.tanh(drive * bias)
    return y / (np.tanh(drive * (1 + bias)) - np.tanh(drive * bias) + 1e-9)


def bitcrush(x, bits: int = 6, hold: int = 1):
    y = np.round(x * (2 ** (bits - 1))) / (2 ** (bits - 1))
    if hold > 1:
        y = np.repeat(y[::hold], hold)[: len(x)]
    return y


def delay_taps(x: np.ndarray, time_samples: int, feedback: float = 0.4, taps: int = 6,
               damp_hz: float = 5000.0, pingpong: bool = True) -> np.ndarray:
    """Echo stereo a repetitions finies. x mono -> (2, n) (ne contient QUE les repetitions)."""
    n = len(x)
    out = np.zeros((2, n))
    y = x.copy()
    for k in range(1, taps + 1):
        y = lp(y, damp_hz, 0.7071)
        off = k * time_samples
        if off >= n:
            break
        ch = (k % 2) if pingpong else 0
        out[ch, off:] += (feedback ** k) * y[: n - off]
        if not pingpong:
            out[1, off:] += (feedback ** k) * y[: n - off]
    return out


# --------------------------------------------------------------------------
# Stereo
# --------------------------------------------------------------------------
def pan(x: np.ndarray, p: float = 0.0) -> np.ndarray:
    """Panoramique a puissance constante, p dans [-1, 1]. Mono -> stereo."""
    if x.ndim == 2:
        return x
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def haas(x: np.ndarray, ms: float = 0.5, side: int = 1) -> np.ndarray:
    """Elargissement par retard de quelques dixiemes de ms (mono -> stereo)."""
    d = int(ms * 1e-3 * SR)
    y = np.concatenate([np.zeros(d), x])[: len(x)]
    return np.stack([x, y]) if side else np.stack([y, x])


def widen(x: np.ndarray, amount: float = 1.0) -> np.ndarray:
    m = 0.5 * (x[0] + x[1])
    s = 0.5 * (x[0] - x[1]) * amount
    return np.stack([m + s, m - s])


def decorrelated_noise(n: int, g: np.random.Generator) -> np.ndarray:
    return np.stack([g.standard_normal(n), g.standard_normal(n)])


# --------------------------------------------------------------------------
# Synthese modale (verre, metal, bois)
# --------------------------------------------------------------------------
def modal(freqs, t60s, amps, n: int, phases=None, strike_ms: float = 0.0) -> np.ndarray:
    """Somme de sinusoides amorties (T60 en secondes). Attaque : cosinus -> premier echantillon non nul."""
    t = tt(n)
    y = np.zeros(n)
    for i, (f, T, a) in enumerate(zip(freqs, t60s, amps)):
        if f >= 0.49 * SR:
            continue
        ph = 0.0 if phases is None else phases[i]
        y += a * np.cos(TWO_PI * f * t + ph) * np.exp(-6.908 * t / T)
    return y


# --------------------------------------------------------------------------
# Grains et bulles
# --------------------------------------------------------------------------
def grain_cloud(n: int, density, g: np.random.Generator, bands, gmin_ms=1.5, gmax_ms=9.0,
                level_fn=None, pan_spread: float = 1.0, stereo: bool = True) -> np.ndarray:
    """Nuage de grains de bruit. density : grains/s (tableau de longueur n ou fonction du temps).
    bands : liste de (f_bas, f_haut) : on filtre un long bruit une fois par bande puis on y decoupe des grains fenetres.
    Retourne (2, n)."""
    dens = _freq_arr(density, n)
    # tirage de Poisson inhomogene : un grain par echantillon avec proba dens/SR
    hits = np.nonzero(g.random(n) < dens / SR)[0]
    streams = []
    for lo, hi in bands:
        w = g.standard_normal(n + 4096)
        w = hp(w, lo, 0.7071)
        w = lp(w, hi, 0.7071)
        streams.append(w / (np.std(w) + 1e-12))
    out = np.zeros((2, n + 1024))
    for h in hits:
        L = int(g.uniform(gmin_ms, gmax_ms) * 1e-3 * SR)
        s = streams[g.integers(len(streams))]
        o = g.integers(0, len(s) - L)
        seg = s[o:o + L] * np.hanning(L + 2)[1:-1]
        a = (g.random() ** 1.5) * (1.0 if level_fn is None else level_fn(h))
        if stereo:
            p = g.uniform(-1, 1) * pan_spread
            ang = (p + 1) * np.pi / 4
            out[0, h:h + L] += seg * a * np.cos(ang)
            out[1, h:h + L] += seg * a * np.sin(ang)
        else:
            out[0, h:h + L] += seg * a
            out[1, h:h + L] += seg * a
    return out[:, :n]


def bubble(f0: float, tau: float, rise: float, amp: float, n: int) -> np.ndarray:
    """Une bulle (Minnaert) : sinusoide amortie dont la hauteur monte vite. n echantillons."""
    t = tt(n)
    f = f0 * (1.0 + rise * (1.0 - np.exp(-t / (0.6 * tau))))
    y = np.sin(TWO_PI * phase(f, n)) * np.exp(-t / tau)
    a = np.minimum(1.0, t / 0.0006)             # attaque 0,6 ms
    return amp * y * a


def bubbles(n: int, rate, g: np.random.Generator, fmin=500.0, fmax=3500.0, tau_range=(0.008, 0.028),
            rise=(0.35, 0.9), f_bias=None) -> np.ndarray:
    """Pluie de bulles. rate : bulles/s (tableau). Retourne (2, n)."""
    ra = _freq_arr(rate, n)
    hits = np.nonzero(g.random(n) < ra / SR)[0]
    out = np.zeros((2, n + 10000))
    for h in hits:
        u = g.random()
        f0 = np.exp(np.log(fmin) + (np.log(fmax) - np.log(fmin)) * (u ** (1.6 if f_bias is None else f_bias)))
        tau = g.uniform(*tau_range) * (1.5 if f0 < 900 else 1.0)
        L = int(min(0.18 * SR, tau * 7 * SR))
        b = bubble(f0, tau, g.uniform(*rise), g.uniform(0.15, 1.0) ** 1.5, L)
        p = g.uniform(-0.9, 0.9)
        ang = (p + 1) * np.pi / 4
        out[0, h:h + L] += b * np.cos(ang)
        out[1, h:h + L] += b * np.sin(ang)
    return out[:, :n]


# --------------------------------------------------------------------------
# Reverberation (reponse impulsionnelle synthetique + convolution FFT)
# --------------------------------------------------------------------------
class Reverb:
    """Reverb stereo : reflexions precoces + queue de bruit decorrelee, decroissance dependante de la frequence."""

    def __init__(self, rt60=1.6, predelay=0.012, hf_ratio=0.45, lf_ratio=1.1, lowcut=180.0,
                 early=0.6, seed="rev", highcut=None):
        g = rng("reverb", seed)
        n = int((rt60 * 1.15 + predelay) * SR)
        t = tt(n)
        late = np.zeros((2, n))
        for ch in range(2):
            w = g.standard_normal(n)
            lo = lp(w, 450.0, 0.7071)
            hi = hp(w, 3500.0, 0.7071)
            mid = w - lo - hi
            e = lambda r: np.exp(-6.908 * t / (rt60 * r))
            late[ch] = lo * e(lf_ratio) + mid * e(1.0) + hi * e(hf_ratio) * 0.8
        build = 1.0 - np.exp(-t / 0.018)
        late *= build
        late[:, : int(predelay * SR)] = 0
        # shift pour le retard initial
        pd = int(predelay * SR)
        late = np.concatenate([np.zeros((2, pd)), late[:, : n - pd]], axis=1)
        # reflexions precoces
        er = np.zeros((2, n))
        for k in range(14):
            d = int((predelay + g.uniform(0.004, 0.055)) * SR)
            a = (0.5 ** (1 + k / 5)) * g.uniform(0.5, 1.0) * early
            ch = g.integers(2)
            if d < n:
                er[ch, d] += a * (1 if g.random() < 0.5 else -1)
                er[1 - ch, min(n - 1, d + int(g.uniform(10, 80)))] += a * 0.6
        ir = late / (np.sqrt(np.sum(late ** 2, axis=1, keepdims=True)) + 1e-12) + er * 0.25
        ir = hp(ir, lowcut, 0.7071)                 # on garde le grave propre
        if highcut:
            ir = lp(ir, highcut, 0.7071)
        self.ir = ir / (np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True)) + 1e-12) * 0.35
        self.rt60 = rt60

    def process(self, x: np.ndarray) -> np.ndarray:
        """x (2, n) -> (2, n) uniquement la partie humide (tronquee a n)."""
        n = x.shape[1]
        if not np.any(x):
            return np.zeros_like(x)
        # un seul FFT par canal : L*irL, R*irR (decorrelation naturelle)
        out = np.stack([signal.fftconvolve(x[0], self.ir[0])[:n],
                        signal.fftconvolve(x[1], self.ir[1])[:n]])
        return out


# --------------------------------------------------------------------------
# Placement a l'echantillon + pistes (stems)
# --------------------------------------------------------------------------
EVENTS: list[dict] = []     # registre global des evenements places (pour le rapport de synchronisation)


class Stem:
    def __init__(self, name: str, reverbs: dict | None = None):
        self.name = name
        self.dry = np.zeros((2, NS))
        self.sends = {}
        self.reverbs = reverbs or {}

    def add(self, sig, frame=None, *, at=None, off=0, end_at=None, pan_pos=0.0, gain=1.0, gain_db=None,
            send=None, label="", sync=None, expect=None):
        """Place `sig` (mono ou stereo).
        - frame : image de depart (peut etre un demi-entier) ; at : echantillon absolu ; off : decalage en echantillons.
        - end_at : le signal se TERMINE a cet echantillon (exclu) -> pour les sons qui menent vers une image.
        - send : {'room': 0.2, 'hall': tableau...} niveaux d'envoi (scalaire ou tableau de la longueur du signal).
        - sync : identifiant pour la table de synchronisation ; expect : echantillon attendu (frame*1600), pour le rapport.
        """
        if gain_db is not None:
            gain = db(gain_db)
        s2 = pan(np.asarray(sig, dtype=float), pan_pos) * gain
        n = s2.shape[1]
        if end_at is not None:
            start = int(end_at) - n
        elif at is not None:
            start = int(at) + off
        else:
            start = frame_to_sample(frame) + off
        a, b = max(0, start), min(NS, start + n)
        if b > a:
            seg = s2[:, a - start:b - start]
            self.dry[:, a:b] += seg
            if send:
                for k, amt in send.items():
                    if k not in self.sends:
                        self.sends[k] = np.zeros((2, NS))
                    amt_arr = amt[a - start:b - start] if np.ndim(amt) else amt
                    self.sends[k][:, a:b] += seg * amt_arr
        mag = np.max(np.abs(s2), axis=0)
        nz = np.nonzero(mag > 1e-12)[0]
        first = start + int(nz[0]) if len(nz) else start
        last = start + int(nz[-1]) + 1 if len(nz) else start
        EVENTS.append(dict(stem=self.name, label=label, sync=sync, start=start, first_nz=first, end=last, stop=start + n,
                           length=n, expect=expect))

    def apply_gate(self, regions):
        """regions : liste de (echantillon_debut_fondu, echantillon_fin_fondu_debut, echantillon_fin_silence).
        Silence numerique entre a et c ; fondu court de a vers b."""
        for a, b, c in regions:
            for buf in [self.dry] + list(self.sends.values()):
                if b > a:
                    buf[:, a:b] *= np.linspace(1, 0, b - a)[None, :]
                buf[:, b:c] = 0.0

    def region_gain(self, a: int, b: int, curve: np.ndarray):
        for buf in [self.dry] + list(self.sends.values()):
            buf[:, a:b] *= curve[None, :]

    def render(self) -> np.ndarray:
        out = self.dry.copy()
        for k, buf in self.sends.items():
            if k in self.reverbs:
                out += self.reverbs[k].process(buf)
        return out


# --------------------------------------------------------------------------
# Bus, limiteur, mesures
# --------------------------------------------------------------------------
def soft_limit(x: np.ndarray, ceiling_db: float = -1.3, look_ms: float = 4.0, osr: int = 4):
    """Limiteur anticipe, sensible aux crêtes inter-échantillons (sur-échantillonné x4).
    Le gain est lisse (fenêtre rectangulaire apres un filtre minimum) : jamais au-dessus de ce qui est necessaire."""
    ceil = db(ceiling_db)
    up = signal.resample_poly(x, osr, 1, axis=-1)
    pk = np.max(np.abs(up), axis=0)
    pk = pk[: x.shape[1] * osr].reshape(-1, osr).max(axis=1) if len(pk) >= x.shape[1] * osr else np.pad(pk, (0, x.shape[1] * osr - len(pk))).reshape(-1, osr).max(axis=1)
    gr = np.minimum(1.0, ceil / (pk + 1e-12))
    L = int(look_ms * 1e-3 * SR)
    gmin = minimum_filter1d(gr, size=2 * L + 1, mode="nearest")
    gsm = uniform_filter1d(gmin, size=2 * L + 1, mode="nearest")
    return x * gsm[None, :], gsm


def true_peak_db(x: np.ndarray, osr: int = 4) -> float:
    up = signal.resample_poly(x, osr, 1, axis=-1)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def lufs(x: np.ndarray) -> float:
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    return float(meter.integrated_loudness(x.T))


def rms_db(x: np.ndarray) -> float:
    return 10 * np.log10(np.mean(x ** 2) + 1e-20)
