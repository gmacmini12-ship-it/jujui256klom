"""Séquence 3 — le brin de menthe, planté dans le verre plein de glace sur le premier temps de la mesure 7.

Ce geste est animé, pas simulé (la paille, elle, tombe dans la simulation des chutes) : on cherche, dans l'empilement
laissé par la simulation, un passage rectiligne libre (aucun glaçon, aucun citron, pas la paille), puis la tige y
glisse le long de son axe. Rien n'est traversé : la recherche le garantit.

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -P build/mojito/plantes.py

Sortie : cache/mojito/plantes.json (pose finale du brin, pose de la paille relevée dans la simulation, horaires).
"""
import bpy  # doit précéder bmesh et mathutils
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import chutes as C         # noqa: E402

TIGE_R = 0.0016
IMAGES_BRIN = (309.0, 312.0)         # le brin entre par le haut de l'image et se cale sur le premier temps de la mesure 7
COURSE = 0.22                        # distance parcourue le long de l'axe pendant la mise en place


def arbres(d):
    """Arbres de recherche des corps au repos (glaçons à l'échelle du rendu, citron), dans le repère du monde."""
    liste = []
    for k, c in enumerate(d["plan"]):
        if c["genre"] == "feuille":
            continue
        me = C.maillage(c)
        p, q = C.pose(d, k, C.T_FIN)
        m = Matrix.Translation(p) @ q.to_matrix().to_4x4()
        ech = 0.94 if c["genre"] == "glacon" else 1.0
        verts = [m @ (v.co * ech) for v in me.vertices]
        polys = [tuple(pl.vertices) for pl in me.polygons]
        centre = sum(verts, Vector()) / len(verts)
        rayon = max((v - centre).length for v in verts)
        liste.append((BVHTree.FromPolygons(verts, polys), centre, rayon))
        bpy.data.meshes.remove(me)
    return liste


def libre(arbres_, a, b, rayon, pas=0.0015):
    """Vrai si le cylindre d'axe [a, b] et de rayon donné ne touche aucun corps."""
    n = max(int((b - a).length / pas), 2)
    for i in range(n + 1):
        p = a.lerp(b, i / n)
        for arbre, centre, r in arbres_:
            if (p - centre).length > r + rayon:
                continue
            pos, nor, idx, dist = arbre.find_nearest(p)
            if pos is None:
                continue
            if dist < rayon or (p - pos).dot(nor) < 0.0:      # trop près, ou à l'intérieur (corps convexes)
                return False
    return True


def fond_a(r):
    """Hauteur du fond (ou du tas de sucre) au rayon r, depuis le dessous du verre."""
    return S.E_FOND + max(C.SUCRE_H * (1.0 - (r / C.SUCRE_R) ** 2), 0.0)


def pose_paille(d):
    """Pied et axe (vers le haut) de la paille au repos, relevés dans la simulation des chutes."""
    from mathutils import Quaternion
    k = next(i for i, c in enumerate(d["plan"]) if c["genre"] == "paille")
    axe = Quaternion(d["quat"][-1, k]) @ Vector((0, 0, 1))
    if axe.z < 0:
        axe = -axe
    centre = Vector(d["loc"][-1, k])
    return centre - axe * (C.PAILLE_L / 2), axe


def chercher_brin(arbres_, paille):
    """Pied de la tige dans un interstice, au moins 40 mm sous le bord ; sortie par l'ouverture, côté gauche."""
    jeu = TIGE_R + 0.0008
    meilleur = None
    for az in range(100, 261, 8):
        a = math.radians(az)
        for r_sortie in (0.026, 0.021, 0.016):
            sortie = Vector((r_sortie * math.cos(a), r_sortie * math.sin(a), S.Z0 + S.H_VERRE))
            for az_pied in range(az - 60, az + 61, 20):
                ap = math.radians(az_pied)
                for r_pied in (0.006, 0.012, 0.018, 0.024):
                    for prof in (0.075, 0.062, 0.050, 0.040):
                        pied = Vector((r_pied * math.cos(ap), r_pied * math.sin(ap), S.Z0 + S.H_VERRE - prof))
                        axe = (sortie - pied).normalized()
                        if axe.z < 0.86:
                            continue
                        if not libre(arbres_, pied, sortie + axe * 0.004, jeu):
                            continue
                        # le bouquet ne doit pas croiser la paille : distance entre les deux axes au-dessus du bord
                        pp, pa = paille
                        ecart = min(((sortie + axe * s) - (pp + pa * ((sortie + axe * s - pp).dot(pa)))).length for s in (0.0, 0.02, 0.04, 0.058))
                        if ecart < 0.026:
                            continue
                        note = -prof + 0.03 * abs(az - 150) / 60.0 + 0.3 * (1.0 - axe.z)
                        if meilleur is None or note < meilleur[0]:
                            meilleur = (note, pied, sortie, az, prof)
                        break
    return meilleur


def descente(u):
    """Trajet le long de l'axe, de 0 (hors champ) à 1 (en place) : accélération de chute, arrêt net, petit rebond amorti."""
    if u <= 0:
        return 0.0
    if u >= 1.25:
        return 1.0
    if u < 1.0:
        return u * u
    v = (u - 1.0) / 0.25
    return 1.0 - 0.012 * math.sin(math.pi * v) * (1.0 - v)


def decalage(nom, f, d):
    """Recul le long de l'axe (m) à l'image f : 0 quand l'objet est en place, None tant qu'il n'est pas entré."""
    f0, f1 = d[nom]["images"]
    if f < f0:
        return None
    u = (f - f0) / (f1 - f0)
    return COURSE * (1.0 - descente(u))


def charger():
    return json.load(open(os.path.join(C.CACHE, "plantes.json")))


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d = C.charger()
    arbres_ = arbres(d)
    pied, axe = pose_paille(d)
    print(f"PLANTES paille (simulée) : pied à {(pied.z - S.Z0) * 1000:.0f} mm, inclinaison {math.degrees(math.acos(axe.z)):.0f}°", flush=True)
    b = chercher_brin(arbres_, (pied, axe))
    if b is None:
        raise SystemExit("PLANTES : aucun passage libre pour le brin")
    _, pied_b, sortie_b, az_b, prof = b
    print(f"PLANTES brin : pied {prof * 1000:.0f} mm sous le bord, sortie à {az_b}°", flush=True)
    resultat = {
        "paille": {"pied": list(pied), "axe": list(axe), "longueur": C.PAILLE_L, "rayon": C.PAILLE_R},
        "brin": {"pied": list(pied_b), "sortie": list(sortie_b), "images": list(IMAGES_BRIN)},
    }
    json.dump(resultat, open(os.path.join(C.CACHE, "plantes.json"), "w"), indent=1)
    print("PLANTES -> cache/mojito/plantes.json", flush=True)
