"""OFFGRIDZ, séquence 1 (images 0-71) : scène Blender / Cycles.

  /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 2 -P build/seq01/scene.py -- \
      --frames 0:71 --res 1008x1512 --spp 96 --device CPU --out out/final/seq01

Arguments (après « -- ») : --frames a:b  --res LxH  --spp N  --device CPU|OPTIX  --out dossier
                           [--denoise auto|on|off] [--only a,b,c] [--tag suffixe]
Entrées : cache/seq01/ (prep.py : textures + géométrie ; sim_strip.py : positions de la bande par image).
Si le cache manque, le script le fabrique avec le Python de production (/opt/og/venv/bin/python).
Monde : px de fenêtre dans le plan z = 0 de la feuille, y haut, z vers la caméra ; caméra de focale (px) = lens en mm
(capteur 1008 mm de large). Sorties : f%04d.png 16 bits sRGB opaques, raccord.json (images 48-71), temps.json.
"""
import bpy  # noqa: E402  (toujours avant bmesh)
import bmesh
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import tl  # noqa: E402

CACHE = os.path.join(ROOT, "cache", "seq01")
VENV_PY = "/opt/og/venv/bin/python"


# ============================================================================ arguments
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = dict(frames="0:71", res="1008x1512", spp=96, device="CPU", out=os.path.join(ROOT, "out", "final", "seq01"),
             denoise="auto", only=None, tag="", filter="0.05", uvshift="0,0",
             arret="0", reprise="0", threads="2")
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        if k in a:
            a[k] = argv[i + 1]
            i += 2
        else:
            raise SystemExit(f"argument inconnu : {argv[i]}")
    f0, f1 = [int(v) for v in str(a["frames"]).split(":")]
    a["f0"], a["f1"] = f0, f1
    a["w"], a["h"] = [int(v) for v in str(a["res"]).lower().split("x")]
    a["spp"] = int(a["spp"])
    a["arret"] = float(a["arret"])
    a["reprise"] = int(a["reprise"])
    a["threads"] = int(a["threads"])
    if a["only"]:
        a["only"] = [int(v) for v in str(a["only"]).split(",")]
    return a


ARGS = parse_args()


def ensure_cache():
    """cache/seq01 est fabriqué une fois (prep.py, sim_strip.py : Python de production avec PIL, skimage, shapely, fontTools)
    et livré dans l'archive « papier » : le rendu, lui, n'a besoin que de bpy, numpy et scipy."""
    need = [os.path.join(CACHE, n) for n in ("geo.npz", "strip.npz", "tex_base.png", "tex_photo.png", "tex_strip.png",
                                             "tex_wordmark.png", "tex_edge.png", "tex_rim.png")]
    if all(os.path.exists(p) for p in need):
        return
    if os.path.exists(VENV_PY):
        for script in ("prep.py", "sim_strip.py"):
            print("fabrication du cache :", script, flush=True)
            subprocess.check_call([VENV_PY, os.path.join(HERE, script)])
        return
    raise SystemExit("cache/seq01 incomplet : déplier l'archive kit_papier.zip (build/gpu/kit.py papier). Absent : "
                     + ", ".join(os.path.basename(p) for p in need if not os.path.exists(p)))


ensure_cache()

# ---- l'atelier du réalisateur (build/grains) : sol, mur, lettres, lumières, dalle en grains, caméra
import importlib.util  # noqa: E402
GRAINS_DIR = os.path.join(ROOT, "build", "grains")
sys.path.append(GRAINS_DIR)
sys.path.append(os.path.join(ROOT, "build", "mojito"))
import atelier as A  # noqa: E402   (insère build/mojito en tête : « scene » désigne alors le module du mojito)
import monde as MON  # noqa: E402
import anim  # noqa: E402
_spec = importlib.util.spec_from_file_location("grains_scene", os.path.join(GRAINS_DIR, "scene.py"))
GS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GS)
D_ATELIER = A.decalage()
S_M = 0.060 / 202.45                         # mètres par px : la bande du logo (202,45 px) fait 60 mm
GEO = np.load(os.path.join(CACHE, "geo.npz"))

# --- monde partagé : repère « px » de la feuille -> repère de l'atelier (mètres) ; la caméra de l'atelier à l'image 60
_P60, _T60, _F60, _, _ = GS.camera_atelier(60, D_ATELIER)
_P61 = GS.camera_atelier(61, D_ATELIER)[0]
OX, OY = tl.O_CENTRE
YC_W = _P60.y - S_M * 56.0                   # la fente (z_px = -56 après dérive) est traversée par la caméra de l'atelier à l'image 60
ZC_W = _P60.z - S_M * OY
XC_W = _P60.x - S_M * OX


def pw(p):
    """point du repère px (x droite, y haut, z vers le spectateur) -> monde de l'atelier."""
    return Vector((XC_W + S_M * p[0], YC_W - S_M * p[2], ZC_W + S_M * p[1]))


tl.SLAB_H = MON.DALLE_HI[2] / S_M * 1.0 - MON.DALLE_LO[2] / S_M
tl.SLAB_T = (MON.DALLE_HI[1] - MON.DALLE_LO[1]) / S_M
tl.SLAB_W = (MON.DALLE_HI[0] - MON.DALLE_LO[0]) / S_M
tl.SLAB_Y0 = 451.03 - tl.SLAB_H / 2.0
_cen = (Vector(MON.DALLE_LO) + Vector(MON.DALLE_HI)) / 2.0 + D_ATELIER
tl.SLAB_F = (OX + (_cen.x - _P60.x) / S_M, (_cen.z - ZC_W) / S_M, (YC_W - _cen.y) / S_M)
tl.FLOOR_Y = (D_ATELIER.z - ZC_W) / S_M
_v = (_P61.y - _P60.y) / S_M                 # vitesse de la caméra de l'atelier en px/image au point de jonction
tl._ZK = [(24, 1800.0), (47, 1700.0), (50, 1210.0), (53, 780.0), (55, 420.0), (57, -56.0 + 3 * _v), (58, -56.0 + 2 * _v),
          (59, -56.0 + _v), (60, -56.0)]
BUMP_D = S_M                                 # distance de relief : 1 px local, exprimé en mètres
STRIP = np.load(os.path.join(CACHE, "strip.npz"))
STRIP_FR = STRIP["frames"]
STRIP_F0 = int(STRIP["first"][0])

# ============================================================================ couleurs (BIBLE §4)


def srgb2lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexlin(h):
    h = h.lstrip("#")
    return tuple(float(v) for v in srgb2lin([int(h[i:i + 2], 16) for i in (0, 2, 4)]))


C_BLACK = hexlin("0A0A09")
C_CREAM = hexlin("EEDFD2")
C_ORANGE = hexlin("EA470F")
C_ORANGE_HI = hexlin("F65726")
C_GREY_L = hexlin("B4A79C")
C_GREY_M = hexlin("8A7E74")
C_GREY_D = hexlin("4C352D")

# ============================================================================ scène
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.render.engine = "CYCLES"
cy = SC.cycles
SC.render.resolution_x, SC.render.resolution_y = ARGS["w"], ARGS["h"]
SC.render.resolution_percentage = 100
SC.render.pixel_aspect_x = SC.render.pixel_aspect_y = 1.0
SC.render.film_transparent = False
SC.render.dither_intensity = 0.0
SC.render.use_motion_blur = False
SC.render.threads_mode = "FIXED"
SC.render.threads = 2
SC.display_settings.display_device = "sRGB"
SC.view_settings.view_transform = "Standard"
SC.view_settings.look = "None"
SC.view_settings.exposure = 0.0
SC.view_settings.gamma = 1.0
SC.sequencer_colorspace_settings.name = "sRGB"
im = SC.render.image_settings
im.file_format = "PNG"
im.color_mode = "RGB"
im.color_depth = "16"
im.compression = 15
im.color_management = "FOLLOW_SCENE"
SC.render.use_file_extension = True

# réglages communs du film (build/mojito/scene.py : appareil, échantillons, débruitage sur la carte, rebonds) puis, pour les
# images de papier (0-55), une version plus légère ; les images d'atelier (56-71) gardent exactement les réglages communs
import types  # noqa: E402
A.S.regler_rendu(types.SimpleNamespace(device=ARGS["device"].upper(), res=ARGS["res"], spp=ARGS["spp"], vue="Standard", exposition=0.0))
SC.render.pixel_aspect_x = SC.render.pixel_aspect_y = 1.0
SC.render.film_transparent = False
SC.render.dither_intensity = 0.0
SC.render.use_motion_blur = False
SC.render.threads_mode = "FIXED"
SC.render.threads = ARGS["threads"]
SC.display_settings.display_device = "sRGB"
SC.view_settings.view_transform = "Standard"
SC.view_settings.look = "None"
SC.sequencer_colorspace_settings.name = "sRGB"
SC.render.image_settings.color_mode = "RGB"
SC.render.image_settings.compression = 15
SC.render.use_file_extension = True
cy.use_animated_seed = False
cy.pixel_filter_type = "BLACKMAN_HARRIS"
cy.use_light_tree = True
SHARED = dict(adaptive=cy.use_adaptive_sampling, max=cy.max_bounces, diffuse=cy.diffuse_bounces, glossy=cy.glossy_bounces,
              trans=cy.transmission_bounces, vol=cy.volume_bounces, tmax=cy.transparent_max_bounces, cr=cy.caustics_reflective,
              cf=cy.caustics_refractive, blur=cy.blur_glossy, clamp=cy.sample_clamp_indirect)


def apply_look(f):
    """Images 0-55 : réglages légers (papier) ; 56-71 : exactement ceux du film (raccord avec la séquence 2)."""
    if f >= 56:
        cy.use_adaptive_sampling = SHARED["adaptive"]; cy.max_bounces = SHARED["max"]; cy.diffuse_bounces = SHARED["diffuse"]
        cy.glossy_bounces = SHARED["glossy"]; cy.transmission_bounces = SHARED["trans"]; cy.volume_bounces = SHARED["vol"]
        cy.transparent_max_bounces = SHARED["tmax"]; cy.caustics_reflective = SHARED["cr"]; cy.caustics_refractive = SHARED["cf"]
        cy.blur_glossy = SHARED["blur"]; cy.sample_clamp_indirect = SHARED["clamp"]
        cy.filter_width = 1.5
    else:
        cy.use_adaptive_sampling = False
        cy.max_bounces = 6; cy.diffuse_bounces = 3; cy.glossy_bounces = 2; cy.transmission_bounces = 2
        cy.volume_bounces = 0; cy.transparent_max_bounces = 8
        cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.0
        cy.sample_clamp_indirect = 6.0
        cy.filter_width = float(ARGS["filter"]) if f <= 11 else 1.0


world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (*C_BLACK, 1)
bg.inputs[1].default_value = 0.0
SC.world = world
WORLD_BG = bg

# ============================================================================ matériaux
M_NODES = []          # valeurs « à plat -> éclairé » à mettre à jour image par image
TAU_NODES = []        # teinte de la bande sur la feuille
IMAGES = {}


def load_img(name, data=False):
    if name in IMAGES:
        return IMAGES[name]
    img = bpy.data.images.load(os.path.join(CACHE, name))
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    img.alpha_mode = "STRAIGHT"
    IMAGES[name] = img
    return img


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt


def N(nt, kind, x=0, y=0, **kw):
    n = nt.nodes.new(kind)
    n.location = (x, y)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def mval(nt, store, val=0.0):
    n = N(nt, "ShaderNodeValue")
    n.outputs[0].default_value = val
    store.append(n)
    return n


def out_node(nt, shader_out):
    o = N(nt, "ShaderNodeOutputMaterial")
    link(nt, shader_out, o.inputs["Surface"])


def flat_lit(nt, color_socket_or_rgb, rough=1.0, flat_color=None, m_node=None, normal=None):
    """Mix(Émission « à plat », Diffuse éclairé ; facteur M). Renvoie la sortie shader."""
    em = N(nt, "ShaderNodeEmission")
    df = N(nt, "ShaderNodeBsdfDiffuse")
    df.inputs["Roughness"].default_value = rough
    for node, key in ((em, "Color"), (df, "Color")):
        src = flat_color if (node is em and flat_color is not None) else color_socket_or_rgb
        if isinstance(src, tuple):
            node.inputs[key].default_value = (*src, 1.0)
        else:
            link(nt, src, node.inputs[key])
    em.inputs["Strength"].default_value = 1.0
    if normal is not None:
        link(nt, normal, df.inputs["Normal"])
    mx = N(nt, "ShaderNodeMixShader")
    link(nt, m_node.outputs[0], mx.inputs[0])
    link(nt, em.outputs[0], mx.inputs[1])
    link(nt, df.outputs[0], mx.inputs[2])
    return mx.outputs[0]


def window_uv(nt, from_uv=False):
    """Coordonnées de texture en pleine fenêtre à partir de la position objet (monde local du plan)."""
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.vector_type = "POINT"
    mp.inputs["Scale"].default_value = (1 / tl.WIN_W, 1 / tl.WIN_H, 1.0)
    _sx, _sy = [float(v) for v in str(ARGS['uvshift']).split(',')]
    mp.inputs["Location"].default_value = (0.5 + _sx / tl.WIN_W, 0.5 + _sy / tl.WIN_H, 0.0)
    link(nt, tc.outputs["Object"], mp.inputs["Vector"])
    return mp.outputs["Vector"], tc


def tex_node(nt, name, vec, data=False, ext="EXTEND"):
    t = N(nt, "ShaderNodeTexImage")
    t.image = load_img(name, data)
    t.interpolation = "Linear"
    t.extension = ext
    t.projection = "FLAT"
    link(nt, vec, t.inputs["Vector"])
    return t


def uv_attr(nt):
    a = N(nt, "ShaderNodeUVMap")
    a.uv_map = "UVMap"
    return a.outputs["UV"]


def mat_sheet_front():
    m, nt = new_mat("sheet_front")
    vec, _ = window_uv(nt)
    t1 = tex_node(nt, "tex_base.png", vec)
    t2 = tex_node(nt, "tex_photo.png", vec)
    tau = mval(nt, TAU_NODES, 1.0)
    mix = N(nt, "ShaderNodeMix", data_type="RGBA")
    link(nt, tau.outputs[0], mix.inputs["Factor"])
    link(nt, t2.outputs["Color"], mix.inputs["A"])
    link(nt, t1.outputs["Color"], mix.inputs["B"])
    mm = mval(nt, M_NODES)
    out_node(nt, flat_lit(nt, mix.outputs["Result"], rough=1.0, m_node=mm))
    return m


def noise_bump(nt, scale, strength, detail=6.0, dist=0.0, vec=None, coord="Object", aniso=None):
    tc = N(nt, "ShaderNodeTexCoord")
    src = tc.outputs[coord]
    if aniso is not None:
        mp = N(nt, "ShaderNodeMapping")
        mp.inputs["Scale"].default_value = aniso
        link(nt, src, mp.inputs["Vector"])
        src = mp.outputs["Vector"]
    nz = N(nt, "ShaderNodeTexNoise")
    nz.noise_dimensions = "3D"
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    nz.inputs["Roughness"].default_value = 0.6
    link(nt, src, nz.inputs["Vector"])
    bp = N(nt, "ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = BUMP_D
    link(nt, nz.outputs["Fac"], bp.inputs["Height"])
    return bp.outputs["Normal"], nz


def mat_sheet_black():
    m, nt = new_mat("sheet_black")
    mm = mval(nt, M_NODES)
    out_node(nt, flat_lit(nt, (0.012, 0.011, 0.010), 1.0, flat_color=C_BLACK, m_node=mm))
    return m


def mat_wall():
    """Paroi déchirée : papier noir et fibres claires (tranche du carton)."""
    m, nt = new_mat("sheet_wall")
    nrm, nz = noise_bump(nt, 0.55, 0.6, detail=7.0, aniso=(1.0, 2.2, 0.6))
    nz2 = N(nt, "ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 0.9
    nz2.inputs["Detail"].default_value = 8.0
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.2, 0.35, 0.5)
    link(nt, tc.outputs["Object"], mp.inputs["Vector"])
    link(nt, mp.outputs["Vector"], nz2.inputs["Vector"])
    ramp = N(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.36
    ramp.color_ramp.elements[0].color = (*C_BLACK, 1)
    ramp.color_ramp.elements[1].position = 0.58
    ramp.color_ramp.elements[1].color = (0.62, 0.57, 0.50, 1)
    link(nt, nz2.outputs["Fac"], ramp.inputs["Fac"])
    df = N(nt, "ShaderNodeBsdfDiffuse")
    df.inputs["Roughness"].default_value = 1.0
    link(nt, ramp.outputs["Color"], df.inputs["Color"])
    link(nt, nrm, df.inputs["Normal"])
    em = N(nt, "ShaderNodeEmission")
    em.inputs["Color"].default_value = (*C_BLACK, 1)
    mx = N(nt, "ShaderNodeMixShader")
    mm = mval(nt, M_NODES)
    link(nt, mm.outputs[0], mx.inputs[0])
    link(nt, em.outputs[0], mx.inputs[1])
    link(nt, df.outputs[0], mx.inputs[2])
    out_node(nt, mx.outputs[0])
    return m


PK_NODES = []


def mat_pocket():
    m, nt = new_mat("pocket")
    vec, _ = window_uv(nt)
    t1 = tex_node(nt, "tex_base.png", vec)
    pk = mval(nt, PK_NODES, 0.0)
    mix = N(nt, "ShaderNodeMix", data_type="RGBA")
    link(nt, pk.outputs[0], mix.inputs["Factor"])
    link(nt, t1.outputs["Color"], mix.inputs["A"])
    mix.inputs["B"].default_value = (0.006, 0.0055, 0.005, 1)
    nrm, nz = noise_bump(nt, 0.7, 0.5, detail=6.0)
    mm = mval(nt, M_NODES)
    out_node(nt, flat_lit(nt, mix.outputs["Result"], rough=1.0, m_node=mm, normal=nrm))
    return m


RIM_NODES = []


def mat_strip():
    m, nt = new_mat("strip")
    vec = uv_attr(nt)
    t = tex_node(nt, "tex_strip.png", vec, ext="CLIP")
    ed = tex_node(nt, "tex_edge.png", vec, data=True, ext="CLIP")
    rim = tex_node(nt, "tex_rim.png", vec, data=True, ext="CLIP")
    mm = mval(nt, M_NODES)
    # face imprimée : noire à plat ; orange une fois arrachée (attribut « age » par sommet) ; l'envers est toujours orange
    age = N(nt, "ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="age")
    geo = N(nt, "ShaderNodeNewGeometry")
    ow = N(nt, "ShaderNodeMath", operation="MAXIMUM")
    link(nt, age.outputs["Fac"], ow.inputs[0])
    link(nt, geo.outputs["Backfacing"], ow.inputs[1])
    tc = N(nt, "ShaderNodeTexCoord")
    nzp = N(nt, "ShaderNodeTexNoise")
    nzp.inputs["Scale"].default_value = 0.9
    nzp.inputs["Detail"].default_value = 8.0
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    link(nt, tc.outputs["UV"], mp.inputs["Vector"])
    mp.inputs["Scale"].default_value = (1008.0, 1512.0, 1.0)
    link(nt, mp.outputs["Vector"], nzp.inputs["Vector"])
    ro = N(nt, "ShaderNodeValToRGB")
    ro.color_ramp.elements[0].position = 0.35
    ro.color_ramp.elements[0].color = (*[c * 0.9 for c in C_ORANGE], 1)
    ro.color_ramp.elements[1].position = 0.65
    ro.color_ramp.elements[1].color = (*[min(c * 1.1, 1.0) for c in C_ORANGE], 1)
    link(nt, nzp.outputs["Fac"], ro.inputs["Fac"])
    c1 = N(nt, "ShaderNodeMix", data_type="RGBA")
    link(nt, ow.outputs[0], c1.inputs["Factor"])
    link(nt, t.outputs["Color"], c1.inputs["A"])
    link(nt, ro.outputs["Color"], c1.inputs["B"])
    # tranche claire et fibreuse du papier déchiré, sur tout le pourtour
    nz2 = N(nt, "ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 0.55
    nz2.inputs["Detail"].default_value = 9.0
    mp2 = N(nt, "ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (1008.0, 1512.0, 1.0)
    link(nt, tc.outputs["UV"], mp2.inputs["Vector"])
    link(nt, mp2.outputs["Vector"], nz2.inputs["Vector"])
    fr = N(nt, "ShaderNodeValToRGB")
    fr.color_ramp.elements[0].position = 0.30
    fr.color_ramp.elements[0].color = (0.30, 0.27, 0.23, 1)
    fr.color_ramp.elements[1].position = 0.62
    fr.color_ramp.elements[1].color = (0.80, 0.75, 0.68, 1)
    link(nt, nz2.outputs["Fac"], fr.inputs["Fac"])
    ra = mval(nt, RIM_NODES, 0.0)
    rf = N(nt, "ShaderNodeMath", operation="MULTIPLY")
    link(nt, rim.outputs["Color"], rf.inputs[0])
    link(nt, ra.outputs[0], rf.inputs[1])
    c2 = N(nt, "ShaderNodeMix", data_type="RGBA")
    link(nt, rf.outputs[0], c2.inputs["Factor"])
    link(nt, c1.outputs["Result"], c2.inputs["A"])
    link(nt, fr.outputs["Color"], c2.inputs["B"])
    body = flat_lit(nt, c2.outputs["Result"], rough=1.0, flat_color=c2.outputs["Result"], m_node=mm)
    # lueur du bord supérieur (images 6-11) : bande gaussienne en x, masquée par le liseré du bord
    sep = N(nt, "ShaderNodeSeparateXYZ")
    link(nt, vec, sep.inputs["Vector"])
    xw = N(nt, "ShaderNodeMath", operation="MULTIPLY_ADD")
    link(nt, sep.outputs["X"], xw.inputs[0])
    xw.inputs[1].default_value = tl.WIN_W
    xw.inputs[2].default_value = -tl.WIN_W / 2
    gx = mval(nt, GLINT_X_NODES, -9999.0)
    dx = N(nt, "ShaderNodeMath", operation="SUBTRACT")
    link(nt, xw.outputs[0], dx.inputs[0])
    link(nt, gx.outputs[0], dx.inputs[1])
    sq = N(nt, "ShaderNodeMath", operation="MULTIPLY")
    link(nt, dx.outputs[0], sq.inputs[0])
    link(nt, dx.outputs[0], sq.inputs[1])
    sc = N(nt, "ShaderNodeMath", operation="MULTIPLY")
    link(nt, sq.outputs[0], sc.inputs[0])
    sc.inputs[1].default_value = -1.0 / (2 * 14.0 ** 2)
    ex = N(nt, "ShaderNodeMath", operation="EXPONENT")
    link(nt, sc.outputs[0], ex.inputs[0])
    gm = N(nt, "ShaderNodeMath", operation="MULTIPLY")
    link(nt, ex.outputs[0], gm.inputs[0])
    link(nt, ed.outputs["Color"], gm.inputs[1])
    gs = N(nt, "ShaderNodeMath", operation="MULTIPLY")
    link(nt, gm.outputs[0], gs.inputs[0])
    gs.inputs[1].default_value = 0.85
    gl = N(nt, "ShaderNodeEmission")
    gl.inputs["Color"].default_value = (*C_CREAM, 1)
    link(nt, gs.outputs[0], gl.inputs["Strength"])
    add = N(nt, "ShaderNodeAddShader")
    link(nt, body, add.inputs[0])
    link(nt, gl.outputs[0], add.inputs[1])
    tr = N(nt, "ShaderNodeBsdfTransparent")
    mx = N(nt, "ShaderNodeMixShader")
    link(nt, t.outputs["Alpha"], mx.inputs[0])
    link(nt, tr.outputs[0], mx.inputs[1])
    link(nt, add.outputs[0], mx.inputs[2])
    out_node(nt, mx.outputs[0])
    return m


GLINT_X_NODES = []


def mat_decal():
    m, nt = new_mat("wordmark_decal")
    vec, _ = window_uv(nt)
    t = tex_node(nt, "tex_wordmark.png", vec, ext="CLIP")
    em = N(nt, "ShaderNodeEmission")
    link(nt, t.outputs["Color"], em.inputs["Color"])
    tr = N(nt, "ShaderNodeBsdfTransparent")
    mx = N(nt, "ShaderNodeMixShader")
    link(nt, t.outputs["Alpha"], mx.inputs[0])
    link(nt, tr.outputs[0], mx.inputs[1])
    link(nt, em.outputs[0], mx.inputs[2])
    out_node(nt, mx.outputs[0])
    return m


def mat_card():
    """Lettres en carton : face crème mate à fibres fines, tranche plus grise, feuilletée (épaisseur visible)."""
    m, nt = new_mat("card")
    nrm, nz = noise_bump(nt, 2.2, 0.10, detail=8.0, aniso=(1.0, 2.5, 1.0))
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.4, 0.9, 0.9)
    link(nt, tc.outputs["Object"], mp.inputs["Vector"])
    fib = N(nt, "ShaderNodeTexNoise")
    fib.inputs["Scale"].default_value = 1.6
    fib.inputs["Detail"].default_value = 10.0
    link(nt, mp.outputs["Vector"], fib.inputs["Vector"])
    face = N(nt, "ShaderNodeValToRGB")
    face.color_ramp.elements[0].position = 0.35
    face.color_ramp.elements[0].color = (*[c * 0.90 for c in C_CREAM], 1)
    face.color_ramp.elements[1].position = 0.70
    face.color_ramp.elements[1].color = (*[min(c * 1.0, 1.0) for c in C_CREAM], 1)
    link(nt, fib.outputs["Fac"], face.inputs["Fac"])
    # tranche : feuilletage le long de l'épaisseur (z local)
    mp2 = N(nt, "ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (0.25, 0.25, 1.4)
    link(nt, tc.outputs["Object"], mp2.inputs["Vector"])
    lam = N(nt, "ShaderNodeTexNoise")
    lam.inputs["Scale"].default_value = 1.0
    lam.inputs["Detail"].default_value = 3.0
    link(nt, mp2.outputs["Vector"], lam.inputs["Vector"])
    edge = N(nt, "ShaderNodeValToRGB")
    edge.color_ramp.elements[0].position = 0.35
    edge.color_ramp.elements[0].color = (0.30, 0.27, 0.24, 1)
    edge.color_ramp.elements[1].position = 0.65
    edge.color_ramp.elements[1].color = (0.60, 0.55, 0.49, 1)
    link(nt, lam.outputs["Fac"], edge.inputs["Fac"])
    # normale locale : |n.z| grand = face, petit = tranche
    ng = N(nt, "ShaderNodeNewGeometry")
    vt = N(nt, "ShaderNodeVectorTransform", vector_type="NORMAL", convert_from="WORLD", convert_to="OBJECT")
    link(nt, ng.outputs["Normal"], vt.inputs["Vector"])
    sp = N(nt, "ShaderNodeSeparateXYZ")
    link(nt, vt.outputs["Vector"], sp.inputs["Vector"])
    ab = N(nt, "ShaderNodeMath", operation="ABSOLUTE")
    link(nt, sp.outputs["Z"], ab.inputs[0])
    sm = N(nt, "ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    link(nt, ab.outputs[0], sm.inputs["Value"])
    sm.inputs["From Min"].default_value = 0.35
    sm.inputs["From Max"].default_value = 0.85
    cm = N(nt, "ShaderNodeMix", data_type="RGBA")
    link(nt, sm.outputs["Result"], cm.inputs["Factor"])
    link(nt, edge.outputs["Color"], cm.inputs["A"])
    link(nt, face.outputs["Color"], cm.inputs["B"])
    mm = mval(nt, M_NODES)
    out_node(nt, flat_lit(nt, cm.outputs["Result"], rough=1.0, flat_color=C_CREAM, m_node=mm, normal=nrm))
    return m


def mat_plaster(name, albedo, bump=0.25, scale=0.9):
    m, nt = new_mat(name)
    nrm, nz = noise_bump(nt, scale, bump, detail=7.0)
    mm = mval(nt, M_NODES)
    df = N(nt, "ShaderNodeBsdfDiffuse")
    df.inputs["Roughness"].default_value = 0.9
    # variation de teinte douce
    ramp = N(nt, "ShaderNodeMix", data_type="RGBA")
    ramp.inputs["Factor"].default_value = 0.0
    df.inputs["Color"].default_value = (*albedo, 1)
    link(nt, nrm, df.inputs["Normal"])
    em = N(nt, "ShaderNodeEmission")
    em.inputs["Color"].default_value = (*albedo, 1)
    mx = N(nt, "ShaderNodeMixShader")
    link(nt, mm.outputs[0], mx.inputs[0])
    link(nt, em.outputs[0], mx.inputs[1])
    link(nt, df.outputs[0], mx.inputs[2])
    out_node(nt, mx.outputs[0])
    return m


def mat_slab():
    """Face avant : impression de la bande (image 12) qui devient pigment pressé ; faces latérales : pigment."""
    m, nt = new_mat("slab")
    vec = uv_attr(nt)
    t = tex_node(nt, "tex_base.png", vec)
    mm = mval(nt, M_NODES)
    printed = flat_lit(nt, t.outputs["Color"], rough=1.0, m_node=mm)
    # pigment : grain fin, teinte variable de ~8 %
    nrm, nz = noise_bump(nt, 1.1, 0.5, detail=10.0)
    tc = N(nt, "ShaderNodeTexCoord")
    vor = N(nt, "ShaderNodeTexVoronoi")
    vor.voronoi_dimensions = "3D"
    vor.inputs["Scale"].default_value = 0.8
    link(nt, tc.outputs["Object"], vor.inputs["Vector"])
    nz3 = N(nt, "ShaderNodeTexNoise")
    nz3.inputs["Scale"].default_value = 0.035
    nz3.inputs["Detail"].default_value = 3.0
    link(nt, tc.outputs["Object"], nz3.inputs["Vector"])
    ramp = N(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*[c * 0.94 for c in C_ORANGE], 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (*[min(c * 1.06, 1.0) for c in C_ORANGE], 1)
    link(nt, nz3.outputs["Fac"], ramp.inputs["Fac"])
    grain = N(nt, "ShaderNodeMix", data_type="RGBA")
    grain.blend_type = "MULTIPLY"
    grain.inputs["Factor"].default_value = 0.25
    link(nt, ramp.outputs["Color"], grain.inputs["A"])
    bp2 = N(nt, "ShaderNodeBump")
    bp2.inputs["Strength"].default_value = 0.35
    bp2.inputs["Distance"].default_value = BUMP_D
    link(nt, vor.outputs["Distance"], bp2.inputs["Height"])
    link(nt, nrm, bp2.inputs["Normal"])
    df = N(nt, "ShaderNodeBsdfDiffuse")
    df.inputs["Roughness"].default_value = 0.95
    link(nt, ramp.outputs["Color"], df.inputs["Color"])
    link(nt, bp2.outputs["Normal"], df.inputs["Normal"])
    g = mval(nt, SLAB_G_NODES, 0.0)
    mx = N(nt, "ShaderNodeMixShader")
    link(nt, g.outputs[0], mx.inputs[0])
    link(nt, printed, mx.inputs[1])
    link(nt, df.outputs[0], mx.inputs[2])
    out_node(nt, mx.outputs[0])
    return m


SLAB_G_NODES = []


def mat_fibre():
    m, nt = new_mat("fibre")
    mm = mval(nt, M_NODES)
    out_node(nt, flat_lit(nt, (0.45, 0.40, 0.34), 1.0, flat_color=C_BLACK, m_node=mm))
    return m


MAT = dict(front=mat_sheet_front(), black=mat_sheet_black(), wall=mat_wall(), strip=mat_strip(), decal=mat_decal(),
           plaster=mat_card(), pocket=mat_pocket(), slab=mat_slab(),
           floor=mat_plaster("floor", C_GREY_L, 0.4, 0.45), fibre=mat_fibre())

# ============================================================================ géométrie


def mesh_obj(name, verts, faces, mats=None, mat_idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts, np.float32).tolist(), [], [tuple(int(i) for i in fc) for fc in faces])
    me.update()
    if mats:
        for m in mats:
            me.materials.append(m)
        if mat_idx is not None:
            me.polygons.foreach_set("material_index", np.asarray(mat_idx, np.int32))
    ob = bpy.data.objects.new(name, me)
    SC.collection.objects.link(ob)
    return ob


def set_uv_from_xy(ob, scale=(1 / tl.WIN_W, 1 / tl.WIN_H), off=(0.5, 0.5), vsrc=None):
    me = ob.data
    uvl = me.uv_layers.new(name="UVMap")
    co = np.array([v.co[:] for v in me.vertices], np.float32) if vsrc is None else vsrc
    vi = np.array([l.vertex_index for l in me.loops], np.int32)
    uv = np.stack([co[vi, 0] * scale[0] + off[0], co[vi, 1] * scale[1] + off[1]], 1)
    uvl.data.foreach_set("uv", uv.astype(np.float32).ravel())


# ---- feuille épaisse trouée
SHEET = mesh_obj("sheet", GEO["sheet_v"], GEO["sheet_f"], [MAT["front"], MAT["black"], MAT["wall"], MAT["pocket"]], GEO["sheet_m"])
for p in SHEET.data.polygons:
    p.use_smooth = False
# alvéole de la bande : sa profondeur croît de presque rien (image 12, impression à plat) à 6 px (image 15), sans décalage de parallaxe à plat
_sv = GEO["sheet_v"]
POCKET_IDX = np.nonzero((np.abs(_sv[:, 2] + 6.0) < 1e-3) | (np.abs(_sv[:, 2] + 3.0) < 1e-3))[0]
POCKET_Z0 = _sv[POCKET_IDX, 2].copy()
_pk_last = [None]


def update_pocket(f):
    k = 0.05 + 0.95 * tl.ss((f - 12.0) / 3.0)
    if _pk_last[0] == k:
        return
    _pk_last[0] = k
    co = np.empty((len(SHEET.data.vertices), 3), np.float32)
    SHEET.data.vertices.foreach_get("co", co.ravel())
    co[POCKET_IDX, 2] = POCKET_Z0 * k
    SHEET.data.vertices.foreach_set("co", co.ravel())
    SHEET.data.update()

# ---- fibres de la déchirure
fib = GEO["fibres"]
cu = bpy.data.curves.new("fibres", "CURVE")
cu.dimensions = "3D"
cu.bevel_depth = 0.22
cu.bevel_resolution = 0
cu.use_fill_caps = True
for pts in fib:
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for k, p in enumerate(pts):
        sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
FIBRES = bpy.data.objects.new("fibres", cu)
cu.materials.append(MAT["fibre"])
SC.collection.objects.link(FIBRES)

# ---- bande déchirée (tissu) : maillage dont les positions viennent de strip.npz
strip_v0 = GEO["strip_v"].copy()
strip_v0[:, 2] = 0.03          # presque au contact de la feuille : pas de décalage de parallaxe à plat
STRIP_OB = mesh_obj("strip", strip_v0, GEO["strip_f"], [MAT["strip"]])
set_uv_from_xy(STRIP_OB, vsrc=strip_v0)
STRIP_AGE = STRIP_OB.data.attributes.new("age", "FLOAT", "POINT")
import sim_strip as _SS  # noqa: E402  (constantes de la libération : pas de simulation ici)
_u = GEO["strip_u"].astype(np.float64)
STRIP_TREL = _SS.T_PEEL[0] + (_SS.T_PEEL[1] - _SS.T_PEEL[0]) * (1 - _u)
STRIP_TREL[_u < 0.035] = _SS.T_LEFT
for p in STRIP_OB.data.polygons:
    p.use_smooth = True

# ---- décalque à plat du lettrage (images 0-12)
DECAL = mesh_obj("decal", [(-504, -756, 0.07), (504, -756, 0.07), (504, 756, 0.07), (-504, 756, 0.07)], [(0, 1, 2, 3)], [MAT["decal"]])
set_uv_from_xy(DECAL)

# ---- lettres : 9 jeux (lettrage d'origine + 8 caractères)
LET = {}


def build_letters(key):
    V = GEO[f"let/{key}/v"].astype(np.float64)
    T = GEO[f"let/{key}/t"]
    idx = GEO[f"let/{key}/ring_idx"]
    lens = GEO[f"let/{key}/ring_len"]
    n = len(V)
    faces = []
    for t in T:
        a, b, c = [int(q) for q in t]
        cz = (V[b, 0] - V[a, 0]) * (V[c, 1] - V[a, 1]) - (V[b, 1] - V[a, 1]) * (V[c, 0] - V[a, 0])
        if cz < 0:
            b, c = c, b
        faces.append((a, b, c))                                   # face avant : normale +z
        faces.append((n + a, n + c, n + b))                       # face arrière : normale -z
    o = 0
    for L in lens:
        r = idx[o:o + L]
        o += L
        for k in range(L):
            i, j = int(r[k]), int(r[(k + 1) % L])
            faces.append((i, n + i, n + j, j))                    # paroi, normale vers l'extérieur de la matière
    verts = np.zeros((2 * n, 3), np.float32)
    verts[:n, :2] = V
    verts[n:, :2] = V
    verts[:n, 2] = 0.5
    verts[n:, 2] = -0.5
    ob = mesh_obj("let_" + key, verts, faces, [MAT["plaster"]])
    for p in ob.data.polygons:                                  # cartes à plat (pas d'éventail de triangles), parois lisses
        p.use_smooth = abs(p.normal.z) < 0.5
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:                                          # arêtes carte/paroi vives
        if len(e.link_faces) == 2:
            f0, f1 = e.link_faces
            if (abs(f0.normal.z) > 0.99) != (abs(f1.normal.z) > 0.99):
                e.smooth = False
        else:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    md = ob.modifiers.new("bevel", "BEVEL")
    md.width = 2.0
    md.segments = 3
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(35)
    md.harden_normals = False
    md.use_clamp_overlap = True
    ob["n"] = n
    LET[key] = (ob, V.astype(np.float32), n)


for key in ["orig", "archivo-var", "anton", "permanent-marker", "saira-stencil-one",
            "doto-var", "major-mono-display", "instrument-serif-italic", "bodoni-moda-var"]:
    build_letters(key)

# ---- dalle orange
SW, SH, ST = tl.SLAB_W, tl.SLAB_H, tl.SLAB_T
bm = bmesh.new()
sv = [bm.verts.new((sx * SW / 2, sy * SH / 2, sz * 0.5)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
# indices : (sx,sy,sz) -> 4*[sx>0] + 2*[sy>0] + [sz>0]


def V8(sx, sy, sz):
    return sv[4 * (sx > 0) + 2 * (sy > 0) + (sz > 0)]


for quad in (((1, -1, 1), (1, 1, 1), (-1, 1, 1), (-1, -1, 1)),      # avant +z
             ((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)),  # arrière -z
             ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)),      # +x
             ((-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)),  # -x
             ((-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)),      # +y
             ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1))): # -y
    bm.faces.new([V8(*q) for q in quad])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
SLAB_ME = bpy.data.meshes.new("slab")
bm.to_mesh(SLAB_ME)
bm.free()
SLAB_ME.materials.append(MAT["slab"])
SLAB = bpy.data.objects.new("slab", SLAB_ME)
SC.collection.objects.link(SLAB)
# UV : coordonnées de fenêtre au repos (le centre au repos est (SLAB_X0, SLAB_Y0))
_co = np.array([v.co[:] for v in SLAB_ME.vertices], np.float32)
_rest = _co.copy()
_rest[:, 0] += tl.SLAB_X0
_rest[:, 1] += tl.SLAB_Y0
set_uv_from_xy(SLAB, vsrc=_rest)
for p in SLAB_ME.polygons:
    p.use_smooth = False
_md = SLAB.modifiers.new("bevel", "BEVEL")
_md.width = 2.4
_md.segments = 3
_md.limit_method = "ANGLE"
_md.angle_limit = math.radians(35)
_md.use_clamp_overlap = True
SLAB_VCO = _co.copy()

# ---- groupe « avant » : tout ce qui est devant l'atelier (feuille, bande, lettres, dalle) vit en px sous un parent à l'échelle S_M
FRONT = bpy.data.objects.new("avant", None)
SC.collection.objects.link(FRONT)
FRONT.matrix_world = Matrix.Translation(Vector((XC_W, YC_W, ZC_W))) @ Matrix(((S_M, 0, 0), (0, 0, -S_M), (0, S_M, 0))).to_4x4()
for _o in [SHEET, FIBRES, STRIP_OB, DECAL, SLAB] + [v[0] for v in LET.values()]:
    _o.parent = FRONT
    _o.matrix_parent_inverse = Matrix.Identity(4)

# ---- l'atelier (derrière la feuille)
ATELIER_OBJ = A.faire_sol_et_mur(D_ATELIER)
LETTRES_AT = A.faire_lettres(D_ATELIER)
A.poser_lettres(LETTRES_AT, 72)
ATELIER_LIGHTS = list(A.eclairer(D_ATELIER))
GRAINS = A.GrainsMixtes("grains_dalle", os.path.join(A.SIMS, "dalle"), D_ATELIER)
GRAINS.cacher(True)

# ============================================================================ lumières
KEY_FRONT_L = Vector((-0.85, 0.38, 0.36)).normalized()
KEY_BACK_L = Vector((-0.88, 0.40, 0.25)).normalized()


def aim(ob, direction_from_target_to_light):
    """Oriente un projecteur (qui éclaire selon son -Z local) pour qu'il éclaire dans la direction opposée."""
    z = Vector(direction_from_target_to_light).normalized()
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(z)


def add_light(name, kind, **kw):
    ld = bpy.data.lights.new(name, kind)
    for k, v in kw.items():
        setattr(ld, k, v)
    ob = bpy.data.objects.new(name, ld)
    SC.collection.objects.link(ob)
    return ob


LIGHT_STRENGTH = dict(key_front=11.0, fill_front=3200.0 * S_M ** 2)
_Lw = lambda v: Vector((v.x, -v.z, v.y))           # direction px -> monde (x->X, y->Z, z->-Y)
key_f = add_light("key_front", "SUN", energy=LIGHT_STRENGTH["key_front"], angle=math.radians(5.0), color=(1.0, 0.88, 0.74))
aim(key_f, _Lw(KEY_FRONT_L))
fill_f = add_light("fill_front", "AREA", energy=LIGHT_STRENGTH["fill_front"], shape="SQUARE", size=2600.0 * S_M, color=(1.0, 0.95, 0.9))
fill_f.location = pw((150.0, 500.0, 2300.0))
aim(fill_f, (0.0, -1.0, 0.0))
# les lumières de l'avant n'éclairent que l'avant (feuille, bande, lettres, dalle de passage) : l'atelier a ses propres lumières
FRONT_COLL = bpy.data.collections.new("recepteurs_avant")
for _o in [SHEET, FIBRES, STRIP_OB, DECAL, SLAB] + [v[0] for v in LET.values()]:
    FRONT_COLL.objects.link(_o)
for _l in (key_f, fill_f):
    _l.light_linking.receiver_collection = FRONT_COLL

# ============================================================================ caméra
CAMD = bpy.data.cameras.new("cam")
CAMD.type = "PERSP"
CAMD.sensor_fit = "VERTICAL"
CAMD.sensor_height = 36.0
CAMD.clip_start = 2e-5
CAMD.clip_end = 30.0
CAM = bpy.data.objects.new("cam", CAMD)
SC.collection.objects.link(CAM)
SC.camera = CAM


def cam_matrix(pos, tgt):
    """Même construction que anim.regarder (haut = +Z du monde, sauf en vue plongeante)."""
    p = Vector(pos)
    avant = (Vector(tgt) - p).normalized()
    w = avant.z * avant.z
    haut = (Vector((0, 0, 1)) * (1 - w) + Vector((0, 1, 0)) * w).normalized()
    droite = avant.cross(haut).normalized()
    haut = droite.cross(avant)
    R = Matrix((droite, haut, -avant)).transposed()
    return R, avant, droite, haut


def hermite(p0, v0, p1, v1, u):
    h00 = 2 * u ** 3 - 3 * u ** 2 + 1
    h10 = u ** 3 - 2 * u ** 2 + u
    h01 = -2 * u ** 3 + 3 * u ** 2
    h11 = u ** 3 - u ** 2
    return p0 * h00 + v0 * h10 + p1 * h01 + v1 * h11


def mine_cam(f):
    pos, tgt, F = tl.cam_state(f)
    return pw(pos), pw(tgt), F * 36.0 / tl.WIN_H


def cam_world(f):
    """(position, cible, focale mm, ouverture, mise au point) dans le monde de l'atelier.
    A partir de l'image 60 : exactement camera_atelier(f, d) ; avant : la plongée, avec la cible et la focale fondues
    vers celles de l'atelier (position et vitesse continues à l'image 60)."""
    if f >= 60:
        p, t, mm, fs, fo = GS.camera_atelier(f, D_ATELIER)
        return Vector(p), Vector(t), float(mm), float(fs), float(fo)
    p, t, mm = mine_cam(f)
    if f >= 55:
        t0 = mine_cam(55)[1]
        v0 = (mine_cam(56)[1] - mine_cam(54)[1]) / 2.0
        t1 = GS.camera_atelier(60, D_ATELIER)[1]
        v1 = GS.camera_atelier(61, D_ATELIER)[1] - GS.camera_atelier(60, D_ATELIER)[1]
        t = hermite(t0, v0 * 5.0, Vector(t1), v1 * 5.0, (f - 55.0) / 5.0)
    if f >= 53:
        mm = mm + (GS.camera_atelier(60, D_ATELIER)[2] - mm) * tl.ss((f - 53.0) / 7.0)
    return p, t, float(mm), None, None


def set_camera(f):
    pos, tgt, mm, fs, fo = cam_world(f)
    R, fwd, right, up = cam_matrix(pos, tgt)
    CAM.matrix_world = Matrix.Translation(pos) @ R.to_4x4()
    CAMD.lens = mm
    CAMD.dof.use_dof = fs is not None
    if fs is not None:
        CAMD.dof.aperture_fstop = fs
        CAMD.dof.focus_distance = fo
    return pos, fwd, right, up, mm


# animation de caméra (flou de mouvement de la plongée) : clés à chaque image
def key_camera(f0, f1):
    CAM.rotation_mode = "QUATERNION"
    ad = CAM.animation_data_create()
    for f in range(max(f0 - 1, 0), f1 + 2):
        pos, tgt, mm, fs, fo = cam_world(f)
        R, *_ = cam_matrix(pos, tgt)
        CAM.location = pos
        CAM.rotation_quaternion = R.to_quaternion()
        CAM.keyframe_insert("location", frame=f)
        CAM.keyframe_insert("rotation_quaternion", frame=f)
    act = ad.action
    try:
        fcs = list(act.fcurves)
    except Exception:
        fcs = []
        for layer in getattr(act, "layers", []):
            for strip in layer.strips:
                for bag in strip.channelbags:
                    fcs += list(bag.fcurves)
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


# ============================================================================ pose par image
def project(p, pos, right, up, fwd, F):
    d = Vector(p) - Vector(pos)
    z = d.dot(fwd)
    return (tl.WIN_W / 2 + F * d.dot(right) / z, tl.WIN_H / 2 - F * d.dot(up) / z, z)


def update_letters(f):
    face = tl.letters_face(f)
    zb, dp, s = tl.letters_state(f)
    for key, (ob, V, n) in LET.items():
        vis = key == face
        ob.hide_render = not vis
        ob.hide_viewport = not vis
        if vis:
            co = np.empty((len(ob.data.vertices), 3), np.float32)
            ob.data.vertices.foreach_get("co", co.ravel())
            co[:n, 2] = dp / 2
            co[n:, 2] = -dp / 2
            ob.data.vertices.foreach_set("co", co.ravel())
            ob.data.update()
            dx, _, dz = tl.sheet_drift(f)
            ob.location = (0.0, 0.0, zb + dp / 2)
            ob.scale = (s, s * 1.0, 1.0)
            # recentrage : l'échelle dans le plan se fait autour du centre du lettrage d'origine
            cx, cy = GEO["word_fit"][1], GEO["word_fit"][2]
            ob.location = (cx * (1 - s), cy * (1 - s), zb + dp / 2)


def update_slab(f):
    show = f >= 12
    SLAB.hide_render = not show
    if not show:
        return None
    cx, cy_, cz, th, t = tl.slab_pose(f)
    co = SLAB_VCO.copy()
    co[:, 2] = np.sign(co[:, 2]) * t / 2
    SLAB.data.vertices.foreach_set("co", co.ravel())
    SLAB.data.update()
    SLAB.rotation_mode = "XYZ"
    SLAB.rotation_euler = (-th, 0.0, 0.0)
    SLAB.location = (cx, cy_, cz)
    for g in SLAB_G_NODES:
        g.outputs[0].default_value = tl.slab_print_mix(f)
    return cx, cy_, cz, th, t


def update_strip(f):
    show = f <= 47
    STRIP_OB.hide_render = not show
    k = min(max(f, STRIP_F0), STRIP_F0 + len(STRIP_FR) - 1) - STRIP_F0
    P = STRIP_FR[k] if f >= 12 else strip_v0
    STRIP_OB.data.vertices.foreach_set("co", np.ascontiguousarray(P, np.float32).ravel())
    STRIP_OB.data.attributes["age"].data.foreach_set("value", np.clip((f - STRIP_TREL) / 4.0, 0, 1).astype(np.float32))
    STRIP_OB.data.update()
    STRIP_OB.location = tl.sheet_drift(f)


def set_state(f):
    m = tl.light_mix(f)
    for n in M_NODES:
        n.outputs[0].default_value = m
    for n in PK_NODES:
        n.outputs[0].default_value = tl.ss((f - 12.0) / 4.0)
    for n in RIM_NODES:
        n.outputs[0].default_value = tl.ss((f - 12.0) / 2.5)
    WORLD_BG.inputs[0].default_value = (0.0006, 0.0006, 0.0006, 1.0)
    WORLD_BG.inputs[1].default_value = 1.0 if f >= 56 else 0.0
    for n in TAU_NODES:
        n.outputs[0].default_value = 1.0 if f <= 12 else max(0.0, 1.0 - (f - 12.0) / 2.0)
    gx = tl.glint_pos(f)
    for n in GLINT_X_NODES:
        n.outputs[0].default_value = -9999.0 if gx is None else gx
    d = tl.sheet_drift(f)
    SHEET.location = d
    FIBRES.location = d
    FIBRES.hide_render = f < 12
    DECAL.hide_render = f > 12
    update_pocket(f)
    update_strip(f)
    update_letters(f)
    slab = update_slab(f)
    # l'atelier : obscurité dans la fente tant que la dalle n'est pas en route ; dalle en grains dès qu'elle est posée
    if f >= 47 and SLAB.name in FRONT_COLL.objects:
        FRONT_COLL.objects.unlink(SLAB)              # derrière la feuille la dalle n'est plus éclairée que par l'atelier
    elif f < 47 and SLAB.name not in FRONT_COLL.objects:
        FRONT_COLL.objects.link(SLAB)
    at = f >= 47
    for o in ATELIER_OBJ + list(LETTRES_AT.values()) + ATELIER_LIGHTS:
        o.hide_render = not at
    if at:
        A.poser_lettres(LETTRES_AT, 72)
    if f >= 59:
        SLAB.hide_render = True
    return slab


# ============================================================================ rendu
def render_frame(f, outdir, stats):
    t0 = time.time()
    SC.frame_set(f)
    slab = set_state(f)
    pos, fwd, right, up, F = set_camera(f)
    apply_look(f)
    bpy.context.view_layer.update()                # la caméra de l'image est en place : le niveau de détail des grains en dépend
    if f >= 59:
        GRAINS.poser(72, CAM, SC)                  # dalle de grains à son état de repos (image 72), cristaux proches / points lointains
    else:
        GRAINS.cacher(True)
    t_prep = time.time() - t0
    SC.render.use_motion_blur = 49 <= f <= 65
    SC.render.motion_blur_shutter = 0.45
    cy.seed = 1000 + f
    dn = ARGS["denoise"]
    flat = f <= 11 and not (dn == "on")
    use_dn = (dn == "on") or (dn == "auto" and not flat)
    cy.use_denoising = use_dn
    if use_dn:
        try:
            cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
            cy.denoising_prefilter = "ACCURATE"
        except Exception:
            pass
    SC.render.filepath = os.path.join(outdir, f"f{f:04d}{ARGS['tag']}")
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    stats[f] = round(dt, 2)
    print(f"[f{f:04d}] {dt:.1f} s (préparation {t_prep:.1f} s)", flush=True)
    # contrôle : écart entre la caméra réellement posée et camera_atelier(f, d)
    p, t, mm, fs, fo = GS.camera_atelier(f, D_ATELIER) if f >= 60 else (None,) * 5
    rec = None
    if p is not None:
        w = CAM.matrix_world
        fwd_r = -(w.to_3x3() @ Vector((0, 0, 1)))
        fwd_a = (Vector(t) - Vector(p)).normalized()
        rec = dict(frame=f, d_position_m=(w.translation - Vector(p)).length, d_direction_deg=math.degrees(fwd_r.angle(fwd_a, 0.0)),
                   d_cible_m=(w.translation + fwd_r * (Vector(t) - Vector(p)).length - Vector(t)).length, d_focale_mm=abs(CAMD.lens - mm))
    return rec


def main():
    os.makedirs(ARGS["out"], exist_ok=True)
    f0, f1 = ARGS["f0"], ARGS["f1"]
    frames = ARGS["only"] if ARGS["only"] else list(range(f0, f1 + 1))
    key_camera(min(frames), max(frames))
    stats, recs = {}, []
    for f in frames:
        if ARGS["arret"] and time.time() > ARGS["arret"]:
            print(f"arrêt avant l'image {f} : délai atteint", flush=True)
            break
        if ARGS["reprise"] and os.path.exists(os.path.join(ARGS["out"], f"f{f:04d}{ARGS['tag']}.png")):
            continue
        r = render_frame(f, ARGS["out"], stats)
        if r:
            recs.append(r)
    tpath = os.path.join(ARGS["out"], "temps.json")
    old = json.load(open(tpath)) if os.path.exists(tpath) else {}
    old.update({str(k): v for k, v in stats.items()})
    json.dump(dict(sorted(old.items(), key=lambda kv: int(kv[0]))), open(tpath, "w"), indent=0)
    if recs and not ARGS["tag"]:
        cpath = os.path.join(ARGS["out"], "ecart_camera.json")
        prev = json.load(open(cpath)) if os.path.exists(cpath) else {}
        for r in recs:
            prev[str(r["frame"])] = r
        json.dump(prev, open(cpath, "w"), indent=1)

main()
