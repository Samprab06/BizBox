"""Offline Blender authoring only; preserve source scene and render a sibling scene."""
import bpy, json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path('/Users/aksharkakkad/.codex/worktrees/hac-115-macbook-assets/HackPrinceton')
source=bpy.data.scenes.get('BizBox_HAC115_Prepared')
if source is None: raise RuntimeError('Prepared HAC115 scene must be open')
name='BizBox_HAC117_Guided_Frame_v2_final'
if bpy.data.scenes.get(name): raise RuntimeError('Version already exists; do not overwrite scene')
scene=bpy.data.scenes.new(name)
lookup={}
for obj in source.objects:
    clone=obj.copy()
    if obj.data: clone.data=obj.data.copy()
    scene.collection.objects.link(clone)
    lookup[obj]=clone
for original,clone in lookup.items():
    if original.parent in lookup:
        clone.parent=lookup[original.parent]
        clone.matrix_parent_inverse=original.matrix_parent_inverse.copy()
        clone.matrix_basis=original.matrix_basis.copy()
scene.world=source.world.copy() if source.world else bpy.data.worlds.new(name+'_world')
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.22,.24,.28,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.4
screen=next(o for o in source.objects if o.name=='HAC115_Screen')
display=lookup[screen]
mat=bpy.data.materials.new(name+'_transparent_display');mat.use_nodes=True
nodes=mat.node_tree.nodes;nodes.clear();hold=nodes.new('ShaderNodeHoldout');out=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(hold.outputs[0],out.inputs['Surface'])
display.data.materials.clear();display.data.materials.append(mat)
cam_data=bpy.data.cameras.new(name+'_camera');cam=bpy.data.objects.new(name+'_camera',cam_data);scene.collection.objects.link(cam)
cam_data.type='ORTHO';cam_data.ortho_scale=.408
cam.location=Vector((0,-.012,.114))+Vector((0,-.9396926,.3420201))*.8
cam.rotation_euler=(Vector((0,-.012,.114))-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1600;scene.render.resolution_y=1120;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='8';scene.view_settings.view_transform='AgX'
scene.render.filepath=str(ROOT/'public/landing-assets/guided-demo/macbook-frame-v2.png')
scene.render.image_settings.compression=70
bpy.context.window.scene=scene
bpy.context.view_layer.update()
# Fit every hardware mesh in camera coordinates, preserving the upright display.
points=[cam.matrix_world.inverted() @ (o.matrix_world @ Vector(corner)) for o in scene.objects if o.type=='MESH' for corner in o.bound_box]
minx,maxx=min(p.x for p in points),max(p.x for p in points)
miny,maxy=min(p.y for p in points),max(p.y for p in points)
basis=cam.matrix_world.to_quaternion()
cam.location+=basis @ Vector(((minx+maxx)/2,(miny+maxy)/2,0))
cam_data.ortho_scale=max(maxx-minx,(maxy-miny)*1600/1120)*1.07
bpy.context.view_layer.update()
# Derive screen aperture from the actual rendered mesh; do not rely on stale
# inactive-scene dependency-graph caches on the original authoring anchors.
projected=[world_to_camera_view(scene,cam,display.matrix_world @ v.co) for v in display.data.vertices]
x0,x1=min(p.x for p in projected),max(p.x for p in projected)
y0,y1=1-max(p.y for p in projected),1-min(p.y for p in projected)
quad=[{'x':round(x,9),'y':round(y,9)} for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]]
manifest={'image':'/landing-assets/guided-demo/macbook-frame-v2.png','width':1600,'height':1120,'screenQuad':quad,'order':['TL','TR','BR','BL'],'source':'HAC115 prepared CC BY MacBook; same source/credits as ../macbook','method':'Blender EEVEE offline render, orthographic frontal product view, holdout display, transparent RGBA. No live runtime renderer.'}
(ROOT/'public/landing-assets/guided-demo/macbook-frame-v2.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Save only this new scene as an editable library, preserving the original prepared file.
bpy.data.libraries.write(str(ROOT/'design/landing/guided-demo/macbook-frame-v2.blend'),{scene},fake_user=True,compress=True)
bpy.ops.render.render(write_still=True,scene=scene.name)
print(json.dumps(manifest))
