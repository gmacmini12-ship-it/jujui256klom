"""Prépare les archives à déposer sur la machine GPU louée, et vérifie qu'il n'y manque rien.

    /opt/og/venv/bin/python build/gpu/kit.py code        ->  out/gpu/kit_code.zip     (scripts, petites données : quelques Mo)
    /opt/og/venv/bin/python build/gpu/kit.py liquide 256 ->  out/gpu/kit_liquide_NN.zip (surfaces du liquide, par tranches)
    /opt/og/venv/bin/python build/gpu/kit.py liquide_c 256 281 320 ->  out/gpu/kit_liquide_c.zip (images du liquide refaites)
    /opt/og/venv/bin/python build/gpu/kit.py papier      ->  out/gpu/kit_papier.zip   (caches de la séquence d'ouverture)
    /opt/og/venv/bin/python build/gpu/kit.py seq56 [grains_final] ->  out/gpu/kit_seq56.zip (séquences 5-6 : grains légers 456-503 + film d'encre 480-527)

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
    "build/grains", "build/mojito", "build/seq01", "build/seq56", "build/gpu/session.sh", "build/gpu/pilote.sh",
    "build/gpu/pilote_film.py", "build/type",
    "cache/grains/lettres.json", "cache/mojito/chutes.npz", "cache/mojito/plantes.json",
    "out/mojito/enseigne", "assets/logo", "assets/fonts/fonts.json",
    "out/grains/dalle/f0072.npz", "out/grains/dalle/run.json",         # état de repos de la dalle (séquence 1, raccord)
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
        # kit.py code [dossier de session] : le plan et les adresses de dépôt de la session sont joints à l'archive
        session = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
        liste = list(fichiers(CODE + sys.argv[3:]))       # chemins supplémentaires : caches à emporter dans la même archive
        archiver("kit_code.zip", liste)
        joints = {"creneaux.txt": (session or SORTIE) / "creneaux.txt"}
        if session:
            joints["plan.json"] = session / "plan.json"
        with zipfile.ZipFile(SORTIE / "kit_code.zip", "a", zipfile.ZIP_DEFLATED) as z:
            for nom, chemin in joints.items():
                if chemin.exists():
                    z.write(chemin, nom)
                    print(f"{nom} ajouté à l'archive ({chemin.relative_to(RACINE)})")
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
    elif quoi == "liquide_c":
        # kit.py liquide_c 256 281 320 : images du liquide refaites par le confinement (build/mojito/surface.py --confiner 1)
        res = sys.argv[2] if len(sys.argv) > 2 else "256"
        a, b = (int(v) for v in sys.argv[3:5]) if len(sys.argv) > 4 else (0, 9999)
        d = RACINE / "cache" / "mojito" / f"liquide_r{res}c"
        liste = [f for f in sorted(d.glob("f[0-9][0-9][0-9][0-9].npz")) if a <= int(f.stem[1:]) <= b]
        archiver("kit_liquide_c.zip", liste, zipfile.ZIP_STORED)
    elif quoi == "papier":
        archiver("kit_papier.zip", list(fichiers(["cache/seq01"])))
    elif quoi == "seq56":
        # ce que lit build/seq56/scene.py : les images légères des grains, et le dossier du film (hauteurs s0480..s0527, Ta.npy)
        nom = sys.argv[2] if len(sys.argv) > 2 else "grains_final"
        g = RACINE / "cache" / "seq56" / nom
        w = RACINE / "cache" / "seq56" / ("work_" + nom)
        films = sorted(d for d in w.glob("film_fpx*") if (d / "Ta.npy").exists()) if w.exists() else []
        if not g.exists() or not films:
            raise SystemExit(f"absent : {g} ou un dossier film_fpx* complet dans {w}")
        liste = [f for f in sorted(g.glob("f[0-9][0-9][0-9][0-9].npz"))] + [g / "run.json"]
        liste += [f for f in (g / "activite.json",) if f.exists()]
        liste += [f for f in sorted(films[0].iterdir()) if f.is_file()]
        archiver("kit_seq56.zip", liste, zipfile.ZIP_DEFLATED)
    else:
        raise SystemExit(__doc__)
