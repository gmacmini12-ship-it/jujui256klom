"""Stage 1 of the type kit: npm fontsource packages -> TTF + licences + fonts.json.

Usage: build_kit.py <dir with extracted npm packages: <pkgdir>/package/...>
(npm pack each @fontsource package, untar into <dir>/<name>/ ; see FACES below).
"""
import json, os, shutil, sys, glob
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "fonts")

# (face_id, npm package, file stem inside package/files, family, style label, category, weight, italic)
V = "@fontsource-variable/"; S = "@fontsource/"
FACES = [
 # wide heavy grotesques
 ("archivo-var", V+"archivo", "archivo-latin-wdth-normal", "Archivo", "Variable wdth+wght", "grotesque", None, False),
 ("unbounded-900", S+"unbounded", "unbounded-latin-900-normal", "Unbounded", "Black 900", "grotesque", 900, False),
 ("syne-800", S+"syne", "syne-latin-800-normal", "Syne", "ExtraBold 800", "grotesque", 800, False),
 ("dela-gothic-one", S+"dela-gothic-one", "dela-gothic-one-latin-400-normal", "Dela Gothic One", "Regular", "grotesque", 400, False),
 ("rubik-mono-one", S+"rubik-mono-one", "rubik-mono-one-latin-400-normal", "Rubik Mono One", "Regular", "grotesque", 400, False),
 ("krona-one", S+"krona-one", "krona-one-latin-400-normal", "Krona One", "Regular", "grotesque", 400, False),
 # serifs
 ("bodoni-moda-var", V+"bodoni-moda", "bodoni-moda-latin-opsz-normal", "Bodoni Moda", "Variable opsz+wght", "serif", None, False),
 ("bodoni-moda-var-italic", V+"bodoni-moda", "bodoni-moda-latin-opsz-italic", "Bodoni Moda", "Variable opsz+wght Italic", "serif", None, True),
 ("playfair-display-900", S+"playfair-display", "playfair-display-latin-900-normal", "Playfair Display", "Black 900", "serif", 900, False),
 ("playfair-display-900-italic", S+"playfair-display", "playfair-display-latin-900-italic", "Playfair Display", "Black 900 Italic", "serif", 900, True),
 ("fraunces-var", V+"fraunces", "fraunces-latin-full-normal", "Fraunces", "Variable opsz+wght+SOFT+WONK", "serif", None, False),
 ("fraunces-var-italic", V+"fraunces", "fraunces-latin-full-italic", "Fraunces", "Variable opsz+wght+SOFT+WONK Italic", "serif", None, True),
 ("dm-serif-display", S+"dm-serif-display", "dm-serif-display-latin-400-normal", "DM Serif Display", "Regular", "serif", 400, False),
 ("dm-serif-display-italic", S+"dm-serif-display", "dm-serif-display-latin-400-italic", "DM Serif Display", "Italic", "serif", 400, True),
 ("instrument-serif", S+"instrument-serif", "instrument-serif-latin-400-normal", "Instrument Serif", "Regular", "serif", 400, False),
 ("instrument-serif-italic", S+"instrument-serif", "instrument-serif-latin-400-italic", "Instrument Serif", "Italic", "serif", 400, True),
 # condensed poster gothics
 ("anton", S+"anton", "anton-latin-400-normal", "Anton", "Regular", "condensed", 400, False),
 ("bebas-neue", S+"bebas-neue", "bebas-neue-latin-400-normal", "Bebas Neue", "Regular", "condensed", 400, False),
 ("league-gothic", S+"league-gothic", "league-gothic-latin-400-normal", "League Gothic", "Regular", "condensed", 400, False),
 ("oswald-700", S+"oswald", "oswald-latin-700-normal", "Oswald", "Bold 700", "condensed", 700, False),
 ("big-shoulders-display-var", V+"big-shoulders-display", "big-shoulders-display-latin-wght-normal", "Big Shoulders Display", "Variable wght", "condensed", None, False),
 # mono
 ("space-mono-400", S+"space-mono", "space-mono-latin-400-normal", "Space Mono", "Regular 400", "mono", 400, False),
 ("space-mono-700", S+"space-mono", "space-mono-latin-700-normal", "Space Mono", "Bold 700", "mono", 700, False),
 ("jetbrains-mono-400", S+"jetbrains-mono", "jetbrains-mono-latin-400-normal", "JetBrains Mono", "Regular 400", "mono", 400, False),
 ("jetbrains-mono-800", S+"jetbrains-mono", "jetbrains-mono-latin-800-normal", "JetBrains Mono", "ExtraBold 800", "mono", 800, False),
 ("ibm-plex-mono-400", S+"ibm-plex-mono", "ibm-plex-mono-latin-400-normal", "IBM Plex Mono", "Regular 400", "mono", 400, False),
 ("ibm-plex-mono-700", S+"ibm-plex-mono", "ibm-plex-mono-latin-700-normal", "IBM Plex Mono", "Bold 700", "mono", 700, False),
 ("major-mono-display", S+"major-mono-display", "major-mono-display-latin-400-normal", "Major Mono Display", "Regular", "mono", 400, False),
 # stencil
 ("stardos-stencil-400", S+"stardos-stencil", "stardos-stencil-latin-400-normal", "Stardos Stencil", "Regular 400", "stencil", 400, False),
 ("stardos-stencil-700", S+"stardos-stencil", "stardos-stencil-latin-700-normal", "Stardos Stencil", "Bold 700", "stencil", 700, False),
 ("saira-stencil-one", S+"saira-stencil-one", "saira-stencil-one-latin-400-normal", "Saira Stencil One", "Regular", "stencil", 400, False),
 # dot-matrix / pixel
 ("doto-var", V+"doto", "doto-latin-full-normal", "Doto", "Variable wght+ROND", "dotmatrix", None, False),
 ("silkscreen-400", S+"silkscreen", "silkscreen-latin-400-normal", "Silkscreen", "Regular 400", "dotmatrix", 400, False),
 ("silkscreen-700", S+"silkscreen", "silkscreen-latin-700-normal", "Silkscreen", "Bold 700", "dotmatrix", 700, False),
 ("dotgothic16", S+"dotgothic16", "dotgothic16-latin-400-normal", "DotGothic16", "Regular", "dotmatrix", 400, False),
 # script / hand
 ("yellowtail", S+"yellowtail", "yellowtail-latin-400-normal", "Yellowtail", "Regular", "script", 400, False),
 ("permanent-marker", S+"permanent-marker", "permanent-marker-latin-400-normal", "Permanent Marker", "Regular", "script", 400, False),
 # blackletter
 ("unifrakturmaguntia", S+"unifrakturmaguntia", "unifrakturmaguntia-latin-400-normal", "UnifrakturMaguntia", "Regular", "blackletter", 400, False),
]

COVER = {
 "upper": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
 "digits": "0123456789",
 "punct": ".,:;!?-–—/°%+×=()«»",
 "fr_upper": "ÉÈÊÀÂÇÎÔÙÛŒ",
 "fr_lower": "éèêàâçîôùûœ",
}
LICENSE_OK = {"OFL-1.1": "SIL OFL 1.1", "Apache-2.0": "Apache 2.0"}

def slug_of(pkg): return pkg.split("/")[1]

def find_pkg(src, pkg):
    base = pkg.replace("@", "").replace("/", "-")
    c = sorted(glob.glob(os.path.join(src, base + "-[0-9]*")))
    return c[-1] if c else None

def main(src):
    entries = []; skipped = []
    for fid, pkg, stem, fam, style, cat, wt, ital in FACES:
        pd = find_pkg(src, pkg)
        if not pd: skipped.append((fid, "package missing")); continue
        pj = json.load(open(os.path.join(pd, "package", "package.json")))
        lic = pj.get("license")
        if lic not in LICENSE_OK: skipped.append((fid, "licence " + str(lic))); continue
        wf = os.path.join(pd, "package", "files", stem + ".woff2")
        if not os.path.exists(wf): skipped.append((fid, "file missing " + stem)); continue
        fslug = slug_of(pkg)
        d = os.path.join(OUT, fslug); os.makedirs(d, exist_ok=True)
        f = TTFont(wf); f.flavor = None
        rel = f"{fslug}/{fid}.ttf"
        f.save(os.path.join(OUT, rel))
        shutil.copyfile(os.path.join(pd, "package", "LICENSE"), os.path.join(d, "LICENSE.txt"))
        f = TTFont(os.path.join(OUT, rel))
        cmap = f.getBestCmap()
        cov = {k: [c for c in v if ord(c) not in cmap] for k, v in COVER.items()}
        axes = [{"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue} for a in f["fvar"].axes] if "fvar" in f else []
        hmtx = f["hmtx"]; adv = {hmtx[cmap[ord(c)]][0] for c in "ilMW." if ord(c) in cmap}
        entries.append({
            "id": fid, "family": fam, "style": style, "category": cat, "weight": wt, "italic": ital,
            "file": rel, "licence_file": f"{fslug}/LICENSE.txt",
            "axes": axes, "variable": bool(axes),
            "licence": LICENSE_OK[lic], "licence_spdx": lic,
            "npm": pkg, "npm_version": pj["version"], "source_file": stem + ".woff2",
            "units_per_em": f["head"].unitsPerEm,
            "has_kern": ("GPOS" in f and any(fr.FeatureTag == "kern" for fr in f["GPOS"].table.FeatureList.FeatureRecord)) or "kern" in f,
            "monospaced_metrics": len(adv) == 1,
            "coverage_missing": cov,
            "coverage": {k: not v for k, v in cov.items()},
            "coverage_all": all(not v for v in cov.values()),
        })
    json.dump({"faces": entries}, open(os.path.join(OUT, "fonts.json"), "w"), ensure_ascii=False, indent=1)
    print(len(entries), "faces kept;", "skipped:", skipped)
    for e in entries:
        miss = {k: "".join(v) for k, v in e["coverage_missing"].items() if v}
        print(f"{e['id']:30s} {e['licence']:10s} axes={[a['tag'] for a in e['axes']]} kern={e['has_kern']} mono={e['monospaced_metrics']} missing={miss}")

if __name__ == "__main__":
    main(sys.argv[1])
