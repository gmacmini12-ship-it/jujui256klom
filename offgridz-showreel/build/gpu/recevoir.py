"""Récupère les résultats d'une session GPU depuis ses créneaux de dépôt, les range et les vérifie.

    python build/gpu/recevoir.py out/gpu/session_a          (dossier fabriqué par build/gpu/plan.py)

Lit plan.json et resultats.json dans ce dossier, puis :
- images de chaque étape de rendu  ->  leur dossier dans le projet (les tables meta.json sont fusionnées avec l'existant) ;
- dépôts annexes (filet...)        ->  leur chemin dans le projet, à la place de l'ancien contenu ;
- journaux de fin                  ->  <dossier de session>/logs ; les fichiers joints retrouvent leur chemin d'origine.
Contrôle ensuite chaque image attendue (présence, dimensions, 16 bits, non noire), relève les sauts de luminance,
fabrique une planche et un aperçu animé par séquence.
"""
import json
import os
import shutil
import subprocess
import sys
import zipfile

import cv2
import numpy as np

# OG_RACINE : autre racine de rangement, pour essayer la réception d'une répétition sans toucher aux vraies images
RACINE = os.environ.get("OG_RACINE") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SESSION = os.path.abspath(sys.argv[1])
PLAN = json.load(open(os.path.join(SESSION, "plan.json")))
CRENEAUX = json.load(open(os.path.join(SESSION, "resultats.json")))
RECU = os.path.join(SESSION, "recu")
os.makedirs(RECU, exist_ok=True)
ABSENTES = []          # tranches d'images que la machine n'a pas déposées


def telecharger(k):
    c = CRENEAUX[str(k)]
    cible = os.path.join(RECU, c["nom"] + ".zip")
    for _ in range(3):
        r = subprocess.run(["curl", "-sS", "-m", "900", "-o", cible, "-w", "%{http_code}", c["url"]], capture_output=True, text=True)
        if r.stdout.strip() == "200":
            try:
                with zipfile.ZipFile(cible) as z:
                    if z.testzip() is None:
                        return cible
            except zipfile.BadZipFile:
                pass
        elif r.stdout.strip() in ("403", "404"):
            break
    if os.path.exists(cible):
        os.remove(cible)
    return None


def deplier(chemin_zip):
    """Déplie l'archive dans un dossier neuf, en refusant tout chemin qui en sortirait."""
    dossier = chemin_zip[:-4]
    if os.path.exists(dossier):
        shutil.rmtree(dossier)
    os.makedirs(dossier)
    with zipfile.ZipFile(chemin_zip) as z:
        for nom in z.namelist():
            if not os.path.realpath(os.path.join(dossier, nom)).startswith(os.path.realpath(dossier) + os.sep):
                raise SystemExit(f"chemin refusé dans {chemin_zip} : {nom}")
        z.extractall(dossier)
    return dossier


def fusionner_meta(source, cible):
    if not os.path.exists(source):
        return
    nouveau = json.load(open(source))
    ancien = json.load(open(cible)) if os.path.exists(cible) else {"images": {}}
    ancien.setdefault("images", {}).update(nouveau.get("images", {}))
    json.dump(ancien, open(cible, "w"))


def controler(e):
    a, b = e["images"]
    dossier = os.path.join(RACINE, e["dossier"])
    larg, haut = e.get("taille", [1008, 1512])
    manquantes, defauts, moyennes = [], [], {}
    for f in range(a, b + 1):
        p = os.path.join(dossier, e.get("motif", "f{:04d}.png").format(f))
        if not os.path.exists(p):
            manquantes.append(f); continue
        im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if im is None or im.shape[:2] != (haut, larg) or im.dtype != np.uint16:
            defauts.append((f, None if im is None else (im.shape, str(im.dtype)))); continue
        moyennes[f] = float(im[..., :3].mean()) / 65535
        if moyennes[f] < 0.004 and not e.get("noir_permis"):
            defauts.append((f, f"image presque noire ({moyennes[f]:.4f})"))
    print(f"{e['nom']} : {b - a + 1 - len(manquantes)} images sur {b - a + 1} ; manquantes : {manquantes if manquantes else 'aucune'} ; défauts : {defauts if defauts else 'aucun'}")
    if moyennes:
        sauts = [(f, round(abs(moyennes[f] - moyennes[f - 1]), 4)) for f in sorted(moyennes) if f - 1 in moyennes and abs(moyennes[f] - moyennes[f - 1]) > 0.03]
        print(f"   sauts de luminance d'une image à l'autre (> 0,03) : {sauts if sauts else 'aucun'}")
        choix = sorted(moyennes)[::max(1, len(moyennes) // 16)][:16]
        vignettes = []
        for f in choix:
            im = cv2.imread(os.path.join(dossier, e.get("motif", "f{:04d}.png").format(f)), cv2.IMREAD_UNCHANGED)
            im = cv2.resize((im[..., :3] / 257).astype(np.uint8), (252, 252 * haut // larg), interpolation=cv2.INTER_AREA)
            cv2.putText(im, str(f), (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            vignettes.append(im)
        while len(vignettes) % 8:
            vignettes.append(np.zeros_like(vignettes[0]))
        planche = os.path.join(SESSION, f"planche_{e['nom']}.png")
        cv2.imwrite(planche, np.vstack([np.hstack(vignettes[i:i + 8]) for i in range(0, len(vignettes), 8)]))
        print("   planche :", os.path.relpath(planche, RACINE))
    return manquantes, defauts


for e in PLAN["etapes"]:
    if e["type"] == "rendu":
        cible = os.path.join(RACINE, e["dossier"]); os.makedirs(cible, exist_ok=True)
        for a, b, k in e["tranches"]:
            z = telecharger(k)
            if z is None:
                print(f"{e['nom']} : tranche {a}-{b} absente")
                ABSENTES.append((e["nom"], a, b))
                continue
            d = deplier(z)
            src = os.path.join(d, e["dossier"])
            n = 0
            for nom in sorted(os.listdir(src)) if os.path.isdir(src) else []:
                if nom.endswith(".png"):
                    shutil.copy2(os.path.join(src, nom), os.path.join(cible, nom)); n += 1
            for joint in e.get("joindre", []):
                if os.path.basename(joint) == "meta.json":
                    fusionner_meta(os.path.join(d, joint), os.path.join(RACINE, joint))
            shutil.rmtree(d); os.remove(z)
    elif e.get("envoi"):
        v = e["envoi"]
        z = telecharger(v["creneau"])
        if z is None:
            print(f"{v['nom']} : absent")
            continue
        d = deplier(z)
        for chemin in v["chemins"]:
            src, cible = os.path.join(d, chemin), os.path.join(RACINE, chemin)
            if os.path.isdir(src):
                if os.path.exists(cible):
                    shutil.rmtree(cible)
                shutil.copytree(src, cible)
                print(f"{v['nom']} : {chemin} remplacé ({len(os.listdir(cible))} fichiers, {os.path.getsize(z) / 1e6:.0f} Mo)")
        shutil.rmtree(d); os.remove(z)

z = telecharger(PLAN["journal"])
if z:
    d = deplier(z)
    logs = os.path.join(SESSION, "logs")
    if os.path.exists(logs):
        shutil.rmtree(logs)
    shutil.copytree(os.path.join(d, "logs"), logs)
    for nom in sorted(os.listdir(logs)):
        if "__" in nom:                                   # fichier joint : il retrouve son chemin d'origine
            cible = os.path.join(RACINE, nom.replace("__", "/"))
            os.makedirs(os.path.dirname(cible), exist_ok=True)
            if os.path.basename(cible) == "meta.json":
                fusionner_meta(os.path.join(logs, nom), cible)
            else:
                shutil.copy2(os.path.join(logs, nom), cible)
    for chemin in PLAN.get("journal_dossiers", []):       # dossiers joints au journal (le filet, en session compacte)
        src, cible = os.path.join(d, chemin), os.path.join(RACINE, chemin)
        if os.path.isdir(src):
            if os.path.exists(cible):
                shutil.rmtree(cible)
            shutil.copytree(src, cible)
            print(f"{chemin} remplacé ({len(os.listdir(cible))} fichiers)")
    shutil.rmtree(d); os.remove(z)
    etat = os.path.join(logs, "etat.json")
    print("journaux reçus ;", json.load(open(etat))["etat"] if os.path.exists(etat) else "pas de bilan")
else:
    print("journaux de fin : absents")

complet = True
for e in PLAN["etapes"]:
    if e["type"] == "rendu":
        manquantes, defauts = controler(e)
        complet = complet and not manquantes and not defauts
if ABSENTES:
    # les images déjà présentes sur place pour ces tranches viennent d'un rendu antérieur, pas de cette session
    print("tranches non reçues :", ", ".join(f"{nom} {a}-{b}" for nom, a, b in ABSENTES))
print("RECEPTION COMPLETE" if complet and not ABSENTES else "RECEPTION INCOMPLETE")
