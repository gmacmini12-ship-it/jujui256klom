"""Séquence 3 — finition de la surface du liquide simulé, pour le rendu.

Le solveur rend une surface qui s'arrête à une fraction de maille des obstacles : entre le liquide et la glace,
entre le liquide et le verre, il resterait une lame d'air que le rendu montrerait comme un miroir. Cette étape
ne change rien au mouvement du liquide ; elle ferme ces lames d'air, image par image :

1. la surface brute est convertie en champ de distance (OpenVDB) sur une grille fine ;
2. les corps immergés (glaçons, citron, tas de sucre) sont noyés jusqu'au niveau du liquide qui les entoure
   (vote sur les quatre directions horizontales : même hauteur d'eau dedans que dehors) ;
3. le liquide est prolongé radialement jusqu'à la paroi et verticalement jusqu'au fond, puis coupé net par la
   surface intérieure exacte du verre, qu'il recouvre de 0,18 mm (comme dans l'image de référence) ;
4. la surface est remaillée.

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 2 -P build/mojito/surface.py -- --res 128 --images 262:359

Entrée : cache/mojito/versement_r<res>/f####.npz. Sortie : cache/mojito/liquide_r<res>/f####.npz (sommets, quadrilatères, triangles).
"""
import bpy  # doit précéder bmesh et mathutils
import argparse
import os
import sys
import time

import numpy as np
import openvdb as vdb
from mathutils import Matrix

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import chutes as C         # noqa: E402

BOITE = ((-0.048, -0.048, 0.010), (0.048, 0.048, 0.302))
RECOUVREMENT = 0.00018          # le liquide entre de 0,18 mm dans la paroi du verre : pas de lame d'air


class Grille:
    def __init__(self, h):
        self.h = h
        (x0, y0, z0), (x1, y1, z1) = BOITE
        self.i0 = (int(np.floor(x0 / h)), int(np.floor(y0 / h)), int(np.floor(z0 / h)))
        self.n = (int(np.ceil(x1 / h)) - self.i0[0] + 1, int(np.ceil(y1 / h)) - self.i0[1] + 1, int(np.ceil(z1 / h)) - self.i0[2] + 1)
        self.tr = vdb.createLinearTransform(voxelSize=h)
        self.x = ((self.i0[0] + np.arange(self.n[0])) * h).astype(np.float32)[:, None, None]
        self.y = ((self.i0[1] + np.arange(self.n[1])) * h).astype(np.float32)[None, :, None]
        self.z = ((self.i0[2] + np.arange(self.n[2])) * h).astype(np.float32)[None, None, :]
        self.r = np.sqrt(self.x ** 2 + self.y ** 2)          # (nx, ny, 1)
        self.zz = self.z - S.Z0                               # hauteur depuis le dessous du verre

    def distance(self, points, triangles, demi_bande):
        """Champ de distance signé d'un maillage fermé, borné à ± demi_bande mailles, sur la grille dense."""
        g = vdb.FloatGrid.createLevelSetFromPolygons(np.ascontiguousarray(points, np.float32), triangles=np.ascontiguousarray(triangles, np.int32),
                                                    transform=self.tr, halfWidth=float(demi_bande))
        a = np.empty(self.n, np.float32)
        g.copyToArray(a, ijk=self.i0)
        return a

    def mailler(self, phi):
        g = vdb.FloatGrid(); g.transform = self.tr; g.background = float(np.abs(phi).max())
        g.copyFromArray(phi, ijk=self.i0, tolerance=0.0)
        g.gridClass = vdb.GridClass.LEVEL_SET
        pts, tri, quads = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
        return pts.astype(np.float32), quads.astype(np.int32), tri.astype(np.int32)


def flou(a, passes=2):
    """Lissage binomial séparable [1 2 1] / 4."""
    for _ in range(passes):
        for axe in range(3):
            b = np.swapaxes(a, 0, axe)
            c = b.copy()
            c[1:-1] = 0.25 * b[:-2] + 0.5 * b[1:-1] + 0.25 * b[2:]
            a = np.swapaxes(c, 0, axe)
    return a


def premiere_sortie(obstacle, liquide, axe, sens):
    """Pour chaque maille, état (1 liquide, 0 air, -1 inconnu) de la première maille libre rencontrée le long de l'axe."""
    o = np.swapaxes(obstacle, 0, axe); l = np.swapaxes(liquide, 0, axe)
    n = o.shape[0]
    idx = np.arange(n, dtype=np.int32)[:, None, None]
    if sens > 0:
        libre = np.where(~o, idx, n)
        proche = np.minimum.accumulate(libre[::-1], axis=0)[::-1]
        connu = proche < n
    else:
        libre = np.where(~o, idx, -1)
        proche = np.maximum.accumulate(libre, axis=0)
        connu = proche >= 0
    etat = np.take_along_axis(l, np.clip(proche, 0, n - 1), axis=0).astype(np.int8)
    etat[~connu] = -1
    return np.swapaxes(etat, 0, axe)


def obstacles(g, jeu):
    """Masque des corps immergeables, grossis de `jeu` (m) pour recouvrir la lame d'air laissée par le solveur."""
    d = C.charger()
    masque = np.zeros(g.n, bool)
    demi = jeu / g.h + 2.0
    for k, c in enumerate(d["plan"]):
        if c["genre"] == "feuille":
            continue
        me = C.maillage(c)
        p, q = C.pose(d, k, C.T_FIN)
        m = Matrix.Translation(p) @ q.to_matrix().to_4x4()
        ech = 0.94 if c["genre"] == "glacon" else 1.0
        v = np.array([(m @ (vert.co * ech))[:] for vert in me.vertices], np.float32)
        me.calc_loop_triangles()
        tri = np.array([t.vertices[:] for t in me.loop_triangles], np.int32)
        bpy.data.meshes.remove(me)
        masque |= g.distance(v, tri, demi) < jeu
    # tas de sucre : calotte analytique
    masque |= (g.zz < S.E_FOND + C.SUCRE_H * (1.0 - (g.r / C.SUCRE_R) ** 2) + jeu) & (g.zz > S.E_FOND - g.h) & (g.r < C.SUCRE_R + jeu)
    return masque


def verre(g):
    """Champ de distance (approché, exact près des surfaces utiles) du verre plein rétréci de RECOUVREMENT : négatif dans le verre."""
    zz = np.clip(g.zz, 0.0, S.H_VERRE)
    ri = S.R_BAS + (S.R_HAUT - S.R_BAS) * zz / S.H_VERRE - S.E_PAROI
    re = S.R_BAS + (S.R_HAUT - S.R_BAS) * zz / S.H_VERRE
    paroi = np.maximum(np.maximum((ri + RECOUVREMENT) - g.r, g.r - (re - RECOUVREMENT)), g.zz - (S.H_VERRE - 0.0002))
    fond = np.maximum(np.maximum(g.zz - (S.E_FOND - 0.0001), 0.0003 - g.zz), g.r - (re - RECOUVREMENT))
    return np.minimum(paroi, fond).astype(np.float32), ri.astype(np.float32)


def prolonger(g, liquide, ri, portee):
    """Prolonge le liquide radialement vers la paroi et verticalement vers le fond, sur `portee` mètres."""
    h = g.h
    nx, ny, nz = g.n
    etendu = np.zeros(g.n, bool)
    # radial : une maille proche de la paroi est mouillée s'il y a du liquide à la même hauteur, vers l'axe, à moins de `portee`
    bande = (g.r > ri - portee) & (g.r < ri + 2 * h + RECOUVREMENT) & (g.zz > S.E_FOND - 2 * h) & (g.zz < S.H_VERRE)
    ii, jj, kk = np.nonzero(bande)
    x = (g.i0[0] + ii) * h; y = (g.i0[1] + jj) * h
    r = np.sqrt(x * x + y * y) + 1e-9
    mouille = np.zeros(len(ii), bool)
    pas = max(int(round(portee / h)), 1)
    for s in range(1, pas + 1):
        f = np.maximum(r - s * h, 0.0) / r
        a = np.clip(np.round(x * f / h).astype(np.int64) - g.i0[0], 0, nx - 1)
        b = np.clip(np.round(y * f / h).astype(np.int64) - g.i0[1], 0, ny - 1)
        mouille |= liquide[a, b, kk]
    etendu[ii, jj, kk] = mouille
    # vertical : une maille proche du fond est mouillée s'il y a du liquide juste au-dessus
    k_fond = int(np.round((S.Z0 + S.E_FOND) / h)) - g.i0[2]
    haut = np.zeros((nx, ny), bool)
    for s in range(1, pas + 2):
        haut |= liquide[:, :, k_fond + s] | etendu[:, :, k_fond + s]
    for k in range(k_fond - 2, k_fond + pas + 1):
        etendu[:, :, k] |= haut
    return etendu


def finir(g, brut, obst, phi_verre, ri, jeu):
    phi = g.distance(brut["v"], brut["tri"], 3.0)
    liquide = phi < 0
    # 2. corps immergés : même niveau dedans que dehors
    voix_l = np.zeros(g.n, np.int8); voix_a = np.zeros(g.n, np.int8)
    for axe in (0, 1):
        for sens in (1, -1):
            e = premiere_sortie(obst, liquide, axe, sens)
            voix_l += e == 1; voix_a += e == 0
    noye = obst & (voix_l >= 2) & (voix_l >= voix_a)
    # 3. prolongement jusqu'au verre
    plein = liquide | noye
    etendu = prolonger(g, plein, ri, jeu + 2 * g.h)
    ajout = flou((noye | etendu).astype(np.float32))
    phi = np.minimum(phi, (0.5 - ajout) * (4.0 * g.h))
    phi = np.maximum(phi, -phi_verre)                # coupe nette par la surface intérieure du verre
    # ce qui a giclé hors du verre et retombe à l'extérieur n'est pas montré
    zz = np.clip(g.zz, 0.0, S.H_VERRE)
    dehors = (g.r > S.R_BAS + (S.R_HAUT - S.R_BAS) * zz / S.H_VERRE + 0.0006) & (g.zz < S.H_VERRE - 0.002)
    phi = np.where(dehors, np.float32(3 * g.h), phi)
    return g.mailler(phi), int(noye.sum()), int(etendu.sum())


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=128, help="résolution de la simulation à finir")
    ap.add_argument("--images", default="262:359")
    ap.add_argument("--maille", type=float, default=0.0006, help="maille de la grille de finition (m)")
    A = ap.parse_args(argv)
    a, b = (int(v) for v in A.images.split(":"))
    entree = os.path.join(S.RACINE, "cache", "mojito", f"versement_r{A.res}")
    sortie = os.path.join(S.RACINE, "cache", "mojito", f"liquide_r{A.res}")
    os.makedirs(sortie, exist_ok=True)
    jeu = 1.3 * 0.306 / A.res                      # un peu plus d'une maille de simulation
    g = Grille(A.maille)
    t0 = time.time()
    obst = obstacles(g, jeu)
    phi_verre, ri = verre(g)
    print(f"SURFACE grille {g.n} mailles de {g.h * 1000:.2f} mm, jeu {jeu * 1000:.1f} mm, obstacles {obst.mean() * 100:.1f} % ({time.time() - t0:.0f} s)", flush=True)
    for f in range(a, b + 1):
        chemin = os.path.join(entree, f"f{f:04d}.npz")
        if not os.path.exists(chemin):
            continue
        brut = np.load(chemin)
        t1 = time.time()
        if len(brut["v"]) == 0:
            np.savez_compressed(os.path.join(sortie, f"f{f:04d}.npz"), v=np.zeros((0, 3), np.float32), quads=np.zeros((0, 4), np.int32), tri=np.zeros((0, 3), np.int32))
            continue
        (v, quads, tri), n_noye, n_etendu = finir(g, brut, obst, phi_verre, ri, jeu)
        np.savez_compressed(os.path.join(sortie, f"f{f:04d}.npz"), v=v, quads=quads, tri=tri)
        print(f"SURFACE image {f} : {len(v)} sommets, {len(quads)} faces ; mailles noyées {n_noye}, prolongées {n_etendu} ; {time.time() - t1:.1f} s", flush=True)
