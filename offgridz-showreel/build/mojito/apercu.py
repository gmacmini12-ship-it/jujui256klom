"""Aperçu rapide des chutes (corps rigides) : matières d'argile, verre en transparence, quelques échantillons.
Sert à juger le mouvement, pas l'image.

    blender -b -t 2 -P build/mojito/apercu.py -- --images 216:300:4 --out out/mojito/apercu_chutes
"""
import bpy  # doit précéder bmesh et mathutils
import bmesh
import argparse
import os
import sys

from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import temps as T          # noqa: E402
import chutes as C         # noqa: E402

COULEURS = {"quartier": (0.25, 0.55, 0.10), "rondelle": (0.45, 0.70, 0.15), "feuille": (0.05, 0.35, 0.08),
            "glacon": (0.75, 0.85, 0.95), "paille": (0.02, 0.02, 0.02), "brin": (0.05, 0.30, 0.06)}


def argile(nom, couleur, alpha=1.0):
    m = S.materiau(nom, **{"Base Color": (*couleur, 1), "Roughness": 0.6, "Alpha": alpha})
    return m


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", default="216:300:4")
    ap.add_argument("--out", default=os.path.join(S.SORTIE, "apercu_chutes"))
    ap.add_argument("--res", default="240x360")
    ap.add_argument("--spp", type=int, default=12)
    ap.add_argument("--vue", default="face", choices=["face", "dessus"])
    ap.add_argument("--liquide", default="", help="dossier de surfaces de liquide (f####.npz) à montrer")
    A = ap.parse_args(argv)
    a, b, pas = (int(v) for v in A.images.split(":"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = A.spp; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6; sc.cycles.transparent_max_bounces = 8
    larg, haut = (int(v) for v in A.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = larg, haut, 100
    sc.view_settings.view_transform = "Standard"
    monde = bpy.data.worlds.new("gris"); sc.world = monde
    try:
        monde.use_nodes = True
    except Exception:
        pass
    monde.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.55, 0.55, 1)
    verre = S.faire_verre()
    verre.data.materials.clear(); verre.data.materials.append(argile("verre_apercu", (0.9, 0.95, 1.0), 0.10))
    tas = C.tas_de_sucre(); tas.data.materials.append(argile("sucre_apercu", (0.8, 0.4, 0.1)))
    sol = S.depuis_bmesh("sol", lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0),
                         argile("sol_apercu", (0.3, 0.3, 0.3)), lisse=False)
    d = C.charger()
    objets = []
    for k, c in enumerate(d["plan"]):
        ob = S.lier(f"corps{k}", C.maillage(c), argile("apercu_" + c["genre"], COULEURS[c["genre"]]))
        ob.rotation_mode = "QUATERNION"
        objets.append(ob)
    cam = bpy.data.cameras.new("camera"); obc = bpy.data.objects.new("camera", cam)
    sc.collection.objects.link(obc); sc.camera = obc
    cam.sensor_fit = "VERTICAL"; cam.sensor_height = 36.0
    if A.vue == "face":
        cam.lens = 70.0; obc.location = (0.06, -0.60, 0.26); S.viser(obc, (0.0, 0.0, 0.13))
    else:
        cam.lens = 50.0; obc.location = (0.0, -0.02, 0.50); S.viser(obc, (0.0, 0.0, 0.05))
    soleil = bpy.data.lights.new("soleil", "SUN"); soleil.energy = 3.0
    obs = bpy.data.objects.new("soleil", soleil); sc.collection.objects.link(obs); obs.rotation_euler = (0.6, 0.2, 0.4)
    os.makedirs(A.out, exist_ok=True)
    eau = argile("eau_apercu", (0.25, 0.55, 0.95), 0.55)
    liquide = None
    for f in range(a, b + 1, pas):
        t = T.tau(f)
        if A.liquide:
            if liquide is not None:
                me = liquide.data; bpy.data.objects.remove(liquide, do_unlink=True); bpy.data.meshes.remove(me); liquide = None
            chemin = os.path.join(A.liquide, f"f{f:04d}.npz")
            if os.path.exists(chemin):
                import numpy as np
                z = np.load(chemin)
                if len(z["v"]):
                    me = bpy.data.meshes.new("liquide"); me.from_pydata(z["v"].tolist(), [], z["tri"].tolist())
                    liquide = S.lier("liquide", me, eau)
        for k, ob in enumerate(objets):
            p = C.pose(d, k, t)
            ob.hide_render = p is None
            if p is not None:
                ob.location = p[0]; ob.rotation_quaternion = p[1]
        sc.render.filepath = os.path.join(A.out, f"f{f:04d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"APERCU {A.out}", flush=True)
