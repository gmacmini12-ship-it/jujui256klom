"""Feuille d'épreuve : fond noir, traits de coupe à couverture exacte, annotations de marge (IBM Plex Mono).
Textes et comportements : BIBLE.md §6 et animatique (sheet.py : état de matière, fondu de signature)."""
import numpy as np

import fx_common as X
import fx_draw as D
import sheet as ASH                       # animatique : etat(f), fade_signature(f)
from common import find, seq_range

SZ = 20
# lignes de base (px feuille)
Y_TOP = 160
Y_BOT1, Y_BOT2, Y_STUDIO = 1776, 1808, 1860
CIBLE_COL = 22                            # colonne (chasse de 12 px) où commence « CIBLE : … »
MARK_OFF, MARK_LEN = 6, 14                # trait de coupe : écart à la fenêtre, longueur

TXT_MIN_MARGIN = 24.0


def base_sheet():
    S = np.empty((X.H, X.W, 3), np.float32)
    S[:] = D.rgb16(X.BLACK)
    return S


def crop_marks(S):
    """Huit traits de coupe de 1 px, posés sur la grille juste hors de la fenêtre (colonnes 35 et 1044,
    lignes 203 et 1716), écart de 6 px au coin, 14 px de long."""
    o, n = MARK_OFF, MARK_LEN
    xl, xr = X.WX0 - 1, X.WX1               # pixel juste à gauche / à droite de la fenêtre
    yt, yb = X.WY0 - 1, X.WY1               # pixel juste au-dessus / au-dessous
    for (px, side_x) in ((xl, -1), (xr, 1)):
        for (py, side_y) in ((yt, -1), (yb, 1)):
            # trait horizontal dans la marge latérale, aligné sur le bord haut/bas de la fenêtre
            if side_x < 0:
                x0, x1 = X.WX0 - o - n, X.WX0 - o
            else:
                x0, x1 = X.WX1 + o, X.WX1 + o + n
            D.paint_rect(S, x0, py, x1, py + 1, X.CREAM)
            # trait vertical dans la marge haute/basse, aligné sur le bord gauche/droit
            if side_y < 0:
                y0, y1 = X.WY0 - o - n, X.WY0 - o
            else:
                y0, y1 = X.WY1 + o, X.WY1 + o + n
            D.paint_rect(S, px, y0, px + 1, y1, X.CREAM)


def fmt_n(n):
    """Entier avec espace fine insécable (U+202F) comme séparateur de milliers."""
    return f"{int(n):,}".replace(",", " ")


def annotations(S, f, rs, counter=None):
    """Annotations de marge ; renvoie la marge minimale (px) entre l'encre et le bord de la feuille."""
    boxes = []

    def t(*a, **k):
        boxes.append(D.draw_text(S, *a, **k))

    t("OFFGRIDZ — ÉPREUVE N° 01", X.WX0, Y_TOP, SZ)
    ok = rs["held"]
    t("REPÉRAGE : " + ("OK" if ok else "PERDU"), X.WX0, Y_BOT1, SZ)
    if rs["target"] and rs["phase"].split(":")[0] in ("snap", "hold", "shake"):
        cell = 0.6 * SZ + 0.06 * SZ
        t("CIBLE : " + rs["target"], X.WX0 + CIBLE_COL * cell, Y_BOT1, SZ)
    t("ÉTAT : " + ASH.etat(f), X.WX0, Y_BOT2, SZ)
    if counter is not None:
        t("N = " + fmt_n(counter), X.WX1, Y_BOT2, SZ, align="r")
    s5 = seq_range(5)
    if s5[0] <= f <= s5[0] + 14 and ((f - s5[0]) // 2) % 2 == 0:
        t("FOND PERDU", X.W / 2, Y_TOP, 26, X.ORANGE_HI, 1.0, "c", 700)
    sig = find("reticule", "verrouillage final")["image"]
    if f >= sig:
        a = ASH.fade_signature(f)
        if a > 0:
            t("BON À TIRER", X.WX1, Y_BOT1, SZ, X.CREAM, a, "r")
            t("STUDIO CRÉATIF · IDENTITÉ · MOTION · 3D · PUBLICITÉ", X.WX0, Y_STUDIO, SZ, X.CREAM, a)
    m = min((min(b[0], b[1], X.W - b[2], X.H - b[3]) for b in boxes), default=999.0)
    return float(m)


def maquette_tag(S):
    """Pastille « MAQUETTE » en marge haute, à droite : images dont une partie vient de l'animatique."""
    SZm = 15
    wtxt = D.text_width("MAQUETTE", SZm, 400, 0.14)
    pad = 7
    x1 = X.WX1
    x0 = x1 - wtxt - 2 * pad
    ytop, ybot = Y_TOP - 16 - 5, Y_TOP + 5
    D.draw_text(S, "MAQUETTE", x1 - pad, Y_TOP - 2, SZm, X.CREAM, 0.85, "r", 400, 0.14)
    for (a, b, c, d) in ((x0, ytop, x1, ytop + 1), (x0, ybot - 1, x1, ybot), (x0, ytop, x0 + 1, ybot), (x1 - 1, ytop, x1, ybot)):
        D.paint_rect(S, a, b, c, d, X.CREAM, 0.6)
    return min(x0, ytop)


def burn_in_text(f):
    m, b = X.AC.beat_pos(f)
    sec = f / X.FPS
    return f"F{f:03d} · {sec:05.2f} s · {m:02d}.{b}".replace(".", ",", 1)
