"""Fabrique le dossier de préproduction d'INSOUMISE à partir du contenu et de la partition.

    python build/dossier/make_dossier.py

Sorties : preprod/dossier.html (page), preprod/img/roulement.png (planche des caractères),
DOSSIER_PREPRODUCTION.md (version texte du même contenu).
"""
import html
import json
import pathlib
import random
import sys

RACINE = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "build" / "dossier"))
sys.path.insert(0, str(RACINE / "build" / "type"))
import contenu as C  # noqa: E402

PARTITION = json.loads((RACINE / "timeline" / "partition.json").read_text(encoding="utf-8"))
FPS = PARTITION["format"]["images_par_seconde"]


def e(texte):
    """Échappe le texte et pose les espaces insécables de la typographie française."""
    t = html.escape(str(texte))
    for avant, apres in (("« ", "«&#160;"), (" »", "&#160;»"), (" :", "&#160;:"), (" ;", "&#160;;"), (" ?", "&#160;?"), (" %", "&#160;%")):
        t = t.replace(avant, apres)
    return t


def n(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def fr(v, dec=2):
    """Nombre à la française : virgule décimale, zéros inutiles retirés."""
    s = f"{v:.{dec}f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    return s.replace(".", ",")


# ----------------------------------------------------------------------------------------------
# Planches du storyboard : schémas de composition à l'échelle 1/10 de la feuille (108 × 192).
# ----------------------------------------------------------------------------------------------
WX0, WY0, WX1, WY1 = 3.6, 20.4, 104.4, 171.6      # fenêtre image
CX, CY, R = 54.0, 96.0, 49.2                       # cercle du logo


def marques(texte_haut=True):
    s = []
    for x, sx in ((WX0, -1), (WX1, 1)):
        for y, sy in ((WY0, -1), (WY1, 1)):
            s.append(f'<path d="M{n(x + sx * 0.8)} {n(y)}H{n(x + sx * 3.2)}M{n(x)} {n(y + sy * 0.8)}V{n(y + sy * 3.6)}" class="tc"/>')
    if texte_haut:
        s.append('<rect x="3.6" y="9" width="34" height="1.3" class="an"/><rect x="3.6" y="12" width="20" height="1.3" class="an"/>')
    s.append('<rect x="3.6" y="181" width="24" height="1.3" class="an"/>')
    return "".join(s)


def reticule(cx=CX, cy=CY, r=R, rot=0, cls="rt"):
    k = 3.2
    d = (f"M{n(cx)} {n(cy - r - k)}V{n(cy - r + k)}M{n(cx - k)} {n(cy - r)}H{n(cx + k)}"
         f"M{n(cx)} {n(cy + r - k)}V{n(cy + r + k)}M{n(cx - k)} {n(cy + r)}H{n(cx + k)}"
         f"M{n(cx - r - k)} {n(cy)}H{n(cx - r + k)}M{n(cx + r - k)} {n(cy)}H{n(cx + r + k)}")
    t = f' transform="rotate({rot} {n(cx)} {n(cy)})"' if rot else ""
    return f'<g{t}><circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" class="{cls}"/><path d="{d}" class="{cls}"/></g>'


def mot(y=99.2, largeur=78, corps=11.5, cls="mot", extra=""):
    return (f'<text x="54" y="{n(y)}" text-anchor="middle" textLength="{n(largeur)}" lengthAdjust="spacingAndGlyphs" '
            f'font-size="{n(corps)}" class="{cls}"{extra}>OFFGRIDZ</text>')


def tete(op=1.0):
    return (f'<g opacity="{op}"><ellipse cx="50" cy="106" rx="25" ry="34" class="fg"/>'
            '<path d="M27 84C20 66 38 54 54 58C74 54 86 68 76 86C62 76 40 76 27 84Z" class="fg2"/></g>')


def bande(op=0.92, h=95.5):
    return f'<rect x="59.5" y="50.9" width="20.1" height="{n(h)}" class="fo" opacity="{op}"/>'


def bande_dechiree(seed=1, transform=""):
    rnd = random.Random(seed)
    xs = [6 + 96 * i / 24 for i in range(25)]
    haut = [(x, 84.2 + rnd.uniform(-1.5, 1.5)) for x in xs]
    bas = [(x, 101.9 + rnd.uniform(-1.5, 1.5)) for x in reversed(xs)]
    pts = " ".join(f"{n(x)},{n(y)}" for x, y in haut + bas)
    t = f' transform="{transform}"' if transform else ""
    return f'<polygon points="{pts}" class="bd"{t}/>'


def semis(seed, k, tirage, cls="fo", r=(0.35, 0.8)):
    rnd = random.Random(seed)
    pts = []
    for _ in range(k):
        x, y = tirage(rnd)
        pts.append(f'<circle cx="{n(x)}" cy="{n(y)}" r="{rnd.uniform(*r):.2f}"/>')
    return f'<g class="{cls}">{"".join(pts)}</g>'


def logo(mot_visible=True):
    return tete() + bande() + bande_dechiree() + (mot() if mot_visible else "") + reticule()


def verre(liquide=None):
    s = '<rect x="64" y="28" width="15" height="136" class="fo" opacity="0.55"/>'            # barre lumineuse
    s += '<ellipse cx="54" cy="153" rx="27" ry="5" class="fc" opacity="0.22"/>'                # sous-verre
    if liquide is not None:
        s += f'<path d="M{n(36.2 + (liquide - 70) * 0.05)} {n(liquide)}H{n(71.8 - (liquide - 70) * 0.05)}L68 150H40Z" class="lq"/>'
    s += '<path d="M36 70L40 150H68L72 70" class="vr"/><path d="M40 150H68" class="vr"/>'
    return s


def glacon(x, y, a, t=11):
    return f'<rect x="{n(x - t / 2)}" y="{n(y - t / 2)}" width="{t}" height="{t}" rx="1.5" class="gl" transform="rotate({a} {n(x)} {n(y)})"/>'


def sucre(seed=5):
    return semis(seed, 60, lambda q: (q.uniform(41.5, 66.5), q.uniform(144.5, 149)), cls="am", r=(0.3, 0.6))


def planche(cle):
    f = {
        "logo": lambda: marques() + logo(),
        "dechirure": lambda: (marques() + tete() + bande()
                              + '<rect x="6" y="86" width="96" height="14" class="fn2"/><rect x="6" y="92.6" width="96" height="0.9" class="fo" opacity="0.7"/>'
                              + bande_dechiree(2, "translate(-10 -17) rotate(-13 6 93)") + mot() + reticule(rot=4)),
        "roulement": lambda: (marques() + '<rect x="6" y="86" width="96" height="14" class="fn2"/>'
                              + mot(79, 74, 13, "mot-s", ' opacity="0.4"') + mot(100.5, 86, 14) + mot(120, 80, 10, "mot-m", ' opacity="0.4"')
                              + reticule(r=49.2, cls="rt2")),
        "plongee": lambda: (marques() + '<ellipse cx="54" cy="96" rx="58" ry="84" class="lt"/>'
                            + '<ellipse cx="54" cy="96" rx="26" ry="50" class="fn2"/><rect x="49" y="70" width="10" height="52" class="fo"/>'
                            + semis(3, 40, lambda q: (q.uniform(6, 102), q.choice([q.uniform(22, 30), q.uniform(162, 170)])), cls="fc2", r=(0.2, 0.5))
                            + reticule(r=49.2, cls="rt2")),
        "dalle": lambda: (marques() + '<rect x="3.6" y="150" width="100.8" height="21.6" class="sol"/>'
                          + '<rect x="43" y="66" width="22" height="84" class="fo"/>'
                          + semis(4, 150, lambda q: (q.gauss(54, 9), 66 - abs(q.gauss(0, 8)) + q.uniform(0, 26)), r=(0.4, 0.9))
                          + semis(6, 70, lambda q: (q.gauss(54, 15), q.uniform(144, 150)), r=(0.4, 0.8))
                          + reticule(54, 104, 40, cls="rt")),
        "avalanche": lambda: (marques() + '<rect x="3.6" y="132" width="100.8" height="39.6" class="sol"/>'
                              + semis(7, 420, lambda q: (lambda u: (6 + 96 * u + q.gauss(0, 5), 30 + 104 * u ** 0.7 + q.gauss(0, 9)))(q.random()), r=(0.4, 1.0))
                              + mot(133, 92, 22, "mot-a")
                              + semis(8, 160, lambda q: (q.uniform(8, 100), q.uniform(128, 138)), r=(0.4, 0.9))),
        "filet": lambda: (marques() + semis(9, 150, lambda q: (54 + q.gauss(0, 1.1), q.uniform(22, 138)), r=(0.35, 0.75))
                          + reticule(54, 62, 13, cls="rt3") + '<ellipse cx="54" cy="147" rx="24" ry="8" class="vr"/>'
                          + '<ellipse cx="54" cy="147" rx="30" ry="11" class="rt2"/>'
                          + semis(10, 40, lambda q: (54 + q.gauss(0, 6), 147 + q.gauss(0, 2)), cls="am", r=(0.3, 0.6))),
        "glacons": lambda: (marques() + verre() + sucre() + glacon(50, 44, 22) + glacon(60, 62, -15) + glacon(47, 96, 40)
                            + glacon(58, 122, 8) + '<ellipse cx="45" cy="137" rx="6" ry="2.6" class="mt" transform="rotate(-20 45 137)"/>'
                            + '<path d="M56 141a7 7 0 0 1 10 -4z" class="mt"/>'),
        "versement": lambda: (marques() + verre(96) + sucre() + glacon(48, 104, 30) + glacon(60, 116, -12) + glacon(52, 130, 10)
                              + '<path d="M22 22C34 40 44 58 49 96" class="jet"/>'
                              + semis(11, 40, lambda q: (q.uniform(42, 66), q.uniform(100, 146)), cls="bu", r=(0.3, 0.7))
                              + '<path d="M44 140c4 -6 10 -8 16 -4c-4 4 -10 6 -16 4z" class="am" opacity="0.6"/>'),
        "heros": lambda: (marques() + verre(76) + glacon(47, 86, 18) + glacon(60, 96, -20) + glacon(50, 112, 35) + glacon(60, 128, 5)
                          + semis(12, 30, lambda q: (q.uniform(42, 66), q.uniform(82, 146)), cls="bu", r=(0.25, 0.6))
                          + '<ellipse cx="50" cy="71" rx="7" ry="3" class="mt" transform="rotate(-25 50 71)"/>'
                          + '<ellipse cx="58" cy="69" rx="6" ry="2.6" class="mt" transform="rotate(20 58 69)"/>'
                          + '<path d="M66 40L57 147" class="pl2"/><path d="M66 40L57 147" class="pl"/>'
                          + reticule(54, 108, 45, cls="rt-ok")),
        "points": lambda: (marques() + '<path d="M54 0V192M0 96H108" class="ax"/>'
                           + semis(13, 520, lambda q: (q.uniform(4, 104), q.uniform(22, 170)), cls="fc2", r=(0.15, 0.45))
                           + semis(14, 160, lambda q: (q.gauss(70, 9), q.uniform(22, 170)), r=(0.15, 0.45))
                           + mot(100, 84, 13, "mot-m")),
        "relief": lambda: (marques() + '<path d="M54 0V192M0 96H108" class="ax"/>'
                           + semis(15, 900, lambda q: _point_tete(q), cls="fc2", r=(0.15, 0.4))
                           + semis(16, 320, lambda q: (q.uniform(59.5, 79.6), q.uniform(52, 146)), r=(0.2, 0.5))
                           + semis(17, 90, lambda q: (q.uniform(80, 104), q.gauss(96, 22)), r=(0.3, 0.8))),
        "debordement": lambda: (marques(texte_haut=False)
                                + semis(18, 1300, lambda q: (q.uniform(0, 108), q.uniform(14, 180)), r=(0.5, 1.3))
                                + semis(19, 260, lambda q: (q.uniform(0, 108), q.choice([q.uniform(2, 16), q.uniform(176, 190)])), r=(0.4, 1.0))
                                + '<text x="54" y="9" text-anchor="middle" font-size="4.2" class="mt-an">FOND PERDU</text>'),
        "raclette": lambda: ('<clipPath id="haut"><rect x="0" y="0" width="108" height="92"/></clipPath>'
                             '<g clip-path="url(#haut)">' + marques() + logo() + '</g>'
                             '<rect x="0" y="98" width="108" height="94" class="fo"/>'
                             '<path d="M0 118C30 110 70 126 108 114V126C70 138 30 122 0 130Z" class="ref"/>'
                             '<rect x="0" y="98" width="108" height="5" class="fo2"/>'
                             '<rect x="0" y="90" width="108" height="8" class="rc"/><rect x="0" y="88" width="108" height="2.2" class="rc2"/>'),
        "signature": lambda: (marques() + logo()
                              + '<text x="54" y="156.5" text-anchor="middle" font-size="5.4" class="sg">Hors-grille.</text>'
                              + '<text x="54" y="164" text-anchor="middle" font-size="5.4" class="sg">Sous contrôle.</text>'),
    }[cle]
    return ('<svg viewBox="0 0 108 192" role="img" xmlns="http://www.w3.org/2000/svg">'
            '<rect x="0" y="0" width="108" height="192" class="fn"/>' + f() + "</svg>")


def _point_tete(q):
    """Point dans la silhouette de la tête, sauf la bande horizontale des yeux (jamais reconstituée)."""
    while True:
        x, y = q.gauss(50, 15), q.gauss(104, 22)
        dans = ((x - 50) / 26) ** 2 + ((y - 104) / 36) ** 2 < 1
        if dans and not 84 < y < 102:
            return x, y


# ----------------------------------------------------------------------------------------------
# Partition graphique
# ----------------------------------------------------------------------------------------------
X0, PX = 132, 100            # colonne des noms, pixels par seconde
RANG = 26


def x_de(image):
    return X0 + image / FPS * PX


def partition_svg():
    ev = PARTITION["evenements"]
    lignes, y = [], 46
    for piste in PARTITION["pistes"]:
        blocs = [v for v in ev if v["piste"] == piste["id"] and "debut" in v]
        points = [v for v in ev if v["piste"] == piste["id"] and "image" in v]
        lignes.append((piste, blocs, points, y))
        y += (RANG if blocs else 0) + (RANG + 8 if points else 0) + 8
    haut_total = y + 30
    largeur = X0 + 20 * PX + 24
    s = [f'<svg viewBox="0 0 {largeur} {haut_total}" width="{largeur}" height="{haut_total}" role="img" '
         f'aria-label="Partition image et son sur vingt secondes" xmlns="http://www.w3.org/2000/svg" class="partition">']
    # grille : temps (traits fins), mesures (traits forts, étiquettes), secondes (axe bas)
    for t in range(51):
        xi = x_de(t * 12)
        fort = t >= 2 and (t - 2) % 4 == 0
        s.append(f'<path d="M{n(xi)} 34V{haut_total - 26}" class="{"g-mes" if fort else "g-tps"}"/>')
        if fort and t < 50:
            s.append(f'<text x="{n(xi + 4)}" y="26" class="t-mes">M{(t - 2) // 4 + 1}</text>')
    s.append(f'<text x="{X0 + 4}" y="26" class="t-mes">levée</text>')
    for sec in range(21):
        xi = X0 + sec * PX
        s.append(f'<path d="M{xi} {haut_total - 26}v6" class="g-mes"/><text x="{xi}" y="{haut_total - 6}" text-anchor="middle" class="t-sec">{sec} s</text>')
    for piste, blocs, points, y0 in lignes:
        s.append(f'<text x="0" y="{y0 + 17}" class="t-piste">{e(piste["nom"])}</text>')
        yy = y0
        if blocs:
            for b in blocs:
                xa, xb = x_de(b["debut"]), x_de(b["fin"] + 1)
                w = xb - xa
                etiq = b["nom"]
                place = int((w - 10) / 6.4)
                if place < 3:
                    etiq = ""
                elif len(etiq) > place:
                    etiq = etiq[:max(place - 1, 1)].rstrip() + "…"
                titre = f'{b["nom"]} — images {b["debut"]} à {b["fin"]} ({fr(b["debut_s"])} à {fr(b["fin_s"])} s)'
                s.append(f'<g class="b b-{piste["id"]}"><title>{e(titre)}</title>'
                         f'<rect x="{n(xa + 0.5)}" y="{yy}" width="{n(max(w - 1, 1))}" height="{RANG - 4}" rx="2"/>'
                         + (f'<text x="{n(xa + 5)}" y="{yy + 15}">{e(etiq)}</text>' if etiq else "") + "</g>")
            yy += RANG
        if points:
            droite = [-1e9, -1e9]
            for p in sorted(points, key=lambda v: v["image"]):
                xi = x_de(p["image"])
                niveau = 0 if xi > droite[0] + 6 else (1 if xi > droite[1] + 6 else (0 if droite[0] <= droite[1] else 1))
                long = len(p["nom"]) * 6.4 + 12
                droite[niveau] = xi + long
                yt = yy + 11 + niveau * 13
                issue = p.get("issue", "")
                cls = "pt-ok" if issue in ("réussi", "tenu") else ("pt-ko" if issue == "échec" else "pt")
                titre = f'{p["nom"]} — image {p["image"]} ({fr(p["image_s"])} s)' + (f" : {issue}" if issue else "")
                s.append(f'<g class="{cls}"><title>{e(titre)}</title><path d="M{n(xi)} {yy - 2}V{yt + 3}" class="pt-fil"/>'
                         f'<path d="M{n(xi)} {yy - 5}l4 4l-4 4l-4 -4z"/><text x="{n(xi + 7)}" y="{yt + 3}">{e(p["nom"])}</text></g>')
    s.append("</svg>")
    return "".join(s)


def jauge_svg():
    ech, h = 2.0, 64
    dep, vise, plafond = C.CREDITS["depenses"], C.CREDITS["vise"], C.CREDITS["plafond"]
    prevu = sum(p[2] for p in C.PALIERS)
    L = plafond * ech
    s = [f'<svg viewBox="0 0 {n(L + 2)} {h}" role="img" aria-label="Crédits : {fr(dep)} dépensés, {fr(prevu)} prévus, {vise} visés, {plafond} au plus" '
         'xmlns="http://www.w3.org/2000/svg" class="jauge">',
         f'<rect x="1" y="22" width="{n(L)}" height="16" class="j-fond"/>',
         f'<rect x="1" y="22" width="{n(prevu * ech)}" height="16" class="j-prevu"/>',
         f'<rect x="1" y="22" width="{n(dep * ech)}" height="16" class="j-dep"/>']
    for val, nom, ancre in ((prevu, f"{fr(round(prevu))} prévus", "middle"), (vise, f"{vise} visés", "middle"), (plafond, f"plafond {plafond}", "end")):
        xi = 1 + val * ech
        s.append(f'<path d="M{n(xi)} 16V44" class="j-trait"/><text x="{n(xi)}" y="{12 if val != vise else 58}" text-anchor="{ancre}" class="j-txt">{e(nom)}</text>')
    s.append(f'<text x="1" y="58" class="j-txt">{fr(dep)} dépensés</text></svg>')
    return "".join(s)


# ----------------------------------------------------------------------------------------------
# Planche des caractères du roulement
# ----------------------------------------------------------------------------------------------
def planche_caracteres(sortie):
    import typekit as T
    from PIL import Image, ImageDraw, ImageFont
    manifeste = {f["id"]: f for f in json.loads((RACINE / "assets/fonts/fonts.json").read_text(encoding="utf-8"))["faces"]}
    mono = ImageFont.truetype(str(RACINE / "assets/fonts" / manifeste[C.CARACTERE_ANNOTATIONS[0]]["file"]), 22)
    col, marge, haut_cellule = 540, 44, 196
    img = Image.new("RGB", (1080, haut_cellule * 4 + 150), "#0A0A09")
    d = ImageDraw.Draw(img)
    for i, (ident, nom, role) in enumerate(C.CARACTERES):
        axes = manifeste[ident].get("showcase_axes") or {}
        g = T.fit_width(T.outlines("OFFGRIDZ", ident, **axes), col - 2 * marge)
        h = T.bounds(g)[3] - min(T.bounds(g)[1], 0)
        tuile = T.raster(g, col, 120, "#EEDFD2", "#0A0A09", scale=1.0, origin=(marge, 14 + min(T.bounds(g)[3], 100)))
        x, y = (i % 2) * col, (i // 2) * haut_cellule
        img.paste(tuile, (x, y + 16))
        d.text((x + marge, y + 142), f"{i + 1}. {nom}", font=mono, fill="#EEDFD2")
        d.text((x + marge, y + 168), role, font=ImageFont.truetype(mono.path, 17), fill="#8A7E74")
    y = haut_cellule * 4 + 24
    d.line((marge, y - 12, 1080 - marge, y - 12), fill="#4C352D", width=1)
    d.text((marge, y + 4), "ÉPREUVE N° 01 — REPÉRAGE : PERDU — ÉTAT : GRANULAIRE", font=mono, fill="#EEDFD2")
    d.text((marge, y + 38), "N = 6 400 000 GRAINS — FOND PERDU — BON À TIRER — 00:17,60", font=mono, fill="#EEDFD2")
    d.text((marge, y + 78), f"{C.CARACTERE_ANNOTATIONS[1]} · {C.CARACTERE_ANNOTATIONS[2]}", font=ImageFont.truetype(mono.path, 17), fill="#8A7E74")
    sortie.parent.mkdir(parents=True, exist_ok=True)
    img.save(sortie, optimize=True)


# ----------------------------------------------------------------------------------------------
# Page HTML
# ----------------------------------------------------------------------------------------------
CSS = """
/* Mise en page : une épreuve d'imprimeur. Colonne de lecture, étiquettes en caractères à chasse fixe,
   traits de coupe aux angles des blocs qui comptent. Les planches montrent le film dans ses propres couleurs. */
:root{
  --papier:#F3EBE2; --encre:#14110F; --doux:#5E544B; --filet:#D3C6B8; --plage:#E9DED2;
  --accent:#B7350A; --accent-fort:#EA470F; --sur-accent:#14110F; --ok:#2F6B3A; --ko:#8C2B1E;
  --film-noir:#0A0A09; --film-noir-2:#000000; --film-creme:#EEDFD2; --film-orange:#EA470F; --film-orange-2:#F65726;
  --film-gris:#6E625A; --film-gris-2:#8A7E74; --film-vert:#5C9A45; --film-ambre:#D09A3A;
  --titre:"Archivo","Arial Black","Helvetica Neue",Arial,sans-serif;
  --texte:"IBM Plex Sans","Segoe UI",system-ui,-apple-system,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){ --papier:#0E0D0C; --encre:#EEDFD2; --doux:#A99C90; --filet:#322C27; --plage:#191715;
    --accent:#F65726; --accent-fort:#EA470F; --sur-accent:#14110F; --ok:#86C290; --ko:#F08A78; color-scheme:dark }
}
:root[data-theme="dark"]{ --papier:#0E0D0C; --encre:#EEDFD2; --doux:#A99C90; --filet:#322C27; --plage:#191715;
  --accent:#F65726; --accent-fort:#EA470F; --sur-accent:#14110F; --ok:#86C290; --ko:#F08A78; color-scheme:dark }

body{ background:var(--papier); color:var(--encre); font-family:var(--texte); font-size:16px; line-height:1.55 }
.page{ max-width:900px; margin:0 auto; padding-block:36px 88px;
  padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px));
  display:flex; flex-direction:column; gap:60px }
section, header{ display:flex; flex-direction:column; gap:18px; min-width:0 }
p, li, dd{ max-width:68ch }
.et{ font-family:var(--mono); font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--doux) }
h1{ font-family:var(--titre); font-weight:900; font-stretch:125%; font-size:clamp(40px, 11vw, 92px); line-height:.92;
  letter-spacing:-.01em; text-transform:uppercase; margin:0; overflow-wrap:anywhere }
h2{ font-family:var(--titre); font-weight:800; font-stretch:112%; font-size:clamp(22px, 4.6vw, 30px); line-height:1.1;
  margin:0; text-wrap:balance }
h3{ font-family:var(--titre); font-weight:800; font-stretch:112%; font-size:20px; line-height:1.15; margin:0 }
p{ margin:0 }
.chapo{ font-size:19px; line-height:1.45 }
.faits{ display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:0; border-top:1px solid var(--filet) }
.faits div{ padding:12px 14px 12px 0; border-bottom:1px solid var(--filet); min-width:0 }
.faits dt{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--doux) }
.faits dd{ margin:2px 0 0; font-weight:600; font-variant-numeric:tabular-nums }
dl{ margin:0 }

/* le bloc à valider : seul bloc encadré de la page, avec ses traits de coupe */
.valider{ position:relative; padding:22px 20px; background:var(--plage); gap:14px }
.valider::before, .valider::after{ content:""; position:absolute; width:14px; height:14px; border:1px solid var(--accent) }
.valider::before{ top:-7px; left:-7px; border-right:0; border-bottom:0 }
.valider::after{ bottom:-7px; right:-7px; border-left:0; border-top:0 }
.valider ol{ margin:0; padding-left:1.3em; display:flex; flex-direction:column; gap:10px }
.valider li strong{ display:block }

.defile{ overflow-x:auto; max-width:100%; -webkit-overflow-scrolling:touch }
table{ border-collapse:collapse; width:100%; font-size:15px; font-variant-numeric:tabular-nums }
th{ font-family:var(--mono); font-size:11px; font-weight:500; letter-spacing:.08em; text-transform:uppercase; color:var(--doux);
  text-align:left; padding:8px 14px 8px 0; border-bottom:1px solid var(--encre); white-space:nowrap }
td{ padding:9px 14px 9px 0; border-bottom:1px solid var(--filet); vertical-align:top }
td.num, th.num{ text-align:right; white-space:nowrap }
td:last-child, th:last-child{ padding-right:0 }
tr.total td{ font-weight:600; border-bottom:1px solid var(--encre) }
.fait{ color:var(--ok); font-weight:600 }
ul.net{ margin:0; padding-left:1.15em; display:flex; flex-direction:column; gap:6px }
.jauge{ width:100%; height:auto; display:block }
.j-fond{ fill:var(--plage); stroke:var(--filet) } .j-prevu{ fill:var(--accent-fort); opacity:.38 } .j-dep{ fill:var(--accent-fort) }
.j-trait{ stroke:var(--encre); stroke-width:1; fill:none } .j-txt{ font-family:var(--mono); font-size:10.5px; fill:var(--doux) }

/* storyboard */
.seq{ display:flex; flex-direction:column; gap:14px; padding-top:18px; border-top:1px solid var(--encre) }
.seq .et b{ color:var(--accent); font-weight:600 }
.planches{ display:flex; flex-wrap:wrap; gap:14px }
.planches figure{ margin:0; width:132px; display:flex; flex-direction:column; gap:6px }
.planches svg{ width:132px; height:auto; display:block; border-radius:2px }
.planches figcaption{ font-family:var(--mono); font-size:10.5px; line-height:1.35; color:var(--doux) }
.fiche{ display:grid; grid-template-columns:132px minmax(0, 1fr); column-gap:14px; row-gap:8px }
.fiche dt{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--doux); padding-top:3px }
.fiche dd{ margin:0; min-width:0 }
@media (max-width:560px){ .fiche{ grid-template-columns:1fr; row-gap:2px } .fiche dd{ margin-bottom:8px }
  .planches{ gap:10px } .planches figure{ width:calc((100% - 20px) / 3); min-width:92px } .planches svg{ width:100% } }

/* couleurs du film, identiques dans les deux thèmes : ce sont des images du film */
.fn{ fill:var(--film-noir) } .fn2{ fill:var(--film-noir-2) } .fc{ fill:var(--film-creme) } .fc2{ fill:var(--film-creme) }
.fo{ fill:var(--film-orange) } .fo2{ fill:var(--film-orange-2) } .fg{ fill:var(--film-gris) } .fg2{ fill:var(--film-gris-2) }
.am{ fill:var(--film-ambre) } .mt{ fill:var(--film-vert) } .bu{ fill:none; stroke:var(--film-creme); stroke-width:.25 }
.sol{ fill:var(--film-creme); opacity:.16 } .lq{ fill:var(--film-creme); opacity:.14 }
.tc{ stroke:var(--film-creme); stroke-width:.35; fill:none; opacity:.8 } .an{ fill:var(--film-creme); opacity:.45 }
.rt{ stroke:var(--film-creme); stroke-width:.5; fill:none } .rt2{ stroke:var(--film-creme); stroke-width:.35; fill:none; opacity:.4 }
.rt3{ stroke:var(--film-creme); stroke-width:.5; fill:none; stroke-dasharray:2 1.6 } .rt-ok{ stroke:var(--film-orange-2); stroke-width:.8; fill:none }
.bd{ fill:var(--film-noir-2); stroke:var(--film-gris-2); stroke-width:.35 } .lt{ fill:none; stroke:var(--film-creme); stroke-width:22 }
.vr{ fill:none; stroke:var(--film-creme); stroke-width:.7; stroke-linejoin:round } .gl{ fill:var(--film-creme); fill-opacity:.12; stroke:var(--film-creme); stroke-width:.45 }
.jet{ fill:none; stroke:var(--film-creme); stroke-width:1.6; stroke-linecap:round; opacity:.8 }
.pl{ stroke:var(--film-noir-2); stroke-width:2.2; stroke-linecap:round; fill:none } .pl2{ stroke:var(--film-gris-2); stroke-width:3; stroke-linecap:round; fill:none }
.ax{ stroke:var(--film-creme); stroke-width:.3; fill:none; opacity:.55; stroke-dasharray:1 2 }
.ref{ fill:var(--film-orange-2) } .rc{ fill:var(--film-creme) } .rc2{ fill:var(--film-gris-2) }
.mot, .mot-a, .sg{ font-family:var(--titre); font-weight:900; font-stretch:125%; fill:var(--film-creme) }
.mot-a{ font-stretch:62% } .mot-s{ font-family:Georgia,"Times New Roman",serif; font-style:italic; font-weight:700; fill:var(--film-creme) }
.mot-m, .mt-an{ font-family:var(--mono); font-weight:600; fill:var(--film-creme) } .sg{ font-weight:800; font-stretch:112% }

/* partition */
.partition{ display:block; max-width:none }
.g-tps{ stroke:var(--filet); stroke-width:1; fill:none; opacity:.55 } .g-mes{ stroke:var(--doux); stroke-width:1; fill:none; opacity:.7 }
.t-mes, .t-sec, .t-piste{ font-family:var(--mono); font-size:11px; fill:var(--doux) } .t-piste{ fill:var(--encre); font-weight:500 }
.b rect{ fill:var(--plage); stroke:var(--filet); stroke-width:1 } .b text{ font-family:var(--mono); font-size:10px; fill:var(--encre) }
.b-sequence rect{ fill:var(--encre); stroke:var(--encre) } .b-sequence text{ fill:var(--papier); font-weight:600 }
.b-matiere rect{ fill:var(--accent-fort); stroke:var(--accent-fort) } .b-matiere text{ fill:var(--sur-accent); font-weight:600 }
.pt path, .pt-ok path, .pt-ko path{ fill:var(--encre) } .pt-fil{ stroke:var(--doux); stroke-width:1; fill:none !important; opacity:.6 }
.pt text, .pt-ok text, .pt-ko text{ font-family:var(--mono); font-size:10px; fill:var(--encre) }
.pt-ok path{ fill:var(--accent-fort) } .pt-ok text{ fill:var(--accent); font-weight:600 } .pt-ko text{ fill:var(--ko) }
.legende{ font-family:var(--mono); font-size:11.5px; color:var(--doux) }

.nuancier{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px }
.nuancier div{ display:flex; flex-direction:column; gap:4px; min-width:0 }
.nuancier i{ display:block; height:44px; border:1px solid var(--filet) }
.nuancier b{ font-weight:600 } .nuancier span{ font-family:var(--mono); font-size:11.5px; color:var(--doux) }
img.planche-typo{ width:100%; height:auto; display:block; border:1px solid var(--filet) }
.groupe{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent) }
.deux{ display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:24px 32px }
.deux > div{ display:flex; flex-direction:column; gap:10px; min-width:0 }
footer{ font-family:var(--mono); font-size:11.5px; color:var(--doux); border-top:1px solid var(--filet); padding-top:14px }
"""


def table(entetes, lignes, num=(), classes=None):
    th = "".join(f'<th{" class=num" if i in num else ""}>{e(h)}</th>' for i, h in enumerate(entetes))
    corps = []
    for k, l in enumerate(lignes):
        cls = f' class="{classes[k]}"' if classes and classes[k] else ""
        corps.append(f"<tr{cls}>" + "".join(f'<td{" class=num" if i in num else ""}>{c}</td>' for i, c in enumerate(l)) + "</tr>")
    return f'<div class="defile"><table><thead><tr>{th}</tr></thead><tbody>{"".join(corps)}</tbody></table></div>'


def page():
    prevu = sum(p[2] for p in C.PALIERS)
    minutes = sum(r[4] for r in C.RENDU)
    o = ['<meta name="claude:viewport-fit-sides" content="cover">', "<title>Dossier INSOUMISE</title>",
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900'
         '&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">',
         f"<style>{CSS}</style>", '<div class="page">']

    o.append('<header><p class="et">OFFGRIDZ · Épreuve n° 01 · Dossier de préproduction</p><h1>Insoumise</h1>'
             f'<p class="chapo">{e(C.RESUME)}</p>'
             '<dl class="faits">'
             '<div><dt>Format</dt><dd>1080 × 1920, 30 images/s</dd></div>'
             '<div><dt>Durée</dt><dd>20,000 s, 600 images</dd></div>'
             '<div><dt>Grille</dt><dd>150 BPM, levée + 12 mesures</dd></div>'
             f'<div><dt>Crédits</dt><dd>{fr(C.CREDITS["depenses"])} dépensés sur {C.CREDITS["vise"]} visés</dd></div>'
             "</dl></header>")

    o.append('<section class="valider"><p class="et">À valider par vous</p><ol>'
             + "".join(f"<li><strong>{e(t)}</strong>{e(d)}</li>" for t, d in C.A_VALIDER) + "</ol></section>")

    o.append('<section><p class="et">Mesuré le 13 novembre</p><h2>Le test GPU confirme le plan, et le rend moins cher</h2>'
             "<p>Une image du verre sort en moins de cinq secondes sur la machine louée, contre onze minutes sur la nôtre. "
             "Le rendu final tient donc en une heure et demie environ.</p>"
             + table(["Mesure", "Résultat"], [(e(a), e(b)) for a, b in C.TEST_GPU])
             + '<ul class="net">' + "".join(f"<li>{e(t)}</li>" for t in C.TEST_GPU_LIMITES) + "</ul></section>")

    lignes = [(e(a), e(b), fr(c), f'<span class="fait">{e(d)}</span>' if d == "fait" else e(d)) for a, b, c, d in C.PALIERS]
    lignes.append(("", "Total prévu", fr(round(prevu, 2)), f"marge restante jusqu'au plafond : {fr(round(C.CREDITS['plafond'] - prevu))}"))
    o.append('<section><p class="et">Budget</p><h2>185 crédits prévus, par paliers que vous validez un à un</h2>'
             + jauge_svg()
             + table(["Palier", "Objet", "Crédits", "Durée ou état"], lignes, num=(2,), classes=[None] * len(C.PALIERS) + ["total"])
             + "<p>Le rendu final est estimé séquence par séquence, à partir des temps mesurés :</p>"
             + table(["Séquence", "Images", "Réglage", "Secondes par image", "Minutes"],
                     [(e(a), b, e(c), fr(d) if d else "—", fr(m, 1) if m else "—") for a, b, c, d, m in C.RENDU]
                     + [("Total", sum(r[1] for r in C.RENDU), "plus 5 minutes d'installation et de transferts", "", fr(minutes, 1))],
                     num=(1, 3, 4), classes=[None] * len(C.RENDU) + ["total"])
             + "</section>")

    o.append('<section><p class="et">A · Storyboard chronométré</p><h2>Sept séquences, un seul plan</h2>'
             "<p>Les planches sont des schémas de composition à l'échelle de la feuille, pas des images du film. "
             "Les numéros d'image sont ceux de la partition.</p>")
    for q in C.SEQUENCES:
        fig = "".join(f"<figure>{planche(k)}<figcaption>{e(lg)}</figcaption></figure>" for k, lg in q["planches"])
        fiche = "".join(f"<dt>{e(k)}</dt><dd>{e(v)}</dd>" for k, v in q["champs"])
        o.append(f'<article class="seq"><p class="et"><b>Séquence {q["id"]}</b> · {e(q["temps"])} · images {e(q["images"])} · '
                 f'{e(q["mesures"])} · {e(q["rendu"])}</p><h3>{e(q["titre"])}</h3>'
                 f'<div class="planches">{fig}</div><dl class="fiche">{fiche}</dl></article>')
    o.append("</section>")

    o.append('<section><p class="et">C · Partition image et son</p><h2>Tout est posé sur la même grille</h2>'
             "<p>À 150 BPM et 30 images par seconde, un temps vaut 12 images et une double-croche 3 images : "
             "chaque événement tombe sur une image entière. Faites défiler la partition horizontalement.</p>"
             f'<div class="defile">{partition_svg()}</div>'
             '<p class="legende">Losange orange : verrouillage tenu ou réussi. Traits forts : débuts de mesure (M1 à M12).</p>'
             "<p>Les points de synchronisation qui seront contrôlés à l'image près :</p>"
             + table(["Image", "Temps", "À l'image", "Au son"], [(a, e(b), e(c), e(d)) for a, b, c, d in C.SYNCHRO], num=(0,))
             + "</section>")

    arch = []
    for groupe, lignes_g in C.ARCHITECTURE:
        arch.append(f'<p class="groupe">{e(groupe)}</p>' + table(["Élément", "Fabrication"], [(e(a), e(b)) for a, b in lignes_g]))
    o.append('<section><p class="et">B · Architecture de production</p><h2>Qui fabrique quoi</h2>'
             "<p>Chaque élément est rangé par mode de fabrication, pour que rien de généré ne passe pour du calculé.</p>"
             + "".join(arch) + "</section>")

    nuancier = "".join(f'<div><i style="background:{h}"></i><b>{e(nom)}</b><span>{h} · {e(u)}</span></div>' for nom, h, u in C.PALETTE)
    o.append('<section><p class="et">D · Références de production</p><h2>Palette, caractères, lumière</h2>'
             f'<div class="nuancier">{nuancier}</div>'
             '<img class="planche-typo" src="img/roulement.png" width="1080" height="934" '
             'alt="Les huit caractères du roulement typographique composant le mot OFFGRIDZ, et le caractère des annotations de marge">'
             '<div class="deux"><div><p class="groupe">Règles de composition</p><ul class="net">'
             + "".join(f"<li>{e(r)}</li>" for r in C.REGLES) + "</ul></div>"
             '<div><p class="groupe">Lumière et matière</p><dl class="fiche" style="grid-template-columns:1fr">'
             + "".join(f"<dt>{e(a)}</dt><dd>{e(b)}</dd>" for a, b in C.LUMIERE) + "</dl></div></div>"
             '<p class="groupe">Références techniques</p><ul class="net">' + "".join(f"<li>{e(r)}</li>" for r in C.REFERENCES) + "</ul></section>")

    o.append('<section><p class="et">E · Plan de fabrication</p><h2>Du gratuit d\'abord, du payant ensuite</h2>'
             "<p>Tout ce qui peut être fabriqué et jugé sans crédit l'est avant la première session GPU.</p>"
             + table(["Étape", "Travail", "Crédits"], [(e(a), e(b), e(c)) for a, b, c in C.PLAN], num=(2,))
             + '<div class="deux"><div><p class="groupe">Contrôles prévus</p><ul class="net">'
             + "".join(f"<li>{e(v)}</li>" for v in C.VALIDATIONS) + "</ul></div>"
             '<div><p class="groupe">Ce qui reste à prouver</p><ul class="net">'
             + "".join(f"<li>{e(v)}</li>" for v in C.RESTE_A_PROUVER) + "</ul></div></div></section>")

    o.append('<section><p class="et">F · Stratégie Katana</p><h2>Katana reste en dehors du film</h2><dl class="fiche">'
             + "".join(f"<dt>{e(a)}</dt><dd>{e(b)}</dd>" for a, b in C.KATANA) + "</dl></section>")

    o.append('<section><p class="et">Textes à l\'image</p><h2>Quatre mots de signature, aucune voix</h2><dl class="fiche">'
             + "".join(f"<dt>{e(a)}</dt><dd>{e(b)}</dd>" for a, b in C.TEXTES) + "</dl></section>")

    o.append("<footer>OFFGRIDZ · INSOUMISE · dossier fabriqué à partir de timeline/partition.json et de build/dossier/contenu.py</footer></div>")
    return "\n".join(o)


# ----------------------------------------------------------------------------------------------
# Version texte
# ----------------------------------------------------------------------------------------------
def md_table(entetes, lignes):
    s = ["| " + " | ".join(entetes) + " |", "|" + "|".join("---" for _ in entetes) + "|"]
    s += ["| " + " | ".join(str(c) for c in l) + " |" for l in lignes]
    return "\n".join(s)


def markdown():
    prevu = sum(p[2] for p in C.PALIERS)
    m = ["# OFFGRIDZ — « INSOUMISE » — Dossier de préproduction (phase 3)", "",
         C.RESUME, "",
         "Version illustrée (planches, partition graphique) : `preprod/dossier.html`. "
         "Les temps font foi dans `timeline/partition.json`.", "",
         "## À valider", ""]
    m += [f"{i}. **{t}** — {d}" for i, (t, d) in enumerate(C.A_VALIDER, 1)]
    m += ["", "## Test GPU (13 novembre)", "", md_table(["Mesure", "Résultat"], C.TEST_GPU), ""]
    m += [f"- {t}" for t in C.TEST_GPU_LIMITES]
    m += ["", "## Budget par paliers", "",
          md_table(["Palier", "Objet", "Crédits", "Durée ou état"], [(a, b, fr(c), d) for a, b, c, d in C.PALIERS]
                   + [("", "**Total prévu**", f"**{fr(round(prevu, 2))}**", f"cible {C.CREDITS['vise']}, plafond {C.CREDITS['plafond']}")]), "",
          "Estimation du rendu final :", "",
          md_table(["Séquence", "Images", "Réglage", "Secondes par image", "Minutes"],
                   [(a, b, c, fr(d) if d else "—", fr(x, 1) if x else "—") for a, b, c, d, x in C.RENDU]), "",
          "## A. Storyboard chronométré", ""]
    for q in C.SEQUENCES:
        m += [f"### Séquence {q['id']} — {q['titre']}", "",
              f"{q['temps']} · images {q['images']} · {q['mesures']} · {q['rendu']}", ""]
        m += [f"- **{k} :** {v}" for k, v in q["champs"]]
        m.append("")
    m += ["## B. Architecture de production", ""]
    for groupe, lignes in C.ARCHITECTURE:
        m += [f"**{groupe}**", "", md_table(["Élément", "Fabrication"], lignes), ""]
    m += ["## C. Partition image et son", "",
          "150 BPM, 30 images par seconde : un temps vaut 12 images, une double-croche 3 images. "
          "Deux temps de levée, puis 12 mesures ; la mesure n commence à l'image 24 + 48 × (n − 1).", "",
          md_table(["Image", "Temps", "À l'image", "Au son"], C.SYNCHRO), "",
          "## D. Références de production", "",
          md_table(["Couleur", "Hex", "Usage"], C.PALETTE), "",
          "Caractères du roulement : " + ", ".join(nom for _, nom, _ in C.CARACTERES) + ". "
          f"Annotations : {C.CARACTERE_ANNOTATIONS[1]}. Planche : `preprod/img/roulement.png`.", "",
          "Règles de composition :", ""]
    m += [f"- {r}" for r in C.REGLES]
    m += ["", "Lumière et matière :", ""] + [f"- **{a} :** {b}" for a, b in C.LUMIERE]
    m += ["", "Références techniques :", ""] + [f"- {r}" for r in C.REFERENCES]
    m += ["", "## E. Plan de fabrication", "", md_table(["Étape", "Travail", "Crédits"], C.PLAN), "", "Contrôles prévus :", ""]
    m += [f"- {v}" for v in C.VALIDATIONS]
    m += ["", "Ce qui reste à prouver :", ""] + [f"- {v}" for v in C.RESTE_A_PROUVER]
    m += ["", "## F. Stratégie Katana", ""] + [f"- **{a} :** {b}" for a, b in C.KATANA]
    m += ["", "## Textes à l'image", ""] + [f"- **{a} :** {b}" for a, b in C.TEXTES]
    return "\n".join(m) + "\n"


if __name__ == "__main__":
    planche_caracteres(RACINE / "preprod" / "img" / "roulement.png")
    (RACINE / "preprod" / "dossier.html").write_text(page(), encoding="utf-8")
    (RACINE / "DOSSIER_PREPRODUCTION.md").write_text(markdown(), encoding="utf-8")
    print("preprod/dossier.html", (RACINE / "preprod" / "dossier.html").stat().st_size, "octets")
    print("DOSSIER_PREPRODUCTION.md", (RACINE / "DOSSIER_PREPRODUCTION.md").stat().st_size, "octets")
