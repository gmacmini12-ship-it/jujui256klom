"""Doublures schématiques : appelle le code de l'animatique pour toute image dont la séquence finale manque.

* window(f)  -> (fenêtre uint8 1512×1008×3, compteur animatique ou None, has_lines)
  `has_lines` : la fenêtre contient déjà le cercle et les repères du logo (le réticule ne les redessine pas).
  Pour les images 12–23 et 504–527 l'animatique pose les traits du logo en position fixe alors que le
  réticule flotte : ils sont retirés ici pour ne pas les voir en double.
* matiere(f) -> (RGBA float32 H×W×4, alpha droit 0..1, couleur 0..255, compteur) pour 456–527 : le
  recouvrement de seq5_overlay est extrait en rendant la même image sur fond noir puis sur fond blanc
  (alpha = 1 − (Cblanc − Cnoir)/255, couleur = Cnoir/alpha) : exact pour tout mélange par recouvrement.
"""
import numpy as np

import fx_common as X
import scenes as AS            # animatique
import common as AC


class _NoLines:
    """Retire provisoirement la couche `lines` du logo recomposé de l'animatique."""
    def __enter__(self):
        st = AS._logo_state()
        self.L = st["L"]
        self.saved = self.L["lines"]
        self.L["lines"] = np.zeros_like(self.saved)

    def __exit__(self, *a):
        self.L["lines"] = self.saved


def counter_rule(f, cnt):
    seq = AS.seq_index(f)
    if cnt is not None and ((seq == 2 and f >= AS.T_CRUMBLE) or seq == 4):
        return cnt
    if seq == 5 and f < AS.T_INK:
        return AS._burst()["v"].shape[0]
    return None


def window(f):
    seq = AS.seq_index(f)
    if seq == 5:
        S, cnt = AS.canvas(), None
        if f >= AS.T_SQ["debut"]:
            S[AC.LOGO_Y:AC.LOGO_Y + AC.LOGO_S, AC.LOGO_X:AC.LOGO_X + AC.LOGO_S] = AC.to_u8(AC.compose_logo(lines=False))
        has_lines = False
    elif seq == 0 and f >= 12:
        with _NoLines():
            S, cnt = AS.window(f)
        has_lines = False
    else:
        S, cnt = AS.window(f)
        has_lines = seq in (0, 6)
    win = np.ascontiguousarray(S[X.WY0:X.WY1, X.WX0:X.WX1])
    return win, counter_rule(f, cnt), has_lines


def matiere(f):
    outs = []
    n_g = None
    for bg in (0, 255):
        F = np.empty((X.H, X.W, 3), np.uint8)
        F[:] = bg
        n_g = AS.seq5_overlay(f, F)
        outs.append(F.astype(np.float32))
    cb, cw = outs
    alpha = np.clip(1.0 - (cw - cb).mean(axis=2) / 255.0, 0.0, 1.0)
    col = np.where(alpha[..., None] > 1e-4, cb / np.maximum(alpha[..., None], 1e-4), 0.0)
    return alpha, np.clip(col, 0, 255), n_g
