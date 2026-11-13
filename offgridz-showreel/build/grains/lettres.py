"""Séquence 2 — contours des lettres monumentales, pour le rendu : le mot OFFGRIDZ dans chaque caractère du roulement n° 2.

Anton reprend exactement la construction de la simulation (hauteur de capitale, puis approche réglée pour atteindre la
largeur) : ce sont ces lettres-là que les grains contournent. Les autres caractères sont ajustés à la même largeur.

    /opt/og/venv/bin/python build/grains/lettres.py      ->  cache/grains/lettres.json
"""
import json
import pathlib
import sys

ICI = pathlib.Path(__file__).resolve().parent
RACINE = ICI.parents[1]
sys.path.insert(0, str(ICI))
sys.path.insert(0, str(RACINE / "build" / "type"))
import monde as M        # noqa: E402
import typekit as tk     # noqa: E402

manifeste = {f["id"]: f for f in json.loads((RACINE / "assets/fonts/fonts.json").read_text(encoding="utf-8"))["faces"]}
resultat = {}
for ident in sorted(set(M.ROULEMENT_2) | {"bodoni-moda-var"}):
    axes = manifeste[ident].get("showcase_axes") or {}
    if ident == "anton":
        g0 = tk.outlines("OFFGRIDZ", ident, size=M.LETTRES_CAP, tracking=0.0)
        b0 = tk.bounds(g0)
        g = tk.outlines("OFFGRIDZ", ident, size=M.LETTRES_CAP, tracking=(M.LETTRES_LARGEUR - (b0[2] - b0[0])) / 7.0)
    else:
        g = tk.fit_width(tk.outlines("OFFGRIDZ", ident, **axes), M.LETTRES_LARGEUR)
    b = tk.bounds(g)
    xc = 0.5 * (b[0] + b[2])
    bas = 0.0 if ident == "anton" else b[1]            # les lettres sont posées sur le sol
    contours = []
    for p in tk.polylines(g, 3e-5):
        contours.append({"points": [[x - xc, y - bas] for x, y in p["points"]], "trou": bool(p["hole"]), "lettre": p["char"]})
    resultat[ident] = {"contours": contours, "largeur": b[2] - b[0], "hauteur": b[3] - b[1]}
    print(f"{ident} : {len(contours)} contours, {1000 * (b[2] - b[0]):.1f} x {1000 * (b[3] - b[1]):.1f} mm")
sortie = RACINE / "cache" / "grains"
sortie.mkdir(parents=True, exist_ok=True)
(sortie / "lettres.json").write_text(json.dumps(resultat), encoding="utf-8")
