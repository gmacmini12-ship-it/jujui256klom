"""Réticule : machine à états pilotée par la partition (piste `reticule`) et dessin en espace écran."""
import math

import cv2
import numpy as np

from common import (CREAM, ORANGE_HI, W, H, find, blocks, instants, smooth, ease_out_back, lerp,
                    logo_circle, mask_blend, line)

# Cibles des trois tentatives (cx, cy, r) en px feuille — d'après les planches `dalle`, `filet`, `heros`.
TARGETS = [(540.0, 1040.0, 400.0, "BANDE"), (540.0, 620.0, 130.0, "FLUX"), (540.0, 1080.0, 450.0, "VERRE")]

SNAP = 6          # images pour s'accrocher
SHAKE = 6         # images de secousse avant l'échec
RELEASE = 12      # images pour se détacher


def _sched():
    lock = find("reticule", "verrouillé", "b")
    unlock = find("reticule", "déverrouillage")["image"]
    att = [e for e in instants("reticule") if e["nom"].startswith("tentative")]
    axes = find("reticule", "repère d'axes", "b")
    final = find("reticule", "verrouillage final")["image"]
    return lock, unlock, att, axes, final


LOCK, UNLOCK, ATT, AXES, FINAL = _sched()


def drift(f):
    """Dérive douce du réticule libre : (cx, cy, r, rot°)."""
    t = 2 * math.pi * f
    cx = 540 + 30 * math.sin(t / 150 + 0.4) + 9 * math.sin(t / 53)
    cy = 960 + 26 * math.sin(t / 190 + 1.3) + 8 * math.sin(t / 61)
    r = 452 + 8 * math.sin(t / 97)
    rot = 4 + 3 * math.sin(t / 120)
    return cx, cy, r, rot


def locked_params():
    cx, cy, r = logo_circle()
    return cx, cy, r, 0.0


def state(f):
    """Paramètres du réticule à l'image f.
    Renvoie dict(cx, cy, r, rot, gap, gap_rot, color, axes, locked, held, phase, target)."""
    L = locked_params()
    st = dict(cx=L[0], cy=L[1], r=L[2], rot=0.0, gap=0.0, gap_rot=0.0, color=CREAM, axes=0.0,
              locked=False, held=False, phase="free", target=None)

    def setp(p):
        st["cx"], st["cy"], st["r"], st["rot"] = p

    # --- verrouillé sur le cercle du logo
    if f <= LOCK["fin"]:
        st.update(locked=True, held=True, phase="locked")
        return st
    # --- verrouillage final (arrivée exacte à l'image FINAL, et tenu ensuite)
    if f >= FINAL:
        st.update(locked=True, held=True, phase="locked-final")
        return st
    p = drift(f)
    st["phase"] = "free"
    # --- déverrouillage
    first_att = ATT[0]["image"]
    if f < first_att:
        u = smooth((f - UNLOCK) / 12.0)
        p = tuple(lerp(a, b, u) for a, b in zip(L, p))
        st["gap"] = 38 * (1 - smooth((f - UNLOCK) / 22.0))
        st["gap_rot"] = 20
        if f >= UNLOCK:
            st["phase"] = "unlock"
    # --- tentatives
    for e in ATT:
        s, end = e["image"], e["fin"]
        tgt = TARGETS[ATT.index(e)]
        T = tgt[:3] + (0.0,)
        if s <= f < end + RELEASE:
            t = f - s
            held_end = end                       # le réticule est « tenu » jusqu'à `fin`
            start = drift(s)
            if f < s + SNAP:
                u = ease_out_back((t + 1) / SNAP)
                p = tuple(lerp(a, b, u) for a, b in zip(start, T))
                st["phase"] = f"snap:{tgt[3]}"
                st["target"] = tgt[3]
            elif f < held_end:
                p = T
                st["held"] = True
                st["phase"] = f"hold:{tgt[3]}"
                st["target"] = tgt[3]
                if e["issue"] == "échec" and f >= held_end - SHAKE:
                    k = (held_end - f) / SHAKE
                    amp = 14 * k
                    p = (T[0] + amp * math.sin(f * 2.9), T[1] + amp * math.cos(f * 3.7), T[2], 3.5 * k * math.sin(f * 4.1))
                    st["phase"] = f"shake:{tgt[3]}"
                if e["issue"] == "tenu":
                    st["color"] = ORANGE_HI
            else:
                u = smooth((f - end) / float(RELEASE))
                a = T
                p = tuple(lerp(x, y, u) for x, y in zip(a, drift(f)))
                p = (p[0], p[1], p[2] * (1 + 0.16 * (1 - u)), p[3])
                st["gap"] = (55 if e["issue"] == "échec" else 26) * (1 - smooth((f - end) / 26.0))
                st["gap_rot"] = 20 + 90 * (f - end) / 26.0
                st["phase"] = f"open:{tgt[3]}"
                if e["issue"] == "tenu":
                    st["color"] = tuple(lerp(a_, b_, u) for a_, b_ in zip(ORANGE_HI, CREAM))
    # --- axes gradués (marques prolongées)
    a0, a1 = AXES["debut"], AXES["fin"]
    if a0 <= f <= a1:
        st["axes"] = smooth((f - a0) / 8.0) * (1 - smooth((f - (a1 - 7)) / 7.0))
        st["phase"] = "axes"
    # --- retour au verrou : arrivée exacte à FINAL
    if f >= FINAL - SNAP:
        start = drift(FINAL - SNAP)
        u = ease_out_back((f - (FINAL - SNAP)) / float(SNAP))
        p = tuple(lerp(a, b, u) for a, b in zip(start, L))
        st["phase"] = "snap-final"
        st["gap"] = 0.0
        st["axes"] = 0.0
    setp(p)
    return st


def _arc(img, cx, cy, r, a0, a1, color, thick):
    cv2.ellipse(img, (int(round(cx * 16)), int(round(cy * 16))), (int(round(r * 16)), int(round(r * 16))), 0,
                a0, a1, color, thick, cv2.LINE_AA, 4)


def _dashed_axes(img, cx, cy, amount, color):
    if amount <= 0.01:
        return
    op = 0.8 * amount
    # bande horizontale
    for horizontal in (True, False):
        n = W if horizontal else H
        c = int(round(cy if horizontal else cx))
        m = np.zeros((9, n) if horizontal else (n, 9), np.uint8)
        for s in range(-12, n, 32):                                   # tirets
            a, b = s, s + 18
            if horizontal:
                cv2.line(m, (a, 4), (b, 4), 255, 1, cv2.LINE_8)
            else:
                cv2.line(m, (4, a), (4, b), 255, 1, cv2.LINE_8)
        # graduations tous les 54 px, plus longues tous les 5
        c0 = (cx if horizontal else cy)
        for k in range(-40, 41):
            pos = int(round(c0 + k * 54))
            if not (0 <= pos < n):
                continue
            ln = 4 if k % 5 == 0 else 2
            if horizontal:
                cv2.line(m, (pos, 4 - ln), (pos, 4 + ln), 255, 1, cv2.LINE_8)
            else:
                cv2.line(m, (4 - ln, pos), (4 + ln, pos), 255, 1, cv2.LINE_8)
        if horizontal:
            mask_blend(img, m, color, op, 0, c - 4)
        else:
            mask_blend(img, m, color, op, c - 4, 0)


def draw(img, st):
    """Dessine le réticule par-dessus l'image. Verrouillé : le cercle et les repères du logo (couche
    `lines`) EN SONT le tracé ; rien n'est ajouté pour ne pas altérer le logo."""
    if st["locked"]:
        return
    cx, cy, r, rot = st["cx"], st["cy"], st["r"], st["rot"]
    col = tuple(int(round(c)) for c in st["color"])
    if st["axes"] > 0:
        _dashed_axes(img, cx, cy, st["axes"], col)
    gap = st["gap"]
    if gap > 0.5:
        g0 = st["gap_rot"] + rot
        _arc(img, cx, cy, r, g0 + gap / 2, g0 + 360 - gap / 2, col, 2)
    else:
        _arc(img, cx, cy, r, 0, 360, col, 2)
    # quatre repères (radiaux, avec barre transversale en haut et en bas comme sur le logo)
    for k in range(4):
        a = math.radians(rot + 90 * k - 90)
        ux, uy = math.cos(a), math.sin(a)
        p_out = (cx + ux * (r + 10), cy + uy * (r + 10))
        p_in = (cx + ux * (r - 46), cy + uy * (r - 46))
        line(img, p_out, p_in, col, 2)
        if k % 2 == 0:
            nx, ny = -uy, ux
            c2 = (cx + ux * (r - 46), cy + uy * (r - 46))
            line(img, (c2[0] - nx * 14, c2[1] - ny * 14), (c2[0] + nx * 14, c2[1] + ny * 14), col, 2)
