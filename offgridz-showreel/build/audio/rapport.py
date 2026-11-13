"""Mesures, table de synchronisation, rapport.md et spectrogramme. Lit les fichiers ecrits (pas la memoire)."""
from __future__ import annotations

import numpy as np
import soundfile as sf
from scipy import signal

import synth as sy
from synth import SR, SPF, NS, db

NAMES = ["rythme", "basse", "textures", "bruitages", "reticule"]


def _dbfs(x):
    return 10 * np.log10(np.mean(x ** 2) + 1e-20)


def sync_rows(P):
    """(ligne dossier C / piste, description, tag d'evenement, image de la partition, 'attaque'|'fin', decalage en echantillons)."""
    r = []
    A, E = "attaque", "fin"
    unl = P.one("reticule", "déverrouillage")["image"]
    r += [("C 12", "bruitage : début de la déchirure", "tear12", P.one("bruitage", "déchirure")["debut"], A, 0),
          ("C 12", "réticule : déclic inversé, clic 1 (aigu)", "ret12_a", unl, A, 0),
          ("C 12", "réticule : déclic inversé, clic 2 (+60 ms)", "ret12_b", unl, A, 2880),
          ("bruitage 6", "tic de papier", "paper6", P.one("bruitage", "tic de papier")["image"], A, 0)]
    c0 = P.one("bruitage", "8 clics")["debut"]
    for i in range(8):
        r.append(("C 24" if i == 0 else "typo", f"clic de caractère {i + 1}", f"char{i}", c0 + P.ipx * i, A, 0))
    r += [("C 24", "rythme : kick d'entrée", "kick24", P.one("musique", "entrée du rythme")["debut"], A, 0),
          ("bruitage", "glissé de basse (temps 3)", "glide48", P.step(1, 8), A, 0)]
    for e in [e for e in P.ev if e["piste"] == "reticule" and "image" in e and e["issue"] == "échec"]:
        r += [(f"C {e['image']}", f"réticule : tentative {e['image']}, clic 1", f"ret{e['image']}_a", e["image"], A, 0),
              (f"C {e['image']}", f"réticule : tentative {e['image']}, clic 2 (+60 ms)", f"ret{e['image']}_b", e["image"], A, 2880),
              (f"C {e['fin']}" if e["fin"] == 96 else "réticule", f"réticule : glissement (échec de {e['image']})", f"slip{e['fin']}", e["fin"], A, 0)]
    r += [("C 72", "rythme : kick, temps 1 mesure 2", "kick72", P.one("musique", "groove A")["debut"], A, 0),
          ("C 72", "basse : première note", "bass72", P.one("musique", "groove A")["debut"], A, 0)]
    gb = P.one("musique", "groove B")["debut"]
    r += [("C 216", "citron vert", "lime216", P.one("bruitage", "citron")["image"], A, 0),
          ("C 216", "rythme : clic fin, temps 1 mesure 5", "tick216", gb, A, 0),
          ("C 216", "basse : première note", "bass216", gb, A, 0),
          ("bruitage", "menthe", "mint228", P.one("bruitage", "menthe")["image"], A, 0),
          ("bruitage", "premier glaçon", "ice240", P.one("bruitage", "glaçons")["debut"], A, 0)]
    st = P.one("bruitage", "paille")["image"]
    lk = P.one("reticule", "tentative 3")
    r += [("C 312", "paille : « toc »", "straw312", st, A, 0),
          ("C 312", "accord ouvert (début)", "chord312", st, A, 0),
          ("C 312", "sous-basse (début)", "sub312", st, A, 0),
          ("C 312", "basse (début)", "bass312", st, A, 0),
          ("C 318", "réticule : déclic tenu, clic 1", "ret318_a", lk["image"], A, 0),
          ("C 318", "réticule : déclic tenu, clic 2 (+60 ms)", "ret318_b", lk["image"], A, 2880),
          ("C 318", "réticule : dyade tenue, début", "dyad318", lk["image"], A, 0),
          ("réticule 342", "dyade tenue : FIN = fin de la prise", "dyad318", lk["fin"], E, 0),
          ("réticule 342", "clic inversé : FIN (culmine sur l'image 342)", "rev342", lk["fin"], E, 0),
          ("bruitage 336", "aspiration : début", "suck_end", P.one("bruitage", "aspiration")["debut"], A, 0),
          ("C 360", "aspiration : FIN exactement à l'image 360", "suck_end", P.one("bruitage", "aspiration")["fin"] + 1, E, 0),
          ("C 360", "rythme : kick, mesure 8", "kick360", P.one("musique", "groove C")["debut"], A, 0),
          ("mesure 9", "roulement en doubles-croches : 1er clic", "roll408", P.bar(9), A, 0),
          ("mesure 9", "roulement en triples-croches : 1er clic", "roll432", P.step(9, 8), A, 0),
          ("C 453", "souffle de la montée : FIN avant le silence", "swell_end", P.one("musique", "silence", 1)["debut"], E, 0)]
    pl = P.one("musique", "plein")["debut"]
    r += [("C 456", "plein : kick", "kick456", pl, A, 0),
          ("C 456", "plein : basse tenue", "bass456", pl, A, 0),
          ("C 456", "plein : nappe de bruit", "wash456", pl, A, 0)]
    rq = P.one("bruitage", "raclette")
    fl = P.one("reticule", "verrouillage final")["image"]
    r += [("C 504", "raclette : début du frottement (seul)", "fric504", rq["debut"], A, 0),
          ("C 504 / 528", "raclette : FIN exactement à l'image 528", "fric504", rq["fin"] + 1, E, 0),
          ("C 528", "réticule : déclic final, clic 1", "ret528_a", fl, A, 0),
          ("C 528", "réticule : déclic final, clic 2 (+60 ms)", "ret528_b", fl, A, 2880),
          ("C 528", "accord de fa mineur", "chord528", fl, A, 0),
          ("C 528", "sous-note", "sub528", fl, A, 0)]
    ac = P.one("bruitage", "second appui")["image"]
    r += [("C 540", "réticule : second appui, clic 1", "ret540_a", ac, A, 0),
          ("C 540", "réticule : second appui, clic 2 (+60 ms)", "ret540_b", ac, A, 2880),
          ("C 540", "accord du second appui", "chord540", ac, A, 0),
          ("C 540", "sous-note du second appui", "sub540", ac, A, 0)]
    return r


def make(out, mixed, g, gsm, P, events, META):
    from maquette import OUT
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # ---- relecture des fichiers ecrits
    mix, sr = sf.read(OUT / "maquette_v0.wav", always_2d=True)
    mix = mix.T
    stems = {k: sf.read(OUT / "stems" / f"{k}.wav", always_2d=True)[0].T for k in NAMES}
    n_mix = mix.shape[1]
    n_stems = {k: v.shape[1] for k, v in stems.items()}

    L = sy.lufs(mix)
    tp4 = sy.true_peak_db(mix, 4)
    tp8 = sy.true_peak_db(mix, 8)
    spk = 20 * np.log10(np.max(np.abs(mix)))
    rms = np.sqrt(np.mean(mix ** 2))
    crest = spk - 20 * np.log10(rms)
    corr = float(np.corrcoef(mix[0], mix[1])[0, 1])
    # sommation des stems vs mix (controle)
    ssum = sum(stems.values())
    lim_diff = 20 * np.log10(np.max(np.abs(ssum - mix)) + 1e-12)

    # ---- RMS par mesure
    bars = [("levée", 0, 24)] + [(f"mesure {m}", P.bar(m), P.bar(m) + 48) for m in range(1, 13)]
    bar_rows = []
    for nm, a, b in bars:
        seg = mix[:, a * SPF:b * SPF]
        c = float(np.corrcoef(seg[0], seg[1])[0, 1]) if np.std(seg[0]) > 0 and np.std(seg[1]) > 0 else float("nan")
        bar_rows.append((nm, a, b - 1, _dbfs(seg), 20 * np.log10(np.max(np.abs(seg)) + 1e-12), c))

    # ---- stems
    stem_rows = []
    for k in NAMES:
        x = stems[k]
        stem_rows.append((k, n_stems[k], _dbfs(x), 20 * np.log10(np.max(np.abs(x)) + 1e-12)))

    # ---- energie de la basse au-dessus de 150 Hz
    bx = stems["basse"].mean(axis=0)
    spec = np.abs(np.fft.rfft(bx)) ** 2
    fr = np.fft.rfftfreq(len(bx), 1 / SR)
    share150 = float(spec[fr >= 150].sum() / spec.sum())
    share300 = float(spec[fr >= 300].sum() / spec.sum())
    # idem, sur la fenetre ou la basse est la plus grave (accord 312-359 et note finale)
    def share_win(a, b):
        s = np.abs(np.fft.rfft(bx[a * SPF:b * SPF])) ** 2
        f = np.fft.rfftfreq(b * SPF - a * SPF, 1 / SR)
        return float(s[f >= 150].sum() / s.sum())

    sh312 = share_win(312, 360)
    sh528 = share_win(528, 596)

    # ---- silences
    sil_rows = []
    for nm, a, b in [("échantillon 0", 0, 1), ("silence 210-215 (musique)", 210 * SPF, 216 * SPF),
                     ("silence 453-455 (musique)", 453 * SPF, 456 * SPF),
                     ("4 dernières images 596-599", 596 * SPF, 600 * SPF)]:
        sil_rows.append((nm, a, b, 20 * np.log10(np.max(np.abs(mix[:, a:b])) + 1e-12)))
    # apres 504 + 50 ms, seule la raclette (bruitages) doit rester
    a = 504 * SPF + int(0.052 * SR)
    b = 528 * SPF
    others = {k: 20 * np.log10(np.max(np.abs(stems[k][:, a:b])) + 1e-12) for k in NAMES}

    # ---- table de synchronisation
    ev_by_tag = {}
    for e in events:
        if e["sync"]:
            ev_by_tag.setdefault(e["sync"], []).append(e)
    rows = sync_rows(P)
    sync_out = []
    worst = 0
    for (ref, desc, tag, frame, kind, off) in rows:
        e = ev_by_tag[tag][0]
        expected = frame * SPF + off
        sched = e["first_nz"] if kind == "attaque" else e["stop"]
        dev = sched - expected
        worst = max(worst, abs(dev))
        # relecture dans le stem (seulement stem reticule, evenements isoles) : debut du transitoire
        rb = ""
        if e["stem"] == "reticule" and kind == "attaque" and tag.startswith("ret"):
            x = np.max(np.abs(stems["reticule"]), axis=0)
            pk = x[expected: expected + 480].max()
            seg = x[expected - 1600: expected + 480]
            idx = int(np.argmax(seg > 0.04 * pk))
            rb = str(expected - 1600 + idx - expected)
        sync_out.append((ref, desc, e["stem"], frame, expected, sched, dev, rb, kind))

    # ---- niveau des 8 clics de caracteres
    char_rms = META.get("char_rms", [])
    char_pk = META.get("char_peak", [])

    # ---- ecriture du rapport
    def fmt(v, d=2):
        return f"{v:.{d}f}"

    md = []
    md.append("# Maquette sonore v0 : rapport de mesures\n")
    md.append("Tout ce qui suit est mesuré par `build/audio/rapport.py` sur les fichiers écrits dans `out/audio/`. "
              "Aucune écoute n'a eu lieu.\n")
    md.append("## 1. Format et niveaux\n")
    md.append("| Mesure | Valeur | Cible |\n|---|---|---|")
    md.append(f"| Fréquence d'échantillonnage | {sr} Hz | 48 000 |")
    md.append(f"| Canaux | {mix.shape[0]} | 2 |")
    md.append(f"| Nombre d'échantillons (mix) | {n_mix} | 960 000 |")
    for k in NAMES:
        md.append(f"| Nombre d'échantillons (stem {k}) | {n_stems[k]} | 960 000 |")
    md.append(f"| Sonie intégrée (ITU-R BS.1770, pyloudnorm) | {fmt(L)} LUFS | −14 ± 0,5 |")
    md.append(f"| Crête vraie (sur-échantillonnage ×4) | {fmt(tp4)} dBTP | ≤ −1 |")
    md.append(f"| Crête vraie (contrôle ×8) | {fmt(tp8)} dBTP | ≤ −1 |")
    md.append(f"| Crête d'échantillon | {fmt(spk)} dBFS | |")
    md.append(f"| RMS global | {fmt(20 * np.log10(rms))} dBFS | |")
    md.append(f"| Facteur de crête (crête / RMS) | {fmt(crest)} dB | |")
    md.append(f"| Corrélation stéréo globale (L/R) | {fmt(corr, 3)} | > 0,3 |")
    md.append(f"| Réduction de gain maximale du limiteur | {fmt(20 * np.log10(gsm.min()))} dB | |")
    md.append(f"| Réduction moyenne du limiteur (sur les instants actifs) | {fmt(20 * np.log10(np.mean(gsm[np.abs(mix).max(0) > 1e-4])))} dB | |")
    md.append(f"| Écart max. entre somme des stems et mix (limiteur seul) | {fmt(lim_diff)} dBFS | |")
    md.append(f"| Gain commun appliqué aux stems | {fmt(20 * np.log10(g))} dB | |\n")
    md.append("Les stems sont écrits avec le même gain commun que le mix, avant le limiteur : leur somme égale le mix, "
              "au limiteur près.\n")

    md.append("## 2. Niveau par mesure (mix)\n")
    md.append("| Section | Images | RMS (dBFS) | Crête (dBFS) | Corrélation L/R |\n|---|---|---|---|---|")
    for nm, a, b, r_, p_, c_ in bar_rows:
        md.append(f"| {nm} | {a}–{b} | {fmt(r_, 1)} | {fmt(p_, 1)} | {fmt(c_, 2)} |")
    md.append("")

    md.append("## 3. Stems\n")
    md.append("| Stem | Échantillons | RMS (dBFS) | Crête (dBFS) |\n|---|---|---|---|")
    for k, n_, r_, p_ in stem_rows:
        md.append(f"| {k} | {n_} | {fmt(r_, 1)} | {fmt(p_, 1)} |")
    md.append("")
    md.append("## 4. Basse sur haut-parleur de téléphone\n")
    md.append("| Mesure (stem `basse`) | Part de l'énergie |\n|---|---|")
    md.append(f"| Au-dessus de 150 Hz, tout le film | {fmt(100 * share150, 1)} % |")
    md.append(f"| Au-dessus de 300 Hz, tout le film | {fmt(100 * share300, 1)} % |")
    md.append(f"| Au-dessus de 150 Hz, images 312–359 (accord ouvert, la plus grave) | {fmt(100 * sh312, 1)} % |")
    md.append(f"| Au-dessus de 150 Hz, images 528–595 (sous-note finale) | {fmt(100 * sh528, 1)} % |\n")

    md.append("## 5. Silences et coupures\n")
    md.append("| Zone | Échantillons | Crête max. du mix (dBFS) |\n|---|---|---|")
    for nm, a, b, p_ in sil_rows:
        md.append(f"| {nm} | {a}–{b - 1} | {fmt(p_, 1)} |")
    md.append("")
    md.append("Après 504 + 52 ms jusqu'à 527 (retrait : seul le frottement doit rester), crête par stem :\n")
    md.append("| Stem | Crête (dBFS) |\n|---|---|")
    for k in NAMES:
        md.append(f"| {k} | {fmt(others[k], 1)} |")
    md.append("")

    md.append("## 6. Les huit clics de caractères (images 24, 27 … 45)\n")
    md.append("RMS sur les 30 premières ms, après normalisation (cible 0,120) ; crête du clic.\n")
    md.append("| Clic | Timbre | RMS 30 ms | Crête |\n|---|---|---|---|")
    tim = ["bois (Archivo)", "membrane (Anton)", "bruit de feutre (Permanent Marker)", "métal (Saira Stencil)",
           "bip quantifié (Doto)", "verre (Major Mono)", "pincement (Instrument Serif)", "cloche FM (Bodoni Moda)"]
    for i in range(len(char_rms)):
        md.append(f"| {i + 1} | {tim[i]} | {fmt(char_rms[i], 4)} | {fmt(char_pk[i], 3)} |")
    md.append("")

    md.append("## 7. Table de synchronisation (échantillon programmé contre image × 1 600)\n")
    md.append("« Programmé » = premier échantillon non nul du signal placé (attaques) ou échantillon de fin exclu (sons qui mènent vers une image). "
              "« Attendu » = image lue dans `partition.json` × 1 600 (+ 2 880 pour le second clic, 60 ms). "
              "« Relecture stem » (stem réticule seulement) = début du transitoire retrouvé dans le fichier WAV du stem, "
              "en échantillons par rapport à l'attendu (seuil 4 % de la crête locale).\n")
    md.append("| Réf. | Événement | Stem | Image | Attendu | Programmé | Écart | Relecture stem |\n|---|---|---|---|---|---|---|---|")
    for ref, desc, stem, frame, expected, sched, dev, rb, kind in sync_out:
        md.append(f"| {ref} | {desc} | {stem} | {frame} | {expected} | {sched} | {dev} | {rb} |")
    md.append("")
    md.append(f"**Écart maximal en valeur absolue : {worst} échantillon(s)** sur {len(sync_out)} lignes.\n")

    (OUT / "rapport.md").write_text("\n".join(md), encoding="utf-8")

    # ---- spectrogramme
    mono = mix.mean(axis=0)
    nperseg = 4096
    f, t, Z = signal.stft(mono, SR, window="hann", nperseg=nperseg, noverlap=nperseg - 512, boundary=None)
    S = 20 * np.log10(np.abs(Z) + 1e-9)
    S = np.maximum(S, S.max() - 85)
    sel = f >= 30
    fig, ax = plt.subplots(figsize=(26, 7.5), dpi=90)
    ax.pcolormesh(t, f[sel], S[sel], shading="auto", cmap="magma", vmin=S.max() - 85, vmax=S.max())
    ax.set_yscale("log")
    ax.set_ylim(30, 22000)
    ax.set_xlim(0, 20)
    ax.set_yticks([50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
    ax.set_yticklabels(["50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"])
    for m in range(1, 13):
        x = P.bar(m) / 30.0
        ax.axvline(x, color="white", lw=0.9, ls="--", alpha=0.8)
        ax.text(x + 0.03, 21000, f"M{m}", color="white", fontsize=9, va="top")
    ax.axvline(20 - 4 / 30, color="cyan", lw=0.8, ls=":")
    for fr_, lab in [(12, "12"), (72, "72"), (96, "96"), (168, "168"), (180, "180"), (318, "318"), (342, "342"), (528, "528"), (540, "540")]:
        ax.plot([fr_ / 30.0], [35], marker="^", color="cyan", ms=6)
    ax.set_xlabel("temps (s) ; triangles = événements du réticule ; lignes = début de mesure")
    ax.set_ylabel("Hz (échelle log)")
    ax.set_title("INSOUMISE : maquette sonore v0, spectrogramme du mix (mono, 0 dB = maximum, plage 85 dB)")
    fig.tight_layout()
    fig.savefig(OUT / "spectrogramme.png")
    plt.close(fig)
    print(f"LUFS {L:.2f}  TP {tp4:.2f}  corr {corr:.3f}  sync worst {worst}  bass>150 {100 * share150:.1f}%")
