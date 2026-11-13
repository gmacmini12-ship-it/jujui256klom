"""alpha_test.py -- proves that the PNG alpha written by scene.py's render settings is STRAIGHT (not premultiplied):
a half-transparent emissive plane of colour #EA470F must give RGB = #EA470F and alpha = 0.5.
  blender -b -P build/seq56/alpha_test.py -- out.png        (or python build/seq56/alpha_test.py -- out.png with the bpy module)
"""
import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 4; sc.cycles.use_denoising = False
sc.render.resolution_x = sc.render.resolution_y = 32
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
im = sc.render.image_settings; im.file_format = "PNG"; im.color_mode = "RGBA"; im.color_depth = "16"
cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 1.0
co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); co.location = (0, 0, 1); sc.camera = co
me = bpy.data.meshes.new("p"); me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
ob = bpy.data.objects.new("p", me); sc.collection.objects.link(ob)
m = bpy.data.materials.new("m"); m.use_nodes = True; nt = m.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (0.8228, 0.0630, 0.00478, 1)   # #EA470F linear
tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader"); mix.inputs["Fac"].default_value = 0.5
o = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], o.inputs["Surface"])
me.materials.append(m)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
