"""Composition d'une image : feuille noire -> fenêtre -> traits de coupe et annotations -> matière -> réticule."""
import os
import pathlib

import cv2
import numpy as np

import fx_common as X
import fx_draw as D
import fx_reticle as R
import fx_sheet as SH
import fx_standin as SI


def read_rgb16(path, shape):
    """Lit un PNG 8 ou 16 bits en RGB float32 0..65535 ; None si absent/illisible/mauvaise taille."""
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None or im.ndim != 3 or im.shape[0] != shape[0] or im.shape[1] != shape[1]:
        return None
    sc = 257.0 if im.dtype == np.uint8 else 1.0
    if im.shape[2] == 4:
        a = im[..., 3:4].astype(np.float32) / (255.0 if im.dtype == np.uint8 else 65535.0)
        rgb = cv2.cvtColor(im[..., :3], cv2.COLOR_BGR2RGB).astype(np.float32) * sc
        return np.concatenate([rgb, a * 65535.0], axis=2)
    return cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32) * sc


def compose(f):
    """Renvoie (image uint16 RGB H×W×3, infos). f est déjà canonique (0 pour les images 1–5 et 594–599)."""
    info = {"f": f, "window": None, "matiere": None}
    S = SH.base_sheet()
    SH.crop_marks(S)
    rs = R.state(f)
    counter = None
    has_lines = False
    standin = False

    # ---- fenêtre
    if f == 0:
        win = X.AC.logo_source().astype(np.float32) * X.SCALE16       # logo source à plat, exact
        S[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S] = win
        info["window"] = "logo-source"
        has_lines = True
    else:
        p = X.window_file(f)
        win = read_rgb16(p, (X.WINH, X.WINW)) if p is not None else None
        win = win[..., :3] if win is not None else None
        if win is not None:
            info["window"] = "final"
            if 72 <= f <= 359:
                # séquences 2 et 3, rendues sur fond de noir absolu : on les pose « en écran » sur le noir de la feuille,
                # sinon la fenêtre se découperait en plus sombre sur la feuille (#0A0A09)
                noir = S[X.WY0:X.WY1, X.WX0:X.WX1]
                win = noir + win * (1.0 - noir / 65535.0)
        else:
            w8, cnt_a, has_lines = SI.window(f)
            win = w8.astype(np.float32) * X.SCALE16
            counter = cnt_a
            info["window"] = "standin"
            standin = True
        S[X.WY0:X.WY1, X.WX0:X.WX1] = win
    m = X.meta(f)
    if "n" in m:
        counter = int(m["n"])
    elif info["window"] == "final":
        counter = None
    info["n"] = counter

    # ---- traits de coupe (déjà posés) et annotations
    info["text_margin"] = SH.annotations(S, f, rs, counter)

    # ---- matière (456–527)
    a0, a1 = X.MATIERE_RANGE
    if a0 <= f <= a1:
        mp = X.matiere_file(f)
        lay = read_rgb16(mp, (X.H, X.W)) if mp is not None else None
        if lay is not None and lay.shape[2] == 4:
            al = (lay[..., 3:4] / 65535.0).astype(np.float32)
            S[:] = S * (1 - al) + lay[..., :3] * al
            info["matiere"] = "final"
        else:
            alpha, col, ng = SI.matiere(f)
            S[:] = S * (1 - alpha[..., None]) + col * X.SCALE16 * alpha[..., None]
            info["matiere"] = "standin"
            standin = True
            if info["window"] != "final" and counter is None:
                pass

    # ---- réticule
    if not (rs["identity"] and has_lines):
        R.draw(S, rs)
    info["reticle"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in rs.items() if k != "color"}

    if standin:
        SH.maquette_tag(S)
    elif os.environ.get("FX_ETIQUETTE"):          # aperçus : toutes les images portent l'étiquette demandée
        SH.maquette_tag(S, os.environ["FX_ETIQUETTE"])
    info["standin"] = standin
    return np.clip(S + 0.5, 0, 65535).astype(np.uint16), info


def write_png(path, img16):
    path = pathlib.Path(path)
    tmp = path.with_suffix(".tmp.png")
    cv2.imwrite(str(tmp), cv2.cvtColor(img16, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 2])
    os.replace(tmp, path)
