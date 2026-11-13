"""Fabrique le plan d'une session GPU (lu par pilote_film.py) et la table de ses créneaux de dépôt.

    python build/gpu/plan.py a --creneaux <créneaux.json> --liquide <adresses.json> [--repetition]
    python build/gpu/plan.py b --creneaux <créneaux.json> --caches <adresses.json> [--repetition]

  a : rectification du sucre (images 169 à 215 de la séquence 2) et séquence 3 (mojito, images 216 à 359)
  b : séquences 0 et 1 (papier, images 0 à 71) et séquences 5 et 6 (encre, images 456 à 527)

créneaux.json : liste de {"upload_url", "url", "media_id"} (un dépôt par créneau, à usage unique), dans l'ordre.
Sorties, dans out/gpu/session_<nom>/ : plan.json, creneaux.txt (adresses de dépôt, une par ligne),
resultats.json (numéro de créneau -> nom, adresse de lecture, identifiant).
--repetition : petites images sur processeur, pour répéter la session en local.
"""
import argparse
import json
import os

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Table:
    """Attribue les créneaux dans l'ordre et garde leur nom."""

    def __init__(self, creneaux):
        self.creneaux, self.noms = creneaux, []

    def prendre(self, nom):
        if len(self.noms) >= len(self.creneaux):
            raise SystemExit(f"pas assez de créneaux : il en faut au moins {len(self.noms) + 1} (demandé pour « {nom} »)")
        self.noms.append(nom)
        return len(self.noms)                      # numéro de ligne dans creneaux.txt


def tranches(table, nom, a, b, taille=24):
    return [[x, min(x + taille - 1, b), table.prendre(f"{nom}_{x}_{min(x + taille - 1, b)}")] for x in range(a, b + 1, taille)]


def installation():
    return [
        dict(type="session", nom="installer", etape="installer", duree_max=300,
             controle=["venv/bin/python", "-c", "import taichi, scipy, cv2"]),
        dict(type="session", nom="installer_rendu", etape="installer_rendu", fond=True, requiert=["installer"], duree_max=480,
             controle=["venv/bin/python", "-c", "import bpy"]),
    ]


def plan_a_compact(table, repetition):
    """Session a avec quatre créneaux seulement (secours quand on ne peut pas en réserver de nouveaux) : le liquide
    voyage dans l'archive de départ, les images partent en trois gros paquets, le filet est joint au journal de fin."""
    fin3 = 263 if repetition else 359
    etapes = installation()
    etapes += [
        dict(type="session", nom="dalle", etape="dalle", requiert=["installer"], duree_max=600, existe=["out/grains/dalle/exits.npz"]),
        dict(type="session", nom="filet", etape="filet", requiert=["dalle"], duree_max=420),
        dict(type="attendre", nom="installer_rendu"),
        dict(type="rendu", nom="seq2", etape="rendu2", images=[169, 215], dossier="out/final/seq2",
             tranches=tranches(table, "seq2", 169, 215, taille=47), joindre=["out/final/seq2/meta.json"],
             requiert=["installer_rendu", "dalle", "filet"]),
        dict(type="rendu", nom="seq3", etape="rendu3", images=[216, fin3], dossier="out/final/seq3",
             tranches=tranches(table, "seq3", 216, fin3, taille=(fin3 - 215 + 1) // 2), joindre=["out/final/seq3/meta.json"],
             requiert=["installer_rendu", "filet"]),
    ]
    env = dict(ECH=0.12, SPP=128, SPP3=256, SIM=256)
    if repetition:
        env.update(ECH=0.002, SPP=4, SPP3=4, SIM=repetition_sim(), ARCH="cpu", DEVICE="CPU", RES="126x189")
    fichiers = ["out/grains/dalle/run.json", "out/grains/dalle/activite.json", "out/grains/dalle/exits.npz",
                "out/final/seq2/meta.json", "out/final/seq3/meta.json"]
    return etapes, env, fichiers, ["out/grains/filet"]


def plan_a(table, liquide, repetition):
    """Sucre rectifié (séquence 2, images 169 à 215) puis mojito (séquence 3)."""
    etapes = installation()
    etapes += [
        dict(type="telecharger", nom="liquide", adresses=liquide),
        # même échelle que la session du 13 novembre ; les images 72 à 168 déjà rendues ne sont pas refaites
        dict(type="session", nom="dalle", etape="dalle", requiert=["installer"], duree_max=600, existe=["out/grains/dalle/exits.npz"]),
        dict(type="session", nom="filet", etape="filet", requiert=["dalle"], duree_max=420,
             envoi=dict(nom="filet", creneau=table.prendre("filet"), chemins=["out/grains/filet"])),
        dict(type="attendre", nom="installer_rendu"),
        dict(type="rendu", nom="seq2", etape="rendu2", images=[169, 215], dossier="out/final/seq2",
             tranches=tranches(table, "seq2", 169, 215), joindre=["out/final/seq2/meta.json"],
             requiert=["installer_rendu", "dalle", "filet"]),
        dict(type="rendu", nom="seq3", etape="rendu3", images=[216, 263 if repetition else 359], dossier="out/final/seq3",
             tranches=tranches(table, "seq3", 216, 263 if repetition else 359), joindre=["out/final/seq3/meta.json"],
             requiert=["installer_rendu", "filet", "liquide"]),      # en répétition : 48 images, dont les premières du liquide
    ]
    env = dict(ECH=0.12, SPP=128, SPP3=256, SIM=256)
    if repetition:
        env.update(ECH=0.002, SPP=4, SPP3=4, SIM=repetition_sim(), ARCH="cpu", DEVICE="CPU", RES="126x189")
    fichiers = ["out/grains/dalle/run.json", "out/grains/dalle/activite.json", "out/grains/dalle/exits.npz",
                "out/grains/filet/run.json", "out/final/seq2/meta.json", "out/final/seq3/meta.json"]
    return etapes, env, fichiers


def repetition_sim():
    return 256                                     # la répétition lit le même liquide que la session réelle


def plan_b(table, caches, repetition, reste3=None, liquide=None, variante3=""):
    """Papier (séquences 0 et 1) puis encre (séquences 5 et 6). Les caches viennent de notre machine.
    reste3 = [(a, b), ...] : plages d'images du mojito à rendre ensuite (images restantes, images corrigées) ; ce qui
    n'aurait pas le temps de passer se finit sur notre machine (build/mojito/rendu_local.sh).
    liquide : adresses des archives du liquide et du filet de la session a ; variante3 : suffixe du dossier d'images
    du liquide refaites (« c » : confinement)."""
    etapes = installation()
    etapes += [
        dict(type="telecharger", nom="caches", adresses=caches),
        dict(type="attendre", nom="installer_rendu"),
        dict(type="rendu", nom="seq01", etape="rendu01", images=[0, 71], dossier="out/final/seq01",
             tranches=tranches(table, "seq01", 0, 71), requiert=["installer_rendu", "caches"]),
        # la couche de matière est transparente là où la feuille est nue : une image vide (527) est normale
        dict(type="rendu", nom="seq56", etape="rendu56", images=[456, 527], dossier="out/final/seq56/matiere",
             taille=[1080, 1920], noir_permis=True,
             tranches=tranches(table, "seq56", 456, 527), requiert=["installer_rendu", "caches"]),
    ]
    if reste3:
        etapes += [dict(type="telecharger", nom="liquide_filet", adresses=liquide or [])]
        for k, (a, b) in enumerate(reste3):
            etapes += [dict(type="rendu", nom="seq3" + "abcdef"[k], etape="rendu3", images=[a, b], dossier="out/final/seq3",
                            tranches=tranches(table, "seq3", a, b), joindre=["out/final/seq3/meta.json"],
                            requiert=["installer_rendu", "liquide_filet"])]
    env = dict(SPP01=128, SPP56=128, SPP3=256, SIM=256)
    if variante3:
        env["VARIANTE3"] = variante3
    if repetition:
        env.update(SPP01=4, SPP56=4, SPP3=4, ARCH="cpu", DEVICE="CPU", RES="126x189", RES56="135x240", LOD56=1080)
    return etapes, env, ["out/final/seq56/scene_log.json", "out/final/seq56/tool_info.json"] + (["out/final/seq3/meta.json"] if reste3 else [])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("session", choices=["a", "b"])
    ap.add_argument("--creneaux", required=True)
    ap.add_argument("--liquide", default="", help="fichier JSON : adresses de lecture des archives du liquide (session a)")
    ap.add_argument("--caches", default="", help="fichier JSON : adresses de lecture des archives de caches (session b)")
    ap.add_argument("--limite", type=int, default=1500, help="secondes après le départ au-delà desquelles on n'entame plus d'image")
    ap.add_argument("--battements", default="120,300,480,660,840,1020,1200,1380,1560,1740")
    ap.add_argument("--repetition", action="store_true")
    ap.add_argument("--compact", action="store_true", help="session a avec quatre créneaux : voir plan_a_compact")
    ap.add_argument("--reste3", default="", help="session b : plages d'images du mojito à rendre, a:b[,c:d...] (avec --liquide : liquide et filet)")
    ap.add_argument("--variante3", default="", help="session b : suffixe du dossier d'images du liquide refaites (c : confinement)")
    ap.add_argument("--sortie", default="")
    A = ap.parse_args()
    creneaux = json.load(open(A.creneaux))
    table = Table(creneaux)
    dossiers = []
    if A.session == "a" and A.compact:
        etapes, env, fichiers, dossiers = plan_a_compact(table, A.repetition)
    elif A.session == "a":
        etapes, env, fichiers = plan_a(table, json.load(open(A.liquide)) if A.liquide else [], A.repetition)
    else:
        reste3 = [tuple(int(v) for v in plage.split(":")) for plage in A.reste3.split(",")] if A.reste3 else None
        etapes, env, fichiers = plan_b(table, json.load(open(A.caches)) if A.caches else [], A.repetition, reste3,
                                       json.load(open(A.liquide)) if A.liquide else [], A.variante3)
    journal = table.prendre("journaux")
    temps = [t for t in A.battements.split(",") if t.strip()]
    battements = [[int(t), table.prendre(f"battement_{k + 1:02d}")] for k, t in enumerate(temps) if int(t) < A.limite + 240]
    plan = dict(session=A.session, limite=A.limite, env=env, battements=battements, journal=journal, journal_fichiers=fichiers,
                journal_dossiers=dossiers, etapes=etapes)
    sortie = A.sortie or os.path.join(RACINE, "out", "gpu", f"session_{A.session}" + ("_compact" if A.compact else "") + ("_repetition" if A.repetition else ""))
    os.makedirs(sortie, exist_ok=True)
    json.dump(plan, open(os.path.join(sortie, "plan.json"), "w"), indent=1, ensure_ascii=False)
    with open(os.path.join(sortie, "creneaux.txt"), "w") as fh:
        fh.write("\n".join(c["upload_url"].strip() for c in creneaux[:len(table.noms)]) + "\n")
    resultats = {str(k + 1): dict(nom=nom, url=creneaux[k]["url"], media_id=creneaux[k].get("media_id", "")) for k, nom in enumerate(table.noms)}
    json.dump(resultats, open(os.path.join(sortie, "resultats.json"), "w"), indent=1)
    print(f"{sortie} : {len(etapes)} étapes, {len(table.noms)} créneaux utilisés sur {len(creneaux)} fournis")
    for k, nom in enumerate(table.noms, start=1):
        print(f"  {k:2d}  {nom}")
