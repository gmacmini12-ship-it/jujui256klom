"""Partition audiovisuelle d'INSOUMISE : la source unique des temps du film.

Tout événement est posé sur la grille musicale (150 BPM, 30 images/s) puis converti en images.
L'animation, la musique et les contrôles de synchronisation liront timeline/partition.json.

    python build/timeline/make_partition.py
"""
import json
import pathlib

FPS, BPM = 30, 150
IMAGES = 600                      # 20,000 s
PAR_TEMPS = FPS * 60 // BPM       # 12 images
PAR_DOUBLE = PAR_TEMPS // 4       # 3 images
LEVEE_TEMPS = 2                   # deux temps de levée avant la mesure 1


def im(mesure, temps=1, double=0):
    """Image d'une position musicale. mesure 0 = levée (temps 1 et 2), mesures 1 à 12 ensuite."""
    if mesure == 0:
        return (temps - 1) * PAR_TEMPS + double * PAR_DOUBLE
    return LEVEE_TEMPS * PAR_TEMPS + (mesure - 1) * 4 * PAR_TEMPS + (temps - 1) * PAR_TEMPS + double * PAR_DOUBLE


def bloc(piste, debut, fin, nom, **plus):
    return {"piste": piste, "debut": debut, "fin": fin, "nom": nom, **plus}


def point(piste, image, nom, **plus):
    return {"piste": piste, "image": image, "nom": nom, **plus}


SEQUENCES = [
    bloc("sequence", 0, 23, "0 Épreuve", rendu="logo"),
    bloc("sequence", 24, 71, "1 Déchirure", rendu="mat"),
    bloc("sequence", 72, 215, "2 Grains", rendu="mat"),
    bloc("sequence", 216, 359, "3 Mojito", rendu="brillant"),
    bloc("sequence", 360, 455, "4 Données", rendu="données"),
    bloc("sequence", 456, 527, "5 Fond perdu", rendu="mat puis brillant"),
    bloc("sequence", 528, 599, "6 Signature", rendu="logo"),
]

MATIERE = [
    bloc("matiere", 0, 83, "solide (bande)"),
    bloc("matiere", 84, 215, "grains"),
    bloc("matiere", 216, 263, "sucre"),
    bloc("matiere", 264, 359, "dissoute"),
    bloc("matiere", 360, 455, "points"),
    bloc("matiere", 456, 479, "grains"),
    bloc("matiere", 480, 527, "encre"),
    bloc("matiere", 528, 599, "bande imprimée"),
]

CAMERA = [
    bloc("camera", 0, 23, "fixe"),
    bloc("camera", 24, 71, "travelling avant, plongée dans le O"),
    bloc("camera", 72, 119, "contre-plongée lente"),
    bloc("camera", 120, 167, "recul au ras des grains"),
    bloc("camera", 168, 215, "descente verticale"),
    bloc("camera", 216, 263, "bascule trois-quarts macro"),
    bloc("camera", 264, 311, "orbite 12°, ralenti"),
    bloc("camera", 312, 335, "quasi fixe (plan héros)"),
    bloc("camera", 336, 359, "entrée dans la paille"),
    bloc("camera", 360, 407, "dérive"),
    bloc("camera", 408, 431, "orbite 20°"),
    bloc("camera", 432, 455, "recul accéléré"),
    bloc("camera", 456, 599, "fixe, feuille entière"),
]

SIMULATION = [
    bloc("simulation", 12, 47, "papier déchiré"),
    bloc("simulation", 84, 215, "grains (MPM)"),
    bloc("simulation", 216, 263, "corps rigides"),
    bloc("simulation", 264, 335, "liquide (FLIP), bulles"),
    bloc("simulation", 360, 455, "champ de vecteurs"),
    bloc("simulation", 456, 479, "grains (MPM)"),
    bloc("simulation", 480, 527, "film d'encre"),
]

RETICULE = [
    bloc("reticule", 0, 11, "verrouillé"),
    point("reticule", 12, "déverrouillage", issue="ouvert"),
    point("reticule", im(2), "tentative 1 : la bande", issue="échec", fin=im(2, 3)),
    point("reticule", im(4), "tentative 2 : le filet", issue="échec", fin=im(4, 2)),
    point("reticule", im(7) + 6, "tentative 3 : le verre", issue="tenu", fin=im(7, 3) + 6),
    bloc("reticule", 360, 455, "devient repère d'axes"),
    point("reticule", im(11, 3), "verrouillage final", issue="réussi"),
]

ROULEMENT_1 = ["archivo-var", "anton", "permanent-marker", "saira-stencil-one", "doto-var", "major-mono-display",
               "instrument-serif-italic", "bodoni-moda-var"]
TYPO = [
    bloc("typo", im(1), im(1, 3) - 1, "roulement 1", caracteres=ROULEMENT_1, arret="bodoni-moda-var"),
    bloc("typo", im(2, 3), im(3) - 1, "roulement 2", arret="anton"),
    bloc("typo", im(5, 3), im(6) - 1, "roulement 3 (enseigne)", arret="instrument-serif-italic"),
    bloc("typo", im(8, 3), im(9) - 1, "roulement 4 (graisse continue)", arret="doto-var"),
    bloc("typo", im(11), im(11, 3) - 1, "lettrage d'origine imprimé"),
    bloc("typo", 588, 593, "fondu des annotations"),
]   # aucune ligne de signature : le client a retiré « Hors-grille. Sous contrôle. » le 13/11, le film finit sur le logo seul

MUSIQUE = [
    bloc("musique", 0, 23, "souffle"),
    bloc("musique", 24, 71, "entrée du rythme"),
    bloc("musique", 72, 209, "groove A, demi-temps"),
    bloc("musique", 210, 215, "silence"),
    bloc("musique", 216, 263, "groove B, clics fins"),
    bloc("musique", 264, 311, "arpège montant"),
    bloc("musique", 312, 359, "accord ouvert, basse"),
    bloc("musique", 360, 407, "groove C, aérien"),
    bloc("musique", 408, 452, "montée"),
    bloc("musique", 453, 455, "silence"),
    bloc("musique", 456, 503, "plein, contrôlé"),
    bloc("musique", 504, 527, "retrait"),
    bloc("musique", 528, 599, "accord final, queue"),
]

BRUITAGES = [
    point("bruitage", 6, "tic de papier"),
    bloc("bruitage", 12, 23, "déchirure"),
    bloc("bruitage", 24, 47, "8 clics de caractères"),
    bloc("bruitage", 48, 71, "souffle de caméra"),
    point("bruitage", 72, "déclic 1"),
    bloc("bruitage", 84, 119, "effritement"),
    point("bruitage", 96, "glissement"),
    bloc("bruitage", 120, 167, "avalanche (densité = débit simulé)"),
    point("bruitage", 168, "déclic 2"),
    point("bruitage", 180, "glissement"),
    bloc("bruitage", 168, 215, "filet de grains"),
    point("bruitage", 216, "citron"),
    point("bruitage", 228, "menthe"),
    point("bruitage", 237, "paille (choc simulé)"),
    bloc("bruitage", 240, 263, "glaçons (chocs simulés)"),
    bloc("bruitage", 264, 311, "versement, bulles"),
    point("bruitage", 312, "brin de menthe"),
    point("bruitage", 318, "déclic tenu"),
    bloc("bruitage", 336, 359, "aspiration"),
    bloc("bruitage", 360, 407, "scintillement"),
    bloc("bruitage", 432, 452, "roulement, souffle"),
    bloc("bruitage", 456, 479, "déferlement"),
    bloc("bruitage", 480, 503, "du sec au mouillé"),
    bloc("bruitage", 504, 527, "raclette"),
    point("bruitage", 528, "déclic final"),
    point("bruitage", 540, "second appui"),
]

PISTES = [
    ("sequence", "Séquence"), ("matiere", "Matière orange"), ("reticule", "Réticule"), ("typo", "Typographie"),
    ("camera", "Caméra"), ("simulation", "Simulation"), ("musique", "Musique"), ("bruitage", "Bruitages"),
]


def avec_temps(e):
    e = dict(e)
    for cle in ("debut", "fin", "image"):
        if cle in e:
            e[cle + "_s"] = round((e[cle] + (1 if cle == "fin" else 0)) / FPS, 3)
    return e


def construire():
    evenements = [avec_temps(e) for groupe in (SEQUENCES, MATIERE, RETICULE, TYPO, CAMERA, SIMULATION, MUSIQUE, BRUITAGES)
                  for e in groupe]
    mesures = [{"mesure": n, "image": im(n), "s": round(im(n) / FPS, 3)} for n in range(1, 13)]
    return {
        "format": {"largeur": 1080, "hauteur": 1920, "images_par_seconde": FPS, "images": IMAGES,
                   "duree_s": IMAGES / FPS, "fenetre": [36, 204, 1044, 1716]},
        "grille": {"bpm": BPM, "images_par_temps": PAR_TEMPS, "images_par_double_croche": PAR_DOUBLE,
                   "levee_temps": LEVEE_TEMPS, "mesures": mesures},
        "pistes": [{"id": i, "nom": n} for i, n in PISTES],
        "evenements": evenements,
    }


def verifier(p):
    """Contrôles de cohérence : couverture complète et sans chevauchement des pistes continues."""
    for piste in ("sequence", "matiere", "camera", "musique"):
        blocs = sorted((e for e in p["evenements"] if e["piste"] == piste and "debut" in e), key=lambda e: e["debut"])
        assert blocs[0]["debut"] == 0 and blocs[-1]["fin"] == IMAGES - 1, piste
        for a, b in zip(blocs, blocs[1:]):
            assert b["debut"] == a["fin"] + 1, (piste, a["nom"], b["nom"])
    assert im(12) + 48 == IMAGES
    for e in p["evenements"]:
        for cle in ("debut", "fin", "image"):
            assert 0 <= e.get(cle, 0) < IMAGES, e


if __name__ == "__main__":
    partition = construire()
    verifier(partition)
    sortie = pathlib.Path(__file__).resolve().parents[2] / "timeline" / "partition.json"
    sortie.write_text(json.dumps(partition, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{sortie.relative_to(sortie.parents[1])} : {len(partition['evenements'])} événements, "
          f"{IMAGES} images, mesure 12 à l'image {im(12)}, verrouillage final à l'image {im(11, 3)}")
