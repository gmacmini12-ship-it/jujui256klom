"""Checks whether Blender's built-in liquid solver runs in this build (it does not in the pip module)."""
import time

import bpy  # must come first
import bmesh

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def box(name, size, loc):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=size); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob); ob.location = loc
    return ob


try:
    dom = box("domain", 1.0, (0, 0, 0.5)); src = box("src", 0.3, (0, 0, 0.75))
    md = dom.modifiers.new("fluid", "FLUID"); md.fluid_type = "DOMAIN"
    ds = md.domain_settings; ds.domain_type = "LIQUID"; ds.resolution_max = 48; ds.cache_type = "REPLAY"
    ds.use_mesh = True
    mf = src.modifiers.new("fluid", "FLUID"); mf.fluid_type = "FLOW"
    fs = mf.flow_settings; fs.flow_type = "LIQUID"; fs.flow_behavior = "GEOMETRY"
    sc.frame_start, sc.frame_end = 1, 16; ds.cache_frame_end = 16
    t0 = time.time(); counts = []
    for f in range(1, 17):
        sc.frame_set(f)
        ev = dom.evaluated_get(bpy.context.evaluated_depsgraph_get())
        counts.append(sum(len(p.particles) for p in ev.particle_systems))
    verts = len(dom.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh().vertices)
    print(f"SMOKE liquid blender={bpy.app.version_string} particles_first={counts[0]} particles_last={counts[-1]} "
          f"mesh_verts={verts} seconds={time.time() - t0:.1f}", flush=True)
except Exception as e:  # noqa: BLE001
    print(f"SMOKE liquid FAILED {type(e).__name__}: {e}", flush=True)
