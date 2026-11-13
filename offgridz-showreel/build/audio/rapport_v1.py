"""Mesures et rapport de la bande-son v1. Appelé par final.py ; tout est relu dans les fichiers WAV écrits.

Aucune écoute n'a eu lieu : ce module ne mesure que des grandeurs objectives.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.stats import spearmanr
from scipy.ndimage import uniform_filter1d

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import synth as sy                       # noqa: E402
from synth import SR, SPF, NS            # noqa: E402

ROOT = HERE.parents[1]
OUT = ROOT / "out" / "audio"
V1 = OUT / "v1"

EDGES = [22.4, 44.7, 89.1, 177.0, 355.0, 707.0, 1414.0, 2828.0, 5657.0, 11314.0, 24000.0]
CENTERS = ["31,5", "63", "125", "250", "500", "1 k", "2 k", "4 k", "8 k", "16 k"]


def dbfs(x):
    return 10 * np.log10(np.mean(np.asarray(x, float) ** 2) + 1e-20)


def pk_db(x):
    return 20 * np.log10(np.max(np.abs(x)) + 1e-12)


def band_shares(x, a=None, b=None):
    """Part de l'énergie par bande d'octave (Welch, somme des deux canaux)."""
    seg = x if a is None else x[:, a:b]
    f, p = signal.welch(seg, SR, nperseg=16384, axis=-1)
    p = p.sum(axis=0)
    tot = p.sum() + 1e-30
    return [float(p[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in zip(EDGES[:-1], EDGES[1:])]


def lra(x):
    """Plage de sonie EBU R128 (fenêtres de 3 s, pas de 0,1 s, portes -70 LUFS puis -20 LU)."""
    import pyloudnorm as pyln
    m = pyln.Meter(SR)
    y = x.T.copy()
    for _, st in m._filters.items():
        y = st.apply_filter(y)
    win, hop = 3 * SR, SR // 10
    zs = []
    for a in range(0, len(y) - win + 1, hop):
        zs.append(np.mean(y[a:a + win] ** 2, axis=0).sum())
    z = np.array(zs)
    l = -0.691 + 10 * np.log10(z + 1e-20)
    ok = l > -70
    if not ok.any():
        return float("nan")
    rel = -0.691 + 10 * np.log10(np.mean(z[ok])) - 20
    ok2 = ok & (l > rel)
    if ok2.sum() < 2:
        return 0.0
    return float(np.percentile(l[ok2], 95) - np.percentile(l[ok2], 10))


def onset_measure(env, s, peak_win=960, pre=400, post=800, frac=0.02):
    """Début d'attaque dans le fichier : premier échantillon de [s-pre, s+post] qui dépasse frac x la crête locale.
    Retourne (échantillon, statut). 'masquée' : un son antérieur dépasse déjà le seuil juste avant."""
    a = max(0, s - pre)
    b = min(len(env), s + post)
    pk = env[s:min(len(env), s + peak_win)].max() if s < len(env) else 0.0
    if pk < 3e-6:
        return None, "inaudible (< -110 dBFS)"
    thr = max(frac * pk, 2e-7)
    pre_lvl = env[max(0, s - pre):s].max() if s > 0 else 0.0
    if pre_lvl > thr:
        return None, "masquée par un son antérieur"
    idx = np.nonzero(env[a:b] > thr)[0]
    if len(idx) == 0:
        return None, "non détectée"
    return int(a + idx[0]), "ok"


def make(mix, mus, sfx, g, gsm, D, LOG, EVENTS, SRC, out, fin=None, S=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import pyloudnorm as pyln
    fin = fin or sys.modules.get("final") or sys.modules["__main__"]
    P = fin.P

    # ---- relecture des fichiers écrits
    mixr, sr = sf.read(OUT / "insoumise_v1.wav", always_2d=True)
    info = sf.info(str(OUT / "insoumise_v1.wav"))
    mixr = mixr.T
    mus_r = sf.read(V1 / "musique.wav", always_2d=True)[0].T
    sfx_r = sf.read(V1 / "bruitages.wav", always_2d=True)[0].T
    n_mix = mixr.shape[1]
    L = float(pyln.Meter(SR).integrated_loudness(mixr.T))
    tp4, tp8 = sy.true_peak_db(mixr, 4), sy.true_peak_db(mixr, 8)
    spk = pk_db(mixr)
    rms = dbfs(mixr)
    corr = float(np.corrcoef(mixr[0], mixr[1])[0, 1])
    lr = lra(mixr)
    lim_diff = pk_db(mus_r + sfx_r - mixr)
    bands = {"mix": band_shares(mixr), "musique": band_shares(mus_r), "bruitages": band_shares(sfx_r)}
    low_mix = sum(bands["mix"][:3])

    # ---- niveau par mesure + part de grave
    bars = [("levée", 0, 24)] + [(f"mesure {m}", P.bar(m), P.bar(m) + 48) for m in range(1, 13)]
    bar_rows = []
    for nm, a, b in bars:
        seg = mixr[:, a * SPF:b * SPF]
        sh = band_shares(mixr, a * SPF, b * SPF) if np.max(np.abs(seg)) > 1e-5 else [float("nan")] * 10
        bar_rows.append((nm, a, b - 1, dbfs(seg), pk_db(seg), sum(sh[:3]) * 100, dbfs(mus_r[:, a * SPF:b * SPF]), dbfs(sfx_r[:, a * SPF:b * SPF])))

    # ---- silences
    sil = []
    for nm, a, b in [("silence 210-215", 210 * SPF, 216 * SPF), ("silence 453-455", 453 * SPF, 456 * SPF)]:
        sil.append((nm, a, b - 1, pk_db(mixr[:, a:b])))
    a0, b0 = 504 * SPF + int(0.052 * SR), 528 * SPF
    ret_mus = pk_db(mus_r[:, a0:b0])
    ret_sfx = pk_db(sfx_r[:, a0:b0])
    fin_pk = pk_db(mixr[:, 596 * SPF:600 * SPF])

    # ---- boucle
    x = mixr
    d_join = float(np.max(np.abs(x[:, 0] - x[:, -1])))
    dd = np.abs(np.diff(x, axis=1))
    med_step = float(np.median(dd[:, -4800:]))
    loop = np.concatenate([x[:, -SR:], x[:, :SR]], axis=1)
    k = SR
    step_join = float(np.max(np.abs(loop[:, k] - loop[:, k - 1])))
    max_step_win = float(np.max(np.abs(np.diff(loop[:, k - 480:k + 480], axis=1))))
    rms_end = dbfs(x[:, -SR // 10:])
    rms_start = dbfs(x[:, :SR // 10])
    m = pyln.Meter(SR)
    yk = loop.T.copy()
    for _, st in m._filters.items():
        yk = st.apply_filter(yk)
    mom = [(-0.691 + 10 * np.log10(np.mean(yk[a:a + int(0.4 * SR)] ** 2, axis=0).sum() + 1e-20)) for a in range(k - int(0.8 * SR), k + int(0.4 * SR), int(0.1 * SR))]
    def oct_levels(seg):
        f_, p_ = signal.welch(seg, SR, nperseg=4096, axis=-1)
        p_ = p_.sum(0)
        return np.array([10 * np.log10(p_[(f_ >= lo) & (f_ < hi)].sum() + 1e-30) for lo, hi in zip(EDGES[3:9], EDGES[4:10])])
    spec_diff = float(np.max(np.abs(oct_levels(x[:, -4 * SPF:]) - oct_levels(x[:, :4 * SPF]))))

    # ---- table de synchronisation
    env_m = np.max(np.abs(mus_r), axis=0)
    env_s = np.max(np.abs(sfx_r), axis=0)
    music_stems = {"rythme", "basse", "textures"}
    _dry = {}

    def env_dry(k):
        if k not in _dry:
            _dry[k] = np.max(np.abs(S[k].dry), axis=0)
        return _dry[k]

    perc_music = ("kick", "caisse", "rim", "hat", "clic", "roulement")
    rows = []
    for e in LOG:
        fam = e["family"]
        dense = fam in ("grains", "points") and not e.get("continuous")
        cont = bool(e.get("continuous"))
        env = env_m if e["stem"] in music_stems else env_s
        meas, stat = (None, "n/a")
        meas_d = None
        measurable = (fam in ("mojito", "typo", "reticule", "papier") or (fam == "versement" and "contact" in e["name"]) or
                      (fam == "musique" and e["name"].startswith(perc_music)))
        if measurable and not dense:
            meas, stat = onset_measure(env, e["expected"])
            if S is not None and e["stem"] in S:
                md_, st_d = onset_measure(env_dry(e["stem"]), e["expected"])
                meas_d = md_
                if meas is None and md_ is not None:
                    stat = "bus sec seulement (WAV : " + stat + ")"
        elif not dense:
            stat = "attaque douce / texture : non mesurée sur seuil"
        rows.append(dict(e, mesure=meas, mesure_sec=meas_d, statut=stat, dense=dense, cont=cont))
    cont_rows = [r for r in rows if r["cont"]]
    sync_rows = [r for r in rows if not r["dense"] and not r["cont"]]
    ok = [r for r in sync_rows if r["mesure"] is not None]
    ok_d = [r for r in sync_rows if r["mesure_sec"] is not None]
    dev_d = [r["mesure_sec"] - r["expected"] for r in ok_d]
    dev_prog = [abs(r["sample"] - r["expected"]) for r in rows if not r["cont"]]
    dev_mes = [r["mesure"] - r["expected"] for r in ok]

    # ---- evenements.json
    V1.mkdir(parents=True, exist_ok=True)
    ev_json = []
    for r in rows:
        ev_json.append(dict(nom=r["name"], source_du_temps=r["source"], image=round(r["frame"], 4), echantillon_attendu=int(r["expected"]),
                            echantillon=int(r["sample"]), piste=("musique" if r["stem"] in music_stems else "bruitages"),
                            famille=r["family"], echantillon_mesure=(None if r["mesure"] is None else int(r["mesure"]))))
    (V1 / "evenements.json").write_text(json.dumps(dict(
        format=dict(sr=SR, echantillons=NS, images=600, echantillons_par_image=SPF),
        evenements=ev_json), ensure_ascii=False, indent=0), encoding="utf-8")

    # ---- vérifications pilotées par les données
    tex = out["tex"]                                         # bruitages continus (avant gain commun), contient nuage de grains, versement, points
    checks = []
    G = D["grains"]
    if G["n_mov"] is not None:
        fr = np.arange(84, 168)
        env = np.array([np.sqrt(np.mean(tex[:, f * SPF:(f + 1) * SPF] ** 2)) for f in fr])
        nm = np.interp(fr, G["frames"], G["n_mov"])
        r1 = spearmanr(env, nm)[0]
        checks.append(("Grains 84-167 : enveloppe RMS du bus des textures contre grains en mouvement (dalle)", f"Spearman {r1:+.2f}"))
    Pt = D["points"]
    if Pt["mean"] is not None:
        fr = np.arange(360, 432)
        cnt = np.zeros(len(fr))
        for r in LOG:
            if r["family"] == "points":
                i = int(r["sample"] // SPF) - 360
                if 0 <= i < len(fr):
                    cnt[i] += 1
        rate = np.interp(fr, *D["points_rate"])
        k5 = np.ones(5) / 5
        r2 = spearmanr(np.convolve(cnt, k5, "same")[2:-2], np.convolve(rate, k5, "same")[2:-2])[0]
        r2b = spearmanr(cnt, rate)[0]
        checks.append(("Points 360-431 : pings par image contre densité pilote (statistiques de l'image)", f"Spearman {r2b:+.2f} par image, {r2:+.2f} lissé sur 5 images ({int(cnt.sum())} pings, 1 image = Poisson de 1 à 10 événements)"))
    F56 = D["seq56"]
    if len(F56["n"]) >= 20:
        fr = np.arange(456, 467)
        env = np.array([np.sqrt(np.mean(tex[:, f * SPF:(f + 1) * SPF] ** 2)) for f in fr])
        nn = np.array([F56["n"].get(int(f), np.nan) for f in fr])
        r3 = spearmanr(env, nn)[0]
        drv = np.interp(fr, *D["flood_drive"])
        r3b = spearmanr(env, drv)[0]
        checks.append(("Déferlement, montée 456-466 (n croît ; ensuite n est constant jusqu'à 478 et le son aussi) : enveloppe RMS du bus des textures contre pilote (taux × niveau tirés de n et dn/dt)", f"Spearman {r3b:+.2f} ; contre n seul {r3:+.2f}"))
    # raclette : centroïde spectral par image contre position de la lame
    fr_ = np.arange(504, 528)
    cen, posv = [], []
    for f in fr_:
        seg = sfx_r[0, f * SPF:(f + 1) * SPF]
        sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        fq = np.fft.rfftfreq(len(seg), 1 / SR)
        cen.append(float((sp * fq).sum() / (sp.sum() + 1e-30)))
        if f in F56["sq"]:
            posv.append(F56["sq"][f]["rubber_edge_px"])
    r4 = spearmanr(cen[:len(posv)], posv)[0] if len(posv) == len(fr_) else float("nan")
    fric_nz = np.nonzero(np.abs(sfx_r[:, 504 * SPF:528 * SPF]).max(0) > 0)[0]
    fric_first, fric_last = 504 * SPF + int(fric_nz[0]), 504 * SPF + int(fric_nz[-1]) + 1
    checks.append(("Raclette : centroïde spectral par image contre position du bord de la lame", f"Spearman {r4:+.2f} (négatif = la hauteur descend avec la lame) ; centroïde image 504 = {cen[0]:.0f} Hz, image 527 = {cen[-1]:.0f} Hz"))
    # versement : centroïde contre vitesse du ralenti
    import temps as TMJ
    fr_ = np.arange(264, 312)
    cv, vv = [], []
    for f in fr_:
        seg = tex[0, f * SPF:(f + 1) * SPF]
        sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        fq = np.fft.rfftfreq(len(seg), 1 / SR)
        cv.append(float((sp * fq).sum() / (sp.sum() + 1e-30)))
        vv.append(TMJ.vitesse(f))
    r5 = spearmanr(cv, vv)[0]
    checks.append(("Versement 264-311 : centroïde spectral par image contre vitesse du ralenti (temps.vitesse)", f"Spearman {r5:+.2f} ; vitesse minimale {min(vv):.2f}, centroïde mini {min(cv):.0f} Hz, maxi {max(cv):.0f} Hz"))

    # ---- glaçons : première frappe de chaque glaçon, voix isolée
    ice_rows = []
    ev, plan = D["chocs"]
    seen = set()
    for e in ev:
        if e["genre"] == "glacon" and e["corps"] not in seen:
            seen.add(e["corps"])
            sig = fin.v_hit_ice(e["dv"], e["corps"], e["k"], e["k"])
            sp = np.abs(np.fft.rfft(sig * np.hanning(len(sig)))) ** 2
            fq = np.fft.rfftfreq(len(sig), 1 / SR)
            cen_i = float((sp * fq).sum() / sp.sum())
            fpk = float(fq[np.argmax(sp)])
            env = np.sqrt(uniform_filter1d(sig ** 2, 480))
            ix = np.nonzero(env > 10 ** (-30 / 20) * env.max())[0]
            ice_rows.append((e["corps"], e["dv"], fpk, cen_i, ix[-1] / SR * 1000, pk_db(sig)))
    allc, allv = [], []
    for e in ev:
        if e["genre"] == "glacon":
            sig = fin.v_hit_ice(e["dv"], e["corps"], e["k"], e["k"])
            sp = np.abs(np.fft.rfft(sig * np.hanning(len(sig)))) ** 2
            fq = np.fft.rfftfreq(len(sig), 1 / SR)
            j = (e["corps"] - 10) % len(fin.ICE_BASE)
            allc.append(float((sp * fq).sum() / sp.sum()) / fin.ICE_BASE[j])
            allv.append(e["dv"])
    r_ice = spearmanr(allv, allc)[0] if len(allc) > 3 else float("nan")
    if len(ice_rows) > 1:
        pts = np.array([[np.log2(r[2]), np.log2(r[3])] for r in ice_rows])
        dm = np.min([np.hypot(*(pts[i] - pts[j])) for i in range(len(pts)) for j in range(i + 1, len(pts))])
    else:
        dm = float("nan")
    straw_rows = []
    f1 = D["straw_f1"]
    sigs = fin.v_hit_straw(1.9, 3, f1)
    sp = np.abs(np.fft.rfft(sigs * np.hanning(len(sigs)))) ** 2
    fq = np.fft.rfftfreq(len(sigs), 1 / SR)
    pk_idx, _ = signal.find_peaks(sp, height=sp.max() * 1e-4, distance=40)
    top = sorted(pk_idx, key=lambda i: -sp[i])[:6]
    straw_peaks = sorted(float(fq[i]) for i in top)
    envs = np.abs(signal.hilbert(sigs))
    t60_straw = float(np.nonzero(envs > envs.max() * 10 ** (-40 / 20))[0][-1] / SR)
    # ---- niveau des 8 clics
    # ---- spectrogramme
    mono = mixr.mean(0)
    f, t, Z = signal.spectrogram(mono, SR, nperseg=2048, noverlap=1536, scaling="spectrum")
    fig, ax = plt.subplots(2, 1, figsize=(16, 9), gridspec_kw=dict(height_ratios=[1, 3.2]), sharex=False)
    tw = np.arange(0, NS, 480) / SR
    ax[0].fill_between(tw, np.max(np.abs(mixr[:, :NS // 480 * 480].reshape(2, -1, 480)), axis=(0, 2)), -np.max(np.abs(mixr[:, :NS // 480 * 480].reshape(2, -1, 480)), axis=(0, 2)), color="#444")
    ax[0].set_xlim(0, 20)
    ax[0].set_ylabel("amplitude")
    im = ax[1].pcolormesh(t, f[1:], 10 * np.log10(Z[1:] + 1e-14), shading="auto", vmin=-110, vmax=-30, cmap="magma")
    ax[1].set_yscale("log")
    ax[1].set_ylim(30, 20000)
    ax[1].set_xlim(0, 20)
    ax[1].set_xlabel("temps (s)")
    ax[1].set_ylabel("fréquence (Hz)")
    for mm in range(1, 13):
        for a_ in ax:
            a_.axvline(P.bar(mm) / 30.0, color="w" if a_ is ax[1] else "k", lw=0.4, alpha=0.5)
    for fr_e, nm_e in [(210, "silence"), (453, "silence"), (264, "versement"), (360, "points"), (456, "déferlement"), (504, "raclette"), (528, "verrou")]:
        ax[1].text(fr_e / 30.0 + 0.03, 24000, nm_e, color="w", fontsize=7, rotation=90, va="top")
    fig.colorbar(im, ax=ax[1], label="dB (spectre, FS)")
    ax[0].set_title("INSOUMISE v1 : forme d'onde et spectrogramme du mix (lignes : début de chaque mesure)")
    fig.tight_layout()
    fig.savefig(V1 / "spectrogramme.png", dpi=110)
    plt.close(fig)

    # ==========================================================================
    # rapport
    # ==========================================================================
    f2 = lambda v, d=2: f"{v:.{d}f}"
    md = []
    md.append("# Bande-son v1 : rapport de mesures\n")
    md.append("Tout ce qui suit est mesuré par `build/audio/rapport_v1.py` sur les fichiers WAV écrits (relus depuis le disque) "
              "et sur les caches de simulation lus pendant la construction. **Personne n'a écouté ce fichier** : le rapport ne contient "
              "que des mesures, pas de jugement d'écoute.\n")
    md.append("Commande : `OMP_NUM_THREADS=2 /opt/og/venv/bin/python build/audio/final.py` (reconstruit tout, rapport compris).\n")
    md.append("## 1. Format, sonie, crête\n")
    md.append("| Mesure | Valeur | Cible |\n|---|---|---|")
    md.append(f"| Fichier | {info.format} {info.subtype}, {info.samplerate} Hz, {info.channels} canaux | WAV, 48 000 Hz, stéréo, 24 bits |")
    md.append(f"| Échantillons | mix {n_mix} ({n_mix / SR:.6f} s) ; musique {mus_r.shape[1]} ; bruitages {sfx_r.shape[1]} | 960 000 (20,000 s) |")
    md.append(f"| Décalage continu (moyenne L / R) | {np.mean(mixr[0]):.1e} / {np.mean(mixr[1]):.1e} | ≈ 0 |")
    md.append(f"| Sonie intégrée (BS.1770-4, pyloudnorm) | {f2(L)} LUFS | −14,0 ± 0,3 |")
    md.append(f"| Crête vraie, sur-échantillonnage ×4 | {f2(tp4)} dBTP | ≤ −1,0 |")
    md.append(f"| Crête vraie, contrôle ×8 | {f2(tp8)} dBTP | ≤ −1,0 |")
    md.append(f"| Crête d'échantillon | {f2(spk)} dBFS | |")
    md.append(f"| Plage de sonie (LRA, EBU R128, fenêtres 3 s) | {f2(lr, 1)} LU | (information) |")
    md.append(f"| RMS global | {f2(rms)} dBFS ; facteur de crête {f2(spk - rms)} dB | |")
    md.append(f"| Corrélation stéréo L/R | {f2(corr, 3)} | |")
    md.append(f"| Réduction de gain maximale du limiteur | {f2(20 * np.log10(gsm.min()))} dB | |")
    md.append(f"| Écart max. (musique + bruitages) − mix | {f2(lim_diff)} dBFS (les stems portent le même gain commun ET la même courbe de limiteur : leur somme égale le mix) | |")
    md.append(f"| Gain commun avant limiteur | {f2(20 * np.log10(g))} dB | |\n")
    md.append("## 2. Équilibre spectral par octave (part de l'énergie, Welch, deux canaux)\n")
    md.append("| Bande (Hz) | " + " | ".join(CENTERS) + " | 31–125 Hz |\n|---|" + "---|" * 11)
    for k_, v in bands.items():
        md.append(f"| {k_} | " + " | ".join(f"{100 * x:.1f} %" for x in v) + f" | **{100 * sum(v[:3]):.1f} %** |")
    md.append(f"\nLa bande 31–125 Hz (trois octaves centrées 31,5 / 63 / 125, de 22 à 177 Hz) porte {100 * low_mix:.1f} % de l'énergie du mix "
              "(cible : minoritaire, donc sous 50 %). Part par mesure :\n")
    md.append("| Section | Images | RMS mix (dBFS) | Crête (dBFS) | RMS musique | RMS bruitages | Part 31–125 Hz |\n|---|---|---|---|---|---|---|")
    for nm, a, b, r_, p_, lw, rm_, rs_ in bar_rows:
        md.append(f"| {nm} | {a}–{b} | {f2(r_, 1)} | {f2(p_, 1)} | {f2(rm_, 1)} | {f2(rs_, 1)} | {lw:.0f} % |" if np.isfinite(lw) else f"| {nm} | {a}–{b} | {f2(r_, 1)} | {f2(p_, 1)} | {f2(rm_, 1)} | {f2(rs_, 1)} | n/a |")
    md.append("")
    md.append("## 3. Silences, retrait, fin\n")
    md.append("| Zone | Crête du mix (dBFS) |\n|---|---|")
    for nm, a, b, p_ in sil:
        md.append(f"| {nm} (échantillons {a}–{b}) | {f2(p_, 1)} |")
    md.append(f"| 4 dernières images 596-599 | {f2(fin_pk, 1)} (le souffle de bande, très bas, est le seul son : c'est le point de raccord de la boucle) |")
    md.append(f"| Retrait 504 + 52 ms → 527 : stem musique | {f2(ret_mus, 1)} |")
    md.append(f"| Retrait 504 + 52 ms → 527 : stem bruitages (la raclette seule) | {f2(ret_sfx, 1)} |\n")
    md.append("## 4. Boucle : dernière image → première image\n")
    md.append("| Contrôle | Mesure | Lecture |\n|---|---|---|")
    md.append(f"| Écart entre le dernier et le premier échantillon (max L/R) | {d_join:.2e} | pas médian entre échantillons voisins sur 100 ms : {med_step:.2e} |")
    md.append(f"| Plus grand pas inter-échantillons exactement au raccord (fichier mis bout à bout) | {step_join:.2e} | plus grand pas sur ±10 ms autour du raccord : {max_step_win:.2e} |")
    md.append(f"| RMS des 100 dernières ms / des 100 premières ms | {f2(rms_end, 1)} / {f2(rms_start, 1)} dBFS | écart {f2(rms_end - rms_start, 1)} dB |")
    md.append(f"| Écart de niveau par octave (250 Hz à 8 kHz) entre les images 596-599 et les images 0-3 | {f2(spec_diff, 1)} dB (maximum sur les six octaves) | |")
    md.append("\nCe qui rend le raccord invisible : le souffle de bande est un bruit périodique de 20 s exactement (filtré dans le domaine de Fourier), "
              "à enveloppe égale au premier et au dernier échantillon ; tout le reste est à zéro numérique entre 596 et 599.\n")

    md.append("## 5. Synchronisation (échantillon attendu, échantillon programmé, début d'attaque mesuré dans le WAV)\n")
    md.append("- **Attendu** : image × 1 600 (partition) ; pour les chocs des corps rigides, `round(temps.image(t) × 1600)` pour les rebonds libres, "
              "et image du plan × 1 600 pour le premier choc de chaque corps quand la simulation tombe à moins d'une demi-image de la grille "
              "(voir §6 pour les écarts de la simulation à la grille).")
    md.append("- **Programmé** : premier échantillon non nul du signal placé (construction).")
    md.append("- **Mesuré (bus sec)** : même seuil, sur le bus du stem avant réverbération (sans queues de réverbération, avant gain commun ; le gain et le limiteur sont lisses et ne déplacent pas une attaque).")
    md.append("- **Mesuré (WAV)** : relu dans `v1/musique.wav` ou `v1/bruitages.wav`, premier échantillon à ≥ 2 % de la crête locale (20 ms) dans la fenêtre [−400, +800] échantillons ; "
              "« masquée » si un son plus ancien dépasse déjà ce seuil juste avant (impossible à mesurer, pas une erreur) ; "
              "les attaques douces (nappes, basses, textures) ne sont pas mesurées au seuil.")
    md.append(f"\nRésumé : {len(rows)} événements placés ({len(sync_rows)} événements discrets dans le tableau ci-dessous, "
              f"{len(rows) - len(sync_rows) - len(cont_rows)} événements denses agrégés : grains dans le verre et points de lumière ; "
              f"{len(cont_rows)} couches continues listées à part). "
              f"Écart programmé maximal sur tous les événements : **{max(dev_prog)} échantillons**. "
              f"Écart mesuré dans les WAV : {len(ok)} événements mesurables, "
              f"écart absolu maximal **{(max(abs(d) for d in dev_mes) if dev_mes else float('nan'))} échantillons**, "
              f"médian {np.median(np.abs(dev_mes)) if dev_mes else float('nan'):.0f} ; sur les bus secs (avant réverbération, mêmes tableaux que le mixage) : "
              f"{len(ok_d)} événements mesurables, écart absolu maximal **{(max(abs(d) for d in dev_d) if dev_d else float('nan'))} échantillons**, "
              f"{sum(1 for d in dev_d if d == 0)} à zéro exactement ; "
              f"{sum(1 for r in sync_rows if r['statut'].startswith('masqu'))} masquées par un son antérieur ; "
              f"{sum(1 for r in sync_rows if r['statut'].startswith('attaque douce'))} attaques douces non mesurées.\n")
    dense_n = {}
    for r in rows:
        if r["dense"]:
            dense_n.setdefault(r["family"], []).append(r)
    for fam, lst in dense_n.items():
        md.append(f"- Événements denses « {fam} » : {len(lst)} événements, écart programmé max {max(abs(r['sample'] - r['expected']) for r in lst)} échantillons ; "
                  f"source : {lst[0]['source']}.")
    md.append("")
    md.append("| Famille | Événement | Image | Attendu | Programmé | Écart prog. | Mesuré (bus sec) | Mesuré (WAV) | Écart WAV | Statut |\n|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(sync_rows, key=lambda r: (r["expected"], r["name"])):
        dm_ = "" if r["mesure"] is None else f"{r['mesure'] - r['expected']:+d}"
        md.append(f"| {r['family']} | {r['name']} | {r['frame']:.3f} | {r['expected']} | {r['sample']} | {r['sample'] - r['expected']:+d} | "
                  f"{'' if r['mesure_sec'] is None else r['mesure_sec']} | {'' if r['mesure'] is None else r['mesure']} | {dm_} | {r['statut']} |")
    md.append("")
    md.append("Couches continues pilotées par des données (leur premier échantillon utile dépend de la densité mesurée ; pas de tolérance à l'échantillon) :\n")
    md.append("| Couche | Image demandée | Échantillon demandé | Premier échantillon non nul | Décalage (ms) |\n|---|---|---|---|---|")
    for r_ in sorted(cont_rows, key=lambda r: r["expected"]):
        md.append(f"| {r_['name']} | {r_['frame']:.0f} | {r_['expected']} | {r_['sample']} | {(r_['sample'] - r_['expected']) / SR * 1000:.1f} |")
    md.append("")
    md.append("Événements de fin de son (non couverts par un début d'attaque) :\n")
    md.append(f"- Raclette : premier échantillon non nul {fric_first} (attendu {504 * SPF}, écart {fric_first - 504 * SPF:+d}) ; dernier échantillon non nul + 1 = {fric_last} "
              f"(fin de l'image 527 = {528 * SPF}, écart {fric_last - 528 * SPF:+d}). Dans `squeegee.json`, le bord de caoutchouc quitte la feuille (1 920 px) à l'image "
              f"{D['seq56'].get('f_sortie_gomme')} et le support à l'image {D['seq56'].get('f_sortie_support')} ; le son décroît à partir de la sortie du caoutchouc et "
              f"atteint zéro à la fin de l'image 527.")
    md.append(f"- Aspiration : fin programmée à l'échantillon {360 * SPF} (image 360) ; clic inversé de relâchement : fin à {342 * SPF} (image 342).\n")

    md.append("## 6. Données de simulation : ce qui est lu et comment il pilote le son\n")
    md.append("| Jeu de données | Lu | Pilote |\n|---|---|---|")
    ch = SRC.get("chocs", {})
    md.append(f"| `cache/mojito/chutes.npz` | {ch.get('n')} chocs | un son par choc, à l'échantillon `round(temps.image(t) × 1600)` ; corps → voix (citron mou, rondelle, feuille, paille d'acier, glaçon) ; saut de vitesse → niveau, éclat, durée ; position x du corps au choc → panoramique |")
    pv = SRC.get("versement", {})
    md.append(f"| `versement_r128/reglages.json` + maillages | f_on {pv.get('f_on')}, f_off {pv.get('f_off')}, contact {pv.get('f_touch')} ({pv.get('source_touch')}) ; {pv.get('images_maillage')} maillages | filet, bulles et clapotis synthétisés en temps physique puis lus au rythme de `temps.tau()` (ralenti jusqu'à ×4 : hauteur abaissée) ; hauteur du filet suit le niveau de remplissage (intégrale du débit f_touch → f_off) ; nombre de bulles suit le nombre de sommets du maillage |")
    gr = SRC.get("grains", {})
    md.append(f"| `out/grains/dalle/f####.npz` | {gr.get('images_dalle')} images (72-231 demandées), {gr.get('images_filet')} images filet | densité de grains (grains en mouvement, v > 2 cm/s), éclat et niveau (vitesse moyenne) : nuage de grains secs de 84 à 209 ; mêmes données pour la densité des grains accordés |")
    md.append(f"| `out/grains/dalle/exits.npz` | {gr.get('atterrissages')} grains tombés par le bec, {D.get('n_land')} placés | un tic de verre par grain à `monde.image_de(t_sortie + chute libre) × 1600` (chute libre calculée comme dans `sim.py`), niveau par vitesse d'arrivée, panoramique par position d'arrivée |")
    pt = SRC.get("points", {})
    md.append(f"| `out/seq4/stats/f####.json` | {pt.get('images')} images | densité (luminance moyenne et points du ruban) et hauteur (p99,9) des pings de lumière de 360 à 431 |")
    s5 = SRC.get("seq56", {})
    md.append(f"| `out/final/seq56/meta.json` | {s5.get('images_n')} images | déferlement 456-479 : densité = particules libres et dn/dt ; 480-503 : clapotis visqueux et nappe humide selon la matière restante |")
    md.append(f"| `out/final/seq56/squeegee.json` | {s5.get('images_raclette')} images | raclette : hauteur du frottement suit la position du bord de la lame (3 300 → 620 Hz), cadence du collé-glissé suit sa vitesse, extinction à la sortie |")
    md.append("")
    md.append("Sources retenues pour chaque pilote : " + "; ".join(f"{k}: {D.get(k)}" for k in ("grains_source", "points_source", "flood_source") if D.get(k)) + "; "
              f"agitation du liquide : {D['pour'].get('agit_source')}.\n")
    md.append("Premiers chocs de chaque corps : image du plan contre image simulée (la simulation actuelle ne retombe pas toujours exactement sur la grille).\n")
    md.append("| Corps | Genre | Image du plan | Image simulée | Écart (échantillons) | Traitement |\n|---|---|---|---|---|---|")
    for s in ch.get("premiers", []):
        md.append(f"| {s['corps']} | {s['genre']} | {s['plan']:g} | {s['sim']:.3f} | {s['ecart_echantillons']:+d} | {'recalé sur la grille' if s['recale'] else 'laissé au temps simulé (> 1/2 image)'} |")
    md.append("")
    md.append("Contrôles objectifs que le son suit bien les données (corrélations de rang entre la grandeur sonore mesurée et le pilote) :\n")
    md.append("| Contrôle | Résultat |\n|---|---|")
    for a_, b_ in checks:
        md.append(f"| {a_} | {b_} |")
    md.append("")
    ps = D["pour"].get("pour_stats", {})
    md.append(f"Versement : synthétisé sur {ps.get('duree_physique_s', 0):.2f} s de temps physique, lu sur {ps.get('duree_film_s', 0):.2f} s de film (images {ps.get('f_from')}-{ps.get('f_to')}), vitesse minimale {ps.get('vitesse_min', 0):.2f}.\n")

    md.append("### Glaçons : les huit premières frappes sont-elles différentes ? (voix isolées, mesurées)\n")
    md.append("| Corps | dv (m/s) | Pic spectral (Hz) | Centroïde (Hz) | Durée à −30 dB (RMS 10 ms) | Crête voix (dBFS) |\n|---|---|---|---|---|---|")
    for r in ice_rows:
        md.append(f"| {r[0]} | {r[1]:.2f} | {r[2]:.0f} | {r[3]:.0f} | {r[4]:.0f} | {r[5]:.1f} |")
    md.append(f"\nSur les {len(allc)} chocs de glaçon de la simulation (voix isolées), corrélation de rang entre le saut de vitesse et le centroïde rapporté à la hauteur de base du glaçon : Spearman {r_ice:+.2f} (positif = plus fort, plus brillant).")
    md.append(f"\nDistance minimale entre deux glaçons dans le plan (log2 pic, log2 centroïde) : {dm:.2f} octave(s) : plus elle est grande, plus les glaçons se distinguent.\n")
    md.append("### Paille d'acier\n")
    md.append(f"Fondamentale calculée (tube d'acier libre-libre, longueur et rayon lus dans `plantes.json`) : {f1:.0f} Hz. Pics mesurés sur la voix isolée (choc 1,9 m/s) : "
              + ", ".join(f"{x:.0f}" for x in straw_peaks) + f" Hz ; durée de résonance à −40 dB : {t60_straw * 1000:.0f} ms (modes en rapports 1 ; 2,76 ; 5,40 ; 8,93 ; 13,34).\n")
    md.append("## 7. Spectrogramme\n")
    md.append("`out/audio/v1/spectrogramme.png` (mix, échelle logarithmique, lignes aux débuts de mesure).\n")
    md.append("## 8. Ce qui n'a pas pu être vérifié\n")
    md.append("- Aucune écoute : le timbre, l'équilibre perçu, la gêne éventuelle des clics ou des bulles ne sont pas évalués.\n"
              "- Aucune simulation d'écoute sur haut-parleur de téléphone n'a été faite ici (seule la répartition spectrale est mesurée).\n"
              "- Le recalage image par image sur la vidéo finale n'a pas été fait : on vérifie le son contre les caches et la partition, pas contre le film rendu.\n"
              "- Les caches de grains et de corps rigides étant régénérés pendant le travail, les nombres ci-dessus sont ceux de la dernière exécution ; relancer la commande les remet à jour.\n")
    (OUT / "rapport_v1.md").write_text("\n".join(md), encoding="utf-8")
    print(f"LUFS {L:.2f}  TP4 {tp4:.2f}  TP8 {tp8:.2f}  LRA {lr:.1f}  31-125Hz {100 * low_mix:.1f}%  dev prog max {max(dev_prog)}  mesure max {(max(abs(d) for d in dev_mes) if dev_mes else None)}")
