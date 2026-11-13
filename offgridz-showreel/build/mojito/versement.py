"""Séquence 3 — le versement : liquide réellement simulé (solveur FLIP de Blender, Mantaflow) autour des glaçons,
des quartiers de citron et du tas de sucre laissés par la simulation des chutes.

La simulation avance image de film par image de film ; pendant le ralenti (voir temps.py) chaque image fait
avancer le liquide d'une fraction d'image de temps réel.

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 3 -P build/mojito/versement.py -- --res 96 --images 258:359

Sortie : cache/mojito/versement_r<res>/f####.npz (surface brute du liquide : sommets, triangles) + reglages.json.
"""
import bpy  # doit précéder bmesh et mathutils
import bmesh
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import temps as T          # noqa: E402
import chutes as C         # noqa: E402

DOMAINE = ((-0.055, -0.055, 0.004), (0.055, 0.055, 0.310))
JET_R, JET_V, JET_Z = 0.0095, 1.8, 0.292        # rayon (m), vitesse initiale (m/s) et hauteur de la bouche du jet
MARGE = 0.97                                    # réglage du volume versé : mesuré, 1,05 remplit 12 mm trop haut à la résolution 128
IMAGE_JET = 264                                 # image où la tête du jet touche la glace : premier temps de la mesure 6
JEU_PAROI = 0.0010                              # la cavité de l'obstacle « verre » déborde dans la paroi réelle : le liquide la recouvre


def volume_a_verser(d, res):
    """Volume de liquide (m3) pour atteindre le niveau de repos, mesuré sur la grille même du solveur : une maille compte
    comme libre si son centre n'est dans aucun obstacle. (À résolution finie les obstacles « en escalier » occupent un peu
    plus de place que les vrais : le volume à verser en tient compte, sinon le verre déborderait.)"""
    (x0, y0, z0), (x1, y1, z1) = DOMAINE
    dx = max(x1 - x0, y1 - y0, z1 - z0) / res
    xs = np.arange(x0 + dx / 2, x1, dx); ys = np.arange(y0 + dx / 2, y1, dx); zs = np.arange(z0 + dx / 2, S.Z0 + S.NIVEAU, dx)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    zz = pts[:, 2] - S.Z0
    r = np.hypot(pts[:, 0], pts[:, 1])
    libre = (r < np.array([S.r_int(v) for v in np.clip(zz, 0, S.H_VERRE)]) + JEU_PAROI) & (zz > S.E_FOND - 0.0008)
    libre &= ~((zz < S.E_FOND + C.SUCRE_H * (1 - (r / C.SUCRE_R) ** 2)) & (r < C.SUCRE_R))
    for k, c in enumerate(d["plan"]):
        if c["genre"] == "feuille":
            continue
        me = C.maillage(c)
        p, q = C.pose(d, k, C.T_FIN)
        rot = np.array(q.to_matrix()); ech = 0.92 if c["genre"] == "glacon" else 1.0
        normales = np.array([pl.normal[:] for pl in me.polygons]) @ rot.T
        centres = (np.array([pl.center[:] for pl in me.polygons]) * ech) @ rot.T + np.array(p)
        bpy.data.meshes.remove(me)
        decal = np.einsum("ij,ij->i", normales, centres)
        proches = np.nonzero(libre & (np.linalg.norm(pts - np.array(p), axis=1) < 0.13))[0]
        for a in range(0, len(proches), 20000):
            idx = proches[a:a + 20000]
            dedans = (pts[idx] @ normales.T - decal).max(1) < 0
            libre[idx[dedans]] = False
    return float(libre.sum() * dx ** 3)


def obstacle(ob):
    m = ob.modifiers.new("fluide", "FLUID"); m.fluid_type = "EFFECTOR"
    e = m.effector_settings
    e.effector_type = "COLLISION"; e.use_plane_init = False; e.surface_distance = 0.0
    return ob


def verre_obstacle():
    """Bloc plein creusé de la cavité du verre (agrandie de JEU_PAROI) : étanche, épais, sans fuite possible."""
    j = JEU_PAROI
    h = S.H_VERRE
    # paroi épaissie de 6 mm vers l'extérieur (une paroi plus mince qu'une maille fuirait), dessus en pente :
    # ce qui gicle par-dessus le bord tombe à l'extérieur au lieu de rester sur une margelle invisible
    profil = [(0.0, S.Z0 + S.E_FOND - 0.0008), (S.r_int(S.E_FOND) + j, S.Z0 + S.E_FOND - 0.0008),
              (S.r_int(h) + j, S.Z0 + h), (S.r_ext(h) + 0.006, S.Z0 + h - 0.006), (S.r_ext(0.0) + 0.006, 0.0), (0.0, 0.0)]
    ob = S.tour("verre_obstacle", profil, segments=96)
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()
    return obstacle(ob)


def point_de_chute(sc):
    """Colonne la plus dégagée au-dessus de la glace, pour que le jet plonge dans le verre au lieu d'éclabousser dehors."""
    dg = bpy.context.evaluated_depsgraph_get()
    meilleur = None
    for r in (0.0, 0.006, 0.012, 0.016):
        for a in np.linspace(0, 2 * np.pi, 12, endpoint=False) if r else (0.0,):
            x, y = r * math.cos(a), r * math.sin(a)
            hauts = []
            for dr in (0.0, JET_R):
                for b in np.linspace(0, 2 * np.pi, 6, endpoint=False) if dr else (0.0,):
                    ok, pos, *_ = sc.ray_cast(dg, Vector((x + dr * math.cos(b), y + dr * math.sin(b), 0.40)), Vector((0, 0, -1)))
                    hauts.append(pos[2] if ok else 0.0)
            # on préfère une colonne basse, vers l'avant gauche du verre (visible de la caméra, loin de la paille)
            note = max(hauts) + 0.15 * math.hypot(x + 0.006, y + 0.010)
            if meilleur is None or note < meilleur[0]:
                meilleur = (note, x, y, max(hauts))
    return meilleur[1], meilleur[2], meilleur[3]


def construire(res, tension, fractions=False, supprime=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = T.IPS
    d = C.charger()
    verre_obstacle()
    tas = C.tas_de_sucre(); obstacle(tas)
    for k, c in enumerate(d["plan"]):
        if c["genre"] == "feuille":
            continue                              # trop minces pour la grille du liquide : elles n'arrêtent pas l'écoulement
        ob = S.lier(f"corps{k}", C.maillage(c))
        p, q = C.pose(d, k, C.T_FIN)
        ob.rotation_mode = "QUATERNION"; ob.location = p; ob.rotation_quaternion = q
        if c["genre"] == "glacon":
            ob.scale = (0.92, 0.92, 0.92)
        obstacle(ob)
    bpy.context.view_layer.update()
    x, y, z_glace = point_de_chute(sc)
    (x0, y0, z0), (x1, y1, z1) = DOMAINE
    dom = S.depuis_bmesh("liquide_sim", lambda bm: bmesh.ops.create_cube(bm, size=1.0), lisse=False)
    dom.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); dom.scale = (x1 - x0, y1 - y0, z1 - z0)
    m = dom.modifiers.new("fluide", "FLUID"); m.fluid_type = "DOMAIN"
    ds = m.domain_settings
    ds.domain_type = "LIQUID"; ds.resolution_max = res; ds.cache_type = "REPLAY"
    ds.use_adaptive_timesteps = True; ds.cfl_condition = 2.0; ds.timesteps_min = 2; ds.timesteps_max = 12
    ds.simulation_method = "FLIP"; ds.flip_ratio = 0.97
    ds.particle_number = 2; ds.particle_radius = 1.0; ds.particle_randomness = 0.1
    ds.use_fractions = fractions; ds.fractions_threshold = 0.05
    ds.delete_in_obstacle = supprime
    for bord in ("front", "back", "right", "left", "top", "bottom"):
        setattr(ds, "use_collision_border_" + bord, False)      # ce qui gicle hors du domaine disparaît
    ds.use_diffusion = tension > 0
    if tension > 0:
        ds.surface_tension = tension
    ds.use_mesh = True; ds.mesh_scale = 2; ds.mesh_generator = "IMPROVED"
    ds.mesh_particle_radius = 1.6; ds.mesh_smoothen_pos = 1; ds.mesh_smoothen_neg = 1
    # le jet : cylindre court en haut du domaine, vitesse initiale vers le bas
    jet = S.depuis_bmesh("jet", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=JET_R, radius2=JET_R, depth=0.014), lisse=False)
    jet.location = (x, y, JET_Z)
    mf = jet.modifiers.new("fluide", "FLUID"); mf.fluid_type = "FLOW"
    fs = mf.flow_settings
    fs.flow_type = "LIQUID"; fs.flow_behavior = "INFLOW"
    fs.use_initial_velocity = True; fs.velocity_coord = (0.0, 0.0, -JET_V); fs.velocity_normal = 0.0; fs.velocity_factor = 0.0
    # horaires : la tête du jet doit toucher la glace à l'image IMAGE_JET
    chute = (-JET_V + math.sqrt(JET_V ** 2 + 2 * 9.81 * (JET_Z - z_glace))) / 9.81
    t_on = T.tau(IMAGE_JET) - chute
    debit = math.pi * JET_R ** 2 * JET_V
    volume = volume_a_verser(d, res)
    t_off = t_on + MARGE * volume / debit
    f_on, f_off = int(math.floor(T.image(t_on))), int(round(T.image(t_off)))
    reglages = dict(res=res, tension=tension, jet=[float(x), float(y), JET_Z], rayon=JET_R, vitesse=JET_V, z_glace=float(z_glace),
                    volume_ml=float(volume * 1e6), debit_ml_s=debit * 1e6, t_on=float(t_on), t_off=float(t_off), f_on=f_on, f_off=f_off)
    return sc, dom, ds, fs, jet, reglages


def simuler(res, tension, images, sortie, fractions=False, supprime=True):
    sc, dom, ds, fs, jet, reg = construire(res, tension, fractions, supprime)
    a, b = images
    debut = min(a, reg["f_on"] - 1)
    # Le solveur ne démarre qu'à l'image 1 de la scène : l'image `debut` du film est l'image 1 de la simulation.
    sc.frame_start, sc.frame_end = 1, b - debut + 1
    ds.cache_frame_start, ds.cache_frame_end = 1, b - debut + 1
    for f in range(debut, b + 1):
        ds.time_scale = T.vitesse(f); dom.keyframe_insert('modifiers["fluide"].domain_settings.time_scale', frame=f - debut + 1)
        fs.use_inflow = reg["f_on"] <= f < reg["f_off"]; jet.keyframe_insert('modifiers["fluide"].flow_settings.use_inflow', frame=f - debut + 1)
        # un filet versé à la main n'est jamais un cylindre parfait : la bouche du jet tremble de 1,5 mm et le débit pulse de 8 %
        t = T.tau(f)
        jx, jy, jz = reg["jet"]
        jet.location = (jx + 0.0015 * math.cos(2 * math.pi * 7.0 * t) + 0.0007 * math.cos(2 * math.pi * 17.0 * t + 1.0),
                        jy + 0.0015 * math.sin(2 * math.pi * 7.0 * t + 0.6) + 0.0007 * math.sin(2 * math.pi * 17.0 * t), jz)
        jet.keyframe_insert("location", frame=f - debut + 1)
        fs.velocity_coord = (0.10 * math.sin(2 * math.pi * 3.1 * t), 0.10 * math.cos(2 * math.pi * 4.3 * t + 0.4),
                             -JET_V * (1.0 + 0.08 * math.sin(2 * math.pi * 5.0 * t)))
        jet.keyframe_insert('modifiers["fluide"].flow_settings.velocity_coord', frame=f - debut + 1)
    reg["debut"] = debut
    os.makedirs(sortie, exist_ok=True)
    json.dump(reg, open(os.path.join(sortie, "reglages.json"), "w"), indent=1)
    print("VERSEMENT réglages : " + json.dumps(reg), flush=True)
    t0 = time.time()
    for f in range(debut, b + 1):
        sc.frame_set(f - debut + 1)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = dom.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        v = np.zeros(n * 3, np.float32); me.vertices.foreach_get("co", v); v = v.reshape(-1, 3)
        me.calc_loop_triangles()
        tri = np.zeros(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("vertices", tri); tri = tri.reshape(-1, 3)
        mw = np.array(ev.matrix_world)
        vw = v @ mw[:3, :3].T + mw[:3, 3]
        ev.to_mesh_clear()
        if n == 8 and len(tri) == 12:                 # pas encore de liquide : Blender renvoie la boîte du domaine
            vw = np.zeros((0, 3), np.float32); tri = np.zeros((0, 3), np.int32)
        np.savez_compressed(os.path.join(sortie, f"f{f:04d}.npz"), v=vw.astype(np.float32), tri=tri)
        haut = float(vw[:, 2].max()) if len(vw) else 0.0; bas = float(vw[:, 2].min()) if len(vw) else 0.0
        print(f"VERSEMENT image {f} : {len(vw)} sommets, z de {bas * 1000:.0f} à {haut * 1000:.0f} mm, vitesse {T.vitesse(f):.2f}, "
              f"{time.time() - t0:.0f} s", flush=True)
    return reg


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=96)
    ap.add_argument("--images", default="258:359")
    ap.add_argument("--tension", type=float, default=0.0)
    ap.add_argument("--out", default="")
    ap.add_argument("--fractions", type=int, default=0, help="obstacles fractionnaires du solveur (ils fuient : laissés éteints)")
    ap.add_argument("--supprime", type=int, default=1, help="supprimer les particules entrées dans un obstacle")
    A = ap.parse_args(argv)
    a, b = (int(v) for v in A.images.split(":"))
    sortie = A.out or os.path.join(S.RACINE, "cache", "mojito", f"versement_r{A.res}")
    simuler(A.res, A.tension, (a, b), sortie, bool(A.fractions), bool(A.supprime))
