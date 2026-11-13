"""Séquence 3 — le mojito. Scène Blender entièrement procédurale (aucun modèle ni texture externes).

À lancer avec la version officielle de Blender (son solveur de liquide fonctionne, celui du module pip non) :

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -P build/mojito/scene.py -- \
        --res 504x756 --spp 96 --out out/mojito/lookdev.png

Unités : mètres. Le verre est centré sur l'origine, posé sur son sous-verre ; le comptoir est le plan z = 0.
La caméra regarde vers +Y ; la barre lumineuse orange (la bande du logo devenue lumière) est derrière le verre.
"""
import bpy  # doit précéder bmesh et mathutils
import bmesh
import argparse
import json
import math
import os
import random
import sys

import numpy as np
from mathutils import Euler, Matrix, Vector

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SORTIE = os.path.join(RACINE, "out", "mojito")

# --- palette du film (sRGB) -----------------------------------------------------------------------
CREME = (0.933, 0.875, 0.824)
ORANGE = (0.918, 0.278, 0.059)


def lin(c):
    """sRGB (0-1) vers linéaire, pour les couleurs de matériaux et de lumières."""
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


# --- dimensions (mètres) --------------------------------------------------------------------------
SOUS_VERRE = 0.003              # épaisseur du sous-verre
Z0 = SOUS_VERRE                 # dessous du verre
H_VERRE = 0.143                 # hauteur du verre
R_BAS, R_HAUT = 0.0340, 0.0385  # rayons extérieurs
E_PAROI = 0.0022                # épaisseur de paroi
E_FOND = 0.012                  # épaisseur du fond
NIVEAU = 0.121                  # hauteur du liquide au repos (depuis le dessous du verre)
TROUBLE = 3.0                   # densité de diffusion du liquide (0 = parfaitement limpide)
T_GLACON = 0.025                # côté d'un glaçon
R_CITRON = (0.023, 0.023, 0.027)  # demi-axes du citron vert


def r_ext(z):
    return R_BAS + (R_HAUT - R_BAS) * z / H_VERRE


def r_int(z):
    return r_ext(z) - E_PAROI


# --- outils ---------------------------------------------------------------------------------------
def lier(nom, mesh, materiau=None, lisse=True):
    if lisse:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    ob = bpy.data.objects.new(nom, mesh)
    bpy.context.scene.collection.objects.link(ob)
    if materiau:
        mesh.materials.append(materiau)
    return ob


def tour(nom, profil, segments=192, materiau=None):
    """Surface de révolution autour de Z à partir d'un profil (rayon, hauteur)."""
    verts, faces, m = [], [], len(profil)
    for i in range(segments):
        a = 2 * math.pi * i / segments
        c, s = math.cos(a), math.sin(a)
        for r, z in profil:
            verts.append((r * c, r * s, z))
    for i in range(segments):
        j = (i + 1) % segments
        for k in range(m - 1):
            faces.append((i * m + k, j * m + k, j * m + k + 1, i * m + k + 1))
    me = bpy.data.meshes.new(nom)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return lier(nom, me, materiau)


def depuis_bmesh(nom, construire, materiau=None, lisse=True):
    bm = bmesh.new(); construire(bm)
    me = bpy.data.meshes.new(nom); bm.to_mesh(me); bm.free()
    return lier(nom, me, materiau, lisse)


def materiau(nom, **entrees):
    m = bpy.data.materials.new(nom)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    for k, v in entrees.items():
        b.inputs[k].default_value = v
    return m


def bruit_relief(mat, echelle, force, detail=2.0, distance=0.0005):
    """Relief procédural branché sur la normale du Principled."""
    nt = mat.node_tree
    b = nt.nodes.get("Principled BSDF")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = echelle
    tex.inputs["Detail"].default_value = detail
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = force
    bump.inputs["Distance"].default_value = distance
    nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])


def image_depuis(nom, tableau, couleur=True):
    """Tableau numpy (h, w, 4) linéaire vers image Blender."""
    h, w = tableau.shape[:2]
    img = bpy.data.images.new(nom, w, h, alpha=True, float_buffer=True)
    img.pixels.foreach_set(np.ascontiguousarray(tableau[::-1], dtype=np.float32).ravel())
    if not couleur:
        img.colorspace_settings.name = "Non-Color"
    img.pack()
    return img


def viser(ob, cible):
    ob.rotation_euler = (Vector(cible) - ob.location).to_track_quat("-Z", "Y").to_euler()


def proto_sphere(subdivisions=1):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    v = np.array([p.co[:] for p in bm.verts], dtype=np.float64)
    f = np.array([[q.index for q in face.verts] for face in bm.faces], dtype=np.int64)
    bm.free()
    return v, f


def nuage(nom, proto, positions, normales, echelles, mat):
    """Fusionne K copies d'un petit maillage en un seul objet. echelles : (tangente, tangente, normale)."""
    pv, pf = proto
    positions = np.asarray(positions, dtype=np.float64); k = len(positions)
    n = np.asarray(normales, dtype=np.float64); n /= np.linalg.norm(n, axis=1, keepdims=True)
    ref = np.where(np.abs(n[:, 2:3]) < 0.9, np.array([[0.0, 0.0, 1.0]]), np.array([[1.0, 0.0, 0.0]]))
    t1 = np.cross(n, ref); t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(n, t1)
    loc = pv[None] * np.asarray(echelles, dtype=np.float64)[:, None, :]
    monde = loc[:, :, 0:1] * t1[:, None] + loc[:, :, 1:2] * t2[:, None] + loc[:, :, 2:3] * n[:, None] + positions[:, None]
    faces = pf[None] + (np.arange(k) * len(pv))[:, None, None]
    me = bpy.data.meshes.new(nom)
    me.from_pydata(monde.reshape(-1, 3).tolist(), [], faces.reshape(-1, pf.shape[1]).tolist())
    return lier(nom, me, mat)


# --- le verre est une limite physique ---------------------------------------------------------------
JEU = 0.0006                    # distance minimale entre un objet et le verre


def depassement(points):
    """Pour des points (N, 3) en repère monde : de combien chacun traverse la paroi intérieure ou le fond du verre.
    Valeur positive = le point est dans le verre (matière) ou au-delà. Les points au-dessus du bord sont libres."""
    z = points[:, 2] - Z0
    r = np.hypot(points[:, 0], points[:, 1])
    sous_le_bord = z < H_VERRE
    paroi = np.where(sous_le_bord, r - (r_int(np.clip(z, 0.0, H_VERRE)) - JEU), -1.0)
    fond = np.where(sous_le_bord, (E_FOND + JEU) - z, -1.0)
    return paroi, fond


def contenir_pose(sommets, origine, rot, iterations=200):
    """Déplace une pose rigide (origine, rotation) jusqu'à ce que tous ses sommets soient à l'intérieur du verre."""
    origine = np.array(origine, dtype=np.float64); R = np.array(rot)
    for _ in range(iterations):
        monde = sommets @ R.T + origine
        paroi, fond = depassement(monde)
        i, j = int(np.argmax(paroi)), int(np.argmax(fond))
        if paroi[i] <= 0 and fond[j] <= 0:
            return Vector(origine)
        if fond[j] > 0:
            origine[2] += fond[j] + 1e-5
        if paroi[i] > 0:
            d = monde[i, :2] / max(np.hypot(*monde[i, :2]), 1e-9)
            origine[:2] -= d * (paroi[i] + 1e-5)
    raise RuntimeError("contenir_pose : impossible de faire tenir l'objet dans le verre")


def sommets_de(mesh):
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float64); mesh.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def figer(ob):
    """Applique la transformation monde de l'objet à ses sommets et le détache de son parent."""
    bpy.context.view_layer.update()
    M = np.array(ob.matrix_world)
    monde = sommets_de(ob.data) @ M[:3, :3].T + M[:3, 3]
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    return monde


def plaquer_dans_le_verre(ob):
    """Feuille souple à l'intérieur du verre : chaque sommet est ramené en deçà de la paroi et au-dessus du fond."""
    monde = figer(ob)
    paroi, fond = depassement(monde)
    r = np.hypot(monde[:, 0], monde[:, 1])
    k = np.where(paroi > 0, (r - paroi) / np.maximum(r, 1e-9), 1.0)
    monde[:, 0] *= k; monde[:, 1] *= k
    monde[:, 2] += np.maximum(fond, 0.0)
    ob.data.vertices.foreach_set("co", monde.ravel()); ob.data.update()


def poser_sur_le_bord(ob):
    """Feuille d'un brin qui sort du verre : rien ne pend à l'extérieur sous le niveau du bord (elle repose dessus),
    et rien ne traverse la paroi."""
    monde = figer(ob)
    z = monde[:, 2] - Z0
    r = np.hypot(monde[:, 0], monde[:, 1])
    dehors = r > r_int(H_VERRE) - 0.0015
    haut = H_VERRE + 0.0014
    monde[:, 2] = np.where(dehors & (z < haut), Z0 + haut + 0.25 * (haut - z), monde[:, 2])
    ob.data.vertices.foreach_set("co", monde.ravel()); ob.data.update()


def verifier_limites():
    """Contrôle final : aucun objet ne traverse le verre. Lève une erreur sinon."""
    exclus = {"verre", "liquide", "comptoir", "sous_verre", "buee", "enseigne", "barre_orange", "carton_fond", "camera"}
    dg = bpy.context.evaluated_depsgraph_get()
    fautes = []
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or ob.name in exclus:
            continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh()
        M = np.array(ev.matrix_world)
        monde = sommets_de(me) @ M[:3, :3].T + M[:3, 3]
        ev.to_mesh_clear()
        z = monde[:, 2] - Z0; r = np.hypot(monde[:, 0], monde[:, 1])
        dans = (z > 0) & (z < H_VERRE)
        zc = np.clip(z, 0.0, H_VERRE)
        mur = dans & (r > r_int(zc) - 0.00005) & (r < r_ext(zc) + 0.00005)
        socle = (z > 0) & (z < E_FOND - 0.00005) & (r < r_ext(zc))
        n = int(mur.sum() + socle.sum())
        if n:
            prof = float(np.max(np.where(mur, r - r_int(zc), 0.0))) if mur.any() else 0.0
            fautes.append(f"{ob.name} : {n} sommets dans le verre (jusqu'à {prof * 1000:.2f} mm dans la paroi)")
    if fautes:
        raise RuntimeError("LIMITES : des objets traversent le verre\n  " + "\n  ".join(fautes))
    print("LIMITES : aucun objet ne traverse le verre", flush=True)


# --- verre, liquide, décor ------------------------------------------------------------------------
def faire_verre():
    verre = materiau("verre", **{"Transmission Weight": 1.0, "IOR": 1.5, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    h = H_VERRE
    profil = [
        (0.0, Z0), (R_BAS - 0.0015, Z0), (R_BAS, Z0 + 0.0015),
        (r_ext(h - 0.0008), Z0 + h - 0.0008), (r_ext(h) - 0.0004, Z0 + h),
        (r_ext(h) - 0.0011, Z0 + h + 0.0003), (r_int(h) + 0.0003, Z0 + h - 0.0002),
        (r_int(h - 0.001), Z0 + h - 0.0012),
        (r_int(E_FOND + 0.004), Z0 + E_FOND + 0.004), (r_int(E_FOND) - 0.0022, Z0 + E_FOND + 0.0008),
        (0.0, Z0 + E_FOND),
    ]
    ob = tour("verre", profil, materiau=verre)
    ob.cycles.is_caustics_caster = True
    return ob


def faire_liquide(niveau=NIVEAU):
    """Liquide au repos, avec ménisque. Teinte : claire en haut, ambrée au fond (le sucre dissous)."""
    liquide = materiau("liquide", **{"Transmission Weight": 1.0, "IOR": 1.336, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    nt = liquide.node_tree
    sortie = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    coord = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    plage = nt.nodes.new("ShaderNodeMapRange")
    plage.inputs["From Min"].default_value = Z0 + E_FOND; plage.inputs["From Max"].default_value = Z0 + E_FOND + 0.045
    melange = nt.nodes.new("ShaderNodeMix"); melange.data_type = "RGBA"
    melange.inputs["A"].default_value = (0.98, 0.56, 0.16, 1)     # ambre du sucre de canne
    melange.inputs["B"].default_value = (0.90, 0.95, 0.82, 1)     # citron vert très dilué
    dens = nt.nodes.new("ShaderNodeMapRange")
    dens.inputs["To Min"].default_value = 26.0; dens.inputs["To Max"].default_value = 5.0
    va = nt.nodes.new("ShaderNodeVolumeAbsorption")
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], plage.inputs["Value"])
    nt.links.new(plage.outputs["Result"], melange.inputs["Factor"])
    nt.links.new(plage.outputs["Result"], dens.inputs["Value"])
    nt.links.new(melange.outputs["Result"], va.inputs["Color"])
    nt.links.new(dens.outputs["Result"], va.inputs["Density"])
    trouble = nt.nodes.new("ShaderNodeVolumeScatter")
    trouble.inputs["Color"].default_value = (0.96, 1.0, 0.90, 1); trouble.inputs["Density"].default_value = TROUBLE
    trouble.inputs["Anisotropy"].default_value = 0.75
    somme = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(va.outputs["Volume"], somme.inputs[0]); nt.links.new(trouble.outputs["Volume"], somme.inputs[1])
    nt.links.new(somme.outputs["Shader"], sortie.inputs["Volume"])
    j = 0.00018  # léger recouvrement dans la paroi : pas de lame d'air entre verre et liquide
    zn = Z0 + niveau
    rw = r_int(niveau) + j
    profil = [
        (0.0, Z0 + E_FOND - 0.0001), (r_int(E_FOND) - 0.0022 + j, Z0 + E_FOND + 0.0007),
        (r_int(E_FOND + 0.004) + j, Z0 + E_FOND + 0.004),
        (rw, zn + 0.0011), (rw - 0.0009, zn + 0.0004), (rw - 0.0030, zn + 0.00005),
        (0.0, zn),
    ]
    ob = tour("liquide", profil, materiau=liquide)
    ob.cycles.is_caustics_caster = True
    return ob


def faire_comptoir():
    laque = materiau("laque", **{"Base Color": (0.006, 0.006, 0.006, 1), "Roughness": 0.07, "Coat Weight": 1.0, "Coat Roughness": 0.03})
    nt = laque.node_tree
    b = nt.nodes.get("Principled BSDF")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    map_ = nt.nodes.new("ShaderNodeMapping"); map_.inputs["Scale"].default_value = (3.0, 90.0, 1.0)
    bruit = nt.nodes.new("ShaderNodeTexNoise"); bruit.inputs["Scale"].default_value = 6.0; bruit.inputs["Detail"].default_value = 6.0
    rampe = nt.nodes.new("ShaderNodeMapRange")
    rampe.inputs["From Min"].default_value = 0.35; rampe.inputs["From Max"].default_value = 0.75
    rampe.inputs["To Min"].default_value = 0.05; rampe.inputs["To Max"].default_value = 0.17
    nt.links.new(coord.outputs["Object"], map_.inputs["Vector"])
    nt.links.new(map_.outputs["Vector"], bruit.inputs["Vector"])
    nt.links.new(bruit.outputs["Fac"], rampe.inputs["Value"])
    nt.links.new(rampe.outputs["Result"], b.inputs["Roughness"])

    def plan(bm):
        for x, y in ((-1.2, -1.0), (1.2, -1.0), (1.2, 0.50), (-1.2, 0.50)):
            bm.verts.new((x, y, 0.0))
        bm.verts.ensure_lookup_table(); bm.faces.new(bm.verts)
    ob = depuis_bmesh("comptoir", plan, laque, lisse=False)
    ob.cycles.is_caustics_receiver = True
    return ob


def faire_sous_verre():
    carton = materiau("sous_verre", **{"Base Color": (*lin((0.085, 0.08, 0.075)), 1), "Roughness": 0.9})
    ob = depuis_bmesh("sous_verre", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=128, radius1=0.047,
                                                                    radius2=0.047, depth=SOUS_VERRE), carton, lisse=False)
    ob.location = (0, 0, SOUS_VERRE / 2)
    ob.cycles.is_caustics_receiver = True
    return ob


def faire_paille():
    noir = materiau("paille", **{"Base Color": (0.004, 0.004, 0.004, 1), "Roughness": 0.2, "Coat Weight": 0.7, "Coat Roughness": 0.06})
    ob = depuis_bmesh("paille", lambda bm: bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=0.0031,
                                                                radius2=0.0031, depth=0.215), noir)
    ep = ob.modifiers.new("epaisseur", "SOLIDIFY"); ep.thickness = 0.00035; ep.offset = -1
    return ob


# --- glace ----------------------------------------------------------------------------------------
def faire_glacon(nom, taille, graine):
    """Glaçon : cube arrondi irrégulier, cœur givré à l'intérieur."""
    rnd = random.Random(graine)
    glace = bpy.data.materials.get("glace")
    if glace is None:
        glace = materiau("glace", **{"Transmission Weight": 1.0, "IOR": 1.31, "Roughness": 0.008, "Base Color": (1, 1, 1, 1)})
        bruit_relief(glace, 60.0, 0.06, detail=2.0, distance=0.0004)
    givre = bpy.data.materials.get("givre") or materiau(
        "givre", **{"Transmission Weight": 0.9, "IOR": 1.31, "Roughness": 0.38, "Base Color": (0.98, 0.99, 1.0, 1),
                    "Subsurface Weight": 0.15})
    ob = depuis_bmesh(nom, lambda bm: bmesh.ops.create_cube(bm, size=taille), glace)
    bev = ob.modifiers.new("arrondi", "BEVEL"); bev.width = taille * 0.11; bev.segments = 4
    sub = ob.modifiers.new("sub", "SUBSURF"); sub.levels = 2; sub.render_levels = 2
    tex = bpy.data.textures.new(nom + "_fonte", "CLOUDS"); tex.noise_scale = taille * 0.8
    dis = ob.modifiers.new("fonte", "DISPLACE"); dis.texture = tex; dis.strength = taille * 0.045
    dis.texture_coords = "OBJECT"
    ob.cycles.is_caustics_caster = True
    # voile laiteux discret au centre
    coeur = depuis_bmesh(nom + "_coeur", lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=3, radius=taille * 0.19), givre)
    tex2 = bpy.data.textures.new(nom + "_coeur", "CLOUDS"); tex2.noise_scale = taille * 0.3
    d2 = coeur.modifiers.new("irregulier", "DISPLACE"); d2.texture = tex2; d2.strength = taille * 0.22
    coeur.scale = (rnd.uniform(0.8, 1.25), rnd.uniform(0.8, 1.25), rnd.uniform(0.9, 1.6))
    coeur.parent = ob
    # traînée de microbulles d'air emprisonnées, comme dans la vraie glace
    rng = np.random.default_rng(graine)
    axe = rng.normal(size=3); axe /= np.linalg.norm(axe)
    k = 260
    pos = rng.normal(0, 0.17, (k, 1)) * axe[None] * taille + rng.normal(0, 0.065, (k, 3)) * taille
    pos = pos[np.abs(pos).max(1) < taille * 0.36]
    micro = bpy.data.materials.get("microbulle") or materiau("microbulle", **{"Transmission Weight": 1.0, "IOR": 0.76, "Roughness": 0.0})
    rayons = rng.uniform(0.00007, 0.00024, (len(pos), 1))
    bulles = nuage(nom + "_microbulles", proto_sphere(1), pos, np.tile([[0.0, 0.0, 1.0]], (len(pos), 1)), np.repeat(rayons, 3, 1), micro)
    bulles.parent = ob
    # plan de fracture : une lame givrée qui accroche la lumière
    fracture = bpy.data.materials.get("fracture") or materiau(
        "fracture", **{"Transmission Weight": 1.0, "IOR": 1.31, "Roughness": 0.28, "Base Color": (1, 1, 1, 1)})

    def lame(bm):
        bmesh.ops.create_grid(bm, x_segments=6, y_segments=6, size=taille * 0.36)
    fr = depuis_bmesh(nom + "_fracture", lame, fracture)
    tex3 = bpy.data.textures.new(nom + "_fracture", "CLOUDS"); tex3.noise_scale = taille * 0.5
    d3 = fr.modifiers.new("gauchie", "DISPLACE"); d3.texture = tex3; d3.strength = taille * 0.10
    fr.rotation_euler = Euler((rnd.uniform(0, 3.1), rnd.uniform(0, 3.1), rnd.uniform(0, 3.1)))
    fr.location = (rnd.uniform(-1, 1) * taille * 0.08, rnd.uniform(-1, 1) * taille * 0.08, rnd.uniform(-1, 1) * taille * 0.08)
    fr.parent = ob
    return ob


# --- citron vert ----------------------------------------------------------------------------------
def maillage_quartier(angle=math.radians(52)):
    """Quartier de citron vert : secteur d'ellipsoïde autour de son axe (Z local), faces de coupe subdivisées."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=72, v_segments=36, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * R_CITRON[0], v.co.y * R_CITRON[1], v.co.z * R_CITRON[2]))
    for signe in (1, -1):
        a = signe * angle / 2
        normale = Vector((-math.sin(a), math.cos(a), 0.0)) * signe      # garde le secteur compris entre les deux plans
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=(0, 0, 0), plane_no=normale, clear_outer=True)
        bord = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        bmesh.ops.holes_fill(bm, edges=bord)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    coupes = [f for f in bm.faces if abs(f.normal.z) < 0.2 and len(f.verts) > 8]
    for f in coupes:
        f.material_index = 1
    tri = bmesh.ops.triangulate(bm, faces=coupes)["faces"]
    aretes = list({e for f in tri for e in f.edges})
    bmesh.ops.subdivide_edges(bm, edges=aretes, cuts=3, use_grid_fill=True)
    me = bpy.data.meshes.new("quartier"); bm.to_mesh(me); bm.free()
    return me


def materiaux_citron():
    ecorce = bpy.data.materials.get("ecorce")
    if ecorce:
        return ecorce, bpy.data.materials["pulpe"]
    ecorce = materiau("ecorce", **{"Base Color": (0.05, 0.19, 0.012, 1), "Roughness": 0.38, "Subsurface Weight": 0.15,
                                 "Coat Weight": 0.3, "Coat Roughness": 0.2})
    bruit_relief(ecorce, 520.0, 0.55, detail=2.0, distance=0.0004)
    # pulpe : vésicules allongées du centre vers l'écorce, liseré blanc sous l'écorce et le long de l'axe
    pulpe = materiau("pulpe", **{"Roughness": 0.16, "Subsurface Weight": 0.6, "Transmission Weight": 0.25, "IOR": 1.34,
                               "Coat Weight": 0.5, "Coat Roughness": 0.1})
    nt = pulpe.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Subsurface Radius"].default_value = (0.6, 0.9, 0.25); b.inputs["Subsurface Scale"].default_value = 0.004
    coord = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])

    def math_(op, a, bb=None, val=None):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = op
        nt.links.new(a, n.inputs[0])
        if bb is not None:
            nt.links.new(bb, n.inputs[1])
        elif val is not None:
            n.inputs[1].default_value = val
        return n.outputs[0]
    x2 = math_("MULTIPLY", sep.outputs["X"], sep.outputs["X"]); y2 = math_("MULTIPLY", sep.outputs["Y"], sep.outputs["Y"])
    rho = math_("SQRT", math_("ADD", x2, y2))
    zn = math_("DIVIDE", sep.outputs["Z"], val=R_CITRON[2])
    rz = math_("SQRT", math_("SUBTRACT", nt.nodes.new("ShaderNodeValue").outputs[0], math_("MULTIPLY", zn, zn)))
    nt.nodes["Value"].outputs[0].default_value = 1.0
    rel = math_("DIVIDE", math_("DIVIDE", rho, val=R_CITRON[0]), rz)       # 0 sur l'axe, 1 à la surface
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(math_("MULTIPLY", rho, val=42.0), comb.inputs["X"]); nt.links.new(math_("MULTIPLY", sep.outputs["Z"], val=260.0), comb.inputs["Y"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 1.0
    nt.links.new(comb.outputs["Vector"], vor.inputs["Vector"])
    teinte = nt.nodes.new("ShaderNodeMix"); teinte.data_type = "RGBA"
    teinte.inputs["A"].default_value = (0.42, 0.62, 0.10, 1); teinte.inputs["B"].default_value = (0.66, 0.80, 0.24, 1)
    nt.links.new(vor.outputs["Distance"], teinte.inputs["Factor"])
    blanc = nt.nodes.new("ShaderNodeMapRange")
    blanc.inputs["From Min"].default_value = 0.86; blanc.inputs["From Max"].default_value = 0.93
    nt.links.new(rel, blanc.inputs["Value"])
    axe = nt.nodes.new("ShaderNodeMapRange")
    axe.inputs["From Min"].default_value = 0.10; axe.inputs["From Max"].default_value = 0.03
    nt.links.new(rel, axe.inputs["Value"])
    liseré = math_("MAXIMUM", blanc.outputs["Result"], axe.outputs["Result"])
    couleur = nt.nodes.new("ShaderNodeMix"); couleur.data_type = "RGBA"
    couleur.inputs["B"].default_value = (0.80, 0.86, 0.62, 1)
    nt.links.new(teinte.outputs["Result"], couleur.inputs["A"]); nt.links.new(liseré, couleur.inputs["Factor"])
    nt.links.new(couleur.outputs["Result"], b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.5; bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return ecorce, pulpe


def materiau_rondelle():
    """Tranche de citron vert : écorce, liseré blanc, dix quartiers séparés par leurs membranes, vésicules rayonnantes."""
    m = bpy.data.materials.get("rondelle")
    if m:
        return m
    m = materiau("rondelle", **{"Roughness": 0.18, "Subsurface Weight": 0.55, "Transmission Weight": 0.25, "IOR": 1.34,
                              "Coat Weight": 0.5, "Coat Roughness": 0.1})
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Subsurface Radius"].default_value = (0.6, 0.9, 0.25); b.inputs["Subsurface Scale"].default_value = 0.003
    coord = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])

    def math_(op, a, bb=None, val=None):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = op
        nt.links.new(a, n.inputs[0])
        if bb is not None:
            nt.links.new(bb, n.inputs[1])
        elif val is not None:
            n.inputs[1].default_value = val
        return n.outputs[0]

    def plage(v, a0, a1, lisse=True):
        n = nt.nodes.new("ShaderNodeMapRange"); n.interpolation_type = "SMOOTHSTEP" if lisse else "LINEAR"
        n.inputs["From Min"].default_value = a0; n.inputs["From Max"].default_value = a1
        nt.links.new(v, n.inputs["Value"])
        return n.outputs["Result"]

    def melange(fac, a, bcol):
        n = nt.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"
        nt.links.new(fac, n.inputs["Factor"])
        for entree, v in (("A", a), ("B", bcol)):
            if isinstance(v, tuple):
                n.inputs[entree].default_value = v
            else:
                nt.links.new(v, n.inputs[entree])
        return n.outputs["Result"]
    x, y = sep.outputs["X"], sep.outputs["Y"]
    rho = math_("DIVIDE", math_("SQRT", math_("ADD", math_("MULTIPLY", x, x), math_("MULTIPLY", y, y))), val=R_CITRON[0])
    theta = math_("ARCTAN2", y, x)
    quartiers = math_("ABSOLUTE", math_("SINE", math_("MULTIPLY", theta, val=5.0)))          # 10 membranes
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(math_("MULTIPLY", rho, val=1.1), comb.inputs["X"]); nt.links.new(math_("MULTIPLY", theta, val=7.0), comb.inputs["Y"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 9.0
    nt.links.new(comb.outputs["Vector"], vor.inputs["Vector"])
    pulpe = melange(vor.outputs["Distance"], (0.40, 0.60, 0.09, 1), (0.68, 0.82, 0.25, 1))
    blanc = (0.82, 0.88, 0.66, 1)
    c = melange(plage(quartiers, 0.13, 0.04), pulpe, blanc)                               # membranes
    c = melange(plage(rho, 0.13, 0.06), c, blanc)                                         # cœur
    c = melange(plage(rho, 0.83, 0.88), c, blanc)                                         # liseré sous l'écorce
    c = melange(plage(rho, 0.93, 0.955), c, (0.05, 0.19, 0.012, 1))                       # écorce
    nt.links.new(c, b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.45; bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def maillage_rondelle(epaisseur=0.0048):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=R_CITRON[0], radius2=R_CITRON[0], depth=epaisseur)
    me = bpy.data.meshes.new("rondelle"); bm.to_mesh(me); bm.free()
    return me


def pose_rondelle():
    """Contre la paroi, face à la caméra, à mi-hauteur."""
    az, z = math.radians(262), 0.083
    rad = Vector((math.cos(az), math.sin(az), 0.0)); tan = Vector((-math.sin(az), math.cos(az), 0.0))
    rot = repere(tan + Vector((0, 0, 0.25)), rad + Vector((0, 0, -0.10)))
    origine = rad * (r_int(z) - 0.0105) + Vector((0, 0, Z0 + z))
    me = maillage_rondelle(); sommets = sommets_de(me); bpy.data.meshes.remove(me)
    return contenir_pose(sommets, origine, rot), rot


def faire_rondelle(nom):
    ob = lier(nom, maillage_rondelle(), materiau_rondelle(), lisse=False)
    origine, rot = pose_rondelle()
    ob.location = origine; ob.rotation_euler = rot.to_euler()
    return ob


def faire_quartier(nom):
    ecorce, pulpe = materiaux_citron()
    ob = lier(nom, maillage_quartier(), None, lisse=True)
    ob.data.materials.append(ecorce); ob.data.materials.append(pulpe)
    ob.data.polygons.foreach_set("use_smooth", [p.material_index == 0 for p in ob.data.polygons])
    return ob


# --- menthe ---------------------------------------------------------------------------------------
def textures_feuille():
    if bpy.data.images.get("feuille_couleur"):
        return bpy.data.images["feuille_couleur"], bpy.data.images["feuille_relief"]
    h, w = 768, 384
    u = np.linspace(0, 1, h)[:, None]              # le long de la nervure centrale, de la base à la pointe
    v = np.linspace(-1, 1, w)[None, :]             # en travers
    rng = np.random.default_rng(4)
    s = u - 0.42 * np.abs(v)                       # les nervures latérales partent en chevrons vers la pointe
    lat = np.exp(-((np.mod(s * 11.0, 1.0) - 0.5) / 0.055) ** 2) * (np.abs(v) > 0.03) * np.clip(1.15 - np.abs(v), 0, 1)
    centrale = np.exp(-(v / 0.035) ** 2)
    nerv = np.clip(lat * 0.8 + centrale, 0, 1)
    grain = rng.random((h // 8, w // 8)); grain = np.kron(grain, np.ones((8, 8)))
    fin = rng.random((h, w))
    base = np.array([0.030, 0.165, 0.020]); clair = np.array([0.15, 0.36, 0.07]); sombre = np.array([0.012, 0.08, 0.010])
    col = base[None, None] * (0.8 + 0.4 * grain[..., None]) * (0.92 + 0.16 * fin[..., None])
    col = col * (1 - 0.35 * np.clip(np.abs(v), 0, 1)[..., None] ** 2) + sombre[None, None] * 0.15
    col = col * (1 - nerv[..., None]) + clair[None, None] * nerv[..., None]
    couleur = np.concatenate([col, np.ones((h, w, 1))], -1)
    bosse = 0.5 + 0.5 * np.cos(2 * np.pi * (s * 11.0)) * np.clip(1 - np.abs(v) * 0.3, 0, 1)      # gaufrage entre nervures
    relief = np.clip(0.55 * bosse + 0.1 * fin - 0.75 * nerv, 0, 1)
    relief = np.repeat(relief[..., None], 4, -1); relief[..., 3] = 1
    return image_depuis("feuille_couleur", couleur), image_depuis("feuille_relief", relief, couleur=False)


def materiau_menthe():
    m = bpy.data.materials.get("menthe")
    if m:
        return m
    couleur, relief = textures_feuille()
    m = materiau("menthe", **{"Roughness": 0.42, "Subsurface Weight": 0.25, "Sheen Weight": 0.25})
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Subsurface Radius"].default_value = (0.25, 0.8, 0.12); b.inputs["Subsurface Scale"].default_value = 0.002
    tc = nt.nodes.new("ShaderNodeTexImage"); tc.image = couleur
    tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = relief
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 1.0; bump.inputs["Distance"].default_value = 0.0022
    nt.links.new(tc.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tr.outputs["Color"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # translucidité : la lumière traverse la feuille mince
    sortie = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    teinte = nt.nodes.new("ShaderNodeMix"); teinte.data_type = "RGBA"; teinte.inputs["Factor"].default_value = 0.5
    teinte.inputs["B"].default_value = (0.35, 0.75, 0.10, 1)
    nt.links.new(tc.outputs["Color"], teinte.inputs["A"]); nt.links.new(teinte.outputs["Result"], trans.inputs["Color"])
    add = nt.nodes.new("ShaderNodeMixShader"); add.inputs["Fac"].default_value = 0.22
    nt.links.new(b.outputs["BSDF"], add.inputs[1]); nt.links.new(trans.outputs["BSDF"], add.inputs[2])
    nt.links.new(add.outputs["Shader"], sortie.inputs["Surface"])
    return m


def maillage_feuille(longueur, graine, nu=30, nv=15):
    """Feuille de menthe : ovale pointue, bord denté, pli central, gaufrage entre nervures, courbure propre."""
    rnd = random.Random(graine)
    largeur = longueur * rnd.uniform(0.27, 0.32)
    courbe = rnd.uniform(0.25, 0.7); pli = rnd.uniform(0.12, 0.30); vrille = rnd.uniform(-0.5, 0.5)
    verts, uvs = [], []
    for i in range(nu + 1):
        u = i / nu
        w = largeur * 2.09 * (u ** 0.50) * ((1 - u) ** 0.75)          # ovale : le plus large au premier tiers
        dent = 1.0 + 0.060 * (1.0 - abs(((u * 17.0) % 1.0) * 2 - 1)) * min(1.0, 6 * u * (1 - u) + 0.2)
        for j in range(nv + 1):
            v = j / nv * 2 - 1
            x = v * w * (dent if abs(v) > 0.86 else 1.0)
            s = u - 0.42 * abs(v)
            gaufre = 0.0011 * (0.5 + 0.5 * math.cos(2 * math.pi * s * 11.0)) * (1 - abs(v)) * (abs(v) > 0.05)
            gondole = 0.0009 * (longueur / 0.04) * math.sin(u * 19.0 + graine) * abs(v) ** 2.2
            z = (pli * abs(x) - courbe * longueur * u * u * 0.35 + 1.7 * gaufre * (longueur / 0.04) + gondole
                 - 0.0009 * math.exp(-(v / 0.06) ** 2))
            a = vrille * u
            verts.append((x * math.cos(a) - z * math.sin(a), u * longueur, x * math.sin(a) + z * math.cos(a)))
            uvs.append((v * 0.5 + 0.5, u))
    faces = [(i * (nv + 1) + j, i * (nv + 1) + j + 1, (i + 1) * (nv + 1) + j + 1, (i + 1) * (nv + 1) + j)
             for i in range(nu) for j in range(nv)]
    me = bpy.data.meshes.new("feuille"); me.from_pydata(verts, [], faces)
    couche = me.uv_layers.new(name="uv")
    plat = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            plat.extend(uvs[me.loops[li].vertex_index])
    couche.data.foreach_set("uv", plat)
    return me


def faire_feuille(nom, longueur, graine):
    ob = lier(nom, maillage_feuille(longueur, graine), materiau_menthe())
    ep = ob.modifiers.new("epaisseur", "SOLIDIFY"); ep.thickness = 0.00028
    sub = ob.modifiers.new("sub", "SUBSURF"); sub.levels = 1; sub.render_levels = 2
    return ob


def faire_brin(nom, base, passage, graine):
    """Brin de menthe planté dans le verre. `base` : pied de la tige (dans le verre) ; `passage` : point (x, y) où la tige
    franchit le plan du bord, forcément à l'intérieur de l'ouverture. Les feuilles ne poussent qu'au-dessus du bord."""
    rnd = random.Random(graine)
    tige_mat = bpy.data.materials.get("tige") or materiau("tige", **{"Base Color": (0.10, 0.26, 0.05, 1), "Roughness": 0.5, "Subsurface Weight": 0.2})
    base = Vector(base)
    sortie = Vector((passage[0], passage[1], Z0 + H_VERRE))
    assert math.hypot(passage[0], passage[1]) < r_int(H_VERRE) - 0.004, "le brin doit sortir par l'ouverture du verre"
    axe = (sortie - base).normalized()
    s_bord = (sortie - base).length
    hauteur = s_bord + 0.058
    racine = bpy.data.objects.new(nom, None); bpy.context.scene.collection.objects.link(racine)
    racine.location = base
    racine.rotation_euler = axe.to_track_quat("Z", "Y").to_euler()
    tige = depuis_bmesh(nom + "_tige", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.0013,
                                                                       radius2=0.0007, depth=hauteur), tige_mat)
    tige.location = (0, 0, hauteur / 2); tige.parent = racine
    feuilles = []
    etages = [(0.006, 0.040), (0.019, 0.037), (0.031, 0.031), (0.041, 0.024), (0.049, 0.017), (0.054, 0.010)]
    for k, (ds, long_) in enumerate(etages):
        for cote in (0, 1):
            f = faire_feuille(f"{nom}_f{k}{cote}", long_ * rnd.uniform(0.92, 1.08), graine * 31 + k * 2 + cote)
            azimut = math.radians(90 * k + 180 * cote + rnd.uniform(-16, 16))
            ouverture = math.radians(rnd.uniform(50, 70) - 7 * k)          # angle avec la tige : étalé en bas, dressé en haut
            f.rotation_euler = (Matrix.Rotation(azimut, 4, "Z") @ Matrix.Rotation(math.pi / 2 - ouverture, 4, "X")).to_euler()
            f.location = (0, 0, s_bord + ds); f.parent = racine
            feuilles.append(f)
    for f in feuilles:
        poser_sur_le_bord(f)
    return racine


# --- bulles, buée, sucre --------------------------------------------------------------------------
def faire_bulles(glacons, graine=21):
    rng = np.random.default_rng(graine)
    air = materiau("bulle", **{"Transmission Weight": 1.0, "IOR": 0.75, "Roughness": 0.0})
    pts = []
    for _ in range(420):                               # accrochées à la paroi intérieure
        z = rng.uniform(E_FOND + 0.004, NIVEAU - 0.002); a = rng.uniform(0, 2 * np.pi)
        r = r_int(z) - 0.0006
        pts.append((r * np.cos(a), r * np.sin(a), Z0 + z, rng.uniform(0.00012, 0.00032)))
    for g in glacons:                                  # accrochées aux glaçons
        c = np.array(g.location)
        for _ in range(26):
            d = rng.normal(size=3); d /= np.linalg.norm(d)
            p = c + d * T_GLACON * rng.uniform(0.52, 0.66)
            if p[2] < Z0 + NIVEAU - 0.002 and np.hypot(p[0], p[1]) < r_int(p[2] - Z0) - 0.001:
                pts.append((*p, rng.uniform(0.00014, 0.00038)))
    for _ in range(110):                               # en train de monter
        a = rng.uniform(0, 2 * np.pi); r = 0.030 * np.sqrt(rng.random())
        pts.append((r * np.cos(a), r * np.sin(a), Z0 + rng.uniform(E_FOND + 0.004, NIVEAU - 0.003), rng.uniform(0.00018, 0.00050)))
    pts = np.array(pts)
    n = np.tile(np.array([[0.0, 0.0, 1.0]]), (len(pts), 1))
    return nuage("bulles", proto_sphere(1), pts[:, :3], n, np.repeat(pts[:, 3:4], 3, 1), air)


def faire_buee(graine=33):
    """Gouttes de condensation sur la paroi extérieure, là où le verre est froid."""
    rng = np.random.default_rng(graine)
    eau = materiau("goutte", **{"Transmission Weight": 1.0, "IOR": 1.333, "Roughness": 0.0})
    pos, nor, ech = [], [], []
    for nombre, (rmin, rmax) in ((5200, (0.00016, 0.00034)), (1500, (0.00040, 0.00075)), (230, (0.0009, 0.0016))):
        for _ in range(nombre):
            z = rng.triangular(0.010, 0.060, NIVEAU + 0.004); a = rng.uniform(0, 2 * np.pi)
            r = r_ext(z)
            rayon = rng.uniform(rmin, rmax)
            pos.append((r * np.cos(a), r * np.sin(a), Z0 + z)); nor.append((np.cos(a), np.sin(a), 0.03))
            ech.append((rayon, rayon * rng.uniform(1.0, 1.35), rayon * 0.50))
    ob = nuage("buee", proto_sphere(2), pos, nor, ech, eau)
    ob.cycles.is_caustics_caster = True
    return ob


def faire_sucre(graine=5):
    rng = np.random.default_rng(graine)
    sucre = materiau("sucre", **{"Base Color": (0.80, 0.36, 0.07, 1), "Roughness": 0.3, "Subsurface Weight": 0.5,
                                "Transmission Weight": 0.3, "IOR": 1.5})
    k = 2600
    a = rng.uniform(0, 2 * np.pi, k); r = (r_int(E_FOND) - 0.0045) * np.sqrt(rng.random(k))
    tas = 0.0035 * np.exp(-((r - 0.012) / 0.012) ** 2) * rng.random(k)
    # le plus gros cristal a une demi-diagonale de 1,2 mm : on le pose au-dessus du fond, jamais dedans
    pos = np.stack([r * np.cos(a), r * np.sin(a), Z0 + E_FOND + 0.0013 + tas], 1)
    nor = rng.normal(size=(k, 3))
    ech = rng.uniform(0.00028, 0.00052, (k, 1)) * rng.uniform(0.7, 1.3, (k, 3))
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    v = np.array([p.co[:] for p in bm.verts]); f = np.array([[q.index for q in face.verts] for face in bm.faces]); bm.free()
    ob = nuage("sucre", (v, f), pos, nor, ech, sucre)
    ob.data.polygons.foreach_set("use_smooth", [False] * len(ob.data.polygons))
    return ob


# --- poses choisies ----------------------------------------------------------------------------------
def pose_paille(longueur=0.215, rayon=0.0031):
    """La paille repose sur le fond du verre et s'appuie contre le bord intérieur, sans rien traverser."""
    bas = Vector((-0.012, -0.004, Z0 + E_FOND + rayon + 0.0012))
    az = math.radians(42)
    appui = Vector((math.cos(az), math.sin(az), 0.0)) * (r_int(H_VERRE) - rayon - 0.0012) + Vector((0, 0, Z0 + H_VERRE - 0.001))
    axe = (appui - bas).normalized()
    centre = bas + axe * (longueur / 2 - 0.002)
    return centre, axe.to_track_quat("Z", "Y").to_euler()


PAILLE_POS, PAILLE_ROT = pose_paille()


def repere(x, z):
    """Matrice de rotation dont les axes locaux X et Z pointent vers x et (à peu près) z."""
    x = Vector(x).normalized(); z = Vector(z); z = (z - z.dot(x) * x).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def poses_quartiers():
    """Le quartier posé au fond, contre la paroi, pulpe tournée vers la caméra. Le second tombe avec les glaçons."""
    poses = []
    # A : face de coupe tournée vers la caméra, en bas à gauche
    az, z = math.radians(246), 0.040
    rad = Vector((math.cos(az), math.sin(az), 0.0)); tan = Vector((-math.sin(az), math.cos(az), 0.0))
    face = Matrix.Rotation(math.radians(-26), 3, "Z")                      # ramène une face de coupe sur le plan local XZ
    rot = repere(tan, Vector((0.10, 0.0, 1.0)) + 0.30 * tan) @ Matrix.Rotation(math.radians(90), 3, "X") @ face
    origine = rad * (r_int(z) - 0.0030) - tan * 0.0115 + Vector((0, 0, Z0 + z))
    me = maillage_quartier(); sommets = sommets_de(me); bpy.data.meshes.remove(me)
    poses.append((contenir_pose(sommets, origine, rot), rot))
    return poses


# --- simulation : mise en place des glaçons ----------------------------------------------------------
def tasser(nombre=8, graine=11, images=230):
    """Fait tomber les glaçons dans le verre (corps rigides) autour de la paille et des quartiers de citron,
    qui sont des obstacles fixes. Renvoie les poses finales des glaçons.

    Un tube de guidage invisible prolonge le verre vers le haut pendant la chute : rien ne peut rebondir dehors.
    Les glaçons qui finissent au-dessus du bord sont écartés.
    """
    cache = os.path.join(SORTIE, f"tassement_v8_{nombre}_{graine}_{int(T_GLACON * 1000)}.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    sc = bpy.context.scene
    bpy.ops.rigidbody.world_add()
    monde = sc.rigidbody_world
    if monde.collection is None:
        monde.collection = bpy.data.collections.new("corps_rigides")
    monde.substeps_per_frame = 60; monde.solver_iterations = 60
    monde.point_cache.frame_start = 1; monde.point_cache.frame_end = images
    sc.frame_start, sc.frame_end = 1, images

    def passif(ob, forme="MESH"):
        monde.collection.objects.link(ob)
        ob.rigid_body.type = "PASSIVE"; ob.rigid_body.collision_shape = forme; ob.rigid_body.friction = 0.25
        # Sans use_margin, Bullet garde sa marge par défaut de 4 cm : le verre devient un bloc plein et éjecte tout.
        ob.rigid_body.use_margin = True; ob.rigid_body.collision_margin = 0.0002
    passif(bpy.data.objects["verre"])
    provisoires = []
    guide = depuis_bmesh("guide", lambda bm: bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=r_int(H_VERRE) - 0.0003,
                                                                  radius2=r_int(H_VERRE) - 0.0003, depth=1.4))
    guide.location = (0, 0, Z0 + H_VERRE - 0.004 + 0.7); passif(guide); provisoires.append(guide)
    tige = depuis_bmesh("guide_paille", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.0036,
                                                                        radius2=0.0036, depth=0.215))
    # La paille est enfoncée après les premiers glaçons, comme au bar : elle descend le long de son axe
    # entre les images 95 et 150 et écarte la glace sur son passage (corps passif animé).
    tige.rotation_euler = PAILLE_ROT; passif(tige, "CONVEX_HULL"); provisoires.append(tige)
    tige.rigid_body.kinematic = True
    axe_paille = Vector((0.0, 0.0, 1.0)); axe_paille.rotate(PAILLE_ROT)
    tige.location = Vector(PAILLE_POS) + axe_paille * 0.24
    tige.keyframe_insert("location", frame=1); tige.keyframe_insert("location", frame=95)
    tige.location = PAILLE_POS; tige.keyframe_insert("location", frame=150)
    for k, (origine, rot) in enumerate(poses_quartiers()):
        q = lier(f"guide_quartier{k}", maillage_quartier(), None)
        q.location = origine; q.rotation_euler = rot.to_euler(); passif(q, "CONVEX_HULL"); provisoires.append(q)
    rondelle = lier("guide_rondelle", maillage_rondelle(), None)
    origine, rot = pose_rondelle()
    rondelle.location = origine; rondelle.rotation_euler = rot.to_euler(); passif(rondelle, "CONVEX_HULL"); provisoires.append(rondelle)
    rnd = random.Random(graine)
    corps = []
    for k in range(nombre + 1):
        citron = k == 4                                    # le second quartier tombe au milieu des glaçons
        if citron:
            ob = lier(f"sim{k}", maillage_quartier(), None)
        else:
            ob = depuis_bmesh(f"sim{k}", lambda bm: bmesh.ops.create_cube(bm, size=T_GLACON))
        a = rnd.uniform(0, 6.283); r = rnd.uniform(0.0, 0.004)
        ob.location = (r * math.cos(a) - 0.004, r * math.sin(a) - (0.012 if citron else 0.004), Z0 + 0.20 + k * 0.058)
        ob.rotation_euler = Euler((rnd.uniform(0, 3.1), rnd.uniform(0, 3.1), rnd.uniform(0, 3.1)))
        monde.collection.objects.link(ob)
        ob.rigid_body.type = "ACTIVE"; ob.rigid_body.collision_shape = "CONVEX_HULL" if citron else "BOX"
        ob.rigid_body.mass = 0.012 if citron else 0.016
        ob.rigid_body.friction = 0.15; ob.rigid_body.restitution = 0.02
        ob.rigid_body.linear_damping = 0.6; ob.rigid_body.angular_damping = 0.7
        ob.rigid_body.use_margin = True; ob.rigid_body.collision_margin = 0.0002
        corps.append(ob)
    for f in range(1, images + 1):
        sc.frame_set(f)
    poses = [{"genre": "quartier" if k == 4 else "glacon", "loc": list(ob.matrix_world.to_translation()),
              "rot": list(ob.matrix_world.to_euler())} for k, ob in enumerate(corps)]
    for ob in corps + provisoires:
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.rigidbody.world_remove()
    sc.frame_set(1)
    dedans = [q for q in poses if math.hypot(q["loc"][0], q["loc"][1]) < R_HAUT and Z0 < q["loc"][2] < Z0 + H_VERRE + 0.002]
    print(f"TASSEMENT {len(dedans)} corps dans le verre sur {len(poses)} ; hauteurs (mm) : "
          + ", ".join(f"{q['genre'][0]}{q['loc'][2] * 1000:.0f}" for q in poses), flush=True)
    if sum(q["genre"] == "glacon" for q in dedans) < 6:
        raise RuntimeError("tassement : moins de 6 glaçons dans le verre")
    os.makedirs(SORTIE, exist_ok=True)
    json.dump(dedans, open(cache, "w"))
    return dedans


# --- lumière, caméra, rendu -------------------------------------------------------------------------
def panneau_lumineux(nom, centre, largeur, hauteur, couleur, force, camera=True, reflets=True, degrade=None):
    """Plan émissif vertical face à la caméra. degrade=(x0, x1) : l'émission tombe à zéro entre x0 et x1 (repère local)."""
    m = bpy.data.materials.new(nom)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission"); sortie = nt.nodes.new("ShaderNodeOutputMaterial")
    em.inputs["Color"].default_value = (*couleur, 1); em.inputs["Strength"].default_value = force
    if degrade:
        coord = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        plage = nt.nodes.new("ShaderNodeMapRange"); plage.interpolation_type = "SMOOTHSTEP"
        plage.inputs["From Min"].default_value = degrade[0]; plage.inputs["From Max"].default_value = degrade[1]
        plage.inputs["To Min"].default_value = force; plage.inputs["To Max"].default_value = 0.0
        nt.links.new(coord.outputs["Object"], sep.inputs["Vector"]); nt.links.new(sep.outputs["X"], plage.inputs["Value"])
        nt.links.new(plage.outputs["Result"], em.inputs["Strength"])
    nt.links.new(em.outputs["Emission"], sortie.inputs["Surface"])

    def plan(bm):
        for x, z in ((-largeur / 2, -hauteur / 2), (largeur / 2, -hauteur / 2), (largeur / 2, hauteur / 2), (-largeur / 2, hauteur / 2)):
            bm.verts.new((x, 0.0, z))
        bm.verts.ensure_lookup_table(); bm.faces.new(bm.verts)
    ob = depuis_bmesh(nom, plan, m, lisse=False)
    ob.location = centre
    ob.visible_camera = camera
    ob.visible_glossy = reflets
    return ob


def faire_enseigne(caractere, force):
    """Le mot en lettres lumineuses, loin derrière le verre : la profondeur de champ le rend flou."""
    chemin = os.path.join(SORTIE, "enseigne", caractere + ".png")
    if not os.path.exists(chemin):
        print(f"ENSEIGNE absente ({chemin}) : lancer build/mojito/enseigne.py", flush=True)
        return None
    img = bpy.data.images.load(chemin)
    m = bpy.data.materials.new("enseigne")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*lin(CREME), 1)
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = force
    sortie = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], mul.inputs[0]); nt.links.new(mul.outputs["Value"], em.inputs["Strength"])
    # hors des lettres le panneau est transparent : la barre orange passe derrière le mot, comme dans le logo
    vide = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(vide.outputs["BSDF"], mix.inputs[1]); nt.links.new(em.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], sortie.inputs["Surface"])
    largeur, hauteur = 0.234, 0.0585

    def plan(bm):
        uv = bm.loops.layers.uv.new("uv")
        vs = [bm.verts.new((x, 0.0, z)) for x, z in ((-largeur / 2, -hauteur / 2), (largeur / 2, -hauteur / 2),
                                                     (largeur / 2, hauteur / 2), (-largeur / 2, hauteur / 2))]
        f = bm.faces.new(vs)
        for boucle, c in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            boucle[uv].uv = c
    ob = depuis_bmesh("enseigne", plan, m, lisse=False)
    ob.location = (0.006, 0.33, 0.2415)
    return ob


def lumiere_surface(nom, position, cible, taille, puissance, couleur=(1, 1, 1), taille_y=None, caustiques=False, camera=False):
    lum = bpy.data.lights.new(nom, "AREA")
    lum.energy = puissance; lum.color = couleur
    if taille_y:
        lum.shape = "RECTANGLE"; lum.size = taille; lum.size_y = taille_y
    else:
        lum.size = taille
    ob = bpy.data.objects.new(nom, lum)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = position; viser(ob, cible)
    ob.visible_camera = camera
    if caustiques:
        lum.cycles.is_caustics_light = True
    return ob


def eclairer(args):
    monde = bpy.data.worlds.new("noir"); bpy.context.scene.world = monde
    try:
        monde.use_nodes = True
    except Exception:
        pass
    nt = monde.node_tree
    fond = nt.nodes["Background"]
    fond.inputs["Color"].default_value = (0.0006, 0.0006, 0.0006, 1)
    if args.tente > 0:
        # Tente lumineuse : vue seulement par les rayons qui traversent le verre, la glace et le liquide.
        # Le fond reste noir à l'image et dans les reflets ; la boisson, elle, a quelque chose à réfracter.
        # Plus claire à l'arrière gauche et au-dessus, éteinte du côté de la barre orange.
        chemin = nt.nodes.new("ShaderNodeLightPath"); geo = nt.nodes.new("ShaderNodeNewGeometry")
        vers = nt.nodes.new("ShaderNodeVectorMath"); vers.operation = "DOT_PRODUCT"
        vers.inputs[1].default_value = Vector((-0.62, 0.62, 0.48)).normalized()
        plage = nt.nodes.new("ShaderNodeMapRange"); plage.interpolation_type = "SMOOTHSTEP"
        plage.inputs["From Min"].default_value = -0.35; plage.inputs["From Max"].default_value = 0.95
        plage.inputs["To Min"].default_value = 0.02 * args.tente; plage.inputs["To Max"].default_value = args.tente
        tente = nt.nodes.new("ShaderNodeBackground"); tente.inputs["Color"].default_value = (*lin(CREME), 1)
        mix = nt.nodes.new("ShaderNodeMixShader"); sortie = nt.nodes["World Output"]
        nt.links.new(geo.outputs["Incoming"], vers.inputs[0])
        nt.links.new(vers.outputs["Value"], plage.inputs["Value"]); nt.links.new(plage.outputs["Result"], tente.inputs["Strength"])
        nt.links.new(chemin.outputs["Is Transmission Ray"], mix.inputs["Fac"])
        nt.links.new(fond.outputs["Background"], mix.inputs[1]); nt.links.new(tente.outputs["Background"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], sortie.inputs["Surface"])
    # la bande du logo devenue lumière : barre verticale derrière le verre, à droite du centre.
    panneau_lumineux("barre_orange", (0.040, 0.36, 0.60), 0.036, 1.20, lin(ORANGE), args.barre)
    if args.caustiques > 0:
        lumiere_surface("barre_caustiques", (0.040, 0.359, 0.45), (0.040, -1.0, 0.45), 0.034, args.caustiques, lin(ORANGE),
                        taille_y=0.9, caustiques=True).visible_glossy = False
    # carton lumineux caché : invisible en direct, visible à travers le verre. Il donne son corps au liquide
    # et laisse les bords du verre sombres, comme en photographie de boisson. Dégradé : il s'éteint vers la barre.
    if args.fond > 0:
        panneau_lumineux("carton_fond", (-0.20, 0.34, 0.11), 0.70, 0.34, lin(CREME), args.fond, camera=False, reflets=False,
                         degrade=(0.02, 0.26))
    if args.aretes > 0:
        # boîtes à lumière larges, de trois quarts arrière : leur reflet sur le cylindre est une plage en dégradé,
        # pas un filet blanc uniforme (qui se lisait comme un contour dessiné)
        lumiere_surface("arete_gauche", (-0.34, 0.20, 0.16), (0, 0, 0.09), 0.15, 4.4 * args.aretes, lin(CREME), taille_y=0.50)
        lumiere_surface("arete_droite", (0.36, 0.12, 0.16), (0, 0, 0.09), 0.11, 2.6 * args.aretes, lin(CREME), taille_y=0.50)
    if args.dessus > 0:
        lumiere_surface("dessus", (-0.05, -0.10, 0.60), (0, 0, 0.12), 0.40, 6.0 * args.dessus, lin(CREME))
    if args.eclat > 0:        # petite source dure : elle fait scintiller les arêtes de la glace et les gouttes
        lumiere_surface("eclat", (-0.30, -0.42, 0.46), (0, 0, 0.12), 0.025, 2.2 * args.eclat, lin(CREME))
    if args.enseigne:
        faire_enseigne(args.enseigne, args.force_enseigne)


def cadrer(args):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new("camera"); ob = bpy.data.objects.new("camera", cam)
    sc.collection.objects.link(ob); sc.camera = ob
    cam.sensor_fit = "VERTICAL"; cam.sensor_height = 36.0; cam.lens = 100.0
    ob.location = (0.010, -0.66, 0.176)
    viser(ob, (0.010, 0.0, 0.118))
    cam.dof.use_dof = True
    cam.dof.focus_distance = (Vector((0.0, -R_HAUT, 0.09)) - ob.location).length
    cam.dof.aperture_fstop = args.ouverture
    return ob


def regler_rendu(args):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    if args.device != "CPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = args.device
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == args.device
        cy.device = "GPU"
    else:
        cy.device = "CPU"
    larg, haut = (int(v) for v in args.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = larg, haut, 100
    cy.samples = args.spp
    cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.012; cy.adaptive_min_samples = max(args.spp // 6, 16)
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    cy.max_bounces = 40; cy.transmission_bounces = 36; cy.glossy_bounces = 12; cy.diffuse_bounces = 4
    cy.volume_bounces = 2; cy.transparent_max_bounces = 36
    cy.caustics_reflective = True; cy.caustics_refractive = True; cy.blur_glossy = 0.3
    cy.sample_clamp_indirect = 8.0
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_depth = "16"
    sc.view_settings.view_transform = args.vue
    if args.vue == "AgX":
        try:
            sc.view_settings.look = "AgX - Medium High Contrast"
        except Exception:
            pass
    sc.view_settings.exposure = args.exposition


def construire(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(SORTIE, exist_ok=True)
    regler_rendu(args)
    faire_comptoir(); faire_sous_verre()
    faire_verre()
    glacons = []
    if args.glacons:
        for k, p in enumerate(tasser(args.glacons)):
            ob = faire_glacon(f"glacon{k}", T_GLACON, 100 + k) if p["genre"] == "glacon" else faire_quartier("quartier_tombe")
            ob.location = p["loc"]; ob.rotation_euler = Euler(p["rot"])
            if p["genre"] == "glacon":
                ob.scale = (0.94, 0.94, 0.94)          # la fonte déplace la surface : on reste en deçà de la boîte simulée
            if p["genre"] == "glacon":
                glacons.append(ob)
    for k, (origine, rot) in enumerate(poses_quartiers()):
        q = faire_quartier(f"quartier{k}")
        q.location = origine; q.rotation_euler = rot.to_euler()
    faire_rondelle("rondelle")
    faire_liquide()
    paille = faire_paille()
    paille.location = PAILLE_POS
    paille.rotation_euler = PAILLE_ROT
    if args.garniture:
        faire_sucre()
        faire_bulles(glacons)
        faire_buee()
        faire_brin("brin", (-0.010, 0.010, Z0 + 0.082), (-0.023, 0.016), 7)
        faire_brin("brin2", (-0.005, -0.010, Z0 + 0.092), (-0.016, -0.022), 12)
        rnd = random.Random(3)
        for k, (az, z) in enumerate(((205, 0.086), (268, 0.074), (322, 0.044), (286, 0.112), (232, 0.108), (150, 0.060))):   # feuilles plaquées contre la paroi
            f = faire_feuille(f"feuille_paroi{k}", rnd.uniform(0.024, 0.034), 60 + k)
            a = math.radians(az); r = r_int(z) - 0.0012
            f.location = (r * math.cos(a), r * math.sin(a), Z0 + z)
            f.rotation_euler = (Matrix.Rotation(a + math.pi / 2, 4, "Z") @ Matrix.Rotation(math.radians(90 + rnd.uniform(-25, 25)), 4, "X")
                                @ Matrix.Rotation(rnd.uniform(-0.6, 0.6), 4, "Y")).to_euler()
            plaquer_dans_le_verre(f)
    eclairer(args); cadrer(args)
    verifier_limites()


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", default="504x756")
    ap.add_argument("--spp", type=int, default=96)
    ap.add_argument("--device", default="CPU", choices=["CPU", "CUDA", "OPTIX"])
    ap.add_argument("--out", default=os.path.join(SORTIE, "lookdev.png"))
    ap.add_argument("--glacons", type=int, default=10)
    ap.add_argument("--garniture", type=int, default=1)
    ap.add_argument("--ouverture", type=float, default=11.0)
    ap.add_argument("--barre", type=float, default=1.3, help="luminance de la barre orange")
    ap.add_argument("--caustiques", type=float, default=0.0, help="puissance de la lumière de caustiques (W), 0 = aucune")
    ap.add_argument("--fond", type=float, default=0.0, help="luminance du carton caché derrière le verre")
    ap.add_argument("--tente", type=float, default=1.4, help="luminance de la tente vue à travers le verre")
    ap.add_argument("--aretes", type=float, default=0.5)
    ap.add_argument("--dessus", type=float, default=1.25)
    ap.add_argument("--eclat", type=float, default=1.0, help="petite source dure pour les reflets vifs")
    ap.add_argument("--enseigne", default="instrument-serif-italic", help="caractère de l'enseigne floue ('' = aucune)")
    ap.add_argument("--force_enseigne", type=float, default=0.42)
    ap.add_argument("--vue", default="Standard", choices=["AgX", "Standard", "Filmic", "Khronos PBR Neutral"])
    ap.add_argument("--exposition", type=float, default=0.0)
    ap.add_argument("--blend", default="")
    A = ap.parse_args(argv)
    construire(A)
    if A.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A.blend))
    import time
    t0 = time.time()
    bpy.context.scene.render.filepath = os.path.abspath(A.out)
    bpy.ops.render.render(write_still=True)
    print(f"RENDU {A.res} {A.spp} échantillons : {time.time() - t0:.1f} s -> {A.out}", flush=True)
