"""OFFGRIDZ / INSOUMISE : bande-son finale v1 (20 s, 48 kHz, stéréo, 24 bits).

Une seule commande reconstruit tout, y compris le rapport de mesures :

    OMP_NUM_THREADS=2 /opt/og/venv/bin/python build/audio/final.py

Le temps vient de timeline/partition.json (grille musicale) ; les bruitages de matière viennent des simulations
du film, relues à chaque exécution (rien n'est copié ici) :

- cache/mojito/chutes.npz           : chaque choc des corps rigides (temps physique, corps, saut de vitesse) ;
- cache/mojito/versement_r128/      : fenêtre du versement (reglages.json) et maillage du liquide par image ;
- out/grains/dalle/ (et /filet/)    : activité des grains, grains qui tombent dans le verre (exits.npz) ;
- out/seq4/stats/                   : statistiques des points (mesures 8 et 9) ;
- out/final/seq56/meta.json, squeegee.json : débordement, encre, raclette.

Tout est synthétisé (numpy/scipy). Les voix de la maquette v0 (maquette.py) sont réutilisées quand elles sont bonnes.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import map_coordinates, uniform_filter1d

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "build" / "mojito"))
sys.path.insert(0, str(ROOT / "build" / "grains"))

import synth as sy                                  # noqa: E402
import maquette as M                                # noqa: E402  (voix de la v0 ; rien n'est rendu à l'import)
import temps as TMJ                                 # noqa: E402  (horloge du mojito : image(t), tau(f), vitesse(f))
import monde as GM                                  # noqa: E402  (horloge des grains : image_de(t))
from synth import SR, SPF, NS, db, note, rng, tt     # noqa: E402

P = M.P
OUT = ROOT / "out" / "audio"
V1 = OUT / "v1"
TWO_PI = sy.TWO_PI
nz = M.nz

# ==========================================================================
# Registre des événements (evenements.json) et placement
# ==========================================================================
LOG: list[dict] = []
CONT_NAMES = ("grains secs", "corps de l'avalanche", "grains accordés", "versement :", "scintillement", "souffle de caméra",
              "souffle de la montée", "aspiration", "nappe de bruit large", "déferlement :", "encre :")
SRC: dict = {}          # description des jeux de données effectivement utilisés (rapport)


def put(stem, sig, sample, name, source, *, frame=None, expect=None, family="sfx", continuous=False, **kw):
    """Place `sig` à l'échantillon `sample` et l'inscrit dans le registre.
    continuous : couche continue pilotée par des données (le premier échantillon utile dépend de la densité mesurée)."""
    sample = int(sample)
    sig = np.asarray(sig, dtype=float)
    continuous = continuous or name.startswith(CONT_NAMES)
    if not continuous and np.all(sig[..., 0] == 0.0):
        sig = nz(sig)
    stem.add(sig, at=sample, label=name, sync=source, **kw)
    e = sy.EVENTS[-1]
    LOG.append(dict(name=name, source=source, frame=float(sample / SPF if frame is None else frame),
                    expected=int(sample if expect is None else expect), sample=int(e["first_nz"]), stem=stem.name,
                    family=family, continuous=continuous))


def log_only(name, source, sample, expected, stem, family):
    LOG.append(dict(name=name, source=source, frame=float(sample / SPF), expected=int(expected), sample=int(sample),
                    stem=stem, family=family, continuous=False))


def fr2s(f):
    return int(round(float(f) * SPF))


# ==========================================================================
# Lecture des données de simulation (relues à chaque exécution)
# ==========================================================================
def _interp_nan(a):
    a = np.array(a, dtype=float)
    ok = np.isfinite(a)
    if ok.sum() == 0:
        return None
    x = np.arange(len(a))
    return np.interp(x, x[ok], a[ok])


def load_chocs():
    p = ROOT / "cache" / "mojito" / "chutes.npz"
    d = np.load(p, allow_pickle=True)
    plan = json.loads(str(d["plan"]))
    chocs = np.array(d["chocs"], dtype=float)
    t = np.array(d["t"], dtype=float)
    loc = np.array(d["loc"], dtype=float)
    ev = []
    first_seen = set()
    snaps = []
    for k, (tp, b, dv) in enumerate(chocs):
        b = int(b)
        f_sim = float(TMJ.image(float(tp)))
        f_use, snapped = f_sim, False
        if b not in first_seen:
            first_seen.add(b)
            f_plan = float(plan[b]["image"])
            # premier choc : calibré sur la grille musicale (tolérance de calibration : une demi-image)
            if abs(f_sim - f_plan) <= 0.5:
                f_use, snapped = f_plan, True
            snaps.append(dict(corps=b, genre=plan[b]["genre"], plan=f_plan, sim=f_sim, ecart_echantillons=int(round((f_sim - f_plan) * SPF)),
                              recale=snapped))
        x = float(np.interp(tp, t, loc[:, b, 0])) if len(t) else 0.0
        ev.append(dict(k=k, t=float(tp), corps=b, genre=plan[b]["genre"], dv=float(dv), f_sim=f_sim, frame=f_use,
                       sample=fr2s(f_use), x=x))
    SRC["chocs"] = dict(fichier=str(p.relative_to(ROOT)), n=len(ev), premiers=snaps)
    return ev, plan


def load_pour():
    d = json.loads((ROOT / "cache" / "mojito" / "versement_r128" / "reglages.json").read_text())
    f_on, f_off = int(d["f_on"]), int(d["f_off"])
    counts = {}
    zmed = {}
    zmin = {}
    for f in range(f_on - 3, 335):
        p = ROOT / "cache" / "mojito" / "versement_r128" / f"f{f:04d}.npz"
        if not p.exists():
            continue
        try:
            v = np.load(p)["v"]
        except Exception:
            continue
        counts[f] = len(v)
        if len(v):
            zmin[f] = float(v[:, 2].min())
            zmed[f] = float(np.median(v[:, 2]))
    d["counts"], d["zmin"], d["zmed"] = counts, zmin, zmed
    # contact de la tête du filet avec les glaçons : première image dont le maillage descend jusqu'à la glace
    zg = float(d.get("z_glace", 0.13))
    touch = None
    for f in sorted(zmin):
        if zmin[f] <= zg:
            touch = f
            break
    d["f_touch"] = touch if touch is not None else 264
    d["f_touch_source"] = "maillage (z min <= z_glace)" if touch is not None else "défaut 264 (maillage absent)"
    SRC["versement"] = dict(f_on=f_on, f_off=f_off, f_touch=d["f_touch"], source_touch=d["f_touch_source"], images_maillage=len(counts))
    return d


def load_grains():
    """Activité des grains par image (72 à 223) : grains en mouvement, vitesse moyenne, énergie cinétique."""
    frames = np.arange(72, 232)
    n_mov = np.full(len(frames), np.nan)
    mean_v = np.full(len(frames), np.nan)
    kin = np.full(len(frames), np.nan)
    got = 0
    resume = ROOT / "out" / "grains" / "dalle" / "activite.json"
    if resume.exists():
        # Simulation finale : ses images (un million de grains) restent sur la machine de calcul ; elle écrit elle-même,
        # image par image, le nombre de grains en mouvement (v > 2 cm/s), leur vitesse moyenne et la somme des v².
        act = json.load(open(resume))["images"]
        for i, f in enumerate(frames):
            if str(f) in act:
                n_mov[i], mean_v[i], kin[i] = act[str(f)]
                got += 1
        SRC["grains_activite"] = "out/grains/dalle/activite.json (résumé écrit par la simulation finale)"
    else:
        for i, f in enumerate(frames):
            p = ROOT / "out" / "grains" / "dalle" / f"f{f:04d}.npz"
            if not p.exists():
                continue
            try:
                z = np.load(p)
                v = np.linalg.norm(z["vel"].astype(np.float32), axis=1)
            except Exception:
                continue
            mov = v > 0.02
            n_mov[i] = mov.sum()
            mean_v[i] = float(v[mov].mean()) if mov.any() else 0.0
            kin[i] = float((v[mov] ** 2).sum())
            got += 1
    out = dict(frames=frames, got=got)
    for k, a in (("n_mov", n_mov), ("mean_v", mean_v), ("kin", kin)):
        out[k] = _interp_nan(a)
    # filet : si des images existent, elles prennent le relais pour les grains en chute (n_free)
    filet = np.full(len(frames), np.nan)
    gf = 0
    for i, f in enumerate(frames):
        p = ROOT / "out" / "grains" / "filet" / f"f{f:04d}.npz"
        if p.exists():
            try:
                filet[i] = float(np.load(p)["n_free"])
                gf += 1
            except Exception:
                pass
    out["filet_n"] = _interp_nan(filet)
    out["filet_got"] = gf
    # grains qui tombent dans le verre : sorties par le bec + vol libre (même calcul que build/grains/sim.py, Filet.build)
    land = None
    p = ROOT / "out" / "grains" / "dalle" / "exits.npz"
    if p.exists():
        try:
            Z = np.load(p)
            ok = ((Z["cause"] == 1) & (np.abs(Z["pos"][:, 0]) < GM.BEC_DEMI + 0.004) & (Z["pos"][:, 1] > GM.SOL_BORD - 0.004)
                  & (Z["pos"][:, 1] < GM.BEC_Y + 0.004) & (Z["t"] >= 0))
            pos = Z["pos"][ok].astype(float)
            vel = Z["vel"][ok].astype(float)
            te = Z["t"][ok].astype(float)
            zl = -GM.DENIVELE + 0.03
            tl = (vel[:, 2] + np.sqrt(vel[:, 2] ** 2 + 2 * 9.81 * (pos[:, 2] - zl))) / 9.81
            fl = np.array([GM.image_de(float(a + b)) for a, b in zip(te, tl)])
            vland = np.sqrt((vel[:, 2] - 9.81 * tl) ** 2 + vel[:, 0] ** 2 + vel[:, 1] ** 2)
            xl = pos[:, 0] + vel[:, 0] * tl
            land = dict(frame=fl, v=vland, x=xl - np.median(xl))
        except Exception as ex:                       # cache en cours de régénération
            SRC["grains_exits_erreur"] = str(ex)
    out["land"] = land
    out["land_source"] = "exits.npz (sorties du bec + chute libre)" if land is not None else None
    # grains qui arrivent au fond du verre, lus dans la simulation « filet » quand elle existe (images 128+)
    try:
        zc = -GM.DENIVELE + 0.025
        prev = None
        fl2, vl2, xl2 = [], [], []
        got_f = 0
        for f in range(128, 240):
            p = ROOT / "out" / "grains" / "filet" / f"f{f:04d}.npz"
            if not p.exists():
                prev = None
                continue
            z = np.load(p)
            ids = z["id"]
            cur = dict(id=ids, z=z["pos"][:, 2].astype(float), x=z["pos"][:, 0].astype(float), v=z["vel"].astype(float))
            got_f += 1
            if prev is not None:
                _, ia, ib = np.intersect1d(prev["id"], cur["id"], assume_unique=True, return_indices=True)
                z0, z1 = prev["z"][ia], cur["z"][ib]
                hit = (z0 > zc) & (z1 <= zc)
                for j in np.nonzero(hit)[0]:
                    fr = (f - 1) + (z0[j] - zc) / max(1e-9, (z0[j] - z1[j]))
                    fl2.append(fr)
                    vl2.append(float(np.linalg.norm(cur["v"][ib[j]])))
                    xl2.append(float(cur["x"][ib[j]]))
            prev = cur
        if got_f >= 40 and len(fl2) > 50:
            xl2 = np.array(xl2)
            out["land"] = dict(frame=np.array(fl2), v=np.array(vl2), x=xl2 - np.median(xl2))
            out["land_source"] = "out/grains/filet/f####.npz (grains qui passent sous le fond du verre entre deux images, temps interpolé)"
    except Exception as ex:
        SRC["grains_filet_erreur"] = str(ex)
    land = out["land"]
    SRC["grains"] = dict(images_dalle=got, images_filet=gf, atterrissages=(0 if land is None else int(len(land["frame"]))), source_atterrissages=out["land_source"])
    return out


def load_points():
    fr = np.arange(360, 456)
    mean = np.full(len(fr), np.nan)
    p999 = np.full(len(fr), np.nan)
    strip = np.full(len(fr), np.nan)
    vis = np.full(len(fr), np.nan)
    got = 0
    for i, f in enumerate(fr):
        p = ROOT / "out" / "seq4" / "stats" / f"f{f:04d}.json"
        if p.exists():
            try:
                j = json.loads(p.read_text())
                mean[i], p999[i], strip[i], vis[i] = j["mean"], j["p999"], j["strip_all"], j["visible"]
                got += 1
            except Exception:
                pass
    SRC["points"] = dict(images=got)
    return dict(frames=fr, mean=_interp_nan(mean), p999=_interp_nan(p999), strip=_interp_nan(strip), vis=_interp_nan(vis), got=got)


def load_final56():
    n = {}
    p = ROOT / "out" / "final" / "seq56" / "meta.json"
    if p.exists():
        try:
            for k, v in json.loads(p.read_text())["images"].items():
                if "n" in v:
                    n[int(k)] = float(v["n"])
        except Exception:
            pass
    sq = {}
    p = ROOT / "out" / "final" / "seq56" / "squeegee.json"
    if p.exists():
        try:
            for k, v in json.loads(p.read_text()).items():
                sq[int(k)] = v
        except Exception:
            pass
    SRC["seq56"] = dict(images_n=len(n), images_raclette=len(sq))
    return dict(n=n, sq=sq)


# ==========================================================================
# Voix nouvelles
# ==========================================================================
ICE_BASE = [2300.0 * (5400.0 / 2300.0) ** (p / 7.0) for p in (3, 0, 5, 2, 7, 1, 6, 4)]    # huit hauteurs de base espacées de plus d'un quart d'octave
ICE_RATIO_JIT = [1.0, 1.035, 0.97, 1.05, 0.985, 1.06, 0.96, 1.02]                          # rapports inharmoniques propres à chaque glaçon
RATIOS_ICE = np.array([1.0, 2.32, 4.25, 6.63, 9.38])


def _pan_x(x, spread=0.7):
    return float(np.clip(x / 0.03 * spread, -0.85, 0.85))


def v_hit_lime(v, seed, wheel=False):
    """Citron : mou. Choc sourd, un peu de jus, presque pas de verre."""
    g = rng("hitlime", seed)
    n = int(0.16 * SR)
    t = tt(n)
    vv = min(v, 2.5)
    a = min(1.0, v / 1.8) ** 0.8
    f0 = (205 if wheel else 150) + 35 * vv / 2.5
    body = np.sin(TWO_PI * sy.phase(f0 * (1 + 0.5 * np.exp(-t / 0.008)), n) + 0.6) * np.exp(-t / (0.022 if not wheel else 0.016))
    sq = sy.bp(g.standard_normal(n), 800 + 900 * vv / 2.5, 1.2) * np.exp(-t / 0.013)
    sq += 0.5 * sy.hp(g.standard_normal(n), 2600.0) * np.exp(-t / 0.004) * min(1.0, vv / 1.6)
    glass = sy.modal([2150.0, 3260.0], [0.05, 0.03], [0.5, 0.3], n) * min(1.0, vv / 2.0) ** 1.5 * 0.35
    y = (0.75 * body + 0.9 * sq + glass) * sy.fade_out(n, 0.04)
    return nz(a * y * 0.55)


def v_hit_leaf(v, seed):
    """Feuille de menthe : presque rien, un froissement mat très bref."""
    g = rng("hitleaf", seed)
    n = int(0.06 * SR)
    t = tt(n)
    a = min(1.0, v / 1.2) ** 0.8
    w = sy.hp(g.standard_normal(n), 1400.0)
    w = sy.lp(w, 2400 + 1500 * min(v, 1.5))
    y = w * np.exp(-t / 0.006) + 0.35 * np.sin(TWO_PI * (330 + 120 * v) * t) * np.exp(-t / 0.008)
    return nz(a * y * sy.fade_out(n, 0.012) * 0.33)


def v_hit_ice(v, body, k, seed):
    """Glaçon sur verre ou sur glaçon : tintement modal. Hauteur = corps + vitesse, éclat et durée = saut de vitesse."""
    g = rng("hitice", seed)
    n = int(0.55 * SR)
    t = tt(n)
    vv = min(v, 4.2)
    j = (body - 10) % len(ICE_BASE)
    fb = ICE_BASE[j] * (1 + 0.011 * np.sin(k * 1.9 + body)) * (1 + 0.035 * min(vv, 3.0) / 3.0)
    bright = 0.30 + 0.70 * min(1.0, vv / 2.2)
    amps = np.array([1.0, 0.7, 0.45, 0.28, 0.14]) * bright ** (0.5 * np.arange(5))
    dur = 0.16 + 0.36 * min(1.0, vv / 2.0)
    t60 = np.array([0.42, 0.26, 0.15, 0.09, 0.05]) * (dur / 0.4) * (1.0 - 0.15 * j / 8)
    rj = np.array([1.0] + [ICE_RATIO_JIT[j] ** (1 + 0.5 * i) for i in range(1, 5)])
    y = sy.modal(fb * RATIOS_ICE * rj * (1 + 0.002 * g.standard_normal(5)), t60, amps, n, phases=[0.3, 1.2, 2.0, 0.7, 1.7])
    y += sy.hp(g.standard_normal(n), 2600.0 + 900 * bright) * np.exp(-t / 0.0007) * (0.35 + 0.5 * bright)
    a = min(1.0, vv / 2.0) ** 0.75
    return nz(a * y * sy.fade_out(n, 0.18) * 0.34)


def straw_f1():
    """Fondamentale de flexion d'un tube d'acier libre-libre : f1 = 22,4/(2 pi L^2) * k * sqrt(E/rho), k = r/sqrt(2)."""
    L, r = 0.215, 0.0031
    try:
        j = json.loads((ROOT / "cache" / "mojito" / "plantes.json").read_text())["paille"]
        L, r = float(j["longueur"]), float(j["rayon"])
    except Exception:
        pass
    k = r / np.sqrt(2.0)
    return 22.4 / (TWO_PI * L ** 2) * k * np.sqrt(200e9 / 7850.0)


def v_hit_straw(v, seed, f1):
    """Paille d'acier sur verre : modes de barre libre-libre (1 ; 2,76 ; 5,40 ; 8,93 ; 13,34), longue résonance, claquement du verre."""
    g = rng("hitstraw", seed)
    n = int(1.4 * SR)
    t = tt(n)
    vv = min(v, 2.5)
    bright = 0.35 + 0.65 * min(1.0, vv / 1.8)
    r = np.array([1.0, 2.756, 5.404, 8.933, 13.34])
    fr = f1 * r * (1 + 0.003 * g.standard_normal(5))
    amps = np.array([1.0, 0.75, 0.5, 0.32, 0.2]) * bright ** (0.6 * np.arange(5))
    t60 = np.array([1.1, 0.7, 0.4, 0.22, 0.12])
    y = sy.modal(fr, t60, amps, n, phases=[0.2, 1.0, 2.1, 0.5, 1.4])
    glass = sy.modal([2250.0, 3480.0, 5120.0], [0.06, 0.04, 0.03], [0.6, 0.4, 0.25], n) * min(1.0, vv / 1.6)
    click = sy.hp(g.standard_normal(n), 3200.0) * np.exp(-t / 0.0009) * 0.6 * bright
    a = min(1.0, vv / 2.0) ** 0.7
    return nz(a * (y * 0.8 + glass * 0.45 + click) * sy.fade_out(n, 0.3) * 0.42)


def v_plop(seed, fb=620.0):
    """Tête du filet qui touche la glace : une bulle ouverte et un coup d'eau."""
    g = rng("plop", seed)
    n = int(0.22 * SR)
    t = tt(n)
    b = sy.bubble(fb, 0.030, 0.6, 1.0, n)
    sp = sy.bp(g.standard_normal(n), 2400, 0.9) * np.exp(-t / 0.012) * 0.7
    y = (b + sp) * sy.fade_out(n, 0.06)
    return nz(y * 0.5)


def v_land_tick(f, tau, seed):
    """Grain sec qui touche le fond du verre : tic de verre bref."""
    g = rng("landtick", seed)
    n = int(0.012 * SR)
    t = tt(n)
    y = np.cos(TWO_PI * f * t + 0.3) * np.exp(-t / tau) + 0.5 * np.cos(TWO_PI * f * 2.41 * t) * np.exp(-t / (0.5 * tau))
    y += sy.bp(g.standard_normal(n), f * 1.3, 1.2) * np.exp(-t / 0.0006) * 0.5
    return y * sy.fade_out(n, 0.004)


def v_ping(f, amp, g):
    """Point de lumière : bip aigu très bref, deux harmoniques, attaque nette."""
    n = int(0.014 * SR)
    t = tt(n)
    y = np.cos(TWO_PI * f * t) * np.exp(-t / 0.0034) + 0.3 * np.cos(TWO_PI * f * 2.0 * t + 0.4) * np.exp(-t / 0.0018)
    return amp * y * sy.fade_out(n, 0.004) * 0.5


# ---- clics de caractères : un timbre par police (huit de la v0), plus deux familles pour les rouleaux 3 et 4
TYPEFACES = ["archivo-var", "anton", "permanent-marker", "saira-stencil-one", "doto-var", "major-mono-display",
             "instrument-serif-italic", "bodoni-moda-var"]


def v_sign_click(i, g):
    """Rouleau 3 (enseigne) : tube qui s'allume, claquement de starter et ronflement du secteur."""
    n = int(0.05 * SR)
    t = tt(n)
    hum = np.zeros(n)
    for h in range(1, 14, 2):
        hum += np.cos(TWO_PI * 100.0 * h * t + h) / h
    hum *= np.exp(-t / (0.012 + 0.002 * i)) * 0.8
    ck = sy.bp(g.standard_normal(n), 2200 + 260 * i, 1.8) * np.exp(-t / 0.0012) * 1.2
    return M._norm_rms(nz((hum + ck) * sy.fade_out(n, 0.015)), 30.0, 0.12)


def v_weight_click(i, g):
    """Rouleau 4 (graisse continue) : la graisse croît, le choc devient plus lourd et plus grave."""
    n = int(0.07 * SR)
    t = tt(n)
    f = 2300.0 * (900.0 / 2300.0) ** (i / 7.0)
    dec = 0.008 + 0.004 * i
    y = np.cos(TWO_PI * f * t + 0.3) * np.exp(-t / dec) + 0.4 * np.cos(TWO_PI * f * 2.0 * t) * np.exp(-t / (dec * 0.5))
    y += sy.bp(g.standard_normal(n), f * 1.8, 1.4) * np.exp(-t / 0.0015) * 0.7
    return M._norm_rms(nz(y * sy.fade_out(n, 0.02)), 30.0, 0.12)


# ==========================================================================
# Textures pilotées par les données
# ==========================================================================
BANDS = [1200.0, 1800.0, 2600.0, 3800.0, 5400.0, 7600.0, 10500.0]


def granular(n, rate, bright, level, g, gmin=1.2, gmax=5.5, pan_spread=0.9):
    """Nuage de grains secs. rate (grains/s), bright (0..1), level (0..1) : tableaux de n échantillons. Retourne (2, n)."""
    hits = np.nonzero(g.random(n) < rate / SR)[0]
    streams = []
    for fc in BANDS:
        w = g.standard_normal(n + 4096)
        w = sy.bp(w, fc, 1.6)
        streams.append(w / (np.std(w) + 1e-12))
    out = np.zeros((2, n + 1024))
    for h in hits:
        b = bright[h]
        c = int(np.clip(round((b * (len(BANDS) - 1)) + g.normal(0, 0.9)), 0, len(BANDS) - 1))
        L = int(g.uniform(gmin, gmax) * (1.0 - 0.35 * b) * 1e-3 * SR)
        L = max(L, 24)
        s = streams[c]
        o = int(g.integers(0, len(s) - L))
        seg = s[o:o + L] * np.hanning(L + 2)[1:-1]
        a = (g.random() ** 1.5) * level[h]
        p = g.uniform(-1, 1) * pan_spread
        ang = (p + 1) * np.pi / 4
        out[0, h:h + L] += seg * a * np.cos(ang)
        out[1, h:h + L] += seg * a * np.sin(ang)
    return out[:, :n]


def per_sample(frames, values, f_a, f_b):
    """Courbe par image -> courbe par échantillon (interpolation linéaire entre centres d'image), de f_a à f_b exclu."""
    fa = f_a + (np.arange((f_b - f_a) * SPF) + 0.5) / SPF
    return np.interp(fa, frames + 0.5, values)


def norm01(a, p=100):
    a = np.asarray(a, float)
    hi = np.percentile(a, p)
    return np.clip(a / (hi + 1e-12), 0, 1)


# ==========================================================================
# Versement (temps physique -> temps du film)
# ==========================================================================
def synth_pour(D):
    """Filet, bulles et clapotis synthétisés dans le temps physique de la simulation, puis lus au rythme du film :
    le ralenti (jusqu'à quatre fois) abaisse naturellement la hauteur. Retourne (signal (2, n), image de départ)."""
    f_on, f_off, f_touch = D["f_on"], D["f_off"], D["f_touch"]
    fa, fb = f_on, 320
    frames = np.arange(fa, fb + 1)
    tau_f = np.array([TMJ.tau(float(f)) for f in frames])
    n_film = (fb - fa) * SPF
    fr_axis = fa + np.arange(n_film) / SPF
    tau_axis = np.interp(fr_axis, frames, tau_f)
    t0 = tau_axis[0]
    n_src = int((tau_axis[-1] - t0) * SR) + 16
    ts = t0 + np.arange(n_src) / SR
    f_of_ts = np.interp(ts, tau_f, frames)

    # courbes de commande par image du film
    def ramp(f, a, b):
        return float(np.clip((f - a) / max(1e-9, b - a), 0, 1))

    fr_all = np.arange(fa, fb + 1, dtype=float)
    stream = np.array([ramp(f, f_on, f_touch) * 0.35 if f < f_touch else (0.35 + 0.65 * ramp(f, f_touch, f_touch + 3)) * (1 - ramp(f, f_off, f_off + 2.5)) for f in fr_all])
    t_touch = TMJ.tau(float(f_touch))
    t_off = TMJ.tau(float(f_off))
    fill = np.array([np.clip((TMJ.tau(float(f)) - t_touch) / max(1e-9, t_off - t_touch), 0, 1) for f in fr_all])
    cnt = D["counts"]
    cf = np.array([cnt.get(int(f), np.nan) for f in fr_all], float)
    cfi = _interp_nan(cf)
    if cfi is None:
        agit = np.clip(stream * 0.8, 0, 1)
        D["agit_source"] = "synthétique (maillage absent)"
    else:
        post = fr_all >= f_touch
        lo, hi = np.percentile(cfi[post], 5), np.percentile(cfi[post], 98)
        agit = np.where(post, np.clip((cfi - lo) / (hi - lo + 1e-9), 0, 1), 0.0)
        agit = uniform_filter1d(agit, 3, mode="nearest")
        D["agit_source"] = "nombre de sommets du maillage du liquide par image"
    stream_s = np.interp(f_of_ts, fr_all, stream)
    fill_s = np.interp(f_of_ts, fr_all, fill)
    agit_s = np.interp(f_of_ts, fr_all, agit)

    g = rng("pourfinal")
    chs = []
    for c in range(2):
        w = sy.pink(n_src, g)
        fc = 700.0 + 3600.0 * fill_s ** 0.8
        s = sy.sweep(w, fc, q=1.5, kind="bp", chunk=128)
        s = s / (np.std(s) + 1e-12)
        turb = sy.lp(g.standard_normal(n_src), 28.0)
        turb = np.clip(1 + 0.45 * turb / (np.std(turb) + 1e-12), 0.2, 2.0)
        hiss = sy.hp(g.standard_normal(n_src), 5500.0)
        hiss = hiss / (np.std(hiss) + 1e-12) * 0.28
        low = sy.bp(g.standard_normal(n_src), 330.0, 0.9)
        low = low / (np.std(low) + 1e-12) * 0.16
        chs.append((s + hiss + low) * turb * stream_s * (0.5 + 0.5 * agit_s))
    st = np.stack(chs)
    # bulles : nées de l'agitation du maillage (bruyantes pendant le versement, de plus en plus rares ensuite)
    rate = (6.0 + 210.0 * agit_s ** 1.2) * (f_of_ts >= f_touch)
    bub = sy.bubbles(n_src, rate, rng("pourbub"), 750.0, 5200.0, tau_range=(0.006, 0.020), f_bias=1.3)
    src = st * 0.75 + bub * 0.34
    pos = (tau_axis - t0) * SR
    out = np.stack([map_coordinates(src[c], [pos], order=3, mode="nearest", prefilter=True) for c in range(2)])
    # la montée en eau commence à l'échantillon exact f_on
    out *= np.minimum(1.0, (np.arange(n_film) + 1) / 96.0)[None, :]
    out *= sy.fade_out(n_film, 0.15)[None, :]
    out[:, 0] += 1e-5
    D["pour_stats"] = dict(f_from=fa, f_to=fb, vitesse_min=float(min(TMJ.vitesse(f) for f in range(fa, fb))),
                           duree_physique_s=float(tau_axis[-1] - t0), duree_film_s=n_film / SR)
    return out, fa


# ==========================================================================
# Raclette : hauteur pilotée par la lame
# ==========================================================================
def synth_friction(F):
    f0, f1 = 504, 528
    n = (f1 - f0) * SPF
    sq = F["sq"]
    have = all(f in sq for f in range(f0, f1))
    if have:
        fr = np.arange(f0, f1)
        edge = np.array([sq[f]["rubber_edge_px"] for f in fr], float)
        hold = np.array([sq[f]["holder_back_px"] for f in fr], float)
        # la lame sort de la feuille (1920 px) : bord de caoutchouc, puis support entièrement sorti
        interp = PchipInterpolator(fr + 0.5, edge, extrapolate=True)
        fa = f0 + (np.arange(n) + 0.5) / SPF
        e = interp(fa)
        d_e = interp.derivative()(fa)
        # image où le support passe sous le bord bas de la feuille (la lame est entièrement sortie)
        hl = PchipInterpolator(fr + 0.5, hold, extrapolate=True)
        xs = np.linspace(f0, f1, 4000)
        ix = np.nonzero(hl(xs) >= 1920.0)[0]
        F["f_sortie_support"] = float(xs[ix[0]]) if len(ix) else None
        ie = np.nonzero(interp(xs) >= 1920.0)[0]
        F["f_sortie_gomme"] = float(xs[ie[0]]) if len(ie) else None
        pos = np.clip(e / 1920.0, 0.0, 1.0)
        spd = np.clip(d_e / max(1e-9, np.percentile(np.abs(d_e), 95)), 0.0, 1.2)
        F["raclette_source"] = "squeegee.json (rubber_edge_px, holder_back_px par image)"
    else:
        x = np.linspace(0, 1, n)
        pos = x
        spd = 0.6 + 0.4 * np.sin(np.pi * x)
        F["f_sortie_support"] = F["f_sortie_gomme"] = None
        F["raclette_source"] = "défaut (squeegee.json absent)"
    g = rng("squeegeefinal")
    fc = 3300.0 * (620.0 / 3300.0) ** (pos ** 0.9)          # la hauteur descend avec la lame
    F["fc_curve"] = (fc[::SPF // 2].tolist(), pos[::SPF // 2].tolist())
    w = g.standard_normal(n)
    base = sy.sweep(w, fc, q=1.6, kind="bp")
    base /= np.std(base)
    # collé-glissé : plus la lame va vite, plus la relaxation est rapide
    out_saw = np.zeros(n)
    p_ = 0
    while p_ < n:
        per = int(g.uniform(0.014, 0.040) * SR / (0.6 + 0.8 * spd[min(n - 1, p_)]))
        e_ = min(n, p_ + max(per, 40))
        out_saw[p_:e_] = np.linspace(0.0, 1.0, e_ - p_) ** g.uniform(1.4, 2.6)
        p_ = e_
    stick = 0.35 + 0.65 * out_saw
    slow = sy.lp(g.standard_normal(n), 6.0)
    slow = 1 + 0.35 * slow / np.std(slow)
    squeak_f = 2100.0 * (900.0 / 2100.0) ** (pos ** 0.9)
    squeak = np.sin(TWO_PI * sy.phase(squeak_f * (1 + 0.01 * (out_saw - 0.5)), n)) * out_saw ** 3 * 0.10
    y = base * stick * np.clip(slow, 0.3, 1.8) + squeak
    lvl = 0.55 + 0.45 * spd
    # le son dure autant que la lame sur la feuille : montée dès l'image 504, extinction exacte à la fin de l'image 527
    f_gom = F.get("f_sortie_gomme")
    t_end = f1
    env = np.minimum(1.0, (np.arange(n) + 1) / (0.03 * SR))
    if f_gom is not None:
        k0 = int((f_gom - f0) * SPF)
        k0 = int(np.clip(k0, 0, n - 4))
        tail = np.ones(n)
        tail[k0:] = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n - k0))
        env = env * tail
    env = env * sy.fade_out(n, 0.012)
    y = y * lvl * env
    y = sy.hp(y, 250.0, 0.7071)
    st = nz(np.stack([y, y * 0.97 + 0.03 * np.roll(y, 37)]) * 0.5)
    return st


# ==========================================================================
# Le souffle de bande, périodique : la fin retrouve exactement le début
# ==========================================================================
def periodic_bed():
    g = rng("bedfinal")
    n = NS
    f = np.fft.rfftfreq(n, 1 / SR)
    H = np.zeros_like(f)
    m = f > 40
    H[m] = 1.0 / np.sqrt(f[m]) / (1 + (f[m] / 5500.0) ** 4)
    chs = []
    for c in range(2):
        w = np.fft.irfft(np.fft.rfft(g.standard_normal(n)) * H, n)
        hs = np.fft.irfft(np.fft.rfft(g.standard_normal(n)) * (f > 4500) * 1.0, n)
        x = w / np.std(w) + 0.12 * hs / np.std(hs)
        chs.append(x)
    st = np.stack(chs)
    t = tt(n)
    wow = 1 + 0.12 * np.sin(TWO_PI * 0.7 * t) + 0.05 * np.sin(TWO_PI * 3.3 * t)       # 14 et 66 périodes : raccord exact
    st = st * wow[None, :] / np.std(st)
    # enveloppe : même niveau au premier et au dernier échantillon
    fr = np.arange(NS) / SPF
    E0, E1, E2 = db(-58.0), db(-50.0), db(-45.0)
    e = np.full(NS, E0)
    r = np.clip((fr - 4) / 20.0, 0, 1)
    e = E0 + (E1 - E0) * (0.5 - 0.5 * np.cos(np.pi * r))                    # la levée respire un peu plus
    d1 = np.clip((fr - 56) / 24.0, 0, 1)
    e = e * (1 - d1) + E0 * d1                                               # retombe dans la mesure 2
    k = np.clip(fr - 528, 0, None)
    tail = (1 - np.exp(-k / 0.7)) * np.exp(-k / 18.0) * (0.5 + 0.5 * np.cos(np.pi * np.clip(k / 72.0, 0, 1)))
    e = e + (E2 - E0) * tail * (fr >= 528)                                   # grain de la queue, retombe exactement à E0
    e[0] = E0
    return st * e[None, :]


# ==========================================================================
# La partition
# ==========================================================================
LV = dict(
    kick=-5.5, snare=-4.0, rim=-5.0, hat=-4.0, tick=-4.5,
    bass=-13.0, sub=-24.0, pad=-12.0, pluck=-10.0, bell=-12.0, wash=-26.0, pgrain=-24.0,
    ret=-8.0,
)


def v_bass2(f, dur, amp=1.0, c0=1100.0, c1=260.0, drive=2.2, glide_from=None, glide_tau=0.05,
            attack=0.004, rel=0.05, bright=1.05, seed="b", sub_w=0.45):
    """Basse de la v0 avec moins de fondamentale (sub_w 0,8 -> 0,45) et plus de médium saturé : tient sur un petit haut-parleur."""
    n = int(dur * SR)
    t = tt(n)
    fr = f if glide_from is None else f * (glide_from / f) ** np.exp(-t / glide_tau)
    subw = np.sin(TWO_PI * sy.phase(fr, n) + 0.4)
    sw = sy.saw(fr, n)
    sw = sy.sweep(sw, c1 + (c0 - c1) * np.exp(-t / 0.18), q=1.1, kind="lp")
    oc = sy.tri(fr * 2.0, n) * 0.34
    y = subw * sub_w + sw * bright * 1.15 + oc
    y = sy.asym_sat(y * 0.9, drive, 0.12)
    y = sy.hp(y, 34.0, 0.7071)
    env = sy.adsr(n, attack, 0.2, 0.8, rel)
    return amp * y * env * 0.55


def v_kick2(seed, amp=1.0):
    """Grosse caisse sèche : corps plus court et moins grave que la v0, claquement plus net."""
    g = rng("kick2", seed)
    n = int(0.26 * SR)
    t = tt(n)
    f = 66.0 + (210.0 - 66.0) * np.exp(-t / 0.018)
    body = np.sin(TWO_PI * sy.phase(f, n) + 0.7) * np.exp(-t / 0.060)
    body = sy.softclip(body * 1.1, 3.0)
    mid = np.sin(TWO_PI * sy.phase(f * 2.0 + 20, n) + 0.7) * np.exp(-t / 0.03) * 0.8
    tick = sy.hp(g.standard_normal(n) * np.exp(-t / 0.0014), 1800.0) * 0.45
    tick += np.cos(TWO_PI * 2300 * t) * np.exp(-t / 0.0018) * 0.25
    y = sy.softclip((body * 0.50 + mid + tick) * sy.fade_out(n, 0.05), 1.4)
    return amp * y * 0.8


def cue_attempt(R, frame, tag, up=True, level_db=0.0, seed=0, pan_a=-0.12, pan_b=0.12):
    lo, hi = M.F5, M.F5 * 1.5
    a, b = (lo, hi) if up else (hi, lo)
    s = frame * SPF
    put(R, M.v_rclick(a, seed), s, f"{tag} clic 1", "partition.json (réticule)", gain_db=LV["ret"] + level_db, pan_pos=pan_a, send={"room": 0.10}, family="reticule")
    put(R, M.v_rclick(b, seed + 1), s + int(0.060 * SR), f"{tag} clic 2 (+60 ms)", "partition.json (réticule)", expect=s + int(0.060 * SR),
        gain_db=LV["ret"] + level_db, pan_pos=pan_b, send={"room": 0.10}, family="reticule")


def build(S, D):
    """S : dictionnaire de stems ; D : données de simulation."""
    RY, BA, TX, EV, TXS, R = S["rythme"], S["basse"], S["textures"], S["evt"], S["tex"], S["reticule"]
    bar, step = P.bar, P.step
    SX = P.ipx * SPF
    src_p = "partition.json"

    # ======================================================= levée : tic de papier, déchirure, déclic inversé
    put(EV, M.v_paper_tick(), P.one("bruitage", "tic de papier")["image"] * SPF, "tic de papier", "partition.json (bruitage 6)",
        gain_db=-4, pan_pos=0.1, send={"room": 0.08}, family="papier")
    tear = P.one("bruitage", "déchirure")
    tn = (tear["fin"] + 1 - tear["debut"]) * SPF
    put(EV, M.v_tear(tn), tear["debut"] * SPF, "déchirure", "partition.json (bruitage 12-23)", gain_db=-9, pan_pos=-0.05,
        send={"room": 0.10}, family="papier")
    unl = P.one("reticule", "déverrouillage")
    cue_attempt(R, unl["image"], "déverrouillage 12", up=False, seed=100)

    # ======================================================= roulements typographiques (un clic toutes les 3 images)
    rolls = [e for e in P.ev if e["piste"] == "typo" and e["nom"].startswith("roulement")]
    r2 = ["archivo-var", "permanent-marker", "saira-stencil-one", "doto-var", "major-mono-display", "instrument-serif-italic",
          "bodoni-moda-var", "anton"]
    r2 = list(getattr(GM, "ROULEMENT_2", r2))
    for r_i, e in enumerate(rolls):
        for i in range(8):
            fr = e["debut"] + P.ipx * i
            if fr > e["fin"]:
                break
            g = rng("rollclick", r_i, i)
            if r_i == 0:
                idx = TYPEFACES.index(e["caracteres"][i]) if "caracteres" in e else i
                sig, lvl = M.char_click(idx), -6.0
            elif r_i == 1:
                idx = TYPEFACES.index(r2[i]) if r2[i] in TYPEFACES else i
                sig, lvl = M.char_click(idx), -9.0
            elif r_i == 2:
                sig, lvl = v_sign_click(i, g), -13.0
            else:
                sig, lvl = v_weight_click(i, g), -10.0
            put(EV, sig, fr * SPF, f"{e['nom']} : clic {i + 1}", "partition.json (typo, un changement de caractère toutes les 3 images)",
                gain_db=lvl, pan_pos=(-0.35 if i % 2 == 0 else 0.35), send={"room": 0.12}, family="typo")

    # ======================================================= mesure 1 : entrée du rythme
    m1 = bar(1)
    put(RY, v_kick2("m1a", 0.9), m1 * SPF, "kick d'entrée", src_p + " (mesure 1)", gain_db=LV["kick"], send={"room": 0.05}, family="musique")
    put(RY, M.v_rim("m1b", 0.8), step(1, 8) * SPF, "rim temps 3", src_p, gain_db=LV["rim"], pan_pos=0.2, send={"room": 0.12}, family="musique")
    put(RY, v_kick2("m1c", 0.55), step(1, 13) * SPF, "kick syncopé m1", src_p, gain_db=LV["kick"] - 5, family="musique")
    put(BA, v_bass2(note("F2"), 0.42, 0.85, glide_from=note("C2"), glide_tau=0.07, c0=900, c1=300), step(1, 8) * SPF,
        "glissé de basse (temps 3)", src_p, gain_db=LV["bass"], family="musique")
    air = P.one("bruitage", "souffle de caméra")
    put(TXS, M.v_air((air["fin"] + 1 - air["debut"]) * SPF), air["debut"] * SPF, "souffle de caméra", "partition.json (bruitage 48-71)",
        gain_db=-31, family="texture")

    # ======================================================= groove A (72-209)
    ga = P.one("musique", "groove A")
    ga_end = ga["fin"] + 1
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
            put(RY, v_kick2(f"a{b}{k}", 1.0 if k == 0 else 0.85), step(b, k) * SPF, f"kick A{b}.{k}", src_p, gain_db=LV["kick"],
                send={"room": 0.06}, family="musique")
        put(RY, M.v_snare(f"a{b}"), step(b, 8) * SPF, f"caisse claire A{b}", src_p, gain_db=LV["snare"], pan_pos=0.05,
            send={"room": 0.16, "plate": 0.05}, family="musique")
        for k in range(last + 1):
            if step(b, k) >= ga_end:
                break
            op = (k == 14 and b != 4)
            put(RY, M.v_hat(f"a{b}{k}", vel_h[k] * (1.0 if not op else 0.9), open_=op), step(b, k) * SPF, f"hat A{b}.{k}", src_p,
                gain_db=LV["hat"], pan_pos=0.25 * np.sin(k * 1.3 + b), send={"room": 0.05}, family="musique")
        for (k, nm, dur_steps) in bass_fig[b]:
            put(BA, v_bass2(note(nm), dur_steps * 0.1 - 0.012, 1.0 if k == 0 else 0.8), step(b, k) * SPF, f"basse A{b}.{k} {nm}", src_p,
                gain_db=LV["bass"], family="musique")

    # réticule : tentatives et glissements
    for e in [e for e in P.ev if e["piste"] == "reticule" and "image" in e]:
        if e["issue"] == "échec":
            cue_attempt(R, e["image"], f"tentative {e['image']}", up=True, seed=e["image"])
            put(R, M.v_slip(e["fin"]), e["fin"] * SPF, f"glissement {e['fin']}", "partition.json (réticule, échec)", gain_db=0.0,
                pan_pos=0.1, send={"room": 0.12}, family="reticule")

    # ---- grains (mesures 2 à 4) : densité et éclat lus dans la simulation
    G = D["grains"]
    f_a, f_b = 84, 210
    nn = (f_b - f_a) * SPF
    if G["n_mov"] is not None and G["got"] >= 10:
        fr_ = G["frames"]
        x_n = norm01(G["n_mov"], 100)
        x_v = norm01(G["mean_v"], 99)
        rate_f = 1900.0 * x_n ** 0.55 * (x_n > 0)
        bright_f = np.clip(0.18 + 0.80 * x_v ** 0.6, 0, 1)
        level_f = 0.25 + 0.75 * x_v ** 0.5
        D["grains_source"] = "dalle : grains en mouvement (v > 2 cm/s) et vitesse moyenne, image par image"
    else:                                        # repli : enveloppe de la v0
        fr_ = np.arange(72, 232)
        dn = np.zeros(len(fr_))
        for i, f in enumerate(fr_):
            if 84 <= f < 120:
                dn[i] = ((f - 84) / 36.0) ** 1.6 * 0.80
            elif 120 <= f < 168:
                dn[i] = 0.92
            elif 168 <= f < 210:
                dn[i] = (1 - (f - 168) / 42.0) ** 1.3
        rate_f, bright_f, level_f = 1500.0 * dn, 0.4 + 0.5 * dn, 0.3 + 0.7 * dn
        D["grains_source"] = "repli : enveloppe fixe (images de la dalle absentes)"
    rate = per_sample(fr_, rate_f, f_a, f_b)
    brg = per_sample(fr_, bright_f, f_a, f_b)
    lvl = per_sample(fr_, level_f, f_a, f_b)
    sand = granular(nn, rate, brg, lvl, rng("sandfinal"))
    put(TXS, sand, f_a * SPF, "grains secs (nuage piloté par la dalle)", "out/grains/dalle/f####.npz (grains en mouvement, vitesse)",
        gain_db=-15.5, send={"room": 0.08}, family="grains")
    rumble = sy.bp(rng("rumblef").standard_normal(nn), 380.0, 0.8)
    rumble = rumble / np.std(rumble) * (np.clip(rate / 1900.0, 0, 1) ** 1.4) * 0.5
    put(TXS, rumble, f_a * SPF, "corps de l'avalanche", "out/grains/dalle/f####.npz", gain_db=-30, family="grains")

    # grains accordés (musique), même densité, plus clairsemée
    gp = rng("pgrainf")
    scale = [note(x) for x in ("F5", "G5", "Ab5", "C6", "Db6", "Eb6", "F6", "G6", "Ab6")]
    pg = np.zeros((2, nn + 4096))
    hits = np.nonzero(gp.random(nn) < (rate * 0.05) / SR)[0]
    for h in hits:
        L = int(gp.uniform(8, 26) * 1e-3 * SR)
        f = scale[gp.integers(len(scale))]
        gr = np.sin(TWO_PI * f * np.arange(L) / SR + gp.random() * 6) * np.hanning(L + 2)[1:-1] * gp.uniform(0.2, 1.0)
        p = gp.uniform(-0.9, 0.9)
        ang = (p + 1) * np.pi / 4
        pg[0, h:h + L] += gr * np.cos(ang)
        pg[1, h:h + L] += gr * np.sin(ang)
    put(TX, pg[:, :nn], f_a * SPF, "grains accordés (densité de la dalle)", "out/grains/dalle/f####.npz", gain_db=LV["pgrain"],
        send={"plate": 0.25, "hall": 0.1}, family="grains")

    # ---- grains qui tombent dans le verre : un tic de verre par grain (sorties du bec + vol libre)
    land = G["land"]
    if land is not None and len(land["frame"]):
        fl, vl, xl = land["frame"], land["v"], land["x"]
        buf = np.zeros((2, NS))
        gl = rng("landfinal")
        # À l'échelle finale, des dizaines de milliers de grains tombent dans le verre : un tic par grain deviendrait
        # un souffle continu. On en fait entendre 2 500 au plus, tirés au hasard : la densité au fil du temps reste
        # celle de la simulation.
        D["land_total"] = int(len(fl))
        if len(fl) > 2500:
            choix = np.sort(rng("landchoix").choice(len(fl), 2500, replace=False))
            fl, vl, xl = fl[choix], vl[choix], xl[choix]
        bank = [v_land_tick(f, tau, i) for i, (f, tau) in enumerate(zip(np.geomspace(2400, 7800, 48), np.linspace(0.0016, 0.0007, 48)))]
        fmin_, fmax_ = None, None
        count = 0
        vmax = np.percentile(vl, 95)
        for i in range(len(fl)):
            f = fl[i]
            if f < 72 or f > 245:
                continue
            s = fr2s(f)
            j = int(np.clip(gl.normal(24 + 18 * min(vl[i] / vmax, 1.2) - 12, 9), 0, 47))
            a = (0.25 + 0.75 * gl.random() ** 1.2) * min(1.0, vl[i] / vmax)
            ang = (np.clip(xl[i] / 0.03, -0.8, 0.8) + 1) * np.pi / 4
            tk = bank[j]
            if s + len(tk) >= NS:
                continue
            buf[0, s:s + len(tk)] += tk * a * np.cos(ang)
            buf[1, s:s + len(tk)] += tk * a * np.sin(ang)
            log_only("grain dans le verre", G["land_source"], s, s, TXS.name, "grains")
            count += 1
        TXS.dry += buf * db(-24.0)
        if "room" in TXS.reverbs:
            TXS.sends.setdefault("room", np.zeros((2, NS)))
            TXS.sends["room"] += buf * db(-24.0) * 0.10
        D["n_land"] = count
    else:
        D["n_land"] = 0

    # ======================================================= mojito : chocs des corps rigides
    f1 = straw_f1()
    D["straw_f1"] = f1
    ev, plan = D["chocs"]
    n_ice = 0
    desc = []
    for e in ev:
        b, v, k = e["corps"], e["dv"], e["k"]
        kind = e["genre"]
        pn = _pan_x(e["x"])
        src = f"cache/mojito/chutes.npz chocs[{k}] (t={e['t']:.4f} s, corps {b} {kind}, dv={v:.3f} m/s)"
        nm = f"choc {kind} corps {b}"
        src2 = src + (" ; premier choc recalé sur la grille (image %g)" % plan[b]["image"] if e["f_sim"] != e["frame"] else " ; temps simulé")
        if kind in ("quartier", "rondelle"):
            sig = v_hit_lime(v, k, wheel=(kind == "rondelle"))
            sd = {"room": 0.12}
            gdb = -7.0
        elif kind == "feuille":
            sig = v_hit_leaf(v, k)
            sd = {"room": 0.10}
            gdb = -7.0
        elif kind == "paille":
            sig = v_hit_straw(v, k, f1)
            sd = {"room": 0.10, "plate": 0.10}
            gdb = -6.0
        else:
            sig = v_hit_ice(v, b, k, k)
            sd = {"room": 0.12, "plate": 0.12}
            gdb = -7.0
            n_ice += 1
        put(EV, sig, e["sample"], nm, src2, frame=e["frame"], expect=e["sample"], gain_db=gdb, pan_pos=pn, send=sd, family="mojito")

    # ---- versement
    pour, fa = synth_pour(D["pour"])
    put(TXS, pour, fa * SPF, "versement : filet, bulles, clapotis (temps physique -> temps du film)",
        "cache/mojito/versement_r128 (reglages.json f_on/f_off ; maillage par image) + temps.tau()", gain_db=-19.0, family="versement",
        send={"room": 0.12, "plate": 0.08})
    put(EV, v_plop(1), D["pour"]["f_touch"] * SPF, "contact de la tête du filet sur la glace", "versement_r128 : " + D["pour"]["f_touch_source"],
        gain_db=-10.0, pan_pos=0.0, send={"room": 0.15, "plate": 0.1}, family="versement")

    # ======================================================= groove B (216-263)
    tickpat = {0: 0.9, 3: 0.5, 5: 0.7, 6: 0.4, 8: 0.9, 10: 0.5, 11: 0.8, 13: 0.4, 14: 0.6}
    for k, v in tickpat.items():
        put(RY, M.v_tick(f"b{k}", 3400 + 300 * (k % 3), v), step(5, k) * SPF, f"clic B5.{k}", src_p, gain_db=LV["tick"], pan_pos=0.35 * np.sin(k),
            send={"room": 0.08}, family="musique")
    put(RY, M.v_rim("b5", 0.9, 1750), step(5, 8) * SPF, "rim B5 temps 3", src_p, gain_db=LV["rim"] + 1, pan_pos=-0.1, send={"room": 0.14}, family="musique")
    put(RY, v_kick2("b5k", 0.6), step(5, 0) * SPF, "kick doux B5", src_p, gain_db=LV["kick"] - 6, send={"room": 0.05}, family="musique")
    for (k, nm, d_) in [(0, "F2", 6.0), (10, "Eb2", 4.2)]:
        put(BA, v_bass2(note(nm), d_ * 0.1 - 0.01, 0.7, c0=800, c1=240), step(5, k) * SPF, f"basse B5 {nm}", src_p, gain_db=LV["bass"] - 2, family="musique")

    # ======================================================= mesure 6 : arpège montant
    arp_notes = ["F3", "C4", "Ab3", "Eb4", "C4", "F4", "Eb4", "Ab4", "F4", "C5", "Ab4", "Eb5", "C5", "F5", "Eb5", "Ab5"]
    arp_vel = [1.0, .5, .6, .85, .5, .7, .5, .9, .55, .65, .5, .85, .55, .7, .6, .9]
    cut_arp = np.geomspace(600.0, 9000.0, 16)
    for k in range(16):
        v = M.v_pluck(note(arp_notes[k]), 0.30, cut_arp[k], arp_vel[k])
        put(TX, v, step(6, k) * SPF, f"arpège 6.{k}", src_p, gain_db=LV["pluck"], pan_pos=0.55 * np.sin(k * 1.2), send={"plate": 0.22, "room": 0.08}, family="musique")
        ec = sy.delay_taps(v, 3 * SX, 0.38, 4, 3500.0)
        TX.add(ec * 0.35, at=step(6, k) * SPF, gain_db=LV["pluck"] - 4, label="écho arpège")
    put(BA, v_bass2(note("F2"), 1.5, 0.6, c0=600, c1=200, rel=0.15), bar(6) * SPF, "basse tenue m6", src_p, gain_db=LV["bass"] - 3, family="musique")

    # ======================================================= mesure 7 : accord ouvert
    straw = P.one("bruitage", "paille")["image"]
    sprig = P.one("bruitage", "brin de menthe")["image"]
    put(EV, M.v_straw() * 0.35, straw * SPF, "paille : pose (se cale)", "partition.json (312, SYNCHRO : la paille se cale)", gain_db=-8, pan_pos=0.05,
        send={"room": 0.1}, family="mojito")
    sg = rng("sprig")
    n_sp = int(0.3 * SR)
    t_sp = tt(n_sp)
    sprig_sig = sy.lp(sy.hp(sg.standard_normal(n_sp), 1800), 4200) * np.exp(-t_sp / 0.05) * 0.5
    for kk in range(7):
        c = int(sg.uniform(0.0, 0.12) * SR)
        bb = sy.bubble(sg.uniform(900, 2600), 0.005, 0.5, sg.uniform(0.2, 0.6), int(0.04 * SR))
        sprig_sig[c:c + len(bb)] += bb[: n_sp - c]
    put(EV, nz(sprig_sig * sy.fade_out(n_sp, 0.1) * 0.5), sprig * SPF, "brin de menthe : retombée sur l'eau", "partition.json (bruitage 312, brin de menthe)",
        gain_db=-9, pan_pos=0.3, send={"room": 0.15}, family="mojito")
    chord_end = P.block("musique", "accord ouvert")[1]
    cn = chord_end - straw * SPF
    chord = M.v_pad([note(x) for x in ("C4", "Eb4", "G4", "Ab4", "Eb5")], cn / SR, 1.0, attack=0.07, release=0.22, cutoff=1700, det=8, spread=0.9)
    put(TX, chord, straw * SPF, "accord ouvert (Fm9)", "partition.json (musique 312)", gain_db=LV["pad"], send={"hall": 0.28, "plate": 0.08}, family="musique")
    _sb = M.v_sub(note("F1"), cn / SR, 0.9, tau=3.0)
    put(BA, _sb * sy.fade_out(len(_sb), 0.06), straw * SPF, "sous-basse F1", src_p, gain_db=LV["sub"] + 5, family="musique")
    put(BA, v_bass2(note("F2"), cn / SR, 0.75, c0=700, c1=300, rel=0.08, drive=1.7), straw * SPF, "basse F2 tenue", src_p, gain_db=LV["bass"] + 1, family="musique")
    lk = P.one("reticule", "tentative 3")
    cue_attempt(R, lk["image"], "tentative 318 (tenue)", up=True, seed=300)
    dn_ = (lk["fin"] - lk["image"]) * SPF
    put(R, M.v_dyad(dn_), lk["image"] * SPF, "dyade tenue (318-342)", "partition.json (réticule, prise 318-342)", gain_db=LV["ret"] - 2, pan_pos=0.0, send={"hall": 0.1}, family="reticule")
    rc = M.v_rclick(M.F5 * 1.5, 77, 1.0, dec=0.02, length=0.07)[::-1].copy() * sy.fade_out(int(0.07 * SR), 0.0008)[::-1]
    R.add(rc, end_at=lk["fin"] * SPF, gain_db=LV["ret"] + 1, pan_pos=0.1, label="clic inversé (relâchement 342)", sync="partition.json (réticule, fin de la prise)")
    asp = P.one("bruitage", "aspiration")
    an2 = (asp["fin"] + 1 - asp["debut"]) * SPF
    put(TXS, M.v_suction(an2), asp["debut"] * SPF, "aspiration (inversée, culmine à 360)", "partition.json (bruitage 336-359)", gain_db=-17, send={"room": 0.05}, family="texture")

    # ======================================================= groove C (360-407) : points
    for k in (0, 10):
        put(RY, v_kick2(f"c{k}", 0.8), step(8, k) * SPF, f"kick C.{k}", src_p, gain_db=LV["kick"] - 3, send={"hall": 0.08}, family="musique")
    put(BA, v_bass2(note("F2"), 0.5, 0.6, c0=700, c1=200), step(8, 0) * SPF, "basse C.0", src_p, gain_db=LV["bass"] - 3, family="musique")
    put(BA, v_bass2(note("Ab2"), 0.3, 0.5, c0=700, c1=200), step(8, 10) * SPF, "basse C.10", src_p, gain_db=LV["bass"] - 4, family="musique")
    put(RY, M.v_rim("c8", 0.55, 2100), step(8, 8) * SPF, "rim C.8", src_p, gain_db=LV["rim"] - 4, pan_pos=0.3, send={"plate": 0.15}, family="musique")
    bell_notes = ["F5", "Ab5", "C6", "G5", "Eb6", "C6", "Ab5", "F6", "C6", "Eb6", "G5", "Ab5", "C6", "F6", "Eb6", "Ab5"]
    accents = {0, 3, 6, 9, 12}
    for k in range(16):
        a = 1.0 if k in accents else 0.45
        b_ = M.v_bell(note(bell_notes[k]), 0.5, 2.4, 3.5, a)
        put(TX, b_, step(8, k) * SPF, f"cloche C.{k}", src_p, gain_db=LV["bell"], pan_pos=0.85 * np.sin(k * 1.7), send={"plate": 0.4, "hall": 0.15}, family="musique")
        ec = sy.delay_taps(b_, 4 * SX, 0.42, 3, 6000.0)
        TX.add(ec * 0.5, at=step(8, k) * SPF, gain_db=LV["bell"] - 3, label="écho cloche")
    # scintillement des points : densité, hauteur et éclat lus dans les statistiques de l'image
    Pt = D["points"]
    f_p0, f_p1 = 360, 432
    npp = (f_p1 - f_p0) * SPF
    if Pt["mean"] is not None and Pt["got"] >= 10:
        m_ = norm01(Pt["mean"], 98)
        s_ = norm01(Pt["strip"], 98)
        v_ = norm01(Pt["p999"], 100)
        rate_p = 22.0 + 150.0 * m_ ** 1.2 + 150.0 * s_
        pitch_i = v_
        D["points_source"] = "out/seq4/stats : luminance moyenne, points du ruban (strip_all), p99,9 par image"
        D["points_rate"] = (Pt["frames"], rate_p)
    else:
        m_ = np.ones(96) * 0.5
        rate_p = np.full(96, 120.0)
        pitch_i = np.full(96, 0.5)
        D["points_source"] = "repli : taux fixe"
    rps = per_sample(Pt["frames"], rate_p, f_p0, f_p1)
    pis = per_sample(Pt["frames"], pitch_i, f_p0, f_p1)
    ms_ = per_sample(Pt["frames"], m_ if len(m_) == len(Pt["frames"]) else np.interp(Pt["frames"], np.arange(360, 456), m_), f_p0, f_p1)
    gpn = rng("pings")
    pool = [note(x) for x in ("F6", "Ab6", "C7", "Eb7", "F7", "G7", "Ab7", "C8")]
    pb = np.zeros((2, npp + 2048))
    hh = np.nonzero(gpn.random(npp) < rps / SR)[0]
    for h in hh:
        idx = int(np.clip(round(pis[h] * (len(pool) - 1) + gpn.normal(0, 1.2)), 0, len(pool) - 1))
        pg_ = v_ping(pool[idx], (0.25 + 0.75 * gpn.random() ** 1.5) * (0.35 + 0.65 * ms_[h]), gpn)
        ang = (gpn.uniform(-0.9, 0.9) + 1) * np.pi / 4
        pb[0, h:h + len(pg_)] += pg_ * np.cos(ang)
        pb[1, h:h + len(pg_)] += pg_ * np.sin(ang)
        log_only("point de lumière (scintillement)", "out/seq4/stats/f####.json (densité)", f_p0 * SPF + h, f_p0 * SPF + h, TXS.name, "points")
    put(TXS, pb[:, :npp], f_p0 * SPF, "scintillement des points (piloté par les statistiques)", "out/seq4/stats/f####.json", gain_db=-10.0,
        send={"plate": 0.25, "hall": 0.08}, family="points")

    # ======================================================= montée (408-452)
    for k in range(8):
        put(RY, M.v_tick(f"r{k}", 2300 + 250 * k, 0.35 + 0.05 * k), step(9, k) * SPF, f"roulement 16e {k}", src_p, gain_db=LV["tick"] + 1,
            pan_pos=0.3 * np.sin(k * 2), family="musique")
    r2f = P.step(9, 8)
    for k in range(14):
        put(RY, M.v_tick(f"r2{k}", 3200 + 170 * k, 0.55 + 0.035 * k, tau=0.001), fr2s(r2f + 1.5 * k), f"roulement 32e {k}", src_p,
            gain_db=LV["tick"] + 1, pan_pos=0.4 * np.sin(k * 1.9), family="musique")
    put(RY, v_kick2("r9k", 0.7), bar(9) * SPF, "kick doux m9", src_p, gain_db=LV["kick"] - 4, send={"room": 0.05}, family="musique")
    put(RY, v_kick2("r9l", 0.6), step(9, 4) * SPF, "kick doux m9.4", src_p, gain_db=LV["kick"] - 6, family="musique")
    sw = P.one("bruitage", "roulement, souffle")
    sn = (sw["fin"] + 1 - sw["debut"]) * SPF
    gs = rng("swellf")
    tsw = tt(sn)
    Ts = sn / SR
    cs = [sy.sweep(gs.standard_normal(sn), 1800.0 * (5200.0 / 1800.0) ** (tsw / Ts), q=0.9, kind="bp") for _ in range(2)]
    swl = np.stack(cs)
    swl = swl / np.std(swl) * ((tsw / Ts) ** 2.2)[None, :] * sy.fade_in(sn, 0.01, 0.01)[None, :] * sy.fade_out(sn, 0.002)[None, :]
    put(TXS, swl, sw["debut"] * SPF, "souffle de la montée", "partition.json (bruitage 432-452)", gain_db=-27, family="texture")
    cr_n = (453 - 408) * SPF
    cr_env = (np.arange(cr_n) / cr_n) ** 2.2 * sy.fade_in(cr_n, 0.05, 0.01)
    cres = M.v_pad([note(x) for x in ("F4", "Ab4", "C5", "Eb5", "G5")], cr_n / SR, 1.0, cutoff=np.geomspace(700, 7000, cr_n), det=9, spread=1.0, env=cr_env)
    put(TX, cres, bar(9) * SPF, "montée : nappe en crescendo (le filtre s'ouvre)", src_p, gain_db=LV["pad"] + 4, send={"hall": 0.15, "plate": 0.1}, family="musique", continuous=True)
    put(BA, v_bass2(note("F2"), (453 - 408) * SPF / SR, 0.7, c0=2200.0, c1=500.0, rel=0.02, drive=1.8), bar(9) * SPF, "basse tenue m9", src_p,
        gain_db=LV["bass"] - 4, family="musique")

    # ======================================================= plein, contrôlé (456-503) : déferlement puis encre
    full = P.one("musique", "plein")
    f0 = full["debut"]
    wet_f = lambda fr: float(np.clip((fr - 480.0) / 24.0, 0, 1))
    for k in [0, 6, 10, 13]:
        fr = step(10, k)
        w = wet_f(fr)
        put(RY, sy.lp(v_kick2(f"f{k}", 1.0 if k == 0 else 0.85), 20000 - 14000 * w, 0.7071), fr * SPF, f"kick F.{k}", src_p, gain_db=LV["kick"],
            send={"room": 0.05 + 0.2 * w, "hall": 0.03 + 0.3 * w}, family="musique")
    sn_fr = step(10, 8)
    put(RY, sy.lp(M.v_snare("f8"), 20000 - 14000 * wet_f(sn_fr), 0.7071), sn_fr * SPF, "caisse claire F", src_p, gain_db=LV["snare"],
        send={"room": 0.16 + 0.2 * wet_f(sn_fr), "hall": 0.1 + 0.35 * wet_f(sn_fr)}, family="musique")
    for k in (4, 12):
        fr = step(10, k)
        put(RY, sy.lp(M.v_rim(f"fr{k}", 0.6), 20000 - 14000 * wet_f(fr), 0.7071), fr * SPF, f"rim fantôme F.{k}", src_p, gain_db=LV["rim"] - 1,
            pan_pos=-0.2 if k == 4 else 0.25, send={"room": 0.1 + 0.2 * wet_f(fr), "hall": 0.05 + 0.3 * wet_f(fr)}, family="musique")
    vel_f = [1.0, .35, .6, .35, .75, .35, 1.0, .35, .85, .35, .6, .35, .8, .35, .65, .5]
    for k in range(16):
        fr = step(10, k)
        w = wet_f(fr)
        h = sy.lp(M.v_hat(f"f{k}", vel_f[k], open_=(k in (6, 14))), 20000 - 15500 * w, 0.7071)
        put(RY, h, fr * SPF, f"hat F.{k}", src_p, gain_db=LV["hat"], pan_pos=0.3 * np.sin(k * 1.1), send={"room": 0.05 + 0.15 * w, "hall": 0.03 + 0.2 * w}, family="musique")
    wn = (full["fin"] + 1 - full["debut"]) * SPF
    wcur = np.clip((np.arange(wn) / SPF - 24.0) / 24.0, 0, 1)
    wash = M.v_wash(wn, wcur) * sy.fade_in(wn, 0.2, 0.01)[None, :]
    put(TX, wash, f0 * SPF, "nappe de bruit large (sec -> mouillé)", "partition.json (musique 456)", gain_db=LV["wash"], send={"hall": 0.1 + 0.5 * wcur}, family="musique")
    bn10 = wn / SR
    put(BA, v_bass2(note("F2"), bn10, 0.8, c0=900.0, c1=420.0, rel=0.02, drive=2.0, bright=0.9), f0 * SPF, "basse tenue F", src_p, gain_db=LV["bass"], family="musique")
    put(BA, M.v_sub(note("F1"), bn10, 0.6, tau=5.0), f0 * SPF, "sous-note F1 m10", src_p, gain_db=LV["sub"] - 3, family="musique")
    pd = M.v_pad([note(x) for x in ("F3", "C4", "Eb4", "Ab4")], bn10, 1.0, attack=0.05, release=0.04, cutoff=np.geomspace(2400, 1100, wn), det=9, spread=1.0)
    put(TX, pd, f0 * SPF, "nappe d'accord m10", src_p, gain_db=LV["pad"] - 1, send={"hall": 0.12 + 0.4 * wcur}, family="musique")

    # ---- déferlement et encre : particules libres par image (meta.json de la séquence 5/6)
    F56 = D["seq56"]
    nmap = F56["n"]
    fl0, fl1 = 456, 504
    nfl = (fl1 - fl0) * SPF
    if len(nmap) >= 20:
        fr_ = np.arange(fl0, fl1)
        nv = np.array([nmap.get(int(f), np.nan) for f in fr_], float)
        nv = _interp_nan(nv)
        nn_ = nv / (nv.max() + 1e-9)
        dn_ = np.gradient(nv)
        dn_pos = np.clip(dn_, 0, None)
        dn_pos = dn_pos / (dn_pos.max() + 1e-9)
        wetf = np.clip((fr_ - 480.0) / 23.0, 0, 1)
        rate_fl = (700.0 + 1900.0 * dn_pos ** 0.7 + 900.0 * nn_) * (1 - 0.85 * wetf) * (nn_ > 0.002)
        brg_fl = np.clip(0.35 + 0.55 * dn_pos, 0, 1) * (1 - 0.6 * wetf)
        lvl_fl = (0.35 + 0.65 * nn_ ** 0.5)
        D["flood_source"] = "meta.json : n particules libres par image (niveau, dn/dt) ; encre à partir de 480"
        D["flood_drive"] = (fr_, rate_fl * lvl_fl)
        sfl = granular(nfl, per_sample(fr_, rate_fl, fl0, fl1), per_sample(fr_, brg_fl, fl0, fl1), per_sample(fr_, lvl_fl, fl0, fl1), rng("floodf"), 1.5, 7.0)
        put(TXS, sfl, fl0 * SPF, "déferlement : grains contre les bords (n et dn/dt de meta.json)", "out/final/seq56/meta.json", gain_db=-21.0, send={"room": 0.1, "hall": 0.1}, family="déferlement")
        # du sec au mouillé : clapotis visqueux d'encre, taux et niveau selon la quantité de matière
        rate_w = per_sample(fr_, 65.0 * wetf * nn_ ** 0.6 + 6.0 * wetf, fl0, fl1)
        wet_b = sy.bubbles(nfl, rate_w, rng("inkbub"), 220.0, 1100.0, tau_range=(0.018, 0.05), rise=(0.2, 0.6), f_bias=1.0)
        put(TXS, wet_b, fl0 * SPF, "encre : clapotis visqueux (matière restante)", "out/final/seq56/meta.json", gain_db=-19.0, send={"plate": 0.2, "room": 0.1}, family="déferlement")
        wcn = per_sample(fr_, wetf * nn_ ** 0.5, fl0, fl1)
        g_w = rng("inkwash")
        ww = np.stack([sy.lp(sy.hp(g_w.standard_normal(nfl), 300.0), 2200.0) for _ in range(2)])
        ww = ww / np.std(ww) * wcn[None, :] * sy.fade_out(nfl, 0.05)[None, :]
        put(TXS, ww, fl0 * SPF, "encre : nappe humide", "out/final/seq56/meta.json", gain_db=-27.0, family="déferlement")
    else:
        D["flood_source"] = "absent (meta.json incomplet)"

    # ======================================================= signature (528-599)
    fl = P.one("reticule", "verrouillage final")
    fr0 = fl["image"]
    cue_attempt(R, fr0, "verrouillage final 528", up=True, level_db=3.0, seed=528, pan_a=-0.05, pan_b=0.05)
    acc = P.one("bruitage", "second appui")["image"]
    cue_attempt(R, acc, "second appui 540", up=True, level_db=-3.5, seed=540, pan_a=0.08, pan_b=-0.08)
    stab_env = lambda m, tau: (np.exp(-np.arange(m) / SR / tau) * sy.fade_in(m, 0.006, 0.01))
    m = int(2.2 * SR)
    cf = M.v_pad([note(x) for x in ("F3", "Ab3", "C4", "Eb4", "C5")], m / SR, 1.0, cutoff=2600.0, det=6, spread=0.8, env=stab_env(m, 0.55) * sy.fade_out(m, 0.3))
    put(TX, cf, fr0 * SPF, "accord de fa mineur (final)", "partition.json (musique 528)", gain_db=LV["pad"] + 3, send={"hall": 0.45, "plate": 0.1}, family="musique")
    put(BA, M.v_sub(note("F1"), 2.6, 0.95, tau=0.9), fr0 * SPF, "sous-note F1 (final)", src_p, gain_db=LV["sub"] + 4, family="musique")
    put(BA, v_bass2(note("F2"), 1.4, 0.7, c0=900, c1=300, rel=0.3, drive=1.9), fr0 * SPF, "basse F2 (final)", src_p, gain_db=LV["bass"] - 3, family="musique")
    cf2 = M.v_pad([note(x) for x in ("Ab3", "C4", "F4", "Eb5")], m / SR, 1.0, cutoff=2300.0, det=6, spread=0.8, env=stab_env(m, 0.45) * sy.fade_out(m, 0.3))
    put(TX, cf2, acc * SPF, "second appui (accord)", "partition.json (bruitage 540)", gain_db=LV["pad"] - 2, send={"hall": 0.45, "plate": 0.1}, family="musique")
    put(BA, M.v_sub(note("F1"), 1.2, 0.5, tau=0.6), acc * SPF, "sous-note second appui", src_p, gain_db=LV["sub"] - 3, family="musique")


# ==========================================================================
# Rendu, coupes, mixage
# ==========================================================================
NAMES_INT = ["rythme", "basse", "textures", "evt", "tex", "reticule"]
MUSIC_INT = ["rythme", "basse", "textures"]
SFX_INT = ["evt", "tex", "reticule"]
TRIM = dict(rythme=-2.0, basse=-1.0, textures=7.0, evt=2.0, tex=3.0, reticule=3.0)


def render(D):
    t0 = time.time()
    sy.EVENTS.clear()
    LOG.clear()
    rev = {"room": sy.Reverb(0.55, 0.008, 0.35, 1.0, 220.0, 0.8, "room"),
           "hall": sy.Reverb(2.6, 0.022, 0.40, 1.1, 260.0, 0.35, "hall"),
           "plate": sy.Reverb(1.3, 0.004, 0.85, 0.9, 400.0, 0.2, "plate")}
    S = {k: sy.Stem(k, rev) for k in NAMES_INT}
    build(S, D)
    print(f"[{time.time() - t0:5.1f}s] voix placées ({len(LOG)} événements)")
    out = {k: S[k].render() for k in NAMES_INT}
    print(f"[{time.time() - t0:5.1f}s] réverbérations rendues")
    bed = periodic_bed()
    out["souffle"] = bed.copy()
    for k in NAMES_INT:
        out[k] = sy.hp(out[k], 20.0, 0.7071, order=2) * db(TRIM[k])       # coupe le décalage continu des saturations de basse

    # silences de la partition : 210-215 et 453-455 (tout le film se tait), retrait 504-527, fin 596-599
    gates = []
    for e in P.ev:
        if e["piste"] == "musique" and e["nom"] == "silence":
            a = e["debut"] * SPF
            gates.append((a - int(0.008 * SR), a, (e["fin"] + 1) * SPF))
    ret = P.one("musique", "retrait")
    cut_a, cut_c = ret["debut"] * SPF, (ret["fin"] + 1) * SPF
    fin_a, fin_b = 580 * SPF, 596 * SPF
    for k in NAMES_INT + ["souffle"]:
        x = out[k]
        for a, b, c in gates:
            x[:, a:b] *= np.linspace(1, 0, b - a)[None, :]
            x[:, b:c] = 0.0
        if k == "souffle":
            d = int(0.050 * SR)
            x[:, cut_a:cut_a + d] *= np.linspace(1, 0, d)[None, :]
            x[:, cut_a + d:cut_c] = 0.0
            x[:, cut_c:cut_c + d] *= np.linspace(0, 1, d)[None, :]
            continue                                   # le souffle traverse la fin : il est le point de raccord de la boucle
        d = int(0.050 * SR)
        x[:, cut_a:cut_a + d] *= np.linspace(1, 0, d)[None, :] ** 1.5
        x[:, cut_a + d:cut_c] = 0.0
        x[:, fin_a:fin_b] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fin_b - fin_a)))[None, :]
        x[:, fin_b:] = 0.0
    # raclette seule, ajoutée après la coupe
    F = D["seq56"]
    fric = synth_friction(F)
    fb = np.zeros((2, NS))
    fb[:, 504 * SPF:504 * SPF + fric.shape[1]] = fric * db(-12.0)
    out["tex"] = out["tex"] + fb
    log_only("raclette : début du frottement (seul)", "partition.json (bruitage 504) + out/final/seq56/squeegee.json", 504 * SPF + int(np.nonzero(np.abs(fric[0]) > 0)[0][0]), 504 * SPF, "tex", "raclette")
    log_only("raclette : fin du frottement (lame sortie, image 527)", "squeegee.json : holder_back_px / rubber_edge_px", 504 * SPF + int(np.nonzero(np.abs(fric[0]) > 0)[0][-1]) + 1, 528 * SPF, "tex", "raclette")
    out["music"] = sum(out[k] for k in MUSIC_INT) + out["souffle"]
    out["sfx"] = sum(out[k] for k in SFX_INT)
    print(f"[{time.time() - t0:5.1f}s] coupes et raclette")
    return out, S, t0


def mix_and_write(out, t0):
    summ = out["music"] + out["sfx"]
    g = 1.0
    for it in range(10):
        lim, gsm = sy.soft_limit(summ * g, -1.25)
        L = sy.lufs(lim)
        if abs(L + 14.0) < 0.03:
            break
        g *= 10 ** ((-14.0 - L) / 20.0)
    print(f"[{time.time() - t0:5.1f}s] gain {20 * np.log10(g):+.2f} dB, {L:.2f} LUFS, réduction max {20 * np.log10(gsm.min()):.2f} dB")
    if "--debug" in sys.argv:
        grf = np.array([gsm[f * SPF:(f + 1) * SPF].min() for f in range(600)])
        for f in np.argsort(grf)[:12]:
            pk = {k: round(20 * np.log10(np.abs(out[k][:, f * SPF:(f + 1) * SPF]).max() * g + 1e-12), 1) for k in NAMES_INT + ["souffle"]}
            print("limiteur", int(f), round(20 * np.log10(grf[f]), 2), pk)
    V1.mkdir(parents=True, exist_ok=True)
    mus = out["music"] * g * gsm[None, :]
    sfx = out["sfx"] * g * gsm[None, :]
    mix = mus + sfx
    sf.write(OUT / "insoumise_v1.wav", mix.T, SR, subtype="PCM_24")
    sf.write(V1 / "musique.wav", mus.T, SR, subtype="PCM_24")
    sf.write(V1 / "bruitages.wav", sfx.T, SR, subtype="PCM_24")
    return mix, mus, sfx, g, gsm


def load_all():
    D = dict(chocs=load_chocs(), pour=load_pour(), grains=load_grains(), points=load_points(), seq56=load_final56())
    return D


def main():
    t0 = time.time()
    D = load_all()
    print(f"[{time.time() - t0:5.1f}s] données lues : {json.dumps(SRC, ensure_ascii=False)[:600]}")
    out, S, t0 = render(D)
    mix, mus, sfx, g, gsm = mix_and_write(out, t0)
    import rapport_v1
    rapport_v1.make(mix, mus, sfx, g, gsm, D, LOG, sy.EVENTS, SRC, out, fin=sys.modules[__name__], S=S)
    print(f"[{time.time() - t0:5.1f}s] terminé")


if __name__ == "__main__":
    main()
