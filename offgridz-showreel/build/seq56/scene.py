"""scene.py -- path-traced render (Blender Cycles) of the matter layer of sequences 5-6, frames 456-527.

  /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 2 -P build/seq56/scene.py -- \
      --frames 456:527 --res 1080x1920 --spp 128 --device CPU|OPTIX --out out/final/seq56 \
      [--grains cache/seq56/grains_s0.01] [--film cache/seq56/work_grains_s0.01/film_fpx2_mu20_g0.25_lv18]

Writes <out>/matiere/f####.png : 1080x1920 (or --res), 16-bit RGBA, straight alpha, transparent where the sheet is bare
(Cycles shadow catcher: cast shadows on the bare sheet are black alpha).  Same layer as the 2.5D version of run.py.

World: metres, sheet centre at the origin, +X right, +Y up the screen, +Z toward the camera (gravity -Z).  Orthographic camera
straight above, ortho width 0.108 m  =>  0.1 mm per pixel at 1080 px wide.
Inputs are the solvers' outputs (nothing is re-simulated here):
  * frames 456-503  grains  : the MPM cache, instanced as faceted pigment crystals (build/grains/atelier.py, unmodified);
                              from 480 they melt (scale -> 0 over 3.5 frames) as the wetting front (Ta.npy) reaches them;
  * frames 480-527  ink     : the film solver's height field s (npz per frame) as a displaced grid (smooth normals);
                              opacity from the thickness (Beer-Lambert, 0.12 mm); glossy clear-coated ink;
  * frames 504-527  squeegee: 3D model (cream rubber blade, brushed aluminium holder, chamfers, screws) placed at tip_y(f).
Lights (product shot seen from above): one large softbox, one long strip, one low rake light for the grain relief.
"""
import bpy  # must precede bmesh / mathutils
import bmesh
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "build", "grains"))
sys.path.insert(0, os.path.join(ROOT, "build", "mojito"))
import atelier as ATL      # noqa: E402  (not modified; imports mojito/scene.py as S)
sys.path.insert(0, HERE)
from common import (W, H, PX_M, WIN, TRAY_DEPTH, ORANGE, CREAM, tip_y, RUBBER_LEN, HOLDER_LEN, col_lin)  # noqa: E402

SHEET = (0.054, 0.096)
TX, TY = (WIN[2] - WIN[0]) / 2 * PX_M, (WIN[3] - WIN[1]) / 2 * PX_M
H_OPAQUE = 0.12e-3


def lin(rgb255):
    return tuple(float(v) for v in col_lin(rgb255))


# ------------------------------------------------------------------------------------------------ helpers
def box(name, lo, hi, mat, catcher=False):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector([lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k]) for k in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    ob.is_shadow_catcher = catcher
    return ob


def principled(name, **kw):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    for k, v in kw.items():
        b.inputs[k].default_value = v
    return m


def aim(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name, loc, target, sx, sy, power, color=(1.0, 0.96, 0.92)):
    li = bpy.data.lights.new(name, "AREA")
    li.shape = "RECTANGLE"
    li.size, li.size_y = sx, sy
    li.energy = power
    li.color = color
    ob = bpy.data.objects.new(name, li)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    aim(ob, target)
    ob.visible_camera = False
    return ob


# ------------------------------------------------------------------------------------------------ scene
def setup_render(A):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    if A.device != "CPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = A.device
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == A.device
        cy.device = "GPU"
    else:
        cy.device = "CPU"
    rx, ry = (int(v) for v in A.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = rx, ry, 100
    sc.render.film_transparent = True
    cy.samples = A.spp
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.adaptive_min_samples = max(A.spp // 8, 8)
    cy.use_denoising = bool(A.denoise)
    if A.device != "CPU" and hasattr(cy, "denoising_use_gpu"):
        cy.denoising_use_gpu = True          # the rented machine has one CPU core: denoise on the card
    try:
        cy.denoiser = "OPENIMAGEDENOISE" if A.device == "CPU" else "OPTIX"
    except Exception:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 4
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 12
    cy.sample_clamp_indirect = 6.0
    cy.film_exposure = 1.0
    sc.render.threads_mode = "FIXED"
    sc.render.threads = A.threads
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    im = sc.render.image_settings
    im.file_format = "PNG"
    im.color_mode = "RGBA"
    im.color_depth = "16"
    im.compression = 15
    sc.render.filter_size = 1.2
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.10, 0.095, 0.09, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w


def setup_camera():
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.sensor_fit = "HORIZONTAL"
    cam.ortho_scale = 2 * SHEET[0]          # 0.108 m wide => 0.1 mm / px at 1080 px
    cam.clip_start, cam.clip_end = 0.05, 2.0
    ob = bpy.data.objects.new("cam", cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (0, 0, 0.5)
    ob.rotation_euler = (0, 0, 0)           # looks down -Z, image up = +Y, image right = +X
    bpy.context.scene.camera = ob
    return ob


def setup_sheet():
    """Sheet with its recessed tray, as shadow catchers (the layer stays transparent, shadows are black alpha)."""
    black = principled("feuille", **{"Base Color": (0.003, 0.003, 0.003, 1), "Roughness": 0.8})
    big = 0.40
    t = 0.012
    d = TRAY_DEPTH
    obs = [
        box("top_l", (-big, -big, -t), (-TX, big, 0.0), black, True),
        box("top_r", (TX, -big, -t), (big, big, 0.0), black, True),
        box("top_b", (-TX, -big, -t), (TX, -TY, 0.0), black, True),
        box("top_t", (-TX, TY, -t), (TX, big, 0.0), black, True),
        box("floor", (-TX, -TY, -d - t), (TX, TY, -d), black, True),
    ]
    # deep pigment seen through the voids of the bed (the grains below the top layer): dark orange, opaque, tray only
    deep = principled("pigment_profond", **{"Base Color": (*[v * 0.07 for v in lin(ORANGE)], 1), "Roughness": 0.9})
    floor_deep = box("pigment_profond", (-TX, -TY, -d + 0.0001), (TX, TY, -d + 0.0002), deep, False)
    return obs, floor_deep


def setup_lights():
    # one large softbox almost overhead (broad reflections slide over the relief), one long strip along X (bright line along
    # the bead), one low rake from the left (reads the grain relief).  Powers in W (Cycles area lights), tuned on test frames.
    area_light("softbox", (-0.07, 0.07, 0.20), (0.0, 0.0, 0.0), 0.14, 0.10, 0.25)
    area_light("ruban", (0.0, -0.12, 0.20), (0.0, 0.0, 0.0), 0.60, 0.020, 0.53)
    area_light("rasante", (-0.26, 0.02, 0.13), (0.0, 0.0, 0.0), 0.10, 0.28, 0.28, (1.0, 0.90, 0.80))


# ------------------------------------------------------------------------------------------------ ink film
def ink_material():
    m = principled("encre")
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(ORANGE), 1)
    b.inputs["Roughness"].default_value = 0.17
    b.inputs["Specular IOR Level"].default_value = 0.3
    b.inputs["IOR"].default_value = 1.45
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.03
    b.inputs["Coat IOR"].default_value = 1.5
    att = nt.nodes.new("ShaderNodeAttribute")
    att.attribute_name = "T"
    att.attribute_type = "GEOMETRY"
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    m1.inputs[1].default_value = -1.0 / H_OPAQUE
    m2 = nt.nodes.new("ShaderNodeMath")
    m2.operation = "EXPONENT"
    m3 = nt.nodes.new("ShaderNodeMath")
    m3.operation = "SUBTRACT"
    m3.inputs[0].default_value = 1.0
    nt.links.new(att.outputs["Fac"], m1.inputs[0])
    nt.links.new(m1.outputs[0], m2.inputs[0])
    nt.links.new(m2.outputs[0], m3.inputs[1])
    # films thinner than ~10-40 um (the residual left behind the blade) are not drawn: the sheet is clean again behind it
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.interpolation_type = "SMOOTHSTEP"
    mr.inputs["From Min"].default_value = 10e-6
    mr.inputs["From Max"].default_value = 40e-6
    nt.links.new(att.outputs["Fac"], mr.inputs["Value"])
    m4 = nt.nodes.new("ShaderNodeMath")
    m4.operation = "MULTIPLY"
    nt.links.new(m3.outputs[0], m4.inputs[0])
    nt.links.new(mr.outputs["Result"], m4.inputs[1])
    nt.links.new(m4.outputs[0], b.inputs["Alpha"])
    return m


class Film:
    """Displaced grid of the film height field; one mesh per grid resolution, vertex positions rewritten every frame."""

    def __init__(self):
        self.mat = ink_material()
        self.meshes = {}
        self.tmax = 0.0

    def _make(self, ny, nx):
        fpx = W // nx
        xs = np.concatenate([[-SHEET[0]], ((np.arange(nx) + 0.5) * fpx - W / 2) * PX_M, [SHEET[0]]])
        ys = np.concatenate([[SHEET[1]], (H / 2 - (np.arange(ny) + 0.5) * fpx) * PX_M, [-SHEET[1]]])
        X, Y = np.meshgrid(xs, ys)
        gy, gx = Y.shape
        idx = np.arange(gx * gy).reshape(gy, gx)
        quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
        me = bpy.data.meshes.new("film%d" % nx)
        me.vertices.add(gx * gy)
        me.loops.add(len(quads) * 4)
        me.polygons.add(len(quads))
        me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
        me.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
        me.polygons.foreach_set("use_smooth", np.ones(len(quads), bool))
        me.update(calc_edges=True)
        me.materials.append(self.mat)
        me.attributes.new("T", "FLOAT", "POINT")
        ob = bpy.data.objects.new("film%d" % nx, me)
        bpy.context.scene.collection.objects.link(ob)
        base_b = np.where((np.abs(X) < TX) & (np.abs(Y) < TY), -TRAY_DEPTH, 0.0).astype(np.float32)
        self.meshes[nx] = dict(ob=ob, me=me, X=X.astype(np.float32), Y=Y.astype(np.float32), b=base_b, ny=ny, nx=nx)

    def set(self, s):
        ny, nx = s.shape
        if nx not in self.meshes:
            self._make(ny, nx)
        for k, d in self.meshes.items():
            d["ob"].hide_render = k != nx
        d = self.meshes[nx]
        sp = np.pad(s, 1, mode="edge").astype(np.float32)
        b = d["b"]
        T = np.maximum(sp - b, 0.0)
        self.tmax = float(T.max())
        # the film lies on its base; a hair above so it never z-fights with the sheet where it is ultra thin
        z = np.maximum(sp, b) + 2e-6
        co = np.stack([d["X"], d["Y"], z], -1).astype(np.float32)
        d["me"].vertices.foreach_set("co", co.ravel())
        d["me"].attributes["T"].data.foreach_set("value", T.ravel())
        d["me"].update()

    def hide(self):
        for d in self.meshes.values():
            d["ob"].hide_render = True


# ------------------------------------------------------------------------------------------------ squeegee
def extrude_profile(name, pts, half_w, mat):
    """Polygon (y, z) pts extruded along X from -half_w to +half_w."""
    n = len(pts)
    verts = [(-half_w, y, z) for y, z in pts] + [(half_w, y, z) for y, z in pts]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


def make_squeegee():
    """Tool in its own frame: origin at the contact line of the blade tip (x along the blade, y toward the printed side
    (+Y = up the screen), z up).  Blade and holder lean back at ALPHA from the sheet."""
    ALPHA = math.radians(60.0)
    d = np.array([math.cos(ALPHA), math.sin(ALPHA)])           # along the blade, going up and back
    nrm = np.array([math.sin(ALPHA), -math.cos(ALPHA)])        # behind the front face (back, down)
    rubber = principled("caoutchouc", **{"Base Color": (*lin(CREAM), 1), "Roughness": 0.55})
    try:
        rubber.node_tree.nodes["Principled BSDF"].inputs["Subsurface Weight"].default_value = 0.06
        rubber.node_tree.nodes["Principled BSDF"].inputs["Subsurface Radius"].default_value = (0.6, 0.35, 0.25)
        rubber.node_tree.nodes["Principled BSDF"].inputs["Sheen Weight"].default_value = 0.2
    except Exception:
        pass
    alu = principled("aluminium", **{"Base Color": (0.78, 0.76, 0.73, 1), "Metallic": 1.0, "Roughness": 0.40})
    nt = alu.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.04, 1.0, 1.0)         # noise stretched along X: brushed streaks
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1500.0
    nz.inputs["Detail"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.00004
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    steel = principled("vis", **{"Base Color": (0.30, 0.30, 0.30, 1), "Metallic": 1.0, "Roughness": 0.38})

    half_w = 0.20                                              # wider than the sheet
    Lb, tb = 0.0125, 0.0020                                     # free blade length and thickness
    A = np.array([0.0, 0.0])
    B = A + d * Lb
    C = B + nrm * tb
    # blade polygon cut flat at z = 0 (contact patch)
    s = C[1] / d[1]
    D = C - d * s
    blade = extrude_profile("lame", [tuple(A), tuple(B), tuple(C), tuple(D)], half_w, rubber)
    # holder: clamps the blade, same lean, chamfered
    L0, Lh, th = Lb - 0.0035, 0.0125, 0.0082
    P0 = A + d * L0
    P1 = P0 + d * Lh
    P2 = P1 + nrm * th
    P3 = P0 + nrm * th
    holder = extrude_profile("porte_lame", [tuple(P0), tuple(P1), tuple(P2), tuple(P3)], half_w, alu)
    for ob, wdt, seg in ((blade, 0.00055, 4), (holder, 0.0009, 1)):
        bv = ob.modifiers.new("biseau", "BEVEL")
        bv.width = wdt
        bv.segments = seg
        bv.limit_method = "ANGLE"
        wn = ob.modifiers.new("normales", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
    # screws on the top cap of the holder (face between P1 and P2)
    cap_c = 0.5 * (P1 + P2)
    parts = [blade, holder]
    for x in (-0.045, -0.015, 0.015, 0.045):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=0.0017, radius2=0.0017, depth=0.0014)
        me = bpy.data.meshes.new("vis")
        bm.to_mesh(me)
        bm.free()
        me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
        ob = bpy.data.objects.new("vis", me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(steel)
        # cone axis (z) -> cap normal d (in the y,z plane): rotate about X by (ALPHA - 90 deg) ... axis z -> (0, cos A, sin A)
        ob.rotation_euler = (ALPHA - math.pi / 2, 0.0, 0.0)
        ob.rotation_euler = (-(math.pi / 2 - ALPHA), 0.0, 0.0)
        ob.location = (x, cap_c[0] + d[0] * 0.0006, cap_c[1] + d[1] * 0.0006)
        bv = ob.modifiers.new("biseau", "BEVEL")
        bv.width = 0.0003
        bv.segments = 2
        parts.append(ob)
    root = bpy.data.objects.new("raclette", None)
    bpy.context.scene.collection.objects.link(root)
    for ob in parts:
        ob.parent = root
    # a small fill light linked to the tool only (Cycles light linking), so that the cream rubber reads cream and not
    # salmon (the scene's orange ink bounces its colour onto it)
    fill = area_light("remplissage_raclette", (0.0, -0.03, 0.10), (0.0, 0.004, 0.006), 0.30, 0.04, 0.55, (1.0, 0.97, 0.93))
    fill.parent = root
    coll = bpy.data.collections.new("outil")
    for ob in parts:
        coll.objects.link(ob)
    try:
        fill.light_linking.receiver_collection = coll
    except Exception as e:                    # pragma: no cover
        print("light linking unavailable:", e)
    return root, parts, dict(plan_extent_m=float(max(P2[0], P1[0], P3[0], C[0])), height_m=float(max(P1[1], P2[1]))), fill


# ------------------------------------------------------------------------------------------------ grains
def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


class GrainsHaut(ATL.GrainsMixtes):
    """Top-down version of atelier.GrainsMixtes: faceted crystals (instances) only for the grains of the visible top layer,
    shader-faceted points for every other grain (buried or tiny).  Orthographic selection instead of the perspective one."""

    def _choisir_haut(self, pos, ech, res_x):
        pas = self.pas
        px_m = 2 * SHEET[0] / res_x
        diam_px = 2 * ech / px_m
        inview = (np.abs(pos[:, 0]) < SHEET[0] + 2 * pas) & (np.abs(pos[:, 1]) < SHEET[1] + 2 * pas)
        c = 1.5 * pas
        nx_, ny_ = int(2 * (SHEET[0] + 3 * pas) / c) + 2, int(2 * (SHEET[1] + 3 * pas) / c) + 2
        i = np.clip(((pos[:, 0] + SHEET[0] + 3 * pas) / c).astype(np.int32), 0, nx_ - 1)
        j = np.clip(((pos[:, 1] + SHEET[1] + 3 * pas) / c).astype(np.int32), 0, ny_ - 1)
        top = np.full((nx_, ny_), -1e9, np.float32)
        np.maximum.at(top, (i, j), pos[:, 2])
        near = pos[:, 2] >= top[i, j] - 1.7 * pas              # the two top layers; deeper grains are hidden by them
        return inview & near & (diam_px >= self.taille_min)

    def poser_haut(self, d, res_x):
        """d: dict(pos, rot, ech, alea) already edited.  Returns number of crystals."""
        pres = self._choisir_haut(d["pos"], d["ech"], res_x)
        for objet, masque in ((self.loin, ~pres), (self.pres, pres)):
            objet._maillage(d["pos"][masque], d["rot"][masque], d["ech"][masque], d["alea"][masque])
        self.n_cristaux = int(pres.sum())
        self.cacher(False)


class GrainLayer:
    def __init__(self, cache, Ta, res_x):
        self.g = GrainsHaut("grains", cache, (0.0, 0.0, 0.0), rayon_par_pas=0.70, sucre=False)
        self.spacing = self.g.pas
        self.Ta = Ta
        self.res_x = res_x
        self.outside = 0
        self.cache = cache
        self.last = max(int(p[1:5]) for p in os.listdir(cache) if p.startswith("f") and p.endswith(".npz") and len(p) == 9)
        self.n_cristaux = 0

    def hide(self):
        self.g.cacher(True)

    def pose(self, f, film_s=None):
        g = self.g
        g.loin.dernier = None                  # always reload: positions are edited below (copies, never in place)
        d0 = g.loin._lire(min(f, self.last))
        if d0 is None:
            self.outside = 1
            self.hide()
            return None
        n_free = g.loin.n_libres
        pos = d0["pos"].copy()
        rot, ech, alea = d0["rot"], d0["ech"].copy(), d0["alea"]
        sp = self.spacing
        # grains lying in the recessed tray cannot overhang its walls
        inside = (np.abs(pos[:, 0]) < TX) & (np.abs(pos[:, 1]) < TY) & (pos[:, 2] < 0.3 * sp)
        m = 0.85 * sp
        pos[inside, 0] = np.clip(pos[inside, 0], -TX + m, TX - m)
        pos[inside, 1] = np.clip(pos[inside, 1], -TY + m, TY - m)
        self.outside = int(np.sum((np.abs(pos[:, 0]) > TX) | (np.abs(pos[:, 1]) > TY)))
        keep = (np.abs(pos[:, 0]) < SHEET[0] + 3 * sp) & (np.abs(pos[:, 1]) < SHEET[1] + 3 * sp)
        if f >= 480 and self.Ta is not None and film_s is not None:
            # the ink wets the pigment: behind the front the grains SINK into the film (they are swallowed, not shrunk);
            # once fully under the opaque ink (3 frames after the front) they are no longer visible and are dropped
            ny, nx = self.Ta.shape
            fpx = W // nx
            u = np.clip(((pos[:, 0] / PX_M + W / 2) / fpx).astype(int), 0, nx - 1)
            v = np.clip(((H / 2 - pos[:, 1] / PX_M) / fpx).astype(int), 0, ny - 1)
            age = f - self.Ta[v, u]
            w = smooth01(age / 1.2)
            top = np.full((ny, nx), -1e9, np.float32)
            np.maximum.at(top, (v, u), pos[:, 2])
            ny2, nx2 = film_s.shape
            if (ny2, nx2) != (ny, nx):
                # film solver grid differs from the arrival grid (squeegee stage): sample by nearest cell
                vv = np.clip((v * ny2) // ny, 0, ny2 - 1)
                uu = np.clip((u * nx2) // nx, 0, nx2 - 1)
                s_here = film_s[vv, uu]
            else:
                s_here = film_s[v, u]
            target = s_here - 1.2 * ech                      # grain centre ends 0.8 radius under the ink surface
            drop = np.maximum(top[v, u] - target, 0.0)
            pos[:, 2] -= w * np.maximum(drop - 0.0, 0.0) * 1.0
            keep &= ~(age > 4.0)
        k = int(keep.sum())
        self.g.poser_haut(dict(pos=pos[keep], rot=rot[keep], ech=ech[keep], alea=alea[keep]), self.res_x)
        self.n_cristaux = self.g.n_cristaux
        return k


# ------------------------------------------------------------------------------------------------ main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="456:527")
    ap.add_argument("--res", default="1080x1920")
    ap.add_argument("--spp", type=int, default=64)
    ap.add_argument("--device", default="CPU", choices=["CPU", "OPTIX", "CUDA"])
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--denoise", type=int, default=1)
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "final", "seq56"))
    ap.add_argument("--grains", default=os.path.join(ROOT, "cache", "seq56", "grains_final"))
    ap.add_argument("--film", default=None)
    ap.add_argument("--list", default=None, help="comma separated frames instead of --frames (stills)")
    ap.add_argument("--arret", type=float, default=0.0, help="unix time after which no new frame is started")
    ap.add_argument("--reprise", type=int, default=0, help="1: skip frames already on disk")
    ap.add_argument("--lod-res", type=int, default=0, help="width in px used to choose crystals vs points (default: --res); 1080 for timing tests at tiny resolution")
    A = ap.parse_args(argv)
    if A.film is None:
        w = os.path.join(ROOT, "cache", "seq56", "work_" + os.path.basename(os.path.abspath(A.grains).rstrip("/")))
        cands = sorted(d for d in os.listdir(w) if d.startswith("film_fpx"))
        A.film = os.path.join(w, cands[0])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render(A)
    setup_camera()
    sheet_obs, floor_deep = setup_sheet()
    setup_lights()
    Ta = np.load(os.path.join(A.film, "Ta.npy")) if os.path.exists(os.path.join(A.film, "Ta.npy")) else None
    film = Film()
    res_x = A.lod_res or int(A.res.split("x")[0])
    grains = GrainLayer(A.grains, Ta, res_x)
    root, parts, tool_info, fill = make_squeegee()
    outdir = os.path.join(A.out, "matiere")
    os.makedirs(outdir, exist_ok=True)
    if A.list:
        frames = [int(v) for v in A.list.split(",")]
    else:
        fa, fb = [int(v) for v in A.frames.split(":")]
        frames = list(range(fa, fb + 1))
    log = {}
    lp = os.path.join(A.out, "scene_log.json")
    if os.path.exists(lp):
        log = json.load(open(lp))
    sc = bpy.context.scene
    extent_px = tool_info["plan_extent_m"] / PX_M
    for f in frames:
        if A.arret and time.time() > A.arret:
            print("SEQ56 arret avant l'image %d : delai atteint" % f, flush=True)
            break
        dest = os.path.join(outdir, "f%04d.png" % f)
        if A.reprise and os.path.exists(dest):
            continue
        t0 = time.time()
        s = None
        if f >= 480:
            s = np.load(os.path.join(A.film, "s%04d.npz" % f))["s"]
        if f <= 503:
            n = grains.pose(f, s)
        else:
            grains.hide()
            n = 0
        if f >= 480:
            film.set(s)
        else:
            film.hide()
            film.tmax = 0.0
        # squeegee 504-527 (tip at row tip_y(f); world Y of the tip = (H/2 - row) * 1e-4); once the whole tool is below the sheet it is gone
        tip = None
        show_tool = False
        if f >= 504:
            tip = float(tip_y(f))
            show_tool = (tip - extent_px) < H
            root.location = (0.0, (H / 2 - tip) * PX_M, 0.0)
        for ob in parts + [root, fill]:
            ob.hide_render = not show_tool
        floor_deep.hide_render = f > 503
        # until a grain crosses the rim the margins carry nothing at all (no catcher, hence no shadow alpha either)
        for ob in sheet_obs[:4]:
            ob.hide_render = (f <= 503 and grains.outside == 0)
        # nothing left on the sheet (squeegee gone, ink film thinner than the drawn threshold): no catcher, so the layer is exactly empty
        if f > 503 and not show_tool and film.tmax < 20e-6:
            for ob in sheet_obs:
                ob.hide_render = True
        t1 = time.time()
        sc.render.filepath = dest
        bpy.ops.render.render(write_still=True)
        t2 = time.time()
        log[str(f)] = dict(n_grains=n, n_cristaux=grains.n_cristaux if f <= 503 else 0, tip_px=tip, prep_s=round(t1 - t0, 2),
                           render_s=round(t2 - t1, 2), res=A.res, spp=A.spp, device=A.device, threads=A.threads)
        print("SEQ56 image %d : %.1f s (preparation %.1f s), grains %s dont cristaux %s" % (f, t2 - t0, t1 - t0, n, grains.n_cristaux if f <= 503 else 0), flush=True)
        json.dump(log, open(lp, "w"), indent=1)
    json.dump(dict(tool=tool_info), open(os.path.join(A.out, "tool_info.json"), "w"))


main()
