#!/opt/og/venv/bin/python
"""typekit : texte -> contours (Bézier cubiques) pour le roulement typographique OFFGRIDZ.

Bibliothèque importable et CLI.  Convention de coordonnées de sortie : y vers le haut,
ligne de base y = 0, hauteur de capitale (H) = `size`, origine x = 0 au départ de la
première chasse (avant fit_width). `tracking` est exprimé dans la même unité que `size`
(fraction de la hauteur de capitale), ajouté après chaque glyphe sauf le dernier.

Structure d'un enregistrement de glyphe :
  {"char": "O", "glyph": "O", "x": <origine du glyphe>, "advance": <chasse>, "kern": <approche
   appliquée avant ce glyphe>, "missing": bool,
   "contours": [ {"bezier": [[p0,p1,p2,p3], ...], "line": [bool, ...]} , ...] }
Les segments droits sont stockés comme cubiques exactes (c1,c2 au tiers/deux-tiers) ; `line`
les signale. Les quadratiques TrueType sont converties exactement en cubiques (élévation de degré).
Les contours sont déjà positionnés (x incluse).
"""
import argparse, copy, json, math, os, sys
from functools import lru_cache
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "assets", "fonts"))

# ----------------------------------------------------------------------------- fonts
@lru_cache(maxsize=None)
def _manifest():
    with open(os.path.join(FONTS_DIR, "fonts.json"), encoding="utf-8") as f:
        return {e["id"]: e for e in json.load(f)["faces"]}

def faces():
    """Dictionnaire id -> entrée de fonts.json."""
    return _manifest()

@lru_cache(maxsize=64)
def _load(face_id, axes_key):
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    ent = _manifest()[face_id]
    font = TTFont(os.path.join(FONTS_DIR, ent["file"]))
    if "fvar" in font:
        have = {a.axisTag: a for a in font["fvar"].axes}
        want = dict(axes_key)
        for k in want:
            if k not in have:
                raise KeyError(f"{face_id}: axe inconnu {k!r} (axes: {list(have)})")
        loc = {}
        for tag, a in have.items():
            v = want.get(tag, a.defaultValue)
            loc[tag] = min(max(float(v), a.minValue), a.maxValue)   # bornage
        font = instancer.instantiateVariableFont(font, loc, inplace=False)
        font._og_axes = loc
    else:
        if axes_key:
            raise KeyError(f"{face_id}: police statique, pas d'axes")
        font._og_axes = {}
    font._og_id = face_id
    return font

def load(face_id, **axes):
    """Charge une face (fontTools TTFont). Les polices variables sont instanciées aux valeurs
    d'axes données (les axes omis prennent la valeur par défaut du fichier, bornés à [min,max])."""
    return _load(face_id, tuple(sorted(axes.items())))

# ----------------------------------------------------------------------------- kerning
def _value_xadv(v):
    return (getattr(v, "XAdvance", 0) or 0) if v is not None else 0

class _Kern:
    def __init__(self, font):
        self.cache = {}
        self.lookups = []
        self.legacy = None
        if "GPOS" in font:
            g = font["GPOS"].table
            idx = set()
            if g.FeatureList:
                for fr in g.FeatureList.FeatureRecord:
                    if fr.FeatureTag == "kern":
                        idx.update(fr.Feature.LookupListIndex)
            for i in sorted(idx):
                subs = []
                for st in g.LookupList.Lookup[i].SubTable:
                    st = getattr(st, "ExtSubTable", st)
                    if st.__class__.__name__ == "PairPos":
                        subs.append((st, set(st.Coverage.glyphs)))
                if subs:
                    self.lookups.append(subs)
        if not self.lookups and "kern" in font:
            tabs = [t.kernTable for t in font["kern"].kernTables if hasattr(t, "kernTable")]
            if tabs:
                self.legacy = tabs[0]

    def pair(self, a, b):
        k = (a, b)
        if k in self.cache: return self.cache[k]
        tot = 0
        for subs in self.lookups:
            for st, cov in subs:
                if a not in cov: continue
                if st.Format == 1:
                    ps = st.PairSet[st.Coverage.glyphs.index(a)]
                    hit = [r for r in ps.PairValueRecord if r.SecondGlyph == b]
                    if hit:
                        tot += _value_xadv(hit[0].Value1); break
                else:
                    c1 = st.ClassDef1.classDefs.get(a, 0) if st.ClassDef1 else 0
                    c2 = st.ClassDef2.classDefs.get(b, 0) if st.ClassDef2 else 0
                    rec = st.Class1Record[c1].Class2Record[c2]
                    tot += _value_xadv(rec.Value1); break
        if self.legacy is not None:
            tot += self.legacy.get((a, b), 0)
        self.cache[k] = tot
        return tot

def _kern_of(font):
    if not hasattr(font, "_og_kern"):
        font._og_kern = _Kern(font)
    return font._og_kern

# ----------------------------------------------------------------------------- outlines
def _cap_height(font):
    gs = font.getGlyphSet(); cmap = font.getBestCmap()
    from fontTools.pens.boundsPen import BoundsPen
    if ord("H") in cmap:
        bp = BoundsPen(gs); gs[cmap[ord("H")]].draw(bp)
        if bp.bounds: return bp.bounds[3]
    ch = getattr(font["OS/2"], "sCapHeight", 0)
    return ch or font["head"].unitsPerEm * 0.7

def _glyph_contours(font, gname):
    """Contours cubiques (en unités de police) d'un glyphe, composants aplatis."""
    from fontTools.pens.basePen import BasePen
    class P(BasePen):
        def __init__(s, gs):
            super().__init__(gs); s.cs = []; s.cur = None; s.pos = None
        def _moveTo(s, p): s.cur = {"bezier": [], "line": []}; s.pos = p
        def _lineTo(s, p):
            a = s.pos; c1 = (a[0] + (p[0]-a[0])/3, a[1] + (p[1]-a[1])/3)
            c2 = (a[0] + 2*(p[0]-a[0])/3, a[1] + 2*(p[1]-a[1])/3)
            s.cur["bezier"].append([a, c1, c2, p]); s.cur["line"].append(True); s.pos = p
        def _curveToOne(s, c1, c2, p):
            s.cur["bezier"].append([s.pos, c1, c2, p]); s.cur["line"].append(False); s.pos = p
        # _qCurveToOne : l'implémentation de BasePen élève exactement le degré (2/3 rule)
        def _closePath(s):
            c = s.cur
            if c["bezier"] and tuple(c["bezier"][0][0]) != tuple(c["bezier"][-1][3]):
                a, p = c["bezier"][-1][3], c["bezier"][0][0]
                c["bezier"].append([a, (a[0]+(p[0]-a[0])/3, a[1]+(p[1]-a[1])/3),
                                    (a[0]+2*(p[0]-a[0])/3, a[1]+2*(p[1]-a[1])/3), p]); c["line"].append(True)
            if c["bezier"]: s.cs.append(c)
            s.cur = None
        _endPath = _closePath
    gs = font.getGlyphSet(); p = P(gs); gs[gname].draw(p)
    return p.cs

def _tx(contours, sx, sy, dx, dy):
    out = []
    for c in contours:
        out.append({"bezier": [[[pt[0]*sx + dx, pt[1]*sy + dy] for pt in seg] for seg in c["bezier"]],
                    "line": list(c["line"])})
    return out

def outlines(text, face, size=1.0, tracking=0.0, kerning=True, **axes):
    """Texte -> liste d'enregistrements de glyphes (voir en-tête du module).
    `face` : identifiant (str, avec **axes éventuels) ou TTFont renvoyé par load()."""
    font = load(face, **axes) if isinstance(face, str) else face
    cmap = font.getBestCmap(); upm = font["head"].unitsPerEm
    hm = font["hmtx"]; kern = _kern_of(font)
    s = size / _cap_height(font)
    out = []; x = 0.0; prev = None
    for ch in text:
        missing = ord(ch) not in cmap
        gname = cmap.get(ord(ch), ".notdef")
        k = kern.pair(prev, gname) if (kerning and prev is not None) else 0
        x += k * s
        adv = hm[gname][0] * s
        cs = _tx(_glyph_contours(font, gname), s, s, x, 0.0)
        out.append({"char": ch, "glyph": gname, "x": x, "advance": adv, "kern": k * s,
                    "missing": missing, "contours": cs})
        x += adv + tracking
        prev = gname
    return out

# ----------------------------------------------------------------------------- géométrie
def _seg_bounds(seg):
    p = np.asarray(seg, float)
    xs, ys = [p[0, 0], p[3, 0]], [p[0, 1], p[3, 1]]
    for ax, acc in ((0, xs), (1, ys)):
        a, b, c, d = p[:, ax]
        # dérivée : 3[(b-a)(1-t)^2 + 2(c-b)(1-t)t + (d-c)t^2]
        A = -a + 3*b - 3*c + d; B = 2*(a - 2*b + c); C = b - a
        roots = []
        if abs(A) < 1e-12:
            if abs(B) > 1e-12: roots = [-C / B]
        else:
            D = B*B - 4*A*C
            if D >= 0:
                r = math.sqrt(D); roots = [(-B + r)/(2*A), (-B - r)/(2*A)]
        for t in roots:
            if 0 < t < 1:
                u = 1 - t
                acc.append(u**3*a + 3*u*u*t*b + 3*u*t*t*c + t**3*d)
    return min(xs), min(ys), max(xs), max(ys)

def bounds(glyphs):
    """Boîte d'encre exacte (xmin, ymin, xmax, ymax) (extrema des Bézier)."""
    bs = [_seg_bounds(s) for g in glyphs for c in g["contours"] for s in c["bezier"]]
    if not bs: return (0.0, 0.0, 0.0, 0.0)
    a = np.array(bs)
    return (a[:, 0].min(), a[:, 1].min(), a[:, 2].max(), a[:, 3].max())

def transform(glyphs, sx=1.0, sy=None, dx=0.0, dy=0.0):
    """Copie transformée (x' = sx*x+dx, y' = sy*y+dy)."""
    sy = sx if sy is None else sy
    out = []
    for g in glyphs:
        n = dict(g)
        n["contours"] = _tx(g["contours"], sx, sy, dx, dy)
        n["x"] = g["x"] * sx + dx; n["advance"] = g["advance"] * sx; n["kern"] = g.get("kern", 0) * sx
        out.append(n)
    return out

def fit_width(glyphs, width):
    """Copie mise à l'échelle uniformément pour que la largeur d'encre totale = width ;
    translatée pour que le bord gauche de l'encre soit à x = 0 (la ligne de base reste y = 0)."""
    x0, _, x1, _ = bounds(glyphs)
    if x1 - x0 <= 0: raise ValueError("pas d'encre")
    k = width / (x1 - x0)
    return transform(glyphs, k, k, -x0 * k, 0.0)

def _flatten_seg(seg, tol, is_line):
    p0, p1, p2, p3 = [np.asarray(q, float) for q in seg]
    if is_line: return [p3]
    pts = []
    def rec(a, b, c, d, depth):
        # planéité : distance max des points de contrôle à la corde
        ch = d - a; L = math.hypot(*ch)
        if L < 1e-12:
            dist = max(np.hypot(*(b - a)), np.hypot(*(c - a)))
        else:
            dist = max(abs(ch[0]*(b[1]-a[1]) - ch[1]*(b[0]-a[0])),
                       abs(ch[0]*(c[1]-a[1]) - ch[1]*(c[0]-a[0]))) / L
        if dist <= tol or depth >= 14:
            pts.append(d); return
        ab, bc, cd = (a+b)/2, (b+c)/2, (c+d)/2
        abc, bcd = (ab+bc)/2, (bc+cd)/2; m = (abc+bcd)/2
        rec(a, ab, abc, m, depth+1); rec(m, bcd, cd, d, depth+1)
    rec(p0, p1, p2, p3, 0)
    return pts

def _flatten_contour(c, tol):
    pts = [np.asarray(c["bezier"][0][0], float)]
    for seg, ln in zip(c["bezier"], c["line"]):
        pts.extend(_flatten_seg(seg, tol, ln))
    P = np.array(pts)
    if len(P) > 1 and np.allclose(P[0], P[-1]): P = P[:-1]
    return P

def _area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))   # >0 : antihoraire (y haut)

def polylines(glyphs, tolerance=0.001):
    """Polygones fermés aplatis (écart max à la courbe = tolerance, en unités de sortie).
    Sens de parcours conservé (celui de la police). Renvoie une liste de
    {"char", "glyph_index", "points": ndarray (N,2) sans point final dupliqué, "area" signée
     (y haut : >0 antihoraire), "hole": bool}. Un contour est un trou si son sens est opposé à
    celui du plus grand contour de son glyphe (règle nonzero, robuste aux contours qui se chevauchent)."""
    out = []
    for gi, g in enumerate(glyphs):
        polys = [_flatten_contour(c, tolerance) for c in g["contours"]]
        polys = [P for P in polys if len(P) >= 3]
        if not polys: continue
        areas = [_area(P) for P in polys]
        ref = math.copysign(1, areas[int(np.argmax(np.abs(areas)))])
        for P, a in zip(polys, areas):
            out.append({"char": g["char"], "glyph_index": gi, "points": P, "area": a,
                        "hole": (math.copysign(1, a) != ref) if a != 0 else False})
    return out

# ----------------------------------------------------------------------------- sorties
def _fmt(v): return f"{v:.4f}".rstrip("0").rstrip(".") if v else "0"

def to_svg(glyphs, path, fill="#EEDFD2", bg=None, pad=0.1, scale=1000):
    """SVG (y retourné ; Bézier cubiques C/L). `scale` = pixels par unité de sortie."""
    x0, y0, x1, y1 = bounds(glyphs)
    X0, X1, Y0, Y1 = x0 - pad, x1 + pad, y0 - pad, y1 + pad
    W, H = (X1 - X0) * scale, (Y1 - Y0) * scale
    def P(p): return f"{_fmt((p[0]-X0)*scale)} {_fmt((Y1-p[1])*scale)}"
    d = []
    for g in glyphs:
        for c in g["contours"]:
            d.append("M" + P(c["bezier"][0][0]))
            for seg, ln in zip(c["bezier"], c["line"]):
                d.append(("L" + P(seg[3])) if ln else ("C" + " ".join(P(q) for q in seg[1:])))
            d.append("Z")
    rect = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{_fmt(W)}" height="{_fmt(H)}" '
           f'viewBox="0 0 {_fmt(W)} {_fmt(H)}">{rect}<path fill="{fill}" fill-rule="nonzero" d="{" ".join(d)}"/></svg>')
    with open(path, "w", encoding="utf-8") as f: f.write(svg)
    return path

def to_json(glyphs, path, tolerance=0.0005, meta=None):
    """JSON : par contour, points de contrôle Bézier ET polyligne dense."""
    x0, y0, x1, y1 = bounds(glyphs)
    pl = polylines(glyphs, tolerance)
    byg = {}
    for p in pl: byg.setdefault(p["glyph_index"], []).append(p)
    gl = []
    for gi, g in enumerate(glyphs):
        cons = []
        flat = [_flatten_contour(c, tolerance) for c in g["contours"]]
        flat = [P for P in flat if len(P) >= 3]
        for c, pp in zip([c for c, P in zip(g["contours"], [_flatten_contour(c, tolerance) for c in g["contours"]]) if len(P) >= 3], byg.get(gi, [])):
            cons.append({"hole": pp["hole"], "signed_area": pp["area"],
                         "bezier": [[[round(v, 6) for v in q] for q in s] for s in c["bezier"]],
                         "line": c["line"],
                         "polyline": [[round(float(a), 6), round(float(b), 6)] for a, b in pp["points"]]})
        gl.append({"char": g["char"], "glyph": g["glyph"], "x": round(g["x"], 6), "advance": round(g["advance"], 6),
                   "kern": round(g.get("kern", 0), 6), "missing": g.get("missing", False), "contours": cons})
    doc = {"units": "cap height = size; y up; baseline y=0", "ink_bbox": [round(v, 6) for v in (x0, y0, x1, y1)],
           "polyline_tolerance": tolerance, "contour_closed": True, **(meta or {}), "glyphs": gl}
    with open(path, "w", encoding="utf-8") as f: json.dump(doc, f, ensure_ascii=False)
    return path

def _rgb(c, default=(0, 0, 0)):
    if c is None: return None
    if isinstance(c, str):
        c = c.lstrip("#"); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
    return tuple(c)

def coverage_array(glyphs, width_px, height_px, scale=None, origin=None, pad=0, ss=4):
    """Couverture antialiasée float32 [0..1] (h,w). Règle de remplissage nonzero exacte (les
    contours qui se chevauchent ou se recoupent sont traités comme un moteur de rendu de police) :
    ss sous-lignes de balayage par pixel, couverture horizontale exacte au sous-pixel."""
    x0, y0, x1, y1 = bounds(glyphs)
    if scale is None:
        scale = min((width_px - 2*pad) / (x1 - x0), (height_px - 2*pad) / (y1 - y0))
    if origin is None:
        origin = ((width_px - (x1 - x0)*scale) / 2 - x0*scale, (height_px + (y1 + y0)*scale) / 2)
    ox, oy = origin; W, H = width_px, height_px
    E = []
    for g in glyphs:
        for c in g["contours"]:
            P = _flatten_contour(c, 0.1 / scale)
            if len(P) < 3: continue
            Q = np.stack([P[:, 0]*scale + ox, oy - P[:, 1]*scale], 1)
            E.append(np.concatenate([Q, np.roll(Q, -1, 0)], 1))
    cov = np.zeros((H, W + 1), np.float64)
    if not E: return cov[:, :W].astype(np.float32)
    E = np.concatenate(E); xa, ya, xb, yb = E.T
    keep = ya != yb; xa, ya, xb, yb = xa[keep], ya[keep], xb[keep], yb[keep]
    d = np.where(yb > ya, 1, -1); ylo, yhi = np.minimum(ya, yb), np.maximum(ya, yb)
    # sous-lignes dont le centre (j+.5)/ss tombe dans [ylo, yhi)
    j0 = np.ceil(ylo*ss - 0.5).astype(np.int64); j1 = np.ceil(yhi*ss - 0.5).astype(np.int64)   # [j0, j1)
    j0 = np.clip(j0, 0, H*ss); j1 = np.clip(j1, 0, H*ss); cnt = np.maximum(j1 - j0, 0)
    n = int(cnt.sum())
    if n == 0: return cov[:, :W].astype(np.float32)
    ei = np.repeat(np.arange(len(cnt)), cnt)
    off = np.arange(n) - np.repeat(np.cumsum(cnt) - cnt, cnt)
    j = j0[ei] + off; ys = (j + 0.5) / ss
    t = (ys - ya[ei]) / (yb[ei] - ya[ei]); x = xa[ei] + t * (xb[ei] - xa[ei]); dd = d[ei]
    o = np.lexsort((x, j)); j, x, dd = j[o], x[o], dd[o]
    wind = np.cumsum(dd)                      # enroulement après chaque croisement
    same = np.zeros(n, bool); same[:-1] = j[:-1] == j[1:]
    sel = same & (wind != 0)
    k = np.nonzero(sel)[0]
    a = np.clip(x[k], 0, W); b = np.clip(x[k + 1], 0, W); r = j[k] // ss
    ca = np.floor(a).astype(np.int64); cb = np.floor(b).astype(np.int64)
    fa = a - ca; fb = b - cb; w = 1.0 / ss; N = H * (W + 1)
    acc = np.zeros(N)
    base = r * (W + 1)
    acc += np.bincount(base + cb, w * fb, N) - np.bincount(base + ca, w * fa, N)
    ones = np.full(len(k), w)
    dif = np.bincount(base + ca, ones, N + 1)[:N] - np.bincount(base + cb, ones, N + 1)[:N]
    acc = acc.reshape(H, W + 1) + np.cumsum(dif.reshape(H, W + 1), 1)
    return np.clip(acc[:, :W], 0, 1).astype(np.float32)

def raster(glyphs, width_px, height_px, fg="#EEDFD2", bg="#0A0A09", scale=None, origin=None, pad=0, ss=4):
    """Image Pillow antialiasée (suréchantillonnage ss=4). Par défaut l'encre est ajustée et
    centrée dans le cadre (pad px de marge) ; sinon scale (px/unité) et origin (x,y de la ligne
    de base à gauche, en px) imposent le placement. bg=None -> RGBA transparent."""
    from PIL import Image
    cov = coverage_array(glyphs, width_px, height_px, scale, origin, pad, ss)
    f = np.array(_rgb(fg), np.float32)
    if bg is None:
        a = np.concatenate([np.broadcast_to(f, cov.shape + (3,)), cov[..., None]*255], -1)
        return Image.fromarray(np.clip(a + .5, 0, 255).astype(np.uint8), "RGBA")
    b = np.array(_rgb(bg), np.float32)
    img = b + (f - b) * cov[..., None]
    return Image.fromarray(np.clip(img + .5, 0, 255).astype(np.uint8), "RGB")

# ----------------------------------------------------------------------------- autotest
def selftest(text="OFFGRIDZ", verbose=True):
    """Compare nos contours rastérisés au rendu texte de Pillow (même police, même taille)."""
    from PIL import Image, ImageDraw, ImageFont, features
    raqm = features.check("raqm")
    engine = ImageFont.Layout.RAQM if raqm else ImageFont.Layout.BASIC
    cases = [("playfair-display-900", {}, 300), ("anton", {}, 300),
             ("archivo-var", {"wdth": 125, "wght": 900}, 280), ("space-mono-700", {}, 260)]
    res = []
    for fid, ax, px in cases:
        ent = faces()[fid]; path = os.path.join(FONTS_DIR, ent["file"])
        fnt = ImageFont.truetype(path, px, layout_engine=engine)
        if ax:
            names = [a["tag"] for a in ent["axes"]]
            fnt.set_variation_by_axes([ax.get(a["tag"], a["default"]) for a in ent["axes"]])
        W, H, x0, y0 = 2400, int(px*1.6), 60, int(px*1.15)
        ref = Image.new("L", (W, H), 0)
        ImageDraw.Draw(ref).text((x0, y0), text, font=fnt, fill=255, anchor="ls")
        ref = np.asarray(ref, np.float32) / 255
        font = load(fid, **ax)
        capu = _cap_height(font); s_px = px / font["head"].unitsPerEm       # px par unité police
        g = outlines(text, font, size=1.0, kerning=True)
        mine = coverage_array(g, W, H, scale=capu * s_px, origin=(x0, y0))
        inter = np.minimum(ref, mine).sum(); union = np.maximum(ref, mine).sum()
        iou = float(inter / union)
        res.append((fid, ax, iou))
        if verbose: print(f"  {fid:24s} {str(ax or ''):32s} IoU = {iou:.4f}  (layout={'raqm' if raqm else 'basic'})")
    ok = all(r[2] > 0.97 for r in res)
    if verbose: print("SELFTEST", "OK" if ok else "ECHEC", f"(min IoU {min(r[2] for r in res):.4f})")
    return ok, res

# ----------------------------------------------------------------------------- CLI
def _parse_axes(s):
    d = {}
    for kv in (s or "").split(","):
        if kv.strip():
            k, v = kv.split("="); d[k.strip()] = float(v)
    return d

def main(argv=None):
    ap = argparse.ArgumentParser(description="typekit : texte -> contours")
    ap.add_argument("--selftest", action="store_true", help="IoU contre le rendu Pillow")
    ap.add_argument("--list", action="store_true", help="liste des faces")
    ap.add_argument("--text", default="OFFGRIDZ"); ap.add_argument("--face")
    ap.add_argument("--axes", default="", help="ex. wdth=125,wght=900")
    ap.add_argument("--size", type=float, default=1.0); ap.add_argument("--tracking", type=float, default=0.0)
    ap.add_argument("--fit", type=float, help="largeur d'encre cible")
    ap.add_argument("--svg"); ap.add_argument("--json"); ap.add_argument("--png", help="PNG W,H via --png-size")
    ap.add_argument("--png-size", default="1080,400")
    a = ap.parse_args(argv)
    if a.selftest:
        return 0 if selftest()[0] else 1
    if a.list:
        for k, e in faces().items(): print(f"{k:30s} {e['category']:12s} {e['licence']:10s} axes={[x['tag'] for x in e['axes']]}")
        return 0
    if not a.face: ap.error("--face requis")
    ax = _parse_axes(a.axes)
    g = outlines(a.text, a.face, a.size, a.tracking, **ax)
    if a.fit: g = fit_width(g, a.fit)
    if a.svg: to_svg(g, a.svg)
    if a.json: to_json(g, a.json, meta={"text": a.text, "face": a.face, "axes": ax})
    if a.png:
        w, h = map(int, a.png_size.split(",")); raster(g, w, h, pad=20).save(a.png)
    print("ink bbox", [round(v, 4) for v in bounds(g)])
    return 0

if __name__ == "__main__":
    sys.exit(main())
