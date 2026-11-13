"""Séquence 2 — l'atelier : sol de plâtre et son bec, lettres monumentales, grains de pigment, lumière rasante.
Module Blender partagé par le rendu des grains (scene.py) et par celui du mojito (le filet tombe dans le verre).

L'atelier est construit dans le repère du bar (build/mojito) : son sol est à DENIVELE au-dessus du fond intérieur
du verre, et le verre est à l'aplomb du point où le filet atterrit.
"""
import bpy  # doit précéder bmesh et mathutils
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, "..", ".."))
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(RACINE, "build", "mojito"))
import monde as M          # noqa: E402
import scene as S          # noqa: E402

SIMS = os.path.join(RACINE, "out", "grains")


def axe_verre():
    """Le verre est à l'aplomb du col de l'entonnoir."""
    return (0.0, M.ENTONNOIR_Y)


def decalage():
    """Vecteur qui porte un point du repère de l'atelier dans celui du bar."""
    cx, cy = axe_verre()
    return Vector((-cx, -cy, M.DENIVELE + S.Z0 + S.E_FOND))


def platre():
    m = bpy.data.materials.get("platre")
    if m is None:
        m = S.materiau("platre", **{"Base Color": (*[v * 0.80 for v in S.lin(S.CREME)], 1), "Roughness": 0.92})
        S.bruit_relief(m, 900.0, 0.25, detail=4.0, distance=0.00012)
    return m


def boite(nom, lo, hi, mat, biseau=0.0006):
    def faire(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k]) for k in range(3)))
    ob = S.depuis_bmesh(nom, faire, mat, lisse=False)
    if biseau:
        b = ob.modifiers.new("biseau", "BEVEL"); b.width = biseau; b.segments = 2
    return ob


def faire_sol_et_mur(d):
    ep = M.SOL_EP   # épaisseur visible du sol
    objets = [
        boite("sol", (-0.45, M.BEC_Y, -ep), (0.45, 0.45, 0.0), platre()),
        boite("sol_gauche", (-0.45, M.SOL_BORD, -ep), (-M.BEC_DEMI, M.BEC_Y + 0.0002, 0.0), platre()),
        boite("sol_droit", (M.BEC_DEMI, M.SOL_BORD, -ep), (0.45, M.BEC_Y + 0.0002, 0.0), platre()),
    ]
    mur = S.materiau("mur_atelier", **{"Base Color": (0.0022, 0.0022, 0.0021, 1), "Roughness": 0.97})
    objets.append(boite("mur", (-0.6, M.MUR_Y, -ep), (0.6, M.MUR_Y + 0.02, 0.9), mur, biseau=0.0))
    for ob in objets:
        ob.location = d
    # l'entonnoir sous la fente : paroi conique, de la bouche au col
    (r1, z1), (r0, z0), w = M.ENTONNOIR_HAUT, M.ENTONNOIR_BAS, M.ENTONNOIR_PAROI
    zt = M.ENTONNOIR_TUBE
    entonnoir = S.tour("entonnoir", [(r0, zt), (r0, z0), (r1, z1), (r1 + w, z1), (r0 + w, z0), (r0 + w, zt), (r0, zt)], segments=96,
                       materiau=platre())
    entonnoir.location = Vector((0.0, M.ENTONNOIR_Y, 0.0)) + d
    objets.append(entonnoir)
    return objets


def faire_lettres(d):
    """Un objet par caractère du roulement ; un seul est visible à la fois."""
    donnees = json.load(open(os.path.join(RACINE, "cache", "grains", "lettres.json")))
    lettres = {}
    for ident, info in donnees.items():
        cu = bpy.data.curves.new("lettres_" + ident, "CURVE")
        cu.dimensions = "2D"; cu.fill_mode = "BOTH"
        cu.extrude = M.LETTRES_EP / 2 - 0.0004; cu.bevel_depth = 0.0004; cu.bevel_resolution = 2
        for c in info["contours"]:
            pts = c["points"]
            sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
            for k, (x, z) in enumerate(pts):
                sp.points[k].co = (x, z, 0.0, 1.0)
            sp.use_cyclic_u = True
        ob = bpy.data.objects.new("lettres_" + ident, cu)
        bpy.context.scene.collection.objects.link(ob)
        cu.materials.append(platre())
        ob.rotation_euler = (math.pi / 2, 0.0, 0.0)                 # le plan du mot devient vertical
        ob.location = Vector((0.0, M.LETTRES_Y - M.LETTRES_EP / 2, 0.0)) + d
        lettres[ident] = ob
    return lettres


def poser_lettres(lettres, f):
    actif = M.caractere_lettres(f)
    for ident, ob in lettres.items():
        ob.hide_render = ident != actif


# --- grains -----------------------------------------------------------------------------------------------
def materiau_grain(sucre=True):
    """Pigment mat dans l'atelier ; en tombant vers le bar, le grain devient un cristal de sucre de canne, ambré et brillant.
    sucre=False : pigment mat partout (séquence 5, où il n'y a pas de bar)."""
    nom = "grain" if sucre else "grain_pigment"
    m = bpy.data.materials.get(nom)
    if m:
        return m
    m = S.materiau(nom, **{"Roughness": 0.85})
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    info = nt.nodes.new("ShaderNodeObjectInfo")
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    hauteur = nt.nodes.new("ShaderNodeMapRange"); hauteur.interpolation_type = "SMOOTHSTEP"
    hauteur.inputs["From Min"].default_value = 0.30; hauteur.inputs["From Max"].default_value = 0.62      # du bar vers l'atelier
    if not sucre:                                       # pigment partout : la transition est rejetée loin sous la scène
        hauteur.inputs["From Min"].default_value = -1000.0; hauteur.inputs["From Max"].default_value = -999.0
    # teinte : orange du logo, variée de 8 % d'un grain à l'autre
    var = nt.nodes.new("ShaderNodeMapRange")
    var.inputs["To Min"].default_value = 0.84; var.inputs["To Max"].default_value = 1.16
    pigment = nt.nodes.new("ShaderNodeMix"); pigment.data_type = "RGBA"; pigment.blend_type = "MULTIPLY"
    pigment.inputs["Factor"].default_value = 1.0
    pigment.inputs["A"].default_value = (*S.lin(S.ORANGE), 1)
    gris = nt.nodes.new("ShaderNodeCombineColor")
    sucre = nt.nodes.new("ShaderNodeMix"); sucre.data_type = "RGBA"
    sucre.inputs["A"].default_value = (0.80, 0.36, 0.07, 1)        # cristal de sucre de canne
    nt.links.new(info.outputs["Random"], var.inputs["Value"])
    for canal in ("Red", "Green", "Blue"):
        nt.links.new(var.outputs["Result"], gris.inputs[canal])
    nt.links.new(gris.outputs["Color"], pigment.inputs["B"])
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"]); nt.links.new(sep.outputs["Z"], hauteur.inputs["Value"])
    nt.links.new(hauteur.outputs["Result"], sucre.inputs["Factor"])
    nt.links.new(pigment.outputs["Result"], sucre.inputs["B"])
    nt.links.new(sucre.outputs["Result"], b.inputs["Base Color"])
    for entree, (bas, haut) in {"Roughness": (0.22, 0.85), "Transmission Weight": (0.35, 0.0), "Subsurface Weight": (0.4, 0.04)}.items():
        plage = nt.nodes.new("ShaderNodeMapRange")
        plage.inputs["To Min"].default_value = bas; plage.inputs["To Max"].default_value = haut
        nt.links.new(hauteur.outputs["Result"], plage.inputs["Value"])
        nt.links.new(plage.outputs["Result"], b.inputs[entree])
    b.inputs["IOR"].default_value = 1.5
    return m


def prototypes(graine=2, sucre=True):
    """Quatre cristaux irréguliers, à facettes, de rayon moyen 1."""
    rng = np.random.default_rng(graine)
    coll = bpy.data.collections.new("cristaux" if sucre else "cristaux_pigment")
    for k in range(4):
        def faire(bm, k=k):
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            for v in bm.verts:
                v.co *= float(rng.uniform(0.72, 1.18))
            ech = rng.uniform(0.78, 1.22, 3)
            for v in bm.verts:
                v.co = Vector((v.co.x * ech[0], v.co.y * ech[1], v.co.z * ech[2]))
        ob = S.depuis_bmesh(f"cristal{k}", faire, materiau_grain(sucre), lisse=False)
        bpy.context.scene.collection.objects.unlink(ob)
        coll.objects.link(ob)
    return coll


class Grains:
    """Nuage de grains instancié sur les particules d'une simulation, relu image par image."""

    def __init__(self, nom, dossier, d, rayon_par_pas=0.60, sucre=True):
        self.nom, self.dossier, self.d = nom, dossier, np.array(d, np.float32)
        run = os.path.join(dossier, "run.json")
        pas = json.load(open(run))["info"]["spacing"] if os.path.exists(run) else 0.0005
        self.rayon = pas * rayon_par_pas
        coll = bpy.data.collections.get("cristaux" if sucre else "cristaux_pigment") or prototypes(sucre=sucre)
        self.ob = bpy.data.objects.new(nom, bpy.data.meshes.new(nom))
        bpy.context.scene.collection.objects.link(self.ob)
        ng = bpy.data.node_groups.new(nom + "_gn", "GeometryNodeTree")
        ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
        ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        entree = ng.nodes.new("NodeGroupInput"); sortie = ng.nodes.new("NodeGroupOutput")
        inst = ng.nodes.new("GeometryNodeInstanceOnPoints")
        info = ng.nodes.new("GeometryNodeCollectionInfo")
        info.inputs["Collection"].default_value = coll
        info.inputs["Separate Children"].default_value = True; info.inputs["Reset Children"].default_value = True
        rot = ng.nodes.new("GeometryNodeInputNamedAttribute"); rot.data_type = "FLOAT_VECTOR"; rot.inputs["Name"].default_value = "rot"
        ech = ng.nodes.new("GeometryNodeInputNamedAttribute"); ech.data_type = "FLOAT"; ech.inputs["Name"].default_value = "ech"
        inst.inputs["Pick Instance"].default_value = True
        ng.links.new(entree.outputs[0], inst.inputs["Points"])
        ng.links.new(info.outputs["Instances"], inst.inputs["Instance"])
        ng.links.new(rot.outputs["Attribute"], inst.inputs["Rotation"])
        ng.links.new(ech.outputs["Attribute"], inst.inputs["Scale"])
        ng.links.new(inst.outputs["Instances"], sortie.inputs[0])
        mod = self.ob.modifiers.new("gn", "NODES"); mod.node_group = ng
        self.dernier = None

    def poser(self, f):
        """Charge l'image f (ou la dernière disponible avant f). Renvoie le nombre de grains libres, ou None."""
        g = f
        while g >= 0 and not os.path.exists(os.path.join(self.dossier, f"f{g:04d}.npz")):
            g -= 1
            if f - g > 400:
                g = -1
        if g < 0:
            self.ob.hide_render = True
            return None
        self.ob.hide_render = False
        if g == self.dernier:
            return self.n_libres
        z = np.load(os.path.join(self.dossier, f"f{g:04d}.npz"))
        pos = z["pos"] + self.d
        q = z["quat"].astype(np.float64)
        w, x, y, zz = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
        rot = np.stack([np.arctan2(2 * (w * x + y * zz), 1 - 2 * (x * x + y * y)),
                        np.arcsin(np.clip(2 * (w * y - zz * x), -1, 1)),
                        np.arctan2(2 * (w * zz + x * y), 1 - 2 * (y * y + zz * zz))], 1).astype(np.float32)
        n = len(pos)
        rng = np.random.default_rng(1)
        ech = (self.rayon * rng.uniform(0.85, 1.15, int(z["id"].max()) + 1 if n else 1)[z["id"]]).astype(np.float32)
        self._maillage(pos, rot, ech)
        self.dernier = g
        self.n_libres = int(z["n_free"])
        return self.n_libres

    def _maillage(self, pos, rot, ech):
        me = bpy.data.meshes.new(self.nom)
        me.vertices.add(len(pos))
        me.vertices.foreach_set("co", np.ascontiguousarray(pos, np.float32).ravel())
        a = me.attributes.new("rot", "FLOAT_VECTOR", "POINT"); a.data.foreach_set("vector", np.ascontiguousarray(rot, np.float32).ravel())
        a = me.attributes.new("ech", "FLOAT", "POINT"); a.data.foreach_set("value", np.ascontiguousarray(ech, np.float32))
        ancien = self.ob.data
        self.ob.data = me
        bpy.data.meshes.remove(ancien)


class Egares(Grains):
    """Grains tombés du bord avant du sol, hors du bec. Ils ne rencontrent plus rien avant le comptoir du bar : leur chute
    est une trajectoire balistique exacte (position et vitesse de sortie données par la simulation), sans simulation
    supplémentaire. Ceux qui tomberaient sur le verre ne sont pas suivis."""

    def __init__(self, nom, dossier_dalle, d):
        super().__init__(nom, dossier_dalle, d)
        chemin = os.path.join(dossier_dalle, "exits.npz")
        self.vide = not os.path.exists(chemin)
        if self.vide:
            return
        Z = np.load(chemin)
        bec = (np.abs(Z["pos"][:, 0]) < M.BEC_DEMI + 0.004) & (Z["pos"][:, 1] > M.SOL_BORD - 0.004) & (Z["pos"][:, 1] < M.BEC_Y + 0.004)
        ok = (Z["cause"] == 1) & ~bec & (Z["t"] >= 0)
        p0 = Z["pos"][ok].astype(np.float64); v0 = Z["vel"][ok].astype(np.float64); t0 = Z["t"][ok].astype(np.float64)
        z_sol = -(M.DENIVELE + S.Z0 + S.E_FOND) + self.rayon           # le comptoir, dans le repère de l'atelier
        tl = (v0[:, 2] + np.sqrt(v0[:, 2] ** 2 + 2 * 9.81 * (p0[:, 2] - z_sol))) / 9.81
        chute = p0[:, :2] + v0[:, :2] * tl[:, None]
        cx, cy = axe_verre()
        loin = np.hypot(chute[:, 0] - cx, chute[:, 1] - cy) > S.R_HAUT + 0.004
        self.p0, self.v0, self.t0, self.tl = p0[loin], v0[loin], t0[loin], tl[loin]
        rng = np.random.default_rng(5)
        k = len(self.p0)
        self.rot0 = rng.uniform(0, 6.283, (k, 3)); self.spin = rng.normal(0, 14.0, (k, 3))
        self.ech = (self.rayon * rng.uniform(0.85, 1.15, k)).astype(np.float32)
        self.z_sol = z_sol

    def poser(self, f):
        if self.vide:
            self.ob.hide_render = True
            return None
        t = M.t_de(f)
        dt = np.minimum(t - self.t0, self.tl)
        vivant = dt >= 0
        if not vivant.any():
            self.ob.hide_render = True
            return 0
        self.ob.hide_render = False
        dt = dt[vivant]
        pos = self.p0[vivant] + self.v0[vivant] * dt[:, None]
        pos[:, 2] -= 0.5 * 9.81 * dt * dt
        rot = self.rot0[vivant] + self.spin[vivant] * dt[:, None]
        self._maillage(pos + self.d, rot, self.ech[vivant])
        return int(((t - self.t0[vivant]) < self.tl[vivant]).sum())


def eclairer(d):
    """Une source rasante et chaude à gauche, un remplissage large et faible à droite."""
    cle = S.lumiere_surface("atelier_cle", Vector((-0.55, -0.30, 0.16)) + d, Vector((0.0, -0.03, 0.06)) + d, 0.10, 7.5,
                            (1.0, 0.86, 0.72), taille_y=0.30)
    remplissage = S.lumiere_surface("atelier_remplissage", Vector((0.50, -0.55, 0.40)) + d, Vector((0.0, -0.03, 0.08)) + d, 0.70, 0.9,
                                    S.lin(S.CREME))
    return cle, remplissage


# --- caméra de l'atelier (repère de l'atelier) -----------------------------------------------------------------
CLES_CAMERA = [
    (60, (0.000, -0.860, 0.050), (0.000, -0.006, 0.128), 50.0, 8.0),     # fin de la plongée de la séquence 1 (raccord)
    (72, (0.000, -0.620, 0.035), (0.000, -0.006, 0.118), 50.0, 8.0),
    (119, (0.012, -0.440, 0.030), (0.000, -0.006, 0.105), 50.0, 8.0),
    (134, (0.020, -0.200, 0.016), (0.000, -0.046, 0.020), 45.0, 5.6),
    (167, (0.000, -0.235, 0.022), (0.000, -0.050, 0.016), 40.0, 5.6),
]
