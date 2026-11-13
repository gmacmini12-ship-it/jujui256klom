"""Séquence 2 — rendu des images 72 à 215 : la dalle s'effondre, l'avalanche contourne les lettres, le filet tombe
vers le verre. De 72 à 167 la caméra est dans l'atelier ; de 168 à 215 elle descend le long du filet jusqu'au verre
(même monde que la séquence du mojito, dont la scène est construite ici aussi).

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -P build/grains/scene.py -- \
        --frames 72:215 --res 1008x1512 --spp 128 --device OPTIX --out out/final/seq2

Lit : out/grains/dalle, out/grains/filet (build/grains/sim.py), cache/grains/lettres.json (build/grains/lettres.py).
"""
import bpy  # doit précéder bmesh et mathutils
import argparse
import json
import os
import sys
import time

from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(os.path.dirname(ICI), "mojito"))
import monde as M          # noqa: E402
import atelier as A        # noqa: E402
import scene as S          # noqa: E402
import anim                # noqa: E402

IMAGE_DESCENTE = 168       # à partir d'ici la caméra suit la trajectoire du bar (build/mojito/anim.py)
IMAGE_SOUS_LE_SOL = 190    # à partir d'ici la caméra regarde le verre d'en haut, sous le sol de l'atelier : la dalle n'est plus vue


def camera_atelier(f, d):
    """Caméra de l'atelier, exprimée dans le repère du bar."""
    sauvegarde = anim.CLES_CAMERA
    anim.CLES_CAMERA = A.CLES_CAMERA
    try:
        i = max(k for k in range(len(A.CLES_CAMERA) - 1) if A.CLES_CAMERA[k][0] <= f)
        pos, cible = anim._hermite(f, i, 1) + d, anim._hermite(f, i, 2) + d
        return pos, cible, anim._hermite(f, i, 3), anim._hermite(f, i, 4), (cible - pos).length
    finally:
        anim.CLES_CAMERA = sauvegarde


def raccorder(d):
    """La trajectoire du bar part de la dernière pose de la caméra de l'atelier : une seule descente, sans saut."""
    f, pos, cible, focale, ouv = A.CLES_CAMERA[-1]
    depart = (IMAGE_DESCENTE, tuple(Vector(pos) + d), tuple(Vector(cible) + d), focale, ouv)
    bascule = (186, (0.0, -0.085, 0.640), (0.0, 0.0, 0.030), 48.0, 5.6)       # la caméra a basculé vers le verre
    anim.CLES_CAMERA = [depart, bascule] + [c for c in anim.CLES_CAMERA if c[0] >= 215]


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="72:215")
    ap.add_argument("--res", default="504x756")
    ap.add_argument("--spp", type=int, default=48)
    ap.add_argument("--device", default="CPU", choices=["CPU", "CUDA", "OPTIX"])
    ap.add_argument("--out", default=os.path.join(S.RACINE, "out", "grains", "rendu"))
    ap.add_argument("--sim", type=int, default=128)
    for nom, defaut in (("ouverture", 8.0), ("barre", 1.3), ("caustiques", 0.0), ("fond", 0.0), ("tente", 1.4), ("aretes", 0.5),
                        ("dessus", 1.25), ("eclat", 1.0), ("force_enseigne", 0.42), ("exposition", 0.0)):
        ap.add_argument("--" + nom, type=float, default=defaut)
    ap.add_argument("--enseigne", default="anton")
    ap.add_argument("--arret", type=float, default=0.0, help="heure (secondes Unix) après laquelle on n'entame plus d'image")
    ap.add_argument("--reprise", type=int, default=0, help="1 : ne pas recalculer les images déjà présentes")
    ap.add_argument("--points", type=int, default=2, help="grains de la dalle. 0 : cristaux instanciés ; 1 : points à facettes simulées ; "
                    "2 : cristaux pour les grains proches et visibles, points pour les autres")
    ap.add_argument("--vue", default="Standard")
    args = ap.parse_args(argv)
    if "," in args.frames or ":" not in args.frames:
        images = [int(v) for v in args.frames.split(",")]
    else:
        m = [int(v) for v in args.frames.split(":")]
        images = list(range(m[0], m[1] + 1, m[2] if len(m) > 2 else 1))
    sans_bar = max(images) < IMAGE_DESCENTE            # plans d'atelier seuls : inutile de construire le bar
    if sans_bar:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        S.regler_rendu(args)
        monde = bpy.data.worlds.new("noir"); bpy.context.scene.world = monde
        try:
            monde.use_nodes = True
        except Exception:
            pass
        monde.node_tree.nodes["Background"].inputs["Color"].default_value = (0.0006, 0.0006, 0.0006, 1)
        bar = None; tas = coeur = coll_bar = None
        cam = S.cadrer(args)
        sucre = None
    else:
        bar = anim.construire(args)                    # le bar d'abord (il repart d'une scène vide)
        tas = bpy.data.objects.get("sucre"); coeur = bpy.data.objects.get("sucre_coeur")
        # tout le bar dans une collection : invisible tant que la caméra est dans l'atelier
        coll_bar = bpy.data.collections.new("bar"); bpy.context.scene.collection.children.link(coll_bar)
        for ob in list(bpy.context.scene.collection.objects):
            if ob.type != "CAMERA":
                bpy.context.scene.collection.objects.unlink(ob); coll_bar.objects.link(ob)
        sucre = bar["sucre"]
        for g in (sucre, bar.get("egares")):           # les grains tombés de l'atelier le traversent : ils restent toujours visibles
            if g is not None:
                coll_bar.objects.unlink(g.ob); bpy.context.scene.collection.objects.link(g.ob)
        cam = bar["cam"]
    d = A.decalage()
    A.faire_sol_et_mur(d)
    lettres = A.faire_lettres(d)
    A.eclairer(d)
    # les grains du filet sont déjà dans la scène du bar (ils y forment le tas de sucre) : on ne les crée pas deux fois
    # la dalle compte un million de grains à l'échelle finale : en points ; le filet et les égarés, peu nombreux, restent des cristaux
    dossier_dalle = os.path.join(A.SIMS, "dalle")
    dalle = A.GrainsMixtes("grains_dalle", dossier_dalle, d) if args.points == 2 else A.Grains("grains_dalle", dossier_dalle, d, points=bool(args.points))
    grains = [] if (bar is not None and bar.get("egares") is not None) else [A.Egares("grains_egares", dossier_dalle, d)]
    if sucre is None:
        grains.append(A.Grains("grains_filet", os.path.join(A.SIMS, "filet"), d))
    if not sans_bar:
        raccorder(d)
    sc = bpy.context.scene
    sc.render.use_persistent_data = True
    sortie = os.path.abspath(args.out)
    os.makedirs(sortie, exist_ok=True)
    chemin_meta = os.path.join(sortie, "meta.json")
    meta = json.load(open(chemin_meta)) if os.path.exists(chemin_meta) else {"images": {}}
    for f in images:
        if args.arret and time.time() > args.arret:
            print(f"GRAINS arrêt avant l'image {f} : délai atteint", flush=True)
            break
        if args.reprise and os.path.exists(os.path.join(sortie, f"f{f:04d}.png")):
            continue
        t0 = time.time()
        if bar is not None:
            anim.poser(bar, f)                          # corps du bar (cachés avant leur lâcher), enseigne, caméra du bar
            for o in (tas, coeur):                      # le tas de sucre du bar n'existe pas encore : il arrive par le filet
                if o:
                    o.hide_render = True
            coll_bar.hide_render = f < IMAGE_DESCENTE
        A.poser_lettres(lettres, f)
        if f < IMAGE_DESCENTE:
            pos, cible, focale, ouv, net = camera_atelier(f, d)
            anim.regarder(cam, pos, cible)
            cam.data.lens = focale; cam.data.dof.aperture_fstop = ouv; cam.data.dof.focus_distance = net
        bpy.context.view_layer.update()                # la caméra de l'image est en place : le niveau de détail en dépend
        libres = [g.poser(f) for g in grains]
        if f >= IMAGE_SOUS_LE_SOL:                     # inutile de charger un million de grains hors champ
            if args.points == 2:
                dalle.cacher(True)
            else:
                dalle.ob.hide_render = True
        else:
            libres.append(dalle.poser(f, cam, sc) if args.points == 2 else dalle.poser(f))
        if sucre is not None:
            libres.append(sucre.poser(f))
        bpy.context.view_layer.update()
        info = {}
        n = sum(v for v in libres if v)
        if n:
            info["n"] = n
        if f < 100:                                     # première tentative du réticule : la dalle
            def px(p):
                c = world_to_camera_view(sc, cam, Vector(p) + d)
                return c.x * 1008.0, (1.0 - c.y) * 1512.0
            cx, cy = px((0.0, M.DALLE_LO[1] / 2, M.DALLE_HI[2] / 2)); hx, hy = px((0.0, M.DALLE_LO[1] / 2, M.DALLE_HI[2]))
            info["cible"] = {"x": cx, "y": cy, "r": 1.08 * ((hx - cx) ** 2 + (hy - cy) ** 2) ** 0.5}
        elif f >= 176:
            cible = anim.cible_reticule(sc, cam, f, 1008.0, 1512.0)
            if cible:
                info["cible"] = cible
        meta["images"][str(f)] = info
        sc.render.filepath = os.path.join(sortie, f"f{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        json.dump(meta, open(chemin_meta, "w"))
        detail = f", cristaux {dalle.n_cristaux}" if args.points == 2 and f < IMAGE_SOUS_LE_SOL else ""
        print(f"GRAINS image {f} : {time.time() - t0:.1f} s, grains libres {n}{detail}", flush=True)
