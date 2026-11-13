"""Suit une session GPU autonome sans lui envoyer de commande : le pilote dépose ses journaux à heures fixes sur des
créneaux d'envoi, et les images par tranches ; on lit ces dépôts depuis le réseau de diffusion.

    python build/gpu/surveiller.py <resultats.json> <dossier de réception> <heure Unix de la location> [durée max en s]

resultats.json : {"1": {"nom": "seq2_1", "url": "...", "media_id": "..."}, ...} (créneaux 1 à 19).
S'arrête quand le journal de fin (créneau 10) est arrivé, ou à l'échéance. Écrit <dossier>/suivi.txt.
"""
import io
import json
import os
import subprocess
import sys
import time
import zipfile

creneaux = json.load(open(sys.argv[1]))
dossier = sys.argv[2]
t_ref = float(sys.argv[3])
duree_max = float(sys.argv[4]) if len(sys.argv) > 4 else 2100.0
os.makedirs(dossier, exist_ok=True)
suivi = open(os.path.join(dossier, "suivi.txt"), "a")


def dire(texte):
    ligne = f"[t+{time.time() - t_ref:5.0f}s] {texte}"
    print(ligne, flush=True)
    suivi.write(ligne + "\n"); suivi.flush()


def present(url):
    r = subprocess.run(["curl", "-sS", "-m", "20", "-o", "/dev/null", "-w", "%{http_code}", "-r", "0-0", url],
                       capture_output=True, text=True)
    return r.stdout.strip() in ("200", "206")


def telecharger(url, cible):
    r = subprocess.run(["curl", "-sS", "-m", "600", "-o", cible, "-w", "%{http_code}", url], capture_output=True, text=True)
    return r.stdout.strip() == "200"


def lire_journal(chemin_zip, n=14):
    try:
        with zipfile.ZipFile(chemin_zip) as z:
            noms = z.namelist()
            texte = z.read("logs/pilote.log").decode("utf-8", "replace") if "logs/pilote.log" in noms else ""
            images = z.read("logs/images.txt").decode().strip() if "logs/images.txt" in noms else "?"
            gpu = z.read("logs/gpu.txt").decode().strip() if "logs/gpu.txt" in noms else "?"
            extraits = []
            for nom in ("logs/dalle.log", "logs/filet.log", "logs/rendu2.log", "logs/installer.log"):
                if nom in noms:
                    lignes = z.read(nom).decode("utf-8", "replace").strip().split("\n")
                    extraits.append(f"    {nom[5:]} : {lignes[-1][:150]}")
        return texte.strip().split("\n")[-n:], images, gpu, extraits
    except Exception as ex:
        return [f"(archive illisible : {ex})"], "?", "?", []


vus = set()
ordre = [str(k) for k in list(range(12, 20)) + list(range(1, 7)) + [9, 10]]
dire("surveillance commencée")
while True:
    for k in ordre:
        if k in vus or k not in creneaux:
            continue
        c = creneaux[k]
        if not present(c["url"]):
            continue
        vus.add(k)
        cible = os.path.join(dossier, c["nom"] + ".zip")
        if c["nom"].startswith("battement") or c["nom"] == "journaux":
            ok = telecharger(c["url"], cible)
            lignes, images, gpu, extraits = lire_journal(cible) if ok else (["(téléchargement échoué)"], "?", "?", [])
            dire(f"=== {c['nom']} : {images} images rendues, carte : {gpu}")
            for l in lignes:
                dire("    " + l[:190])
            for e in extraits:
                dire(e)
        else:
            dire(f"=== {c['nom']} déposé")
    if "10" in vus:
        dire("journal de fin reçu : la session est terminée")
        break
    if time.time() - t_ref > duree_max:
        dire("échéance atteinte sans journal de fin")
        break
    time.sleep(12)
