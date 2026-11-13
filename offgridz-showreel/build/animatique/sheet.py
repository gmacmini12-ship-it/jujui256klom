"""Feuille d'épreuve : fond noir, traits de coupe, annotations de marge pilotées par la partition,
incrustation de relecture (burn-in)."""
import numpy as np

import reticle
from common import (BLACK, CREAM, ORANGE_HI, W, H, WX0, WY0, WX1, WY1, FPS, blocks, find, instants,
                    draw_text, line, beat_pos, smooth, mask_blend, blend_rect, in_block, seq_range)

BURN_IN = True       # une seule bascule : False (ou --no-burnin) supprime l'incrustation de relecture


def base_sheet():
    """Feuille noire + traits de coupe, juste à l'extérieur des quatre coins de la fenêtre."""
    F = np.empty((H, W, 3), np.uint8)
    F[:] = BLACK
    for x, sx in ((WX0, -1), (WX1, 1)):
        for y, sy in ((WY0, -1), (WY1, 1)):
            line(F, (x + sx * 8, y), (x + sx * 30, y), CREAM, 1)      # trait horizontal, dans la marge latérale
            line(F, (x, y + sy * 8), (x, y + sy * 30), CREAM, 1)      # trait vertical, dans la marge haute/basse
    return F


_MATIERE = {"solide": "SOLIDE", "grains": "GRANULAIRE", "sucre": "GRANULAIRE", "dissoute": "LIQUIDE",
            "points": "LUMIÈRE", "encre": "LIQUIDE", "bande imprimée": "SOLIDE"}


def etat(f):
    for e in blocks("matiere"):
        if e["debut"] <= f <= e["fin"]:
            for k, v in _MATIERE.items():
                if e["nom"].startswith(k):
                    return v
    return "SOLIDE"


def fade_signature(f):
    """Opacité des textes de signature (1 jusqu'au fondu `typo`, 0 après)."""
    fd = find("typo", "fondu", "b")
    if f < fd["debut"]:
        return 1.0
    if f > fd["fin"]:
        return 0.0
    return 1 - (f - fd["debut"] + 1) / float(fd["fin"] - fd["debut"] + 2)


def annotations(F, f, rstate, counter=None):
    """Annotations de marge (hors incrustation de relecture)."""
    draw_text(F, "OFFGRIDZ — ÉPREUVE N° 01", 36, 140, 20)
    ok = rstate["held"]
    l1 = "REPÉRAGE : " + ("OK" if ok else "PERDU")
    if rstate["target"] and rstate["phase"].split(":")[0] in ("snap", "hold", "shake"):
        l1 += "      CIBLE : " + rstate["target"]
    draw_text(F, l1, 36, WY1 + 44, 20)
    draw_text(F, "ÉTAT : " + etat(f), 36, WY1 + 76, 20)
    if counter is not None:
        draw_text(F, "N = " + f"{counter:,}".replace(",", " "), WX1, WY1 + 76, 20, CREAM, 1.0, "r")
    # FOND PERDU clignote pendant la première moitié du déferlement
    s5 = seq_range(5)
    fp_end = s5[0] + 14
    if s5[0] <= f <= fp_end and ((f - s5[0]) // 2) % 2 == 0:
        draw_text(F, "FOND PERDU", W // 2, 130, 26, ORANGE_HI, 1.0, "c", 700)
    # BON À TIRER dès le verrouillage final ; signature en marge
    sig = find("reticule", "verrouillage final")["image"]
    if f >= sig:
        a = fade_signature(f)
        if a > 0:
            draw_text(F, "BON À TIRER", WX1, WY1 + 44, 20, CREAM, a, "r")
            draw_text(F, "STUDIO CRÉATIF · IDENTITÉ · MOTION · 3D · PUBLICITÉ", 36, WY1 + 128, 20, CREAM, a)


def burn_in(F, f):
    """Incrustation de relecture, en haut à droite, petite et discrète : image, secondes, mesure.temps."""
    if not BURN_IN:
        return
    m, b = beat_pos(f)
    txt = f"F {f:03d} | {f / FPS:05.2f} S | {m:02d}.{b}"
    blend_rect(F, WX1 - 8 * 14 - 150, 44, WX1 + 2, 72, BLACK, 0.55)
    draw_text(F, txt, WX1, 48, 16, CREAM, 0.5, "r")
