#!/usr/bin/env python3
"""OFFGRIDZ — INSOUMISE : pilote d'une session GPU, conduit par un plan.

    setsid nohup python3 build/gpu/pilote_film.py plan.json > logs/pilote.log 2>&1 < /dev/null &

Une seule commande lance toute la session, et plus aucune n'est nécessaire ensuite : chaque commande envoyée à la
machine louée peut attendre une autorisation pendant que la machine tourne (incident du 13 novembre). Le pilote
enchaîne les étapes du plan dans l'ordre de priorité, envoie les images par tranches dès qu'elles sont complètes,
dépose ses journaux à heures fixes (on suit la session en lisant ces dépôts, sans commande), puis éteint la machine.

Il n'utilise que la bibliothèque standard : il tourne avec le Python du système, avant toute installation.

Le plan (build/gpu/plan.py) :
  limite        secondes après le départ au-delà desquelles on n'entame plus aucune image
  env           variables communes à toutes les étapes (ECH, SPP, ARCH, DEVICE, RES...)
  battements    [[secondes, créneau], ...] : dépôts des journaux
  journal       créneau du journal de fin ; journal_fichiers : fichiers à y joindre
  etapes        liste ordonnée ; chaque étape a un "nom" et, au besoin, "requiert" (étapes qui doivent avoir réussi)
     type "session"     : bash build/gpu/session.sh <etape>   ("fond": true pour la lancer sans attendre,
                          "controle": commande qui doit réussir ensuite, "existe": fichiers qui doivent exister,
                          "envoi": {"nom", "creneau", "chemins"} dépôt en cas de réussite, "duree_max" en secondes)
     type "attendre"    : attend la fin d'une étape lancée en fond
     type "telecharger" : récupère des archives ("adresses") et les déplie dans le dossier de travail
     type "rendu"       : étape de session qui écrit des images ; "images": [a, b], "dossier", "tranches": [[a, b, créneau]]
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
import zipfile

W = os.environ.get("OG_DIR", os.path.join(os.path.expanduser("~"), "og"))
os.chdir(W)
os.makedirs("logs", exist_ok=True)
PLAN = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "plan.json"))
T0 = time.time()
ARRET = T0 + float(os.environ.get("LIMITE", PLAN.get("limite", 1200)))
CRENEAUX = [l.strip() for l in open("creneaux.txt").read().split("\n")]
ETAT = {}                      # nom de l'étape -> "reussi", "echec", "partiel", "saute"
FOND = {}                      # nom -> fil d'exécution d'une étape lancée en fond
FINI = threading.Event()
VERROU = threading.Lock()


def dire(texte):
    with VERROU:
        print(f"[t+{time.time() - T0:.0f}s] {texte}", flush=True)


def derniere_ligne(chemin):
    try:
        lignes = [l for l in open(chemin, errors="replace").read().split("\n") if l.strip()]
        return lignes[-1][:200] if lignes else ""
    except OSError:
        return ""


def envoyer(nom, creneau, chemins, essais=3):
    """Archive sans compression (les images le sont déjà) et dépôt sur un créneau. Renvoie True si le dépôt a répondu 200."""
    adresse = CRENEAUX[creneau - 1] if 0 < creneau <= len(CRENEAUX) else ""
    if not adresse:
        dire(f"envoi {nom} : pas de créneau {creneau}")
        return False
    archive = f"{nom}.zip"
    n = 0
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as z:
        for c in chemins:
            if os.path.isdir(c):
                for racine, _, fichiers in os.walk(c):
                    for f in sorted(fichiers):
                        z.write(os.path.join(racine, f)); n += 1
            elif os.path.exists(c):
                z.write(c); n += 1
    taille = os.path.getsize(archive) / 1e6
    code = "000"
    for _ in range(essais):
        r = subprocess.run(["curl", "-sS", "-m", "600", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT",
                            "-H", "Content-Type: application/octet-stream", "--data-binary", "@" + archive, adresse],
                           capture_output=True, text=True)
        code = r.stdout.strip() or "000"
        if code == "200":
            break
        time.sleep(3)
    dire(f"envoi {nom} ({n} fichiers, {taille:.0f} Mo) sur le créneau {creneau} -> HTTP {code}")
    return code == "200"


def lancer_session(e, env_suppl=None):
    """Lance une étape de session.sh ; renvoie le processus."""
    env = dict(os.environ)
    env.update({k: str(v) for k, v in PLAN.get("env", {}).items()})
    env.update({k: str(v) for k, v in e.get("env", {}).items()})
    env.update(env_suppl or {})
    env["ARRET"] = str(int(ARRET))
    env["OG_DIR"] = W
    return subprocess.Popen(["bash", "build/gpu/session.sh", e["etape"]], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def reussite_session(e, code_retour):
    ligne = derniere_ligne(os.path.join("logs", e["etape"] + ".log"))
    ok = code_retour == 0 and f"ETAPE {e['etape']} FIN 0 " in ligne
    for chemin in e.get("existe", []):
        ok = ok and os.path.exists(chemin)
    if ok and e.get("controle"):
        ok = subprocess.run(e["controle"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    return ok, ligne


def etape_session(e):
    dire(f"DEBUT {e['nom']}")
    p = lancer_session(e)
    try:
        code = p.wait(timeout=e.get("duree_max"))
    except subprocess.TimeoutExpired:
        p.kill(); code = -9
        dire(f"{e['nom']} : durée maximale dépassée ({e.get('duree_max')} s)")
    ok, ligne = reussite_session(e, code)
    ETAT[e["nom"]] = "reussi" if ok else "echec"
    dire(f"FIN {e['nom']} : {'réussi' if ok else 'ECHEC'} ; {ligne}")
    if not ok:
        for l in open(os.path.join("logs", e["etape"] + ".log"), errors="replace").read().split("\n")[-8:]:
            if l.strip():
                dire("    " + l[:200])
    elif e.get("envoi"):
        v = e["envoi"]
        envoyer(v["nom"], v["creneau"], v["chemins"])


def etape_telecharger(e):
    dire(f"DEBUT {e['nom']}")
    ok = True
    for k, adresse in enumerate(e["adresses"]):
        archive = f"{e['nom']}_{k:02d}.zip"
        r = subprocess.run(["curl", "-sS", "-m", "600", "-o", archive, "-w", "%{http_code}", adresse], capture_output=True, text=True)
        if r.stdout.strip() != "200":
            dire(f"{e['nom']} : téléchargement {k} -> HTTP {r.stdout.strip()}")
            ok = False
            continue
        try:
            with zipfile.ZipFile(archive) as z:
                racine = os.path.realpath(W)
                for nom in z.namelist():
                    if not os.path.realpath(os.path.join(W, nom)).startswith(racine + os.sep):
                        raise ValueError("chemin refusé : " + nom)
                z.extractall(W)
            os.remove(archive)
        except (zipfile.BadZipFile, ValueError, OSError) as ex:
            dire(f"{e['nom']} : archive {k} illisible ({ex})")
            ok = False
    ETAT[e["nom"]] = "reussi" if ok else "echec"
    dire(f"FIN {e['nom']} : {'réussi' if ok else 'ECHEC'}")


def chemin_image(e, f):
    return os.path.join(e["dossier"], e.get("motif", "f{:04d}.png").format(f))


def tranches_a_envoyer(e, envoyees, tout=False):
    for a, b, creneau in e["tranches"]:
        if creneau in envoyees:
            continue
        presentes = [chemin_image(e, f) for f in range(a, b + 1) if os.path.exists(chemin_image(e, f))]
        if len(presentes) == b - a + 1 or (tout and presentes):
            time.sleep(2)                                  # la dernière image peut être en cours d'écriture
            envoyees.add(creneau)
            ok = envoyer(f"{e['nom']}_{a}_{b}", creneau, presentes + e.get("joindre", []))
            if not ok:
                dire(f"{e['nom']} : tranche {a}-{b} non déposée")


def etape_rendu(e):
    if time.time() > ARRET:
        ETAT[e["nom"]] = "saute"
        dire(f"{e['nom']} : délai atteint, étape non entamée")
        return
    a, b = e["images"]
    dire(f"DEBUT {e['nom']} (images {a} à {b})")
    p = lancer_session(e, {"IMAGES": f"{a}:{b}"})
    envoyees = set()
    while p.poll() is None:
        tranches_a_envoyer(e, envoyees)
        time.sleep(5)
    tranches_a_envoyer(e, envoyees, tout=True)
    n = sum(os.path.exists(chemin_image(e, f)) for f in range(a, b + 1))
    ETAT[e["nom"]] = "reussi" if n == b - a + 1 else ("partiel" if n else "echec")
    dire(f"FIN {e['nom']} : {n} images sur {b - a + 1} ; {derniere_ligne(os.path.join('logs', e['etape'] + '.log'))}")
    if n < b - a + 1:
        for l in open(os.path.join("logs", e["etape"] + ".log"), errors="replace").read().split("\n")[-6:]:
            if l.strip():
                dire("    " + l[:200])


def battements():
    for quand, creneau in PLAN.get("battements", []):
        while time.time() - T0 < quand:
            if FINI.wait(2.0):
                return
        try:
            gpu = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader"],
                                 capture_output=True, text=True).stdout.strip()
        except OSError:
            gpu = "?"
        images = {e["nom"]: sum(os.path.exists(chemin_image(e, f)) for f in range(e["images"][0], e["images"][1] + 1))
                  for e in PLAN["etapes"] if e["type"] == "rendu"}
        json.dump(dict(t=round(time.time() - T0), gpu=gpu, etat=ETAT, images=images), open("logs/etat.json", "w"))
        envoyer(f"battement_{creneau}", creneau, ["logs"], essais=1)


def terminer():
    for chemin in PLAN.get("journal_fichiers", []):
        if os.path.exists(chemin):
            cible = os.path.join("logs", chemin.replace("/", "__"))
            try:
                with open(chemin, "rb") as src, open(cible, "wb") as dst:
                    dst.write(src.read())
            except OSError:
                pass
    json.dump(dict(t=round(time.time() - T0), etat=ETAT), open("logs/etat.json", "w"))
    dire("bilan : " + ", ".join(f"{k} {v}" for k, v in ETAT.items()))
    dire("PILOTE FIN")
    FINI.set()
    envoyer("journaux", PLAN["journal"], ["logs"] + [d for d in PLAN.get("journal_dossiers", []) if os.path.isdir(d)])
    if os.environ.get("AUTO_ARRET") == "1" and os.path.exists("/tmp/.higgs-gpu-log-relay.py"):
        # Tout est envoyé : on termine le processus d'accueil de la machine louée, qui s'éteint dans la minute
        # (vérifié le 13 novembre). Jamais ailleurs que sur cette machine.
        time.sleep(2)
        subprocess.run(["pkill", "-f", "higgs-gpu-log-relay"])
        try:
            os.kill(1, signal.SIGTERM)
        except OSError:
            pass


def principal():
    dire(f"PILOTE DEBUT : {len(PLAN['etapes'])} étapes, arrêt des rendus à t+{ARRET - T0:.0f}s")
    threading.Thread(target=battements, daemon=True).start()
    for e in PLAN["etapes"]:
        manque = [r for r in e.get("requiert", []) if ETAT.get(r) != "reussi"]
        if e["type"] == "attendre":
            fil = FOND.get(e["nom"])
            if fil is not None:
                fil.join()
            continue
        if manque:
            ETAT[e["nom"]] = "saute"
            dire(f"{e['nom']} : sautée, il manque {', '.join(manque)}")
            continue
        if e["type"] == "session":
            if e.get("fond"):
                FOND[e["nom"]] = threading.Thread(target=etape_session, args=(e,))
                FOND[e["nom"]].start()
            else:
                etape_session(e)
        elif e["type"] == "telecharger":
            etape_telecharger(e)
        elif e["type"] == "rendu":
            etape_rendu(e)
    for fil in FOND.values():
        fil.join()
    terminer()


if __name__ == "__main__":
    try:
        principal()
    except Exception as ex:                                 # quoi qu'il arrive : journal de fin et extinction
        dire(f"ERREUR DU PILOTE : {type(ex).__name__} : {ex}")
        terminer()
