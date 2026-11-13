"""Textures de l'enseigne floue derrière le verre : le mot OFFGRIDZ dans chaque caractère du roulement n° 3.

    /opt/og/venv/bin/python build/mojito/enseigne.py      ->  out/mojito/enseigne/<caractere>.png (blanc sur noir)
"""
import json
import pathlib
import sys

RACINE = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "build" / "type"))
import typekit as T  # noqa: E402

LARGEUR, HAUTEUR, MARGE = 2048, 512, 96
partition = json.loads((RACINE / "timeline" / "partition.json").read_text(encoding="utf-8"))
caracteres = next(e for e in partition["evenements"] if e["nom"] == "roulement 1")["caracteres"]
manifeste = {f["id"]: f for f in json.loads((RACINE / "assets/fonts/fonts.json").read_text(encoding="utf-8"))["faces"]}
sortie = RACINE / "out" / "mojito" / "enseigne"
sortie.mkdir(parents=True, exist_ok=True)
for ident in caracteres:
    axes = manifeste[ident].get("showcase_axes") or {}
    g = T.fit_width(T.outlines("OFFGRIDZ", ident, **axes), LARGEUR - 2 * MARGE)
    x0, y0, x1, y1 = T.bounds(g)
    if y1 - y0 > HAUTEUR - 2 * MARGE:                         # caractères hauts et étroits : on cale sur la hauteur
        k = (HAUTEUR - 2 * MARGE) / (y1 - y0)
        g = T.transform(g, k, k); x0, y0, x1, y1 = T.bounds(g)
    img = T.raster(g, LARGEUR, HAUTEUR, "#FFFFFF", "#000000", scale=1.0,
                   origin=((LARGEUR - (x1 - x0)) / 2 - x0, HAUTEUR / 2 + (y1 + y0) / 2))
    img.save(sortie / f"{ident}.png")
    print(ident, img.size)
