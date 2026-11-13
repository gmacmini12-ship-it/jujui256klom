"""Calibration benchmark for INSOUMISE: the two heaviest shot types, at production-like complexity.

Not a look-development scene. Its only purpose is to measure seconds per frame on a given device so
that render budgets are computed from measurements instead of guesses.

Works with bpy as a Python module or inside `blender -b -P bench_scene.py -- <args>`.

  python bench_scene.py --scene glass  --device OPTIX --spp 256 --frames 2 --out /tmp/o
  python bench_scene.py --scene grains --device CUDA  --spp 128 --frames 2 --out /tmp/o --grains 3000000

Prints machine-readable lines beginning with BENCH / DEVICE.
"""
import argparse, math, random, sys, time

import bpy  # must come first: bmesh and mathutils only exist once bpy is loaded
import bmesh
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--scene", choices=["glass", "grains"], required=True)
ap.add_argument("--device", choices=["CPU", "CUDA", "OPTIX"], default="CPU")
ap.add_argument("--spp", type=int, default=256)
ap.add_argument("--res", default="1008x1512")
ap.add_argument("--frames", type=int, default=2)
ap.add_argument("--denoise", type=int, default=1)
ap.add_argument("--adaptive", type=int, default=0)
ap.add_argument("--grains", type=int, default=3_000_000)
ap.add_argument("--out", default="/tmp/og_bench")
A = ap.parse_args(argv)
W, H = (int(v) for v in A.res.split("x"))
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
cy = sc.cycles


def setup_device(kind):
    if kind == "CPU":
        cy.device = "CPU"
        return
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = kind
    try:
        prefs.refresh_devices()
    except Exception:
        prefs.get_devices()
    used = 0
    for d in prefs.devices:
        d.use = d.type == kind
        used += int(d.use)
        print(f"DEVICE name={d.name!r} type={d.type} use={d.use}", flush=True)
    if not used:
        raise RuntimeError(f"no {kind} device available")
    cy.device = "GPU"


setup_device(A.device)
cy.samples = A.spp
cy.use_adaptive_sampling = bool(A.adaptive)
if A.adaptive:
    cy.adaptive_threshold = 0.02
    cy.adaptive_min_samples = 64
cy.use_denoising = bool(A.denoise)
if A.denoise:
    want = "OPTIX" if A.device == "OPTIX" else "OPENIMAGEDENOISE"
    try:
        cy.denoiser = want
    except Exception as e:  # fall back to whatever exists
        print(f"DEVICE denoiser {want} unavailable ({e}); using default", flush=True)
    if A.device != "CPU" and hasattr(cy, "denoising_use_gpu"):
        cy.denoising_use_gpu = True
cy.max_bounces = 24; cy.transmission_bounces = 24; cy.glossy_bounces = 12
cy.diffuse_bounces = 4; cy.volume_bounces = 2; cy.transparent_max_bounces = 24
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.5
sc.render.resolution_x = W; sc.render.resolution_y = H; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
sc.render.use_persistent_data = True
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.frame_start, sc.frame_end = 1, max(2, A.frames)

world = bpy.data.worlds.new("W"); sc.world = world
try:
    world.use_nodes = True
except Exception:
    pass
world.node_tree.nodes["Background"].inputs[0].default_value = (0.002, 0.002, 0.002, 1)


def mat(name, emission=None, absorb=None, **kw):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    for k, v in kw.items():
        b.inputs[k].default_value = v
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1)
        b.inputs["Emission Strength"].default_value = emission[1]
    if absorb:
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        va = nt.nodes.new("ShaderNodeVolumeAbsorption")
        va.inputs["Color"].default_value = (*absorb[0], 1)
        va.inputs["Density"].default_value = absorb[1]
        nt.links.new(va.outputs["Volume"], out.inputs["Volume"])
    return m


def link(name, me, material=None, smooth=True):
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    if material:
        me.materials.append(material)
    return ob


def lathe(name, profile, seg=192, material=None):
    verts, faces, m = [], [], len(profile)
    for i in range(seg):
        a = 2 * math.pi * i / seg; c, s = math.cos(a), math.sin(a)
        for r, z in profile:
            verts.append((r * c, r * s, z))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(m - 1):
            faces.append((i * m + j, i2 * m + j, i2 * m + j + 1, i * m + j + 1))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return link(name, me, material)


def bm_object(name, build, material=None, smooth=True):
    bm = bmesh.new(); build(bm); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return link(name, me, material, smooth)


def look_at(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def area(name, loc, target, size, power, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, "AREA"); L.size = size; L.energy = power; L.color = color
    ob = bpy.data.objects.new(name, L); sc.collection.objects.link(ob); ob.location = loc; look_at(ob, target)


def instances(name, coords, proto):
    """Instance `proto` on every coordinate (vertex instancing)."""
    me = bpy.data.meshes.new(name); me.vertices.add(len(coords))
    me.vertices.foreach_set("co", [v for c in coords for v in c])
    host = bpy.data.objects.new(name, me); sc.collection.objects.link(host)
    proto.parent = host; host.instance_type = "VERTS"
    return host


def native_points(name, coords_flat, n, radius, material):
    """N points rendered as native Cycles point primitives through a Mesh-to-Points node."""
    me = bpy.data.meshes.new(name); me.vertices.add(n); me.vertices.foreach_set("co", coords_flat)
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    ng = bpy.data.node_groups.new(name + "_gn", "GeometryNodeTree")
    ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n_in = ng.nodes.new("NodeGroupInput"); n_out = ng.nodes.new("NodeGroupOutput")
    m2p = ng.nodes.new("GeometryNodeMeshToPoints"); m2p.inputs["Radius"].default_value = radius
    sm = ng.nodes.new("GeometryNodeSetMaterial"); sm.inputs["Material"].default_value = material
    ng.links.new(n_in.outputs[0], m2p.inputs["Mesh"])
    ng.links.new(m2p.outputs["Points"], sm.inputs["Geometry"])
    ng.links.new(sm.outputs["Geometry"], n_out.inputs[0])
    mod = ob.modifiers.new("gn", "NODES"); mod.node_group = ng
    return ob


cam = bpy.data.cameras.new("cam"); camo = bpy.data.objects.new("cam", cam)
sc.collection.objects.link(camo); sc.camera = camo; cam.dof.use_dof = True

if A.scene == "glass":
    glass = mat("glass", **{"Transmission Weight": 1.0, "IOR": 1.5, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    liquid = mat("liquid", absorb=((0.80, 0.95, 0.70), 8.0),
                 **{"Transmission Weight": 1.0, "IOR": 1.333, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    water = mat("water", **{"Transmission Weight": 1.0, "IOR": 1.333, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    air = mat("air", **{"Transmission Weight": 1.0, "IOR": 0.75, "Roughness": 0.0, "Base Color": (1, 1, 1, 1)})
    ice = mat("ice", **{"Transmission Weight": 1.0, "IOR": 1.31, "Roughness": 0.03, "Base Color": (1, 1, 1, 1)})
    straw = mat("straw", **{"Base Color": (0.004, 0.004, 0.004, 1), "Roughness": 0.25})
    leaf = mat("leaf", **{"Base Color": (0.07, 0.33, 0.05, 1), "Roughness": 0.45, "Subsurface Weight": 0.25})
    lime = mat("lime", **{"Base Color": (0.42, 0.62, 0.08, 1), "Roughness": 0.35, "Subsurface Weight": 0.5})
    table = mat("table", **{"Base Color": (0.008, 0.008, 0.008, 1), "Roughness": 0.12})
    band = mat("band", emission=((0.92, 0.28, 0.06), 6.0), **{"Base Color": (0, 0, 0, 1)})

    lathe("glass", [(0, 0), (0.034, 0), (0.036, 0.004), (0.0385, 0.14), (0.0372, 0.1408), (0.036, 0.14),
                    (0.0338, 0.014), (0.032, 0.011), (0, 0.011)], material=glass)
    lathe("liquid", [(0, 0.0112), (0.0322, 0.0112), (0.0340, 0.0142), (0.03585, 0.118), (0, 0.118)], material=liquid)
    for k in range(12):
        a = random.uniform(0, 6.28); r = random.uniform(0, 0.019)
        ob = bm_object(f"ice{k}", lambda bm: bmesh.ops.create_cube(bm, size=0.021), ice)
        ob.location = (r * math.cos(a), r * math.sin(a), 0.028 + k * 0.0085)
        ob.rotation_euler = Euler((random.uniform(0, 3), random.uniform(0, 3), random.uniform(0, 3)))
        ob.keyframe_insert("rotation_euler", frame=1)
        ob.rotation_euler.rotate_axis("Z", 0.12)
        ob.keyframe_insert("rotation_euler", frame=4)
        b = ob.modifiers.new("bev", "BEVEL"); b.width = 0.0028; b.segments = 3
        s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 2; s.render_levels = 2
        t = bpy.data.textures.new(f"n{k}", "CLOUDS"); t.noise_scale = 0.012
        d = ob.modifiers.new("dis", "DISPLACE"); d.texture = t; d.strength = 0.0016
    for k in range(40):  # crushed ice
        a = random.uniform(0, 6.28); r = random.uniform(0, 0.028)
        ob = bm_object(f"crush{k}", lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.004), ice)
        ob.location = (r * math.cos(a), r * math.sin(a), random.uniform(0.02, 0.118))
        ob.scale = (random.uniform(0.6, 1.4), random.uniform(0.6, 1.4), random.uniform(0.6, 1.4))
        t = bpy.data.textures.new(f"c{k}", "CLOUDS"); t.noise_scale = 0.006
        d = ob.modifiers.new("dis", "DISPLACE"); d.texture = t; d.strength = 0.002
    drop = bm_object("drop", lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0007), water)
    pts = []
    for _ in range(5000):  # condensation on the outer wall
        z = random.uniform(0.02, 0.128); a = random.uniform(0, 6.28)
        r = 0.036 + (0.0385 - 0.036) * (z - 0.004) / 0.136
        pts.append((r * math.cos(a), r * math.sin(a), z))
    instances("droplets", pts, drop)
    bub = bm_object("bub", lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0006), air)
    pts = []
    for _ in range(600):  # carbonation
        a = random.uniform(0, 6.28); r = 0.03 * math.sqrt(random.random())
        pts.append((r * math.cos(a), r * math.sin(a), random.uniform(0.016, 0.115)))
    instances("bubbles", pts, bub)
    st = bm_object("straw", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.0032,
                                                             radius2=0.0032, depth=0.21), straw)
    st.location = (0.012, 0.004, 0.105); st.rotation_euler = Euler((0.0, math.radians(11), 0.0))
    for k in range(10):
        ob = bm_object(f"leaf{k}", lambda bm: bmesh.ops.create_grid(bm, x_segments=6, y_segments=10, size=0.011), leaf)
        ob.scale = (1, 1.6, 1); a = random.uniform(0, 6.28)
        ob.location = (0.02 * math.cos(a), 0.02 * math.sin(a), 0.118 + random.uniform(0.0, 0.03))
        ob.rotation_euler = Euler((random.uniform(-1, 1), random.uniform(-1, 1), a))
        s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 2; s.render_levels = 2
    lw = bm_object("lime", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=0.021,
                                                            radius2=0.021, depth=0.004), lime)
    lw.location = (-0.012, -0.022, 0.07); lw.rotation_euler = Euler((math.radians(80), 0, math.radians(20)))
    bm_object("table", lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2.0), table, smooth=False)
    bo = bm_object("band", lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5), band, smooth=False)
    bo.scale = (0.14, 1.0, 1.0); bo.location = (0.03, 0.55, 0.3); bo.rotation_euler = Euler((math.radians(90), 0, 0))
    area("key", (-0.4, -0.3, 0.5), (0, 0, 0.08), 0.5, 30)
    area("rim", (0.35, 0.3, 0.25), (0, 0, 0.08), 0.3, 20)
    camo.location = (0.0, -0.74, 0.14); look_at(camo, (0, 0, 0.082)); cam.lens = 85
    camo.keyframe_insert("location", frame=1)
    camo.location = (0.02, -0.72, 0.142); camo.keyframe_insert("location", frame=4)
    cam.dof.focus_distance = 0.74; cam.dof.aperture_fstop = 4.0
else:
    import numpy as np

    N = A.grains
    rng = np.random.default_rng(3)
    u = rng.random(N); th = rng.random(N) * 2 * np.pi; ph = np.arccos(rng.random(N))
    r = 0.07 * u ** (1 / 3)
    pts = np.stack([r * np.sin(ph) * np.cos(th), r * np.sin(ph) * np.sin(th), 0.45 * r * np.cos(ph)], 1).astype("f4")
    grain = mat("grain", **{"Base Color": (0.83, 0.2, 0.03, 1), "Roughness": 0.6})
    native_points("grains", pts.ravel(), N, 0.00032, grain)
    floor = mat("floor", **{"Base Color": (0.75, 0.7, 0.64, 1), "Roughness": 0.8})
    bm_object("floor", lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0), floor, smooth=False)
    area("key", (-0.25, -0.1, 0.12), (0, 0, 0.01), 0.15, 12)
    area("fill", (0.2, -0.2, 0.3), (0, 0, 0.01), 0.5, 4)
    camo.location = (0.0, -0.2, 0.075); look_at(camo, (0, 0, 0.014)); cam.lens = 100
    camo.keyframe_insert("location", frame=1)
    camo.location = (0.004, -0.196, 0.075); camo.keyframe_insert("location", frame=4)
    cam.dof.focus_distance = 0.21; cam.dof.aperture_fstop = 5.6

t_all = time.time()
for f in range(1, A.frames + 1):
    sc.frame_set(f)
    sc.render.filepath = f"{A.out}_{A.scene}_{A.device}_f{f}.png"
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"BENCH scene={A.scene} device={A.device} res={W}x{H} spp={A.spp} adaptive={A.adaptive} "
          f"denoise={A.denoise} frame={f} seconds={time.time() - t0:.2f}"
          + (f" grains={A.grains}" if A.scene == "grains" else ""), flush=True)
print(f"BENCH scene={A.scene} device={A.device} total_seconds={time.time() - t_all:.2f}", flush=True)
