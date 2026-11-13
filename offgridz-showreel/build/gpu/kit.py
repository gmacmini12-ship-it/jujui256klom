"""Prépare les archives à déposer sur la machine GPU louée, et vérifie qu'il n'y manque rien.

    /opt/og/venv/bin/python build/gpu/kit.py code        ->  out/gpu/kit_code.zip     (scripts, petites données : quelques Mo)
    /opt/og/venv/bin/python build/gpu/kit.py liquide 256 ->  out/gpu/kit_liquide_NN.zip (surfaces du liquide, par tranches)
    /opt/og/venv/bin/python build/gpu/kit.py papier      ->  out/gpu/kit_papier.zip   (caches de la séquence d'ouverture)

Sur la machine : les archives sont dépliées dans ~/og, qui reproduit l'arborescence du dépôt.
"""
import pathlib
import sys
import zipfile

RACINE = pathlib.Path(__file__).resolve().parents[2]
SORTIE = RACINE / "out" / "gpu"
CODE = [
    "BIBLE.md", "timeline/partition.json",
    "build/sim/mpm.py", "build/sim/scenes.py",
    "build/grains", "build/mojito", "build/seq01", "build/seq56", "build/gpu/session.sh", "build/gpu/pilote.sh", "build/type",
    "cache/grains/lettres.json", "cache/mojito/chutes.npz", "cache/mojito/plantes.json",
    "out/mojito/enseigne", "assets/logo", "assets/fonts/fonts.json",
]
TRANCHE = 180 * 1024 * 1024         # taille maximale d'une archive (octets)


def fichiers(chemins):
    for c in chemins:
        p = RACINE / c
        if not p.exists():
            print(f"ABSENT : {c}")
            continue
        if p.is_file():
            yield p
        else:
            for f in sorted(p.rglob("*")):
                if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                    yield f


def archiver(nom, liste, compression=zipfile.ZIP_DEFLATED):
    SORTIE.mkdir(parents=True, exist_ok=True)
    cible = SORTIE / nom
    with zipfile.ZipFile(cible, "w", compression) as z:
        for f in liste:
            z.write(f, f.relative_to(RACINE))
    print(f"{cible.relative_to(RACINE)} : {len(liste)} fichiers, {cible.stat().st_size / 1e6:.1f} Mo")
    return cible


if __name__ == "__main__":
    quoi = sys.argv[1] if len(sys.argv) > 1 else "code"
    if quoi == "code":
        liste = list(fichiers(CODE))
        creneaux = SORTIE / "creneaux.txt"          # adresses de dépôt des résultats, une par ligne (préparées avant la session)
        archiver("kit_code.zip", liste)
        if creneaux.exists():
            with zipfile.ZipFile(SORTIE / "kit_code.zip", "a", zipfile.ZIP_DEFLATED) as z:
                z.write(creneaux, "creneaux.txt")
            print("creneaux.txt ajouté à l'archive")
    elif quoi == "liquide":
        res = sys.argv[2] if len(sys.argv) > 2 else "256"
        tous = list(fichiers([f"cache/mojito/liquide_r{res}"]))
        lot, taille, n = [], 0, 0
        for f in tous:
            if lot and taille + f.stat().st_size > TRANCHE:
                archiver(f"kit_liquide_{n:02d}.zip", lot, zipfile.ZIP_STORED); lot, taille, n = [], 0, n + 1
            lot.append(f); taille += f.stat().st_size
        if lot:
            archiver(f"kit_liquide_{n:02d}.zip", lot, zipfile.ZIP_STORED)
    elif quoi == "papier":
        archiver("kit_papier.zip", list(fichiers(["cache/seq01"])))
    else:
        raise SystemExit(__doc__)
