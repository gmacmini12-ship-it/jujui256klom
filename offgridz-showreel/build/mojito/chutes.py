"""Séquence 3 — les chutes dans le verre : quartiers et rondelle de citron vert, feuilles de menthe, glaçons.

Corps rigides réellement simulés (Bullet, dans Blender), à 240 pas par seconde, en temps physique.
Les lâchers sont recalés automatiquement pour que le premier choc de chaque corps tombe sur la grille musicale
(doubles-croches du film) ; les chocs mesurés sont enregistrés pour le son.

Les corps légers ou minces (feuilles, rondelle, paille) sont figés là où ils se sont posés, une fois au repos, juste avant
que la glace ne tombe dessus : ils deviennent des appuis fixes pour la suite (plan_de_chute, clé « fige »).

Deux précautions de calcul, sans effet sur la physique :
- la simulation tourne à dix fois la taille réelle avec une gravité dix fois plus forte (mêmes durées, mêmes
  trajectoires) : le moteur est réglé pour des objets de l'ordre du mètre, pas du centimètre ;
- le verre est représenté par 32 douves convexes et un fond épais : les corps ne peuvent pas le traverser.

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 2 -P build/mojito/chutes.py -- [--graine 3]

Sortie : cache/mojito/chutes.npz (poses de chaque corps à chaque pas, instants de lâcher, chocs).
"""
import bpy  # doit précéder bmesh et mathutils
import bmesh
import argparse
import json
import math
import os
import random
import sys
import time

import numpy as np
from mathutils import Euler, Quaternion, Vector

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import temps as T          # noqa: E402

CACHE = os.path.join(S.RACINE, "cache", "mojito")
HZ = 240                       # pas de simulation enregistrés par seconde (temps physique)
ECH = 10.0                     # facteur d'échelle de la simulation
G = 9.81
T_DEBUT, T_FIN = -0.60, 2.40   # la simulation couvre tau de -0,6 s à 2,4 s (image 312) ; au-delà tout est au repos
Z_LACHER = S.Z0 + S.H_VERRE + 0.21     # hauteur de lâcher : 21 cm au-dessus du bord, comme une main de barman
SUCRE_R, SUCRE_H = 0.022, 0.010        # tas de sucre au fond du verre (obstacle fixe)
C_FEUILLE = -math.log(1.0 - 0.999)     # freinage de l'air sur une feuille (1/s) : vitesse limite G / C = 1,42 m/s
PAILLE_L, PAILLE_R = 0.215, 0.0031     # la paille noire : longueur et rayon


def plan_de_chute(graine):
    """Liste des corps : genre, image visée pour le premier choc, point d'entrée, paramètres."""
    rnd = random.Random(graine)
    corps = []

    def ajoute(genre, image, rayon, **plus):
        a = rnd.uniform(0, 2 * math.pi); r = rayon * math.sqrt(rnd.random())
        corps.append(dict(genre=genre, image=image, x=r * math.cos(a), y=r * math.sin(a),
                          rot=[rnd.uniform(0, 6.283) for _ in range(3)], **plus))
    ajoute("quartier", 216, 0.008)
    ajoute("quartier", 219, 0.008)
    ajoute("quartier", 222, 0.008)
    for k, image in enumerate((228, 229, 230, 231.5, 233, 234.5)):
        ajoute("feuille", image, 0.010, longueur=rnd.uniform(0.024, 0.034), graine=60 + k, fige=238.5)
    # la paille tombe avant la glace, comme au bar : inclinée de 12° vers l'arrière droit, elle se cale contre le bord
    axe = Vector((math.sin(math.radians(12)) * math.cos(math.radians(42)), math.sin(math.radians(12)) * math.sin(math.radians(42)),
                  math.cos(math.radians(12))))
    corps.append(dict(genre="paille", image=237, x=-0.008 + rnd.uniform(-0.002, 0.002), y=-0.007 + rnd.uniform(-0.002, 0.002),
                      rot=list(axe.to_track_quat("Z", "Y").to_euler()), dz=PAILLE_L / 2, fige=246.5))
    for image in (240, 243, 246, 249, 252, 255, 258, 261):          # huit glaçons, un par double-croche
        ajoute("glacon", image, 0.007)
    # la rondelle de citron vert tombe debout contre la paroi avant, entre le troisième et le quatrième glaçon :
    # elle se cale entre la glace et le verre, face à la caméra, et la suite des glaçons la bloque
    corps.append(dict(genre="rondelle", image=247.5, x=rnd.uniform(-0.004, 0.004), y=-0.026,
                      rot=[math.pi / 2 + 0.20, 0.0, rnd.uniform(-0.3, 0.3)], fige=251.0))
    return corps


def maillage(c, simulation=False):
    if c["genre"] == "quartier":
        return S.maillage_quartier()
    if c["genre"] == "rondelle":
        return S.maillage_rondelle()
    if c["genre"] == "feuille":
        me = S.maillage_feuille(c["longueur"], c["graine"])
        if simulation:      # forme de collision : la feuille avec une vraie épaisseur (une forme trop mince affole le moteur)
            pts = np.array([v.co[:] for v in me.vertices])
            bpy.data.meshes.remove(me)
            bm = bmesh.new()
            for dz in (-0.0006, 0.0006):
                for p in pts[::7]:
                    bm.verts.new((p[0], p[1], p[2] + dz))
            bmesh.ops.convex_hull(bm, input=bm.verts)
            me = bpy.data.meshes.new("feuille_sim"); bm.to_mesh(me); bm.free()
        return me
    if c["genre"] == "paille":
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=PAILLE_R, radius2=PAILLE_R, depth=PAILLE_L)
        me = bpy.data.meshes.new("paille_sim"); bm.to_mesh(me); bm.free()
        return me
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=S.T_GLACON)
    me = bpy.data.meshes.new("glacon_sim"); bm.to_mesh(me); bm.free()
    return me


PHYSIQUE = {   # masse (kg), frottement, rebond, amortissements linéaire et angulaire, forme de collision
    "quartier": (0.012, 0.45, 0.10, 0.05, 0.30, "CONVEX_HULL"),
    "rondelle": (0.008, 0.45, 0.10, 0.05, 0.30, "CONVEX_HULL"),
    "feuille": (0.0004, 0.60, 0.00, 0.9990, 0.98, "CONVEX_HULL"),
    "glacon": (0.0143, 0.10, 0.40, 0.02, 0.10, "BOX"),
    "paille": (0.0140, 0.40, 0.10, 0.03, 0.20, "CONVEX_HULL"),      # paille en inox laqué noir : 14 g
}
ENCOMBREMENT = {"quartier": 0.055, "rondelle": 0.055, "feuille": 0.038, "glacon": 0.055, "paille": 0.14}   # écart vertical minimal au lâcher


def tas_de_sucre():
    """Calotte convexe au fond du verre : le sucre déjà tombé, obstacle fixe pour les chutes."""
    profil = [(0.0, S.Z0 + S.E_FOND + SUCRE_H)]
    for k in range(1, 7):
        u = k / 6
        profil.append((SUCRE_R * u, S.Z0 + S.E_FOND + SUCRE_H * (1 - u * u)))
    profil.append((0.0, S.Z0 + S.E_FOND))
    return S.tour("tas_sucre", profil, segments=32)


def verre_convexe(n=32, epaisseur=0.008):
    """Le verre pour le moteur de collision : n douves convexes (face intérieure sur la paroi intérieure réelle)
    et un fond épais. Construit à l'échelle de la simulation."""
    pieces = []
    zb, zt = S.E_FOND - 0.004, S.H_VERRE
    for i in range(n):
        a1, a2 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        pts = []
        for z in (zb, zt):
            for r in (S.r_int(z), S.r_int(z) + epaisseur):
                for a in (a1, a2):
                    pts.append((ECH * r * math.cos(a), ECH * r * math.sin(a), ECH * (S.Z0 + z)))

        def douve(bm, pts=pts):
            for p in pts:
                bm.verts.new(p)
            bmesh.ops.convex_hull(bm, input=bm.verts)
        pieces.append(S.depuis_bmesh(f"douve{i}", douve, lisse=False))
    fond = S.depuis_bmesh("fond", lambda bm: bmesh.ops.create_cone(
        bm, cap_ends=True, segments=48, radius1=ECH * (S.R_BAS + 0.012), radius2=ECH * (S.R_BAS + 0.012), depth=ECH * (S.E_FOND + 0.02)), lisse=False)
    fond.location = (0, 0, ECH * (S.Z0 + S.E_FOND - (S.E_FOND + 0.02) / 2))
    pieces.append(fond)
    return pieces


def hauteur_libre(c, z0, dt):
    """Hauteur d'un corps lâché de z0 depuis dt secondes, en chute libre (freinée par l'air pour une feuille)."""
    if dt <= 0:
        return z0
    if c["genre"] == "feuille":
        return z0 - (G / C_FEUILLE) * (dt - (1.0 - math.exp(-C_FEUILLE * dt)) / C_FEUILLE)
    return z0 - 0.5 * G * dt * dt


def duree_de_chute(c, dz):
    if c["genre"] != "feuille":
        return math.sqrt(2 * max(dz, 0.0) / G)
    a, b = 0.0, 3.0
    for _ in range(50):
        m = 0.5 * (a + b)
        if hauteur_libre(c, 0.0, m) > -dz:
            a = m
        else:
            b = m
    return 0.5 * (a + b)


def hauteurs_de_lacher(plan, lachers):
    """Chaque corps part de la hauteur de lâcher, ou plus haut s'il chevaucherait un corps lâché avant lui."""
    ordre = sorted(range(len(plan)), key=lambda k: lachers[k])
    z = [Z_LACHER + c.get("dz", 0.0) for c in plan]
    for rang, k in enumerate(ordre):
        for j in ordre[:rang]:
            zj = hauteur_libre(plan[j], z[j], lachers[k] - lachers[j])
            ecart = max(ENCOMBREMENT[plan[k]["genre"]], ENCOMBREMENT[plan[j]["genre"]])
            if zj + ecart > Z_LACHER - 0.03:
                z[k] = max(z[k], zj + ecart)
    return z


def simuler(plan, lachers, hauteurs):
    """Une simulation complète. Renvoie (t, loc, quat) en unités réelles."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = HZ
    sc.gravity = (0.0, 0.0, -G * ECH)
    n_pas = int(round((T_FIN - T_DEBUT) * HZ)) + 1
    sc.frame_start, sc.frame_end = 1, n_pas
    bpy.ops.rigidbody.world_add()
    monde = sc.rigidbody_world
    if monde.collection is None:
        monde.collection = bpy.data.collections.new("corps_rigides")
    monde.substeps_per_frame = 6; monde.solver_iterations = 30
    monde.point_cache.frame_start = 1; monde.point_cache.frame_end = n_pas

    def corps_rigide(ob, type_, forme, masse=1.0, frottement=0.5, rebond=0.0, lin=0.04, ang=0.1):
        monde.collection.objects.link(ob)
        rb = ob.rigid_body
        rb.type = type_; rb.collision_shape = forme; rb.mass = masse; rb.friction = frottement; rb.restitution = rebond
        rb.linear_damping = lin; rb.angular_damping = ang
        rb.use_margin = True; rb.collision_margin = 0.0003 * ECH
        return rb
    for piece in verre_convexe():
        corps_rigide(piece, "PASSIVE", "CONVEX_HULL", frottement=0.25, rebond=0.6)
    tas = tas_de_sucre(); tas.scale = (ECH, ECH, ECH)
    corps_rigide(tas, "PASSIVE", "CONVEX_HULL", frottement=0.9, rebond=0.0)
    objets = []
    for k, c in enumerate(plan):
        ob = S.lier(f"corps{k}", maillage(c, simulation=True))
        ob.scale = (ECH, ECH, ECH); ob.rotation_euler = Euler(c["rot"])
        masse, frot, reb, lin, ang, forme = PHYSIQUE[c["genre"]]
        rb = corps_rigide(ob, "ACTIVE", forme, masse, frot, reb, lin, ang)
        rb.use_deactivation = True
        i_lacher = int(round((lachers[k] - T_DEBUT) * HZ)) + 1
        assert i_lacher > 8, "lâcher trop tôt : avancer T_DEBUT"
        # En attente, le corps est garé loin du verre. Il est posé au point de lâcher quatre pas avant d'être libéré :
        # sa vitesse initiale est donc nulle.
        ob.location = (20.0 + 3.0 * k, 0.0, 30.0); ob.keyframe_insert("location", frame=i_lacher - 5)
        ob.location = (ECH * c["x"], ECH * c["y"], ECH * hauteurs[k]); ob.keyframe_insert("location", frame=i_lacher - 4)
        rb.kinematic = True; ob.keyframe_insert("rigid_body.kinematic", frame=i_lacher - 1)
        rb.kinematic = False; ob.keyframe_insert("rigid_body.kinematic", frame=i_lacher)
        objets.append(ob)
    figeages = {int(round((T.tau(c["fige"]) - T_DEBUT) * HZ)) + 1: [] for c in plan if "fige" in c}
    for k, c in enumerate(plan):
        if "fige" in c:
            figeages[int(round((T.tau(c["fige"]) - T_DEBUT) * HZ)) + 1].append(k)
    loc = np.zeros((n_pas, len(objets), 3), np.float32); quat = np.zeros((n_pas, len(objets), 4), np.float32)
    for i in range(n_pas):
        sc.frame_set(i + 1)
        for k, ob in enumerate(objets):
            m = ob.matrix_world
            loc[i, k] = m.to_translation() / ECH; quat[i, k] = m.to_quaternion()
        for k in figeages.get(i + 1, []):              # le corps posé devient un appui fixe, là où il est
            ob = objets[k]
            m = ob.matrix_world.copy()
            ob.location = m.to_translation(); ob.rotation_euler = m.to_euler()
            ob.keyframe_insert("location", frame=i + 1); ob.keyframe_insert("rotation_euler", frame=i + 1)
            ob.rigid_body.kinematic = True; ob.keyframe_insert("rigid_body.kinematic", frame=i + 1)
    t = T_DEBUT + np.arange(n_pas) / HZ
    return t, loc, quat


def chocs(t, loc, lachers, seuil=0.15):
    """Chocs de chaque corps : instants où sa vitesse change brutalement (m/s en un pas). Renvoie [(t, corps, dv)]."""
    v = np.diff(loc, axis=0) * HZ                       # vitesse entre pas
    dv = np.linalg.norm(np.diff(v, axis=0), axis=2)     # saut de vitesse au pas i+1
    liste = []
    for k in range(loc.shape[1]):
        i = int(round((lachers[k] - T_DEBUT) * HZ)) + 3
        while i < len(dv):
            if dv[i, k] > seuil:
                j = i
                while j + 1 < len(dv) and dv[j + 1, k] > seuil and j - i < 4:      # un choc s'étale sur quelques pas
                    j += 1
                liste.append((float(t[i + 1]), k, float(dv[i:j + 1, k].sum())))
                i = j + 3
            else:
                i += 1
    return sorted(liste)


def dans_le_verre(p):
    z = p[2] - S.Z0
    return 0.0 < z < S.H_VERRE + 0.04 and math.hypot(p[0], p[1]) < S.r_int(min(max(z, 0.0), S.H_VERRE)) + 0.001


def fabriquer(graine, tours=8):
    plan = plan_de_chute(graine)
    cibles = [T.tau(c["image"]) for c in plan]
    contact = {"quartier": 0.035, "rondelle": 0.035, "feuille": 0.035, "glacon": 0.06, "paille": 0.035}
    lachers = [cible - duree_de_chute(c, Z_LACHER - S.Z0 - contact[c["genre"]]) for cible, c in zip(cibles, plan)]
    meilleur = None
    for tour in range(tours):
        hauteurs = hauteurs_de_lacher(plan, lachers)
        t0 = time.time()
        t, loc, quat = simuler(plan, lachers, hauteurs)
        liste = chocs(t, loc, lachers)
        premier = {}
        for (tc, k, dv) in liste:
            premier.setdefault(k, tc)
        ecarts = [premier.get(k, cibles[k] + 1.0) - cibles[k] for k in range(len(plan))]
        # les feuilles, freinées par l'air et légères, se posent sans bruit : seuls les corps lourds sont calés sur la grille
        pire = max(abs(e) for e, c in zip(ecarts, plan) if c["genre"] != "feuille")
        vit = np.linalg.norm(np.diff(loc, axis=0), axis=2) * HZ
        vmax = max(float(vit[int(round((lachers[k] - T_DEBUT) * HZ)) + 1:, k].max()) for k in range(len(plan)))
        dehors = [k for k in range(len(plan)) if not dans_le_verre(loc[-1][k])]
        print(f"CHUTES tour {tour} ({time.time() - t0:.0f} s) : écart maximal au premier choc {pire * T.IPS:.2f} image ; "
              f"chocs {len(liste)} ; vitesse maximale {vmax:.1f} m/s ; hors du verre {dehors}", flush=True)
        print("CHUTES   écarts (images) : " + " ".join(f"{p['genre'][0]}{e * T.IPS:+.1f}" for p, e in zip(plan, ecarts)), flush=True)
        sain = not dehors and vmax < 8.0
        for k, c in enumerate(plan):                 # la paille doit finir debout dans le verre, appuyée sur le bord
            if c["genre"] == "paille":
                axe = Quaternion(quat[-1, k]) @ Vector((0, 0, 1))
                if axe.z < 0:
                    axe = -axe
                pied = Vector(loc[-1, k]) - axe * (PAILLE_L / 2)
                inclinaison = math.degrees(math.acos(min(axe.z, 1.0)))
                azimut = math.degrees(math.atan2(axe.y, axe.x))
                ok = (4.0 < inclinaison < 40.0 and (pied.z - S.Z0) < 0.085 and math.hypot(pied.x, pied.y) < S.r_int(0.03)
                      and -25.0 < azimut < 115.0)            # jamais penchée vers la caméra : elle masquerait le verre
                print(f"CHUTES   paille : pied à {(pied.z - S.Z0) * 1000:.0f} mm, inclinaison {inclinaison:.0f}°, azimut {azimut:.0f}°"
                      f"{'' if ok else ' (rejetée)'}", flush=True)
                sain = sain and ok
            if c["genre"] == "rondelle":             # la rondelle doit rester contre la paroi avant, face à la caméra
                normale = Quaternion(quat[-1, k]) @ Vector((0, 0, 1))
                z_r = loc[-1, k][2] - S.Z0
                ok = abs(normale.y) > 0.72 and loc[-1, k][1] < -0.012 and 0.045 < z_r < 0.120
                print(f"CHUTES   rondelle : hauteur {z_r * 1000:.0f} mm, y {loc[-1, k][1] * 1000:.0f} mm, face à la caméra {abs(normale.y):.2f}"
                      f"{'' if ok else ' (rejetée)'}", flush=True)
                sain = sain and ok
        if sain and (meilleur is None or pire < meilleur["pire"]):
            meilleur = dict(plan=plan, lachers=list(lachers), hauteurs=hauteurs, cibles=cibles, t=t, loc=loc, quat=quat,
                            chocs=liste, ecarts=ecarts, pire=pire)
        if sain and pire < 0.5 / T.IPS:
            break
        lachers = [l - (e if abs(e) < 0.9 and (c["genre"] != "feuille" or tour < 2) else 0.0) for l, e, c in zip(lachers, ecarts, plan)]
    if meilleur is None or meilleur["pire"] > 0.75 / T.IPS:
        return None
    fin = meilleur["loc"][-1]
    repos = np.linalg.norm(meilleur["loc"][-1] - meilleur["loc"][-25], axis=1) * HZ / 24
    print("CHUTES hauteurs finales (mm) : " + ", ".join(f"{p['genre'][0]}{(fin[k][2] - S.Z0) * 1000:.0f}" for k, p in enumerate(plan)), flush=True)
    print(f"CHUTES retenu : écart maximal {meilleur['pire'] * T.IPS:.2f} image ; vitesse résiduelle maximale {repos.max() * 1000:.1f} mm/s", flush=True)
    return meilleur


def enregistrer(r, graine):
    os.makedirs(CACHE, exist_ok=True)
    chemin = os.path.join(CACHE, "chutes.npz")
    np.savez_compressed(chemin, t=r["t"], loc=r["loc"], quat=r["quat"], lachers=np.array(r["lachers"]),
                        hauteurs=np.array(r["hauteurs"]), cibles=np.array(r["cibles"]),
                        chocs=np.array(r["chocs"], np.float64).reshape(-1, 3), plan=json.dumps(r["plan"]), graine=graine, hz=HZ)
    return chemin


def charger():
    z = np.load(os.path.join(CACHE, "chutes.npz"), allow_pickle=False)
    d = {k: z[k] for k in z.files}
    d["plan"] = json.loads(str(d["plan"]))
    return d


def pose(d, k, t):
    """Pose interpolée du corps k au temps physique t : (position, quaternion), ou None avant son lâcher."""
    if t < d["lachers"][k] - 1e-9:
        return None
    x = (min(max(t, d["t"][0]), d["t"][-1]) - d["t"][0]) * float(d["hz"])
    i = min(int(x), len(d["t"]) - 2); a = x - i
    p = (1 - a) * d["loc"][i, k] + a * d["loc"][i + 1, k]
    q = Quaternion(d["quat"][i, k]).slerp(Quaternion(d["quat"][i + 1, k]), a)
    return Vector(p), q


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--graine", type=int, default=3)
    ap.add_argument("--essais", type=int, default=4, help="nombre de graines essayées si un corps sort du verre")
    A = ap.parse_args(argv)
    for essai in range(A.essais):
        g = A.graine + essai
        r = fabriquer(g)
        if r is not None:
            print(f"CHUTES graine {g} retenue -> {enregistrer(r, g)}", flush=True)
            break
        print(f"CHUTES graine {g} écartée : aucun tour sain", flush=True)
    else:
        raise SystemExit("CHUTES : aucune graine ne garde tous les corps dans le verre")
