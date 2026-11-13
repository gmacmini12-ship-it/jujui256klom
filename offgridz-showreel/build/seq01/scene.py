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
             denoise="auto", only=None, tag="", filter="0.05", uvshift="0,0")
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
    if a["only"]:
        a["only"] = [int(v) for v in str(a["only"]).split(",")]
    return a


ARGS = parse_args()


def ensure_cache():
    need = [os.path.join(CACHE, n) for n in ("geo.npz", "strip.npz", "tex_base.png")]
    if all(os.path.exists(p) for p in need):
        return
    for script in ("prep.py", "sim_strip.py"):
        print("fabrication du cache :", script, flush=True)
        subprocess.check_call([VENV_PY, os.path.join(HERE, script)])


ensure_cache()
GEO = np.load(os.path.join(CACHE, "geo.npz"))
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

cy.samples = ARGS["spp"]
cy.use_adaptive_sampling = False
cy.film_exposure = 1.0
cy.max_bounces = 6
cy.diffuse_bounces = 3
cy.glossy_bounces = 2
cy.transmission_bounces = 2
cy.transparent_max_bounces = 8
cy.sample_clamp_direct = 0.0
cy.sample_clamp_indirect = 6.0
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.use_light_tree = True
SC.render.filter_size = float(ARGS['filter'])
cy.filter_width = float(ARGS['filter'])
cy.pixel_filter_type = 'BLACKMAN_HARRIS'
cy.use_animated_seed = False

if ARGS["device"].upper() == "OPTIX":
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    try:
        prefs.refresh_devices()
    except Exception:
        pass
    for d in prefs.devices:
        d.use = d.type in ("OPTIX", "CUDA")
    cy.device = "GPU"
else:
    cy.device = "CPU"

world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (*C_BLACK, 1)
bg.inputs[1].default_value = 0.0
SC.world = world

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


def flat_lit(nt, color_socket_or_rgb, rough=1.0, flat_color=None, m_node=None):
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
    bp.inputs["Distance"].default_value = 1.0
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
    ramp.color_ramp.elements[0].position = 0.46
    ramp.color_ramp.elements[0].color = (*C_BLACK, 1)
    ramp.color_ramp.elements[1].position = 0.70
    ramp.color_ramp.elements[1].color = (0.46, 0.40, 0.34, 1)
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


def mat_strip():
    m, nt = new_mat("strip")
    vec = uv_attr(nt)
    t = tex_node(nt, "tex_strip.png", vec, ext="CLIP")
    ed = tex_node(nt, "tex_edge.png", vec, data=True, ext="CLIP")
    mm = mval(nt, M_NODES)
    body = flat_lit(nt, t.outputs["Color"], rough=1.0, m_node=mm)
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
           plaster=mat_plaster("plaster", C_CREAM, 0.25, 0.7), slab=mat_slab(),
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
SHEET = mesh_obj("sheet", GEO["sheet_v"], GEO["sheet_f"], [MAT["front"], MAT["black"], MAT["wall"]], GEO["sheet_m"])
for p in SHEET.data.polygons:
    p.use_smooth = False

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
    for p in ob.data.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:                                          # arêtes carte/paroi vives
        if len(e.link_faces) == 2:
            f0, f1 = e.link_faces
            if abs(f0.normal.z) > 0.99 != abs(f1.normal.z) > 0.99:
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

# ---- sol de plâtre pâle derrière la feuille
FR = 9000.0
FLOOR = mesh_obj("floor", [(-6000, tl.FLOOR_Y, -60), (6000, tl.FLOOR_Y, -60), (6000, tl.FLOOR_Y, -FR), (-6000, tl.FLOOR_Y, -FR)],
                 [(0, 3, 2, 1)], [MAT["floor"]])

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


LIGHT_STRENGTH = dict(key_front=11.0, fill_front=3200.0, key_back=1.25e9, fill_back=1.2e7)
key_f = add_light("key_front", "SUN", energy=LIGHT_STRENGTH["key_front"], angle=math.radians(2.5), color=(1.0, 0.88, 0.74))
aim(key_f, KEY_FRONT_L)
fill_f = add_light("fill_front", "AREA", energy=LIGHT_STRENGTH["fill_front"], shape="SQUARE", size=2600.0, color=(1.0, 0.95, 0.9))
fill_f.location = (150.0, 500.0, 2300.0)
slab_f = Vector(tl.SLAB_F)
kb_pos = slab_f + KEY_BACK_L * 3800.0
key_b = add_light("key_back", "SPOT", energy=LIGHT_STRENGTH["key_back"], spot_size=math.radians(100), spot_blend=1.0,
                  shadow_soft_size=140.0, color=(1.0, 0.89, 0.77))
key_b.location = kb_pos
aim(key_b, KEY_BACK_L)
fill_b = add_light("fill_back", "AREA", energy=LIGHT_STRENGTH["fill_back"], shape="SQUARE", size=3400.0, color=(1.0, 0.93, 0.85))
fill_b.location = (-150.0, 120.0, -500.0)
aim(fill_b, (0.0, 0.0, 1.0))

# ============================================================================ caméra
CAMD = bpy.data.cameras.new("cam")
CAMD.type = "PERSP"
CAMD.sensor_fit = "HORIZONTAL"
CAMD.sensor_width = float(tl.WIN_W)
CAMD.clip_start = 0.3
CAMD.clip_end = 40000.0
CAM = bpy.data.objects.new("cam", CAMD)
SC.collection.objects.link(CAM)
SC.camera = CAM


def cam_matrix(pos, tgt):
    p = Vector(pos)
    fwd = (Vector(tgt) - p).normalized()
    right = fwd.cross(Vector((0, 1, 0))).normalized()
    up = right.cross(fwd).normalized()
    R = Matrix(((right.x, up.x, -fwd.x), (right.y, up.y, -fwd.y), (right.z, up.z, -fwd.z)))
    return R, fwd, right, up


def set_camera(f):
    pos, tgt, F = tl.cam_state(f)
    R, fwd, right, up = cam_matrix(pos, tgt)
    CAM.matrix_world = Matrix.Translation(Vector(pos)) @ R.to_4x4()
    CAMD.lens = float(F)
    return pos, fwd, right, up, F


# animation de caméra (flou de mouvement de la plongée) : clés à chaque image
def key_camera(f0, f1):
    CAM.rotation_mode = "QUATERNION"
    ad = CAM.animation_data_create()
    for f in range(f0 - 1, f1 + 2):
        pos, tgt, F = tl.cam_state(f)
        R, *_ = cam_matrix(pos, tgt)
        CAM.location = Vector(pos)
        CAM.rotation_quaternion = R.to_quaternion()
        CAM.keyframe_insert("location", frame=f)
        CAM.keyframe_insert("rotation_quaternion", frame=f)
    for fc in ad.action.fcurves if hasattr(ad.action, "fcurves") else []:
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
    STRIP_OB.data.update()
    STRIP_OB.location = tl.sheet_drift(f)


def set_state(f):
    m = tl.light_mix(f)
    for n in M_NODES:
        n.outputs[0].default_value = m
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
    FLOOR.hide_render = f < 12
    update_strip(f)
    update_letters(f)
    slab = update_slab(f)
    key_f.hide_render = f >= 62      # la caméra est derrière la feuille : seule la lumière du fond éclaire
    fill_f.hide_render = f >= 62
    key_b.hide_render = f < 12
    fill_b.hide_render = f < 12
    return slab


# ============================================================================ rendu
def render_frame(f, outdir, stats):
    t0 = time.time()
    SC.frame_set(f)
    slab = set_state(f)
    pos, fwd, right, up, F = set_camera(f)
    SC.render.use_motion_blur = f >= 49
    SC.render.motion_blur_shutter = 0.45
    cy.seed = 1000 + f
    dn = ARGS["denoise"]
    flat = f <= 11 and not (dn == "on")
    use_dn = (dn == "on") or (dn == "auto" and not flat)
    cy.use_denoising = use_dn
    if use_dn:
        cy.denoiser = "OPTIX" if ARGS["device"].upper() == "OPTIX" else "OPENIMAGEDENOISE"
        try:
            cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
            cy.denoising_prefilter = "ACCURATE"
        except Exception:
            pass
    SC.render.filepath = os.path.join(outdir, f"f{f:04d}{ARGS['tag']}")
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    stats[f] = round(dt, 2)
    print(f"[f{f:04d}] {dt:.1f} s", flush=True)
    rec = None
    if f >= 48 and slab is not None:
        cx, cy_, cz, th, t = slab
        u, n = tl._rot_u(th)
        R = Matrix.Rotation(-th, 3, "X")
        corners = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    q = Vector((sx * tl.SLAB_W / 2, sy * tl.SLAB_H / 2, sz * t / 2))
                    corners.append(R @ q + Vector((cx, cy_, cz)))
        pr = [project(c, pos, right, up, fwd, F) for c in corners]
        xs = [p[0] for p in pr]
        ys = [p[1] for p in pr]
        rec = dict(
            frame=f,
            bbox_px=dict(x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys), width=max(xs) - min(xs), height=max(ys) - min(ys),
                         centre_x=(min(xs) + max(xs)) / 2, centre_y=(min(ys) + max(ys)) / 2,
                         height_over_window=(max(ys) - min(ys)) / tl.WIN_H),
            camera=dict(position=[round(v, 3) for v in pos], direction=[round(v, 5) for v in fwd], right=[round(v, 5) for v in right],
                        up=[round(v, 5) for v in up], focal_px=round(F, 3), focal_mm_sensor_1008mm=round(F, 3),
                        vertical_fov_deg=round(math.degrees(2 * math.atan(tl.WIN_H / 2 / F)), 3),
                        horizontal_fov_deg=round(math.degrees(2 * math.atan(tl.WIN_W / 2 / F)), 3)),
            slab=dict(centre=[round(cx, 3), round(cy_, 3), round(cz, 3)], size_xyz=[tl.SLAB_W, tl.SLAB_H, round(t, 3)],
                      tilt_deg=round(math.degrees(th), 4), long_axis=[0.0, round(math.cos(th), 5), round(-math.sin(th), 5)],
                      front_normal=[0.0, round(math.sin(th), 5), round(math.cos(th), 5)]),
        )
    return rec


def main():
    os.makedirs(ARGS["out"], exist_ok=True)
    f0, f1 = ARGS["f0"], ARGS["f1"]
    frames = ARGS["only"] if ARGS["only"] else list(range(f0, f1 + 1))
    key_camera(min(frames), max(frames))
    stats, recs = {}, []
    for f in frames:
        r = render_frame(f, ARGS["out"], stats)
        if r:
            recs.append(r)
    tpath = os.path.join(ARGS["out"], "temps.json")
    old = json.load(open(tpath)) if os.path.exists(tpath) else {}
    old.update({str(k): v for k, v in stats.items()})
    json.dump(dict(sorted(old.items(), key=lambda kv: int(kv[0]))), open(tpath, "w"), indent=0)
    if recs and not ARGS["tag"]:
        rpath = os.path.join(ARGS["out"], "raccord.json")
        prev = json.load(open(rpath)) if os.path.exists(rpath) else {"frames": {}}
        for r in recs:
            prev["frames"][str(r["frame"])] = r
        prev["_meta"] = dict(
            repere="monde : px de fenêtre dans le plan z=0 de la feuille (x droite, y haut, z vers le spectateur), origine = centre de la fenêtre 1008x1512",
            fenetre_px="origine en haut à gauche de la fenêtre, y vers le bas",
            projection="x_px = 504 + F*(d.right)/(d.fwd), y_px = 756 - F*(d.up)/(d.fwd), d = point - position caméra ; F = focale en px (capteur 1008 mm de large : lens en mm = F)",
            sol=dict(plan_y=tl.FLOOR_Y, albedo="#B4A79C"), lumiere_principale="projecteur rasant venu de la gauche ; direction vers la lumière (monde) = %s" % [round(v, 4) for v in KEY_BACK_L],
            dalle=dict(taille=[tl.SLAB_W, tl.SLAB_H, tl.SLAB_T], couleur="#EA470F"))
        json.dump(prev, open(rpath, "w"), indent=1)


main()
