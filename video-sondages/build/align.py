#!/usr/bin/env python3
"""Découpe la narration en unités (entre deux pauses), resserre les silences,
accélère légèrement, et produit timeline.json (unités, sous-titres, scènes)."""
import json, subprocess, sys, re, wave
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
TEMPO = float(sys.argv[1]) if len(sys.argv) > 1 else 1.12
GAP = {",": 0.14, ".": 0.26, "§": 0.45}   # pause après l'unité (avant accélération)

# (début, fin, type de fin, sous-titres, coupé ?)  — temps mesurés dans chaque fichier s#.mp3
S = {
 1: [(0.00, 1.87, ".", ["Ce sondage", "que vous avez vu", "ce matin…"]),
     (2.24, 3.26, ".", ["vous savez", "*qui l'a payé ?*"]),
     (3.80, 5.54, "§", ["Et à qui appartient", "*l'institut*", "qui l'a fait ?"]),
     (6.07, 7.23, ".", ["Restez trente secondes."], True),
     (7.51, 8.45, "§", ["Vous allez comprendre."], True)],
 2: [(0.00, 1.77, ",", ["*Présidentielle 2027 :*"]),
     (2.04, 2.88, ".", ["plus que", "*cinq mois.*"]),
     (3.40, 6.32, ",", ["Et chaque semaine,", "des sondages décident", "qui est *crédible…*"]),
     (6.63, 7.42, "§", ["et qui", "*ne l'est plus.*"])],
 3: [(0.00, 0.98, ".", ["Premier exemple."]),
     (1.56, 5.32, ".", ["L'institut *CSA*", "appartient à *Havas,*", "contrôlé par", "la famille *Bolloré.*"]),
     (5.91, 9.66, ",", ["Le 4 novembre,", "CSA publie un sondage", "sur la présidentielle…"]),
     (10.24, 12.59, ".", ["pour *CNews,*", "*Europe 1*", "et *le JDD.*"]),
     (13.17, 14.92, ".", ["Trois médias", "de la galaxie *Bolloré.*"]),
     (15.61, 16.54, ".", ["Bolloré *sonde.*"]),
     (17.10, 18.22, ".", ["Bolloré *diffuse.*"]),
     (18.80, 19.88, "§", ["Bolloré *commente.*"])],
 4: [(0.00, 0.77, ".", ["*OpinionWay ?*"]),
     (1.49, 2.43, ",", ["En 2022,"]),
     (2.59, 6.07, ".", ["le groupe", "Les Échos–Le Parisien", "annonce en prendre", "*75 %.*"]),
     (6.60, 7.39, ",", ["Propriétaire :"]),
     (7.70, 8.49, ".", ["*LVMH.*"]),
     (8.80, 9.79, ".", ["*Bernard Arnault.*"]),
     (10.46, 10.94, ".", ["*L'Ifop ?*"]),
     (11.47, 13.02, ".", ["Racheté par", "un *fonds d'investissement.*"]),
     (13.63, 14.18, ".", ["*Ipsos ?*"]),
     (14.67, 15.50, ",", ["Coté en *Bourse…*"]),
     (15.95, 18.31, ".", ["et il a avalé", "*BVA* en 2025."]),
     (18.94, 22.50, "§", ["Une poignée d'acteurs", "se partage l'opinion", "de *68 millions*", "de Français."])],
 5: [(0.00, 0.97, ".", ["Et qui", "*passe commande ?*"]),
     (1.49, 4.84, ",", ["En 2025,", "une méga-enquête *Ifop*", "sur la présidentielle,"]),
     (5.15, 6.54, ",", ["plus de", "*9 000 personnes,*"]),
     (6.78, 9.52, ".", ["est commandée par", "un observatoire", "nommé *Hexagone.*"]),
     (10.27, 11.14, ",", ["Devant les députés,"]),
     (11.52, 14.40, ",", ["on apprend qu'Hexagone", "est largement financé", "par *Périclès…*"]),
     (14.80, 17.09, ",", ["le projet du milliardaire", "*Pierre-Édouard Stérin,*"]),
     (17.49, 20.00, "§", ["conçu pour faire gagner", "la droite", "et *l'extrême droite.*"])],
 6: [(0.00, 0.55, ",", ["*Attention :*"]),
     (0.98, 3.00, ".", ["personne ne dit", "que les chiffres", "sont inventés."]),
     (3.47, 5.01, ".", ["Le problème,", "c'est *tout le reste.*"]),
     (5.70, 7.78, ",", ["Un sondage,", "c'est environ", "*1 000 personnes,*"]),
     (8.15, 9.89, ".", ["et jusqu'à *3 points*", "de marge d'erreur."]),
     (10.56, 12.54, ",", ["Les réponses brutes", "sont ensuite *redressées,*"]),
     (12.98, 14.68, ".", ["c'est-à-dire *corrigées*", "par l'institut."]),
     (15.30, 16.08, ".", ["Les chiffres bruts ?"]),
     (16.67, 17.61, ".", ["Vous ne les verrez", "*jamais.*"]),
     (18.16, 19.03, ",", ["Dès 2010,"], True),
     (19.34, 20.22, ",", ["deux sénateurs,"], True),
     (20.47, 21.15, ",", ["un de droite,"], True),
     (21.35, 21.99, ",", ["un de gauche,"], True),
     (22.37, 23.70, ".", ["réclamaient", "la transparence."], True),
     (24.37, 25.62, ",", ["Et le 5 novembre dernier,"]),
     (26.04, 30.98, "§", ["la Commission des sondages", "a encore dû réclamer", "aux instituts", "plus de *clarté*", "sur leurs *marges d'erreur.*"])],
 7: [(0.00, 1.03, ".", ["Le pouvoir *le sait.*"]),
     (1.56, 2.36, ",", ["Sous Sarkozy,"]),
     (2.68, 5.05, ",", ["*l'Élysée* commandait", "des sondages", "sur *fonds publics,*"]),
     (5.23, 6.20, ".", ["sans appel d'offres :"]),
     (6.70, 9.55, ".", ["Claude Guéant", "a été *condamné*", "en appel en 2025."]),
     (10.13, 10.68, ",", ["Aujourd'hui,"]),
     (11.01, 15.77, ".", ["des responsables politiques", "envisagent carrément", "de laisser *les sondages*", "départager", "leurs candidats."]),
     (16.44, 19.18, ".", ["Un chiffre", "répété en boucle", "devient une *prophétie :*"]),
     (19.57, 20.68, ",", ["on vote *utile,*"]),
     (21.01, 22.78, ",", ["on lâche celui", "qui ne décolle pas…"]),
     (23.38, 24.72, "§", ["*avant même*", "le premier tour."])],
 8: [(0.00, 3.36, ".", ["Alors la prochaine fois", "qu'on vous montre", "un sondage,", "posez *trois questions.*"]),
     (3.87, 4.63, ".", ["*Qui l'a commandé ?*"]),
     (5.17, 6.53, ".", ["À qui appartient", "*l'institut ?*"]),
     (7.13, 8.35, ".", ["Quelle est", "*la marge d'erreur ?*"]),
     (8.91, 9.72, ",", ["Tout est *public,*"]),
     (9.97, 11.95, ".", ["sur le site de la", "*Commission des sondages.*"]),
     (12.50, 13.89, ".", ["*Votre vote*", "vous appartient."]),
     (14.41, 15.31, ".", ["Pas à *leurs courbes.*"]),
     (15.94, 17.60, "§", ["*Partagez*", "avant le prochain sondage."])],
}
KEEP_CUTS = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[2] else set()  # ex: "6" pour garder le Sénat

SPOKEN = [("2027", "deux mille vingt-sept"), ("2022", "deux mille vingt-deux"), ("2025", "deux mille vingt-cinq"),
          ("2010", "deux mille dix"), ("9 000", "neuf mille"), ("1 000", "mille"), ("75 %", "soixante-quinze pour cent"),
          ("68", "soixante-huit"), ("CSA", "cé esse a"), ("JDD", "ji dé dé"), ("LVMH", "elle vé ème ache"),
          ("BVA", "bé vé a"), ("Europe 1", "Europe un"), ("4 ", "quatre "), ("5 ", "cinq "), ("3 ", "trois ")]

def weight(txt):
    t = txt.replace("*", "")
    for a, b in SPOKEN:
        t = t.replace(a, b)
    return len(re.sub(r"[^\wÀ-ÿ]", "", t)) + 2.0 + (3.0 if t.rstrip().endswith((",", "…", ":")) else 0)

def load(i):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(ROOT / f"audio/s{i}.mp3"), "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

out, units, scenes, t = [], [], [], 0.35   # petite amorce de silence
out.append(np.zeros(int(t * SR), np.float32))
PAD = 0.035
for i in range(1, 9):
    a = load(i)
    kept = [u for u in S[i] if not (len(u) > 4 and u[4] and str(i) not in KEEP_CUTS)]
    sc0 = t
    for k, u in enumerate(kept):
        t0, t1, end, subs = u[:4]
        i0, i1 = int(max(0, t0 - PAD) * SR), int(min(len(a) / SR, t1 + PAD) * SR)
        seg = a[i0:i1].copy()
        f = int(0.012 * SR)
        seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f)
        d = len(seg) / SR
        if k == len(kept) - 1:
            end = "§"
        ws = [weight(s) for s in subs]
        tot, acc, sl = sum(ws), 0.0, []
        for s, w in zip(subs, ws):
            sl.append({"text": s, "start": t + d * acc / tot, "end": t + d * (acc + w) / tot}); acc += w
        units.append({"id": f"s{i}u{S[i].index(u) + 1}", "scene": i, "start": t, "end": t + d, "subs": sl})
        out.append(seg); t += d
        g = GAP[end]; out.append(np.zeros(int(g * SR), np.float32)); t += g
    scenes.append({"id": i, "start": sc0, "end": t})
out.append(np.zeros(int(0.9 * SR), np.float32)); t += 0.9
audio = np.concatenate(out)

def sc(x): return round(x / TEMPO, 4)
for u in units:
    u["start"], u["end"] = sc(u["start"]), sc(u["end"])
    for s in u["subs"]:
        s["start"], s["end"] = sc(s["start"]), sc(s["end"])
for s in scenes:
    s["start"], s["end"] = sc(s["start"]), sc(s["end"])
scenes[0]["start"] = 0.0
total = round(len(audio) / SR / TEMPO, 3)
scenes[-1]["end"] = total

(ROOT / "build/out").mkdir(parents=True, exist_ok=True)
tmp = ROOT / "build/out/narration_raw.wav"
with wave.open(str(tmp), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af",
                f"atempo={TEMPO},highpass=f=70,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120,loudnorm=I=-15:TP=-1.5:LRA=7",
                "-ar", "48000", str(ROOT / "build/out/narration.wav")], check=True)
json.dump({"tempo": TEMPO, "total": total, "fps": 30, "scenes": scenes, "units": units},
          open(ROOT / "build/out/timeline.json", "w"), ensure_ascii=False, indent=1)
print(f"tempo {TEMPO}  total {total:.2f}s")
for s in scenes:
    print(f"  scène {s['id']}: {s['start']:6.2f} → {s['end']:6.2f}  ({s['end'] - s['start']:.2f}s)")
