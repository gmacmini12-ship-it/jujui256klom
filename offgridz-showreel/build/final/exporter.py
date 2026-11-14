#!/opt/og/venv/bin/python
"""Export de diffusion du film final, depuis les images maîtresses, sans rien recomposer.

    /opt/og/venv/bin/python build/final/exporter.py [sortie.mp4] [--temoin fichier_valide.mp4] [--controle-seul]

Entrées : out/final/master/f0000.png … f0599.png (1080 × 1920, 16 bits, composées par compose.py) et la bande son
validée (out/audio/insoumise_v1_diffusion.wav). Aucune image n'est redimensionnée : la conversion de couleur est
celle de l'encodage validé (fx_encode.VF), le son passe par la même chaîne (fx_encode.AF).

Sortie : MP4, H.264 High niveau 4.1, qualité constante (CRF 12), débit plafonné aux limites du niveau (62,5 Mb/s,
tampon 78,125 Mb) pour que le fichier reste lisible sur tout appareil ; AAC 320 kb/s ; 30 images/s ; 20 s.
Un plafond plus bas (40 Mb/s, essayé le 14 novembre) dégradait le film d'encre (15,2 à 17,6 s), qui demande
ponctuellement plus : c'est la séquence à surveiller.

Puis contrôle du fichier produit, écrit dans <sortie>.controle.json ; le code de sortie vaut 1 si un contrôle échoue :
  - propriétés lues par FFprobe, décodage complet sans erreur, débit dans les limites du niveau ;
  - perte d'encodage, sur les 600 images : PSNR de la luminance entre le fichier et les images maîtresses converties
    sans perte au format de diffusion (4:2:0, 8 bits). On mesure ainsi l'encodeur, pas le format ;
  - détail natif : le fichier est réduit à 512 × 910 puis ragrandi ; s'il n'était qu'un agrandissement, il en
    sortirait presque intact (PSNR élevé). Indice, pas preuve : étalonné le 14 novembre (voir le README) ;
  - niveaux sonores après décodage ;
  - avec --temoin : comparaison au fichier déjà validé (fidélité par séquence, bande son identique).
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fx_common as X  # noqa: E402
import fx_encode as E  # noqa: E402

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
TEMOIN = pathlib.Path(sys.argv[sys.argv.index("--temoin") + 1]) if "--temoin" in sys.argv else None
if TEMOIN is not None:
    ARGS.remove(str(TEMOIN))
SORTIE = pathlib.Path(ARGS[0]) if ARGS else X.ROOT / "out" / "livraison" / "OFFGRIDZ_INSOUMISE_FINAL_1080x1920.mp4"
QUALITE = 12                                             # qualité constante x264 (le fichier du 13 novembre : 13)
NIVEAU, DEBIT_MAX_KBPS, TAMPON_KB = "4.1", 62500, 78125  # limites du niveau 4.1 en profil High
SEQUENCES = (("0 Épreuve", 0, 23), ("1 Déchirure", 24, 71), ("2 Grains", 72, 215), ("3 Mojito", 216, 359),
             ("4 Données", 360, 455), ("5 Fond perdu", 456, 527), ("6 Signature", 528, 599))
PSNR_MINIMAL, ALLER_RETOUR_MAX = 40.0, 38.0              # dB : perte d'encodage tolérée ; médiane au-delà de laquelle on soupçonne un agrandissement


def lire_maitre(f):
    im = cv2.imread(str(X.MASTER / f"f{f:04d}.png"), cv2.IMREAD_UNCHANGED)
    if im is None or im.shape != (X.H, X.W, 3) or im.dtype != np.uint16:
        raise SystemExit(f"image maîtresse inattendue : {f} {None if im is None else (im.shape, im.dtype)}")
    return np.ascontiguousarray(im[..., ::-1]).astype("<u2").tobytes()                # BGR -> RGB, 16 bits

ENTREE_MAITRES = ["-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{X.W}x{X.H}", "-r", str(X.FPS), "-i", "-"]


def nourrir(cmd):
    """Lance FFmpeg et lui envoie les 600 images maîtresses sur son entrée standard."""
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in range(X.NFRAMES):
        p.stdin.write(lire_maitre(f))
    p.stdin.close()
    return p.wait()


def encoder():
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    code = nourrir(["ffmpeg", "-y", "-loglevel", "error", *ENTREE_MAITRES, "-i", str(E.WAV), "-map", "0:v:0", "-map", "1:a:0",
                    "-vf", E.VF, "-c:v", "libx264", "-profile:v", "high", "-level:v", NIVEAU, "-preset", "slow", "-crf", str(QUALITE),
                    "-maxrate", f"{DEBIT_MAX_KBPS}k", "-bufsize", f"{TAMPON_KB}k", "-g", "30", "-pix_fmt", "yuv420p", "-r", str(X.FPS),
                    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                    "-af", E.AF, "-c:a", "aac", "-aac_pns", "0", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-t", f"{E.DUR}",
                    "-movflags", "+faststart", str(SORTIE)])
    if code != 0:
        raise SystemExit("EXPORT : l'encodage a échoué")


def sonder(chemin):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,profile,level,width,height,"
                        "coded_width,coded_height,pix_fmt,color_space,color_range,r_frame_rate,avg_frame_rate,nb_frames,"
                        "duration,bit_rate,sample_rate,channels,sample_aspect_ratio:stream_side_data=rotation",
                        "-of", "json", str(chemin)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def decoder_sans_erreur():
    """Décode tout le fichier (image et son) ; renvoie ce que FFmpeg signale, vide si tout va bien."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(SORTIE), "-map", "0", "-f", "null", "-"], capture_output=True, text=True)
    return r.returncode, r.stderr.strip()


def debits_video():
    """Débit maximal sur une seconde glissante (kb/s), et marge minimale du tampon du décodeur (kb).

    Le niveau ne limite pas chaque seconde au débit maximal : il garantit un tampon de TAMPON_KB, rempli à DEBIT_MAX_KBPS
    et vidé de chaque image à son instant de décodage (H.264, annexe C). Le flux est conforme si ce tampon ne se vide
    jamais ; une seconde peut donc dépasser le débit maximal tant que le tampon y suffit. Remplissage initial : 90 %,
    celui que suppose x264."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size", "-of", "csv=p=0", str(SORTIE)],
                       capture_output=True, text=True, check=True)
    bits = np.array([int(x.split(",")[0]) for x in r.stdout.split()], dtype=np.float64) * 8      # paquets dans l'ordre de décodage
    plein = TAMPON_KB * 1000.0
    niveau = marge = 0.9 * plein
    for b in bits:
        niveau -= b
        marge = min(marge, niveau)
        niveau = min(niveau + DEBIT_MAX_KBPS * 1000.0 / X.FPS, plein)
    return float(np.convolve(bits, np.ones(X.FPS), "valid").max() / 1000.0), float(marge) / 1000.0


def lire_psnr(chemin):
    y = [100.0 if m == "inf" else float(m) for m in re.findall(r"psnr_y:(\S+)", open(chemin).read())]
    if len(y) != X.NFRAMES:
        raise SystemExit(f"EXPORT : {len(y)} images comparées au lieu de {X.NFRAMES} ({chemin})")
    return np.array(y)


def perte_encodage(fichiers, dossier):
    """PSNR de la luminance de chaque fichier, image par image, face aux images maîtresses converties en 4:2:0 sans perte."""
    n = len(fichiers)
    graphe = f"[{n}:v]{E.VF},split={n}" + "".join(f"[r{i}]" for i in range(n)) + ";" + ";".join(
        f"[{i}:v][r{i}]psnr=stats_file={dossier}/perte_{i}.log[o{i}]" for i in range(n))
    cmd = ["ffmpeg", "-y", "-v", "error", *sum((["-i", str(f)] for f in fichiers), []), *ENTREE_MAITRES, "-lavfi", graphe,
           *sum((["-map", f"[o{i}]", "-f", "null", "-"] for i in range(n)), [])]
    if nourrir(cmd) != 0:
        raise SystemExit("EXPORT : la comparaison aux images maîtresses a échoué")
    return [lire_psnr(f"{dossier}/perte_{i}.log") for i in range(n)]


def aller_retour_512(dossier):
    """PSNR de la luminance entre le fichier et lui-même réduit à 512 × 910 puis ragrandi : bas si le détail est natif."""
    journal = f"{dossier}/aller_retour.log"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(SORTIE), "-lavfi",
                    f"[0:v]split[a][b];[b]scale=512:910:flags=lanczos,scale={X.W}:{X.H}:flags=lanczos[c];[a][c]psnr=stats_file={journal}",
                    "-f", "null", "-"], check=True)
    return lire_psnr(journal)


def niveaux_son():
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(SORTIE), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    fin = r[r.rfind("Summary:"):]
    val = lambda motif: (float(m.group(1)) if (m := re.search(motif, fin)) else None)
    return val(r"I:\s+(-?[0-9.]+) LUFS"), val(r"Peak:\s+(-?[0-9.]+) dBFS")


def empreinte_son(chemin):
    """Empreinte du flux AAC tel qu'il est dans le fichier (paquets copiés, sans décodage)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(chemin), "-map", "0:a:0", "-c", "copy", "-f", "adts", "-"], capture_output=True, check=True)
    return hashlib.sha256(r.stdout).hexdigest()


def par_sequence(y):
    return {nom: dict(moyen=round(float(y[a:b + 1].mean()), 2), minimal=round(float(y[a:b + 1].min()), 2), image=a + int(y[a:b + 1].argmin()))
            for nom, a, b in SEQUENCES}


if __name__ == "__main__":
    if "--controle-seul" not in sys.argv:
        encoder()
    s = sonder(SORTIE)
    v = next(x for x in s["streams"] if x["codec_type"] == "video")
    a = next(x for x in s["streams"] if x["codec_type"] == "audio")
    code, erreurs = decoder_sans_erreur()
    crete_debit, marge_tampon = debits_video()
    with tempfile.TemporaryDirectory() as dossier:
        pertes = perte_encodage([SORTIE] + ([TEMOIN] if TEMOIN else []), dossier)
        retour = aller_retour_512(dossier)
    y = pertes[0]
    lufs, crete = niveaux_son()
    controles = {
        "résolution 1080 × 1920": (v["width"], v["height"]) == (1080, 1920) and (v["coded_width"], v["coded_height"]) == (1080, 1920),
        "aucune rotation ni pixel non carré": not v.get("side_data_list") and v.get("sample_aspect_ratio", "1:1") in ("1:1", "N/A", "0:1"),
        "30 images par seconde, constantes": v["r_frame_rate"] == "30/1" and v["avg_frame_rate"] == "30/1",
        "600 images": int(v["nb_frames"]) == X.NFRAMES,
        "durée de 20 secondes": abs(float(s["format"]["duration"]) - 20.0) < 0.001 and abs(float(v["duration"]) - 20.0) < 0.001,
        f"H.264 High niveau {NIVEAU}, yuv420p": v["codec_name"] == "h264" and v["profile"] == "High" and v["pix_fmt"] == "yuv420p"
                                                 and v.get("level") == int(NIVEAU.replace(".", "")),
        f"débit dans les limites du niveau {NIVEAU} (le tampon du décodeur ne se vide jamais)": marge_tampon >= 0.0,
        "son AAC stéréo 48 kHz présent, 20 secondes": a["codec_name"] == "aac" and int(a["channels"]) == 2 and int(a["sample_rate"]) == 48000
                                                      and abs(float(a["duration"]) - 20.0) < 0.03,
        "décodage complet sans erreur": code == 0 and erreurs == "",
        f"perte d'encodage : PSNR minimal au-dessus de {PSNR_MINIMAL:g} dB sur les 600 images": float(y.min()) > PSNR_MINIMAL,
        f"détail natif : aller-retour par 512 × 910 sous {ALLER_RETOUR_MAX:g} dB (médiane)": float(np.median(retour)) < ALLER_RETOUR_MAX,
        "son : -14 LUFS, crête sous -1 dBTP": lufs is not None and abs(lufs + 14.0) < 0.3 and crete is not None and crete <= -1.0,
    }
    rapport = dict(fichier=SORTIE.name, octets=int(s["format"]["size"]), sha256=hashlib.sha256(SORTIE.read_bytes()).hexdigest(),
                   debit_total_kbps=round(int(s["format"]["bit_rate"]) / 1000),
                   video=dict(codec=v["codec_name"], profil=v["profile"], niveau=v.get("level"), largeur=v["width"], hauteur=v["height"],
                              pixels=v["pix_fmt"], cadence=v["r_frame_rate"], images=int(v["nb_frames"]), duree_s=float(v["duration"]),
                              debit_kbps=round(int(v["bit_rate"]) / 1000), debit_maximal_sur_une_seconde_kbps=round(crete_debit), marge_minimale_du_tampon_kb=round(marge_tampon),
                              espace=v.get("color_space"), plage=v.get("color_range")),
                   son=dict(codec=a["codec_name"], profil=a.get("profile"), frequence=int(a["sample_rate"]), canaux=int(a["channels"]),
                            debit_kbps=round(int(a["bit_rate"]) / 1000), duree_s=float(a["duration"]), lufs=lufs, crete_dbtp=crete),
                   perte_encodage_psnr_y_db=dict(moyen=round(float(y.mean()), 2), minimal=round(float(y.min()), 2), image_la_plus_faible=int(y.argmin()),
                                                 par_sequence=par_sequence(y)),
                   aller_retour_512x910_psnr_y_db=dict(mediane=round(float(np.median(retour)), 2), minimal=round(float(retour.min()), 2),
                                                       maximal=round(float(retour.max()), 2)),
                   decodage=dict(code=code, erreurs=erreurs))
    if TEMOIN:
        t = pertes[1]
        meme_son = empreinte_son(SORTIE) == empreinte_son(TEMOIN)
        seq_n, seq_t = par_sequence(y), par_sequence(t)
        controles[f"au moins aussi fidèle que {TEMOIN.name}, séquence par séquence"] = all(
            seq_n[nom]["moyen"] >= seq_t[nom]["moyen"] - 0.1 and seq_n[nom]["minimal"] >= seq_t[nom]["minimal"] - 0.25 for nom, _, _ in SEQUENCES)
        controles[f"bande son identique à celle de {TEMOIN.name} (même flux AAC)"] = meme_son
        rapport["temoin"] = dict(fichier=TEMOIN.name, psnr_y_db=dict(moyen=round(float(t.mean()), 2), minimal=round(float(t.min()), 2),
                                                                     image_la_plus_faible=int(t.argmin()), par_sequence=seq_t),
                                 images_ou_le_nouveau_est_meilleur=int((y > t).sum()), flux_son_identique=meme_son)
    controles = {nom: bool(ok) for nom, ok in controles.items()}
    rapport["controles"] = controles
    SORTIE.with_suffix(".controle.json").write_text(json.dumps(rapport, indent=1, ensure_ascii=False) + "\n")
    print(f"EXPORT {SORTIE.name} : {rapport['octets'] / 1e6:.1f} Mo, débit vidéo {rapport['video']['debit_kbps']} kb/s "
          f"(maximum sur une seconde : {crete_debit / 1000:.1f} Mb/s ; marge minimale du tampon : {marge_tampon / 1000:.1f} Mb sur {TAMPON_KB / 1000:g})")
    print(f"  vidéo : {v['codec_name']} {v['profile']} niveau {v.get('level')}, {v['width']} × {v['height']}, {v['r_frame_rate']} i/s, "
          f"{v['nb_frames']} images, {float(v['duration']):.3f} s, {v['pix_fmt']}, {v.get('color_space')} {v.get('color_range')}")
    print(f"  son   : {a['codec_name']} {a.get('profile')}, {a['sample_rate']} Hz, {a['channels']} canaux, {rapport['son']['debit_kbps']} kb/s, "
          f"{float(a['duration']):.3f} s ; {lufs} LUFS, crête {crete} dBTP")
    print(f"  perte d'encodage (PSNR Y) : moyen {y.mean():.2f} dB, minimal {y.min():.2f} dB (image {int(y.argmin())})")
    for nom, _, _ in SEQUENCES:
        ligne = f"    {nom:13s} moyen {par_sequence(y)[nom]['moyen']:6.2f}  minimal {par_sequence(y)[nom]['minimal']:6.2f}"
        if TEMOIN:
            ligne += f"   | témoin : moyen {seq_t[nom]['moyen']:6.2f}  minimal {seq_t[nom]['minimal']:6.2f}"
        print(ligne)
    print(f"  aller-retour par 512 × 910 (PSNR Y) : médiane {np.median(retour):.2f} dB, de {retour.min():.2f} à {retour.max():.2f} dB")
    print(f"  décodage : code {code}, erreurs « {erreurs} »")
    for nom, ok in controles.items():
        print(f"  [{'OK' if ok else 'ECHEC'}] {nom}")
    sys.exit(0 if all(controles.values()) else 1)
