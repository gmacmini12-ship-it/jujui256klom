#!/opt/og/venv/bin/python
"""Contrôle qualité du film final : mesures image par image, planches de relecture, raccords, mesures du son.

    /opt/og/venv/bin/python build/final/qc.py            ->  out/qc/

Sorties :
  mesures.json          par image : luminance moyenne, écart à l'image précédente, image identique à la précédente ;
                        conformité du fichier vidéo ; niveaux sonores (LUFS, crête vraie) ; énergie sonore par image
  planche_NN.png        une image sur trois, vingt par planche (numéro d'image incrusté)
  raccord_AAA_BBB.png   les six images autour de chaque changement de séquence, et la boucle 599 -> 0
  alertes.txt           ce que les mesures signalent : sauts de luminance, images figées hors des plages prévues
"""
import json
import pathlib
import re
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fx_common as X  # noqa: E402

QC = X.ROOT / "out" / "qc"
VIDEO = X.FINAL / "insoumise_wip.mp4"
RACCORDS = [(71, 72), (215, 216), (359, 360), (455, 456), (527, 528), (593, 594), (599, 0)]
FIGEES_PREVUES = [(0, 5), (574, 599)]          # logo à plat au début, signature tenue à la fin


def lire(f, taille=None):
    im = cv2.imread(str(X.MASTER / f"f{f:04d}.png"), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"master absent : {f}")
    im = im[..., :3]
    if taille:
        im = cv2.resize(im, taille, interpolation=cv2.INTER_AREA)
    return im


def vignette(f, taille):
    im = (lire(f, taille) / 257).astype(np.uint8)
    cv2.rectangle(im, (0, 0), (78, 26), (0, 0, 0), -1)
    cv2.putText(im, str(f), (5, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    return im


def mesures_images():
    lignes, prec = [], None
    for f in range(X.NFRAMES):
        petit = lire(f, (270, 480)).astype(np.float32) / 65535
        luma = float((petit @ np.array([0.0722, 0.7152, 0.2126], np.float32)).mean())        # ordre BGR
        ecart = float(np.abs(petit - prec).mean()) if prec is not None else 0.0
        identique = bool(prec is not None and np.array_equal(petit, prec))
        lignes.append(dict(f=f, luma=round(luma, 5), ecart=round(ecart, 5), identique=identique))
        prec = petit
    return lignes


def planches():
    choix = list(range(0, X.NFRAMES, 3))
    for k in range(0, len(choix), 20):
        lot = [vignette(f, (384, 683)) for f in choix[k:k + 20]]
        while len(lot) < 20:
            lot.append(np.zeros_like(lot[0]))
        cv2.imwrite(str(QC / f"planche_{k // 20:02d}.png"), np.vstack([np.hstack(lot[i:i + 5]) for i in range(0, 20, 5)]))


def raccords():
    for a, b in RACCORDS:
        suite = [(a - 2) % X.NFRAMES, (a - 1) % X.NFRAMES, a, b, (b + 1) % X.NFRAMES, (b + 2) % X.NFRAMES]
        cv2.imwrite(str(QC / f"raccord_{a:03d}_{b:03d}.png"), np.hstack([vignette(f, (432, 768)) for f in suite]))


def mesures_video():
    sonde = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                            "format=duration,size,bit_rate:stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames,sample_rate,channels",
                            "-of", "json", str(VIDEO)], capture_output=True, text=True)
    return json.loads(sonde.stdout)


def mesures_son():
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(VIDEO), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    fin = r[r.rfind("Summary:"):]
    val = lambda motif: (float(m.group(1)) if (m := re.search(motif, fin)) else None)
    resume = dict(lufs=val(r"I:\s+(-?[0-9.]+) LUFS"), lra=val(r"LRA:\s+(-?[0-9.]+) LU"), crete_vraie_dbtp=val(r"Peak:\s+(-?[0-9.]+) dBFS"))
    # énergie par image du film (48 kHz, 1600 échantillons par image), en dB
    brut = subprocess.run(["ffmpeg", "-v", "error", "-i", str(VIDEO), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(brut, np.float32)
    n = min(len(x) // 1600, X.NFRAMES)
    rms = np.sqrt((x[:n * 1600].reshape(n, 1600) ** 2).mean(1) + 1e-12)
    resume["energie_db_par_image"] = [round(float(20 * np.log10(v)), 1) for v in rms]
    resume["echantillons"] = int(len(x))
    return resume


def alertes(images):
    msgs = []
    figee = lambda f: any(a <= f <= b for a, b in FIGEES_PREVUES)
    for i in images[1:]:
        f = i["f"]
        if i["identique"] and not (figee(f) and figee(f - 1)):
            msgs.append(f"image {f} identique à la précédente hors des plages figées prévues")
    lum = [i["luma"] for i in images]
    for f in range(1, X.NFRAMES):
        d = lum[f] - lum[f - 1]
        if abs(d) > 0.045:
            msgs.append(f"saut de luminance de {d:+.3f} entre {f - 1} et {f}")
    return msgs


if __name__ == "__main__":
    QC.mkdir(parents=True, exist_ok=True)
    images = mesures_images()
    planches()
    raccords()
    video = mesures_video()
    son = mesures_son()
    msgs = alertes(images)
    json.dump(dict(images=images, video=video, son=son, alertes=msgs), open(QC / "mesures.json", "w"), indent=1, ensure_ascii=False)
    open(QC / "alertes.txt", "w").write("\n".join(msgs) + "\n")
    v = next(s for s in video["streams"] if s.get("codec_name") == "h264")
    print(f"vidéo : {v['width']}x{v['height']}, {v['r_frame_rate']} i/s, {v['nb_frames']} images, {video['format']['duration']} s, {v['profile']}, {v['pix_fmt']}")
    print(f"son : {son['lufs']} LUFS, crête vraie {son['crete_vraie_dbtp']} dBTP, LRA {son['lra']} LU, {son['echantillons']} échantillons")
    print(f"{len(msgs)} alertes :")
    for m in msgs:
        print("  ", m)
