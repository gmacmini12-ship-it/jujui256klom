"""Stage 2 : outlines JSON de OFFGRIDZ pour chaque face + planches specimen (PNG).
Relancer : /opt/og/venv/bin/python build/type/make_assets.py   (après build_kit.py)"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import typekit as T

BG, CREAM, MUTED, ORANGE = "#0A0A09", "#EEDFD2", "#8A7E74", "#EA470F"
FD = T.FONTS_DIR
LABEL = ImageFont.truetype(os.path.join(FD, "jetbrains-mono", "jetbrains-mono-400.ttf"), 20)
HEAD = ImageFont.truetype(os.path.join(FD, "jetbrains-mono", "jetbrains-mono-800.ttf"), 26)
SMALL = ImageFont.truetype(os.path.join(FD, "jetbrains-mono", "jetbrains-mono-400.ttf"), 16)

SHOWCASE = {  # instance de chaque police variable utilisée pour la planche et les outlines
 "archivo-var": {"wdth": 125, "wght": 900},
 "bodoni-moda-var": {"wght": 900, "opsz": 96}, "bodoni-moda-var-italic": {"wght": 900, "opsz": 96},
 "fraunces-var": {"wght": 900, "opsz": 144, "SOFT": 0, "WONK": 0}, "fraunces-var-italic": {"wght": 900, "opsz": 144, "SOFT": 0, "WONK": 1},
 "big-shoulders-display-var": {"wght": 900}, "doto-var": {"wght": 900, "ROND": 0},
}
CATS = [("grotesque", "GROTESQUES LARGES / HEAVY"), ("serif", "SERIFS A FORT CONTRASTE"), ("condensed", "GOTHIQUES CONDENSEES D'AFFICHE"),
        ("stencil", "STENCIL"), ("dotmatrix", "MATRICE DE POINTS / PIXEL"), ("script", "SCRIPT / MAIN"),
        ("blackletter", "BLACKLETTER"), ("mono", "MONOSPACE (annotations)")]

def axes_str(ax): return " ".join(f"{k}={int(v) if float(v).is_integer() else v}" for k, v in ax.items())

def main():
    man_path = os.path.join(FD, "fonts.json")
    man = json.load(open(man_path, encoding="utf-8"))
    os.makedirs(os.path.join(FD, "outlines"), exist_ok=True)
    for e in man["faces"]:
        if e["variable"]: e["showcase_axes"] = SHOWCASE[e["id"]]
        ax = SHOWCASE.get(e["id"], {})
        g = T.outlines("OFFGRIDZ", e["id"], size=1.0, **ax)
        T.to_json(g, os.path.join(FD, "outlines", e["id"] + ".json"),
                  meta={"text": "OFFGRIDZ", "face": e["id"], "family": e["family"], "style": e["style"], "axes": ax,
                        "licence": e["licence"], "size": 1.0, "tracking": 0.0, "kerning": e["has_kern"]})
        e["outlines"] = f"outlines/{e['id']}.json"
    json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---------------- specimen.png
    rows = []  # (kind, payload)
    for cat, title in CATS:
        fs = [e for e in man["faces"] if e["category"] == cat]
        if not fs: continue
        rows.append(("head", title))
        for e in fs:
            ax = SHOWCASE.get(e["id"], {})
            g = T.fit_width(T.outlines("OFFGRIDZ", e["id"], **ax), 900)
            sty = ("Variable Italic" if e["italic"] else "Variable") if ax else e["style"]
            lab = f"{e['family']} · {sty}" + (f" [{axes_str(ax)}]" if ax else "") + f" · {e['licence']}"
            rows.append(("word", (g, lab)))
    H = 40; layout = []
    for k, p in rows:
        if k == "head": layout.append((k, p, H)); H += 70
        else:
            g, lab = p; x0, y0, x1, y1 = T.bounds(g)
            top = H + 18; base = top + y1; bottom = base - y0
            layout.append((k, (g, lab, base), top)); H = int(bottom + 12 + 28 + 26)
    H += 20
    img = Image.new("RGB", (1080, H), BG); d = ImageDraw.Draw(img)
    for k, p, y in layout:
        if k == "head":
            d.text((90, y + 14), p, font=HEAD, fill=ORANGE)
            d.line([(90, y + 52), (990, y + 52)], fill="#4C352D", width=1)
        else:
            g, lab, base = p
            h = int(T.bounds(g)[3] - T.bounds(g)[1]) + 6
            tile = T.raster(g, 1080, h, CREAM, BG, scale=1.0, origin=(90, T.bounds(g)[3] + 3))
            img.paste(tile, (0, int(base - T.bounds(g)[3] - 3)))
            d.text((90, base - T.bounds(g)[1] + 14), lab, font=LABEL, fill=MUTED)
    img.save(os.path.join(FD, "specimen.png"))
    print("specimen.png", img.size)

    # ---------------- specimen_variable.png
    GRIDS = [
     ("archivo-var", [{"wdth": w, "wght": g} for g in (400, 900) for w in (62, 100, 125)]),
     ("bodoni-moda-var", [{"opsz": o, "wght": g} for g in (400, 900) for o in (6, 28, 96)]),
     ("bodoni-moda-var-italic", [{"opsz": o, "wght": g} for g in (400, 900) for o in (6, 28, 96)]),
     ("fraunces-var", [{"wght": 100, "opsz": 144}, {"wght": 400, "opsz": 144}, {"wght": 900, "opsz": 144},
                       {"wght": 900, "opsz": 9}, {"wght": 900, "opsz": 144, "SOFT": 100}, {"wght": 600, "opsz": 144, "SOFT": 100}]),
     ("fraunces-var-italic", [{"wght": 100, "opsz": 144}, {"wght": 400, "opsz": 144}, {"wght": 900, "opsz": 144}]),
     ("big-shoulders-display-var", [{"wght": w} for w in (100, 400, 900)]),
     ("doto-var", [{"wght": w, "ROND": r} for r in (0, 100) for w in (100, 500, 900)]),
    ]
    byid = {e["id"]: e for e in man["faces"]}
    W3 = 3; cw = 1080 // W3
    layout = []; H = 40
    for fid, insts in GRIDS:
        e = byid[fid]; layout.append(("head", f"{e['family']} · {e['style']}", H)); H += 70
        for r in range(0, len(insts), W3):
            row = []
            for ax in insts[r:r + W3]:
                full = {a["tag"]: a["default"] for a in e["axes"]}; full.update(ax)
                # axes non précisés : valeurs du showcase (SOFT/WONK/opsz) sauf ceux fixés
                for kk, vv in e["showcase_axes"].items():
                    if kk not in ax and kk in ("SOFT", "WONK"): full[kk] = vv
                g = T.fit_width(T.outlines("OFFGRIDZ", fid, **full), cw - 60); row.append((g, axes_str(ax)))
            ymax = max(T.bounds(g)[3] for g, _ in row); ymin = min(T.bounds(g)[1] for g, _ in row)
            layout.append(("row", (row, ymax, ymin), H)); H += int(ymax - ymin) + 70
        H += 30
    img = Image.new("RGB", (1080, H + 20), BG); d = ImageDraw.Draw(img)
    for k, p, y in layout:
        if k == "head":
            d.text((30, y + 14), p, font=HEAD, fill=ORANGE); d.line([(30, y + 52), (1050, y + 52)], fill="#4C352D", width=1)
        else:
            row, ymax, ymin = p
            for i, (g, lab) in enumerate(row):
                gh = int(T.bounds(g)[3] - T.bounds(g)[1]) + 6
                tile = T.raster(g, cw, gh, CREAM, BG, scale=1.0, origin=(30, T.bounds(g)[3] + 3))
                img.paste(tile, (i * cw, int(y + ymax - T.bounds(g)[3] - 3)))
                d.text((i * cw + 30, y + ymax - ymin + 14), lab, font=SMALL, fill=MUTED)
    img.save(os.path.join(FD, "specimen_variable.png")); print("specimen_variable.png", img.size)

    # ---------------- specimen_micro.png
    LINES = ["ÉPREUVE N° 01 — REPÉRAGE : PERDU",
             "ÉTAT : GRANULAIRE — N = 2 400 000 GRAINS",
             "FOND PERDU — BON À TIRER — 150 BPM — 00:17,60"]
    MONOS = ["space-mono-400", "space-mono-700", "jetbrains-mono-400", "ibm-plex-mono-400", "ibm-plex-mono-700",
             "major-mono-display", "dotgothic16"]
    H = 30 + len(MONOS) * (34 * 3 + 64)
    img = Image.new("RGB", (1080, H), BG); d = ImageDraw.Draw(img); y = 30
    for fid in MONOS:
        e = byid[fid]
        d.text((36, y), f"{e['family']} · {e['style']} · {e['licence']} · 22 px", font=SMALL, fill=ORANGE); y += 28
        f = ImageFont.truetype(os.path.join(FD, e["file"]), 22)
        for ln in LINES:
            d.text((36, y), ln, font=f, fill=CREAM); y += 34
        y += 36
    img.save(os.path.join(FD, "specimen_micro.png")); print("specimen_micro.png", img.size)

if __name__ == "__main__":
    main()
