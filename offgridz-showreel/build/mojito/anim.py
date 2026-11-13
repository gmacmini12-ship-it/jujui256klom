"""Séquence 3 animée — rendu des images 216 à 359 (et du raccord 168 à 215) : chutes simulées, versement simulé,
caméra, lumière. La scène est construite une fois ; à chaque image seuls bougent les corps, le liquide et la caméra.

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -P build/mojito/anim.py -- \
        --frames 216:359 --res 1008x1512 --spp 256 --device OPTIX --out out/final/seq3

Lit : cache/mojito/chutes.npz, cache/mojito/plantes.json, cache/mojito/liquide_r<sim>/f####.npz
(voir chutes.py, plantes.py, versement.py, surface.py). Écrit aussi <out>/meta.json (cible du réticule).

Ce qui est simulé : chutes du citron, des feuilles, de la paille et des glaçons (corps rigides) ; versement (liquide).
Ce qui est animé à la main : la caméra, la mise en place du brin de menthe, l'apparition de la buée et des bulles.
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
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import scene as S          # noqa: E402
import temps as T          # noqa: E402
import chutes as C         # noqa: E402
import plantes as P        # noqa: E402

ROULEMENT_3 = ["bodoni-moda-var", "archivo-var", "anton", "permanent-marker", "saira-stencil-one", "doto-var",
               "major-mono-display", "instrument-serif-italic"]
IMAGE_PAILLE = 336          # début du glissement vers l'ouverture de la paille


def lisse(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3.0 - 2.0 * x)


def caractere_enseigne(f):
    """Roulement typographique n° 3 : un caractère par double-croche pendant la chute des glaçons, arrêt sur l'italique."""
    if f < 240:
        return "anton"
    if f <= 263:
        return ROULEMENT_3[(f - 240) // 3]
    return "instrument-serif-italic"


# --- caméra ---------------------------------------------------------------------------------------------
# (image, position, point visé, focale en mm, ouverture). Courbe lisse passant par toutes les clés.
CLES_CAMERA = [
    (168, (0.000, -0.050, 0.900), (0.000, 0.0, 0.030), 50.0, 5.6),
    (215, (0.000, -0.050, 0.335), (0.000, 0.0, 0.030), 50.0, 5.6),
    (228, (-0.040, -0.330, 0.380), (0.000, 0.0, 0.085), 60.0, 6.3),
    (240, (-0.035, -0.525, 0.228), (-0.004, 0.0, 0.118), 80.0, 8.0),      # décalage latéral réduit : l'enseigne, loin derrière,
    (264, (-0.040, -0.575, 0.205), (-0.002, 0.0, 0.119), 88.0, 8.0),      # sortait du cadre par la gauche entre 240 et 300
    (312, (0.010, -0.660, 0.176), (0.010, 0.0, 0.118), 100.0, 11.0),
    (IMAGE_PAILLE, (0.010, -0.654, 0.176), (0.010, 0.0, 0.118), 100.0, 11.0),
]


def _hermite(f, i, composante):
    """Interpolation d'Hermite de la composante (1 position, 2 cible, 3 focale, 4 ouverture) entre les clés i et i + 1."""
    cles = CLES_CAMERA

    def val(k):
        v = cles[k][composante]
        return Vector(v) if isinstance(v, tuple) else v

    def pente(k):
        a, b = max(k - 1, 0), min(k + 1, len(cles) - 1)
        if cles[b][0] == cles[a][0]:
            return val(k) * 0.0
        return (val(b) - val(a)) / (cles[b][0] - cles[a][0])
    f0, f1 = cles[i][0], cles[i + 1][0]
    h = f1 - f0; u = (f - f0) / h
    h00 = 2 * u ** 3 - 3 * u ** 2 + 1; h10 = u ** 3 - 2 * u ** 2 + u; h01 = -2 * u ** 3 + 3 * u ** 2; h11 = u ** 3 - u ** 2
    return val(i) * h00 + pente(i) * (h10 * h) + val(i + 1) * h01 + pente(i + 1) * (h11 * h)


def camera_a(f, plantes):
    """Position, cible, focale, ouverture et distance de mise au point à l'image f."""
    cles = CLES_CAMERA
    if f <= cles[0][0]:
        pos, cible, focale, ouv = Vector(cles[0][1]), Vector(cles[0][2]), cles[0][3], cles[0][4]
        return pos, cible, focale, ouv, (cible - pos).length
    if f <= IMAGE_PAILLE:
        i = max(k for k in range(len(cles) - 1) if cles[k][0] <= f)
        pos, cible = _hermite(f, i, 1), _hermite(f, i, 2)
        return pos, cible, _hermite(f, i, 3), _hermite(f, i, 4), (cible - pos).length
    # entrée dans la paille : courbe de Bézier du plan héros à l'intérieur du tube, en accélérant
    pied, axe = Vector(plantes["paille"]["pied"]), Vector(plantes["paille"]["axe"])
    haut = pied + axe * plantes["paille"]["longueur"]
    p0, c0 = Vector(cles[-1][1]), Vector(cles[-1][2])
    p1 = p0 + Vector((0.0, 0.14, 0.05))
    p2 = haut + axe * 0.12
    p3 = haut - axe * 0.014
    s = ((f - IMAGE_PAILLE) / (359 - IMAGE_PAILLE)) ** 2.2
    pos = ((1 - s) ** 3) * p0 + 3 * ((1 - s) ** 2) * s * p1 + 3 * (1 - s) * s * s * p2 + (s ** 3) * p3
    cible = c0.lerp(haut - axe * 0.035, lisse(min(1.0, s * 2.4)))
    focale = 100.0 + (30.0 - 100.0) * lisse(s)
    ouv = 11.0 + (5.6 - 11.0) * lisse(s)
    net = max((haut - pos).length, 0.02)
    return pos, cible, focale, ouv, net


def regarder(ob, pos, cible):
    """Oriente la caméra vers la cible. En vue plongeante, le haut de l'image est le fond de la scène (+Y)."""
    avant = (Vector(cible) - Vector(pos)).normalized()
    w = avant.z * avant.z
    haut = (Vector((0, 0, 1)) * (1 - w) + Vector((0, 1, 0)) * w).normalized()
    droite = avant.cross(haut).normalized()
    haut = droite.cross(avant)
    m = Matrix((droite, haut, -avant)).transposed().to_4x4()
    ob.matrix_world = Matrix.Translation(pos) @ m


# --- éléments propres à l'animation ---------------------------------------------------------------------
def faire_tas_de_sucre(graine=5):
    """Le sucre de canne tombé au fond : un cœur opaque et deux couches de cristaux ambrés sur sa surface."""
    rng = np.random.default_rng(graine)
    sucre = S.materiau("sucre", **{"Base Color": (0.80, 0.36, 0.07, 1), "Roughness": 0.25, "Subsurface Weight": 0.5,
                                  "Transmission Weight": 0.35, "IOR": 1.5})
    coeur_mat = S.materiau("sucre_coeur", **{"Base Color": (0.42, 0.17, 0.03, 1), "Roughness": 0.8})
    profil = [(0.0, S.Z0 + S.E_FOND + C.SUCRE_H - 0.0012)]
    for k in range(1, 9):
        u = k / 8
        profil.append(((C.SUCRE_R - 0.0012) * u, S.Z0 + S.E_FOND + 0.0004 + (C.SUCRE_H - 0.0016) * (1 - u * u)))
    profil.append((0.0, S.Z0 + S.E_FOND + 0.0004))
    S.tour("sucre_coeur", profil, segments=48, materiau=coeur_mat)
    k = 9000
    a = rng.uniform(0, 2 * np.pi, k); r = C.SUCRE_R * np.sqrt(rng.random(k)) * 1.04
    couche = rng.integers(0, 2, k) * 0.0005
    haut = np.clip(C.SUCRE_H * (1 - (r / C.SUCRE_R) ** 2), 0.0, None)
    pos = np.stack([r * np.cos(a), r * np.sin(a), S.Z0 + S.E_FOND + 0.0011 + haut - couche + rng.uniform(-0.0002, 0.0002, k)], 1)
    pos = pos[r < S.r_int(S.E_FOND) - 0.0030]; k = len(pos)
    nor = rng.normal(size=(k, 3))
    ech = rng.uniform(0.00026, 0.00050, (k, 1)) * rng.uniform(0.7, 1.3, (k, 3))
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2.0); bmesh.ops.triangulate(bm, faces=bm.faces)
    v = np.array([p.co[:] for p in bm.verts]); fa = np.array([[q.index for q in face.verts] for face in bm.faces]); bm.free()
    ob = S.nuage("sucre", (v, fa), pos, nor, ech, sucre)
    ob.data.polygons.foreach_set("use_smooth", [False] * len(ob.data.polygons))
    return ob


def faire_corps(d):
    """Les corps de la simulation des chutes, avec leurs matières de rendu."""
    objets = []
    for k, c in enumerate(d["plan"]):
        if c["genre"] == "quartier":
            ob = S.faire_quartier(f"quartier{k}")
        elif c["genre"] == "rondelle":
            ob = S.faire_rondelle(f"rondelle{k}")
        elif c["genre"] == "feuille":
            ob = S.faire_feuille(f"feuille{k}", c["longueur"], c["graine"])
        elif c["genre"] == "paille":
            ob = S.faire_paille()
        else:
            ob = S.faire_glacon(f"glacon{k}", S.T_GLACON, 100 + k)
            ob.scale = (0.94, 0.94, 0.94)
        ob.rotation_mode = "QUATERNION"
        objets.append(ob)
    return objets


def poser_corps(d, objets, f):
    t = T.tau(f)
    for k, ob in enumerate(objets):
        p = C.pose(d, k, t)
        cache = p is None
        for o in [ob] + list(ob.children):
            o.hide_render = cache
        if p is not None:
            ob.location = p[0]; ob.rotation_quaternion = p[1]


class Brin:
    """Le brin de menthe : construit en place, puis reculé le long de son axe tant qu'il n'est pas planté."""

    def __init__(self, plantes):
        b = plantes["brin"]
        avant = set(bpy.data.objects)
        S.faire_brin("brin", tuple(b["pied"]), (b["sortie"][0], b["sortie"][1]), 7)
        self.objets = [o for o in bpy.data.objects if o not in avant]
        bpy.context.view_layer.update()
        self.bases = [o.matrix_world.copy() for o in self.objets]
        for o in self.objets:
            o.parent = None
        self.axe = (Vector(b["sortie"]) - Vector(b["pied"])).normalized()
        self.plantes = plantes

    def poser(self, f):
        recul = P.decalage("brin", f, self.plantes)
        for o, base in zip(self.objets, self.bases):
            o.hide_render = recul is None
            if recul is not None:
                o.matrix_world = Matrix.Translation(self.axe * recul) @ base


class Liquide:
    """Surface du liquide, relue image par image dans le cache."""

    def __init__(self, dossier):
        self.dossier = dossier
        self.ob = None
        tmp = S.faire_liquide(); self.mat = tmp.data.materials[0]
        me = tmp.data; bpy.data.objects.remove(tmp, do_unlink=True); bpy.data.meshes.remove(me)

    def poser(self, f):
        if self.ob is not None:
            me = self.ob.data; bpy.data.objects.remove(self.ob, do_unlink=True); bpy.data.meshes.remove(me); self.ob = None
        chemin = os.path.join(self.dossier, f"f{f:04d}.npz")
        if not os.path.exists(chemin):
            return False
        z = np.load(chemin)
        if len(z["v"]) == 0:
            return False
        # Maillage rempli par tableaux entiers : en résolution finale la surface compte un million de faces, et la
        # construire face par face prendrait plusieurs secondes par image sur l'unique cœur de la machine louée.
        v = np.ascontiguousarray(z["v"], np.float32)
        quads = np.ascontiguousarray(z["quads"], np.int32).reshape(-1, 4); tri = np.ascontiguousarray(z["tri"], np.int32).reshape(-1, 3)
        nq, nt = len(quads), len(tri)
        me = bpy.data.meshes.new("liquide")
        me.vertices.add(len(v)); me.vertices.foreach_set("co", v.ravel())
        me.loops.add(4 * nq + 3 * nt)
        me.loops.foreach_set("vertex_index", np.concatenate([quads.ravel(), tri.ravel()]))
        me.polygons.add(nq + nt)
        me.polygons.foreach_set("loop_start", np.concatenate([4 * np.arange(nq, dtype=np.int32), 4 * nq + 3 * np.arange(nt, dtype=np.int32)]))
        me.polygons.foreach_set("loop_total", np.concatenate([np.full(nq, 4, np.int32), np.full(nt, 3, np.int32)]))
        me.update(calc_edges=True)
        self.ob = S.lier("liquide", me, self.mat)
        self.ob.cycles.is_caustics_caster = True
        return True


def apparition(ob):
    """Ajoute à la matière de l'objet un fondu vers le transparent, piloté par la valeur renvoyée (0 invisible, 1 présent)."""
    mat = ob.data.materials[0]
    nt = mat.node_tree
    sortie = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    lien = sortie.inputs["Surface"].links[0]
    source = lien.from_socket
    vide = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
    valeur = nt.nodes.new("ShaderNodeValue"); valeur.outputs[0].default_value = 1.0
    nt.links.remove(lien)
    nt.links.new(valeur.outputs[0], mix.inputs["Fac"])
    nt.links.new(vide.outputs["BSDF"], mix.inputs[1]); nt.links.new(source, mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], sortie.inputs["Surface"])
    return valeur.outputs[0]


class Enseigne:
    def __init__(self):
        mat = bpy.data.materials.get("enseigne")
        self.tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE") if mat else None
        self.images = {}

    def poser(self, f):
        if self.tex is None:
            return
        nom = caractere_enseigne(f)
        if nom not in self.images:
            self.images[nom] = bpy.data.images.load(os.path.join(S.SORTIE, "enseigne", nom + ".png"))
        self.tex.image = self.images[nom]


def cible_reticule(sc, cam, f, larg, haut):
    """Cercle que le réticule doit épouser, en pixels de la fenêtre : le bord du verre vu de dessus, puis le verre entier."""
    def px(p):
        c = world_to_camera_view(sc, cam, Vector(p))
        return c.x * larg, (1.0 - c.y) * haut
    if 160 <= f <= 222:
        cx, cy = px((0, 0, S.Z0 + S.H_VERRE))
        bx, by = px((S.R_HAUT, 0, S.Z0 + S.H_VERRE))
        return {"x": cx, "y": cy, "r": math.hypot(bx - cx, by - cy)}
    if 306 <= f <= 348:
        cx, cy = px((0, 0, S.Z0 + S.H_VERRE * 0.5))
        tx, ty = px((0, 0, S.Z0 + S.H_VERRE))
        return {"x": cx, "y": cy, "r": 1.22 * math.hypot(tx - cx, ty - cy)}
    return None


def construire(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S.regler_rendu(args)
    S.faire_comptoir(); S.faire_sous_verre(); S.faire_verre()
    faire_tas_de_sucre()
    d = C.charger()
    plantes = P.charger()
    objets = faire_corps(d)
    brin = Brin(plantes)
    glacons = []
    for k, c in enumerate(d["plan"]):                       # bulles accrochées : positions des glaçons au repos
        if c["genre"] == "glacon":
            class Repos:
                location = Vector(d["loc"][-1, k])
            glacons.append(Repos)
    bulles = S.faire_bulles(glacons); buee = S.faire_buee()
    fondus = {"bulles": apparition(bulles), "buee": apparition(buee)}
    S.eclairer(args)
    # Les sources qui dessinent le verre n'éclairent pas le comptoir : vues d'en haut, leurs reflets y feraient des taches blanches.
    comptoir = bpy.data.objects.get("comptoir")
    if comptoir:
        exclus = bpy.data.collections.new("hors_lumieres_du_verre")
        exclus.objects.link(comptoir)
        exclus.collection_objects[0].light_linking.link_state = "EXCLUDE"
        for nom in ("dessus", "arete_gauche", "arete_droite", "eclat"):      # ces sources dessinent le verre, pas le comptoir
            lum = bpy.data.objects.get(nom)
            if lum:
                lum.light_linking.receiver_collection = exclus
    cam = S.cadrer(args)
    liquide = Liquide(os.path.join(S.RACINE, "cache", "mojito", f"liquide_r{args.sim}"))
    # le sucre : si la simulation du filet existe, ce sont ses grains, tombés de l'atelier, qui forment le tas au fond du verre
    sucre = None
    filet = os.path.join(S.RACINE, "out", "grains", "filet")
    if os.path.exists(os.path.join(filet, "run.json")):
        sys.path.insert(0, os.path.join(os.path.dirname(ICI), "grains"))
        import atelier as A
        sucre = A.Grains("grains_filet", filet, A.decalage())
        for nom in ("sucre", "sucre_coeur"):
            bpy.data.objects[nom].hide_render = True
    # Les grains tombés du bord avant de l'atelier ne sont pas rendus (décision du 13 novembre : tout le sucre visible
    # dans le bar passe par le bec et finit dans le verre). L'option --egares 1 les remet, posés sur le comptoir.
    egares = None
    dalle = os.path.join(S.RACINE, "out", "grains", "dalle")
    if getattr(args, "egares", 0) and sucre is not None and os.path.exists(os.path.join(dalle, "exits.npz")):
        egares = A.Egares("grains_egares", dalle, A.decalage())
    return dict(d=d, plantes=plantes, objets=objets, brin=brin, fondus=fondus, cam=cam, liquide=liquide, enseigne=Enseigne(), sucre=sucre,
                egares=egares)


def poser(scene, f):
    poser_corps(scene["d"], scene["objets"], f)
    scene["brin"].poser(f)
    a_du_liquide = scene["liquide"].poser(f)
    scene["enseigne"].poser(f)
    if scene["sucre"] is not None:
        scene["sucre"].poser(f)
    if scene.get("egares") is not None:
        scene["egares"].poser(f)
    scene["fondus"]["buee"].default_value = lisse((f - 246) / 60.0)        # la buée se forme dès que la glace arrive
    scene["fondus"]["bulles"].default_value = lisse((f - 298) / 16.0) if a_du_liquide else 0.0
    cam = scene["cam"]
    pos, cible, focale, ouv, net = camera_a(f, scene["plantes"])
    regarder(cam, pos, cible)
    cam.data.lens = focale
    cam.data.dof.use_dof = True; cam.data.dof.aperture_fstop = ouv; cam.data.dof.focus_distance = net
    return a_du_liquide


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="216:359", help="a:b ou a:b:pas, ou liste séparée par des virgules")
    ap.add_argument("--res", default="504x756")
    ap.add_argument("--spp", type=int, default=64)
    ap.add_argument("--device", default="CPU", choices=["CPU", "CUDA", "OPTIX"])
    ap.add_argument("--out", default=os.path.join(S.SORTIE, "anim"))
    ap.add_argument("--sim", type=int, default=128, help="résolution de la simulation de liquide à lire")
    ap.add_argument("--ouverture", type=float, default=11.0)
    ap.add_argument("--barre", type=float, default=1.3)
    ap.add_argument("--caustiques", type=float, default=0.0)
    ap.add_argument("--fond", type=float, default=0.0)
    ap.add_argument("--tente", type=float, default=1.4)
    ap.add_argument("--aretes", type=float, default=0.5)
    ap.add_argument("--dessus", type=float, default=1.25)
    ap.add_argument("--eclat", type=float, default=1.0)
    ap.add_argument("--enseigne", default="instrument-serif-italic")
    ap.add_argument("--force_enseigne", type=float, default=0.42)
    ap.add_argument("--vue", default="Standard")
    ap.add_argument("--exposition", type=float, default=0.0)
    ap.add_argument("--egares", type=int, default=0, help="1 : montrer sur le comptoir les grains tombés du bord de l'atelier")
    ap.add_argument("--arret", type=float, default=0.0, help="heure (secondes Unix) après laquelle on n'entame plus d'image")
    ap.add_argument("--reprise", type=int, default=0, help="1 : ne pas recalculer les images déjà présentes")
    A = ap.parse_args(argv)
    if "," in A.frames or ":" not in A.frames:
        images = [int(v) for v in A.frames.split(",")]
    else:
        morceaux = [int(v) for v in A.frames.split(":")]
        images = list(range(morceaux[0], morceaux[1] + 1, morceaux[2] if len(morceaux) > 2 else 1))
    scene = construire(A)
    sc = bpy.context.scene
    sc.render.use_persistent_data = True
    larg, haut = (int(v) for v in A.res.split("x"))
    sortie = os.path.abspath(A.out)
    os.makedirs(sortie, exist_ok=True)
    chemin_meta = os.path.join(sortie, "meta.json")
    meta = json.load(open(chemin_meta)) if os.path.exists(chemin_meta) else {"images": {}}
    for f in images:
        if A.arret and time.time() > A.arret:
            print(f"ANIM arrêt avant l'image {f} : délai atteint", flush=True)
            break
        if A.reprise and os.path.exists(os.path.join(sortie, f"f{f:04d}.png")):
            continue
        t0 = time.time()
        a_du_liquide = poser(scene, f)
        bpy.context.view_layer.update()
        cible = cible_reticule(sc, scene["cam"], f, 1008.0, 1512.0)
        meta["images"][str(f)] = {"cible": cible} if cible else {}
        sc.render.filepath = os.path.join(sortie, f"f{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        json.dump(meta, open(chemin_meta, "w"))
        print(f"ANIM image {f} : {time.time() - t0:.1f} s, liquide {'oui' if a_du_liquide else 'non'}", flush=True)
