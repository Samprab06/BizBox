import bpy, math, json, struct, contextlib, io
from pathlib import Path
from mathutils import Vector

OUT=Path(__file__).resolve().parents[2] / 'public' / 'landing-preview'
scene=bpy.data.scenes.new('BizBox_MacBook_v3');bpy.context.window.scene=scene

def mat(name,base,metal=0,rough=.4,emission=0):
 m=bpy.data.materials.new('V3_'+name);m.use_nodes=True;p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 p.inputs['Base Color'].default_value=(*base,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emission:p.inputs['Emission Color'].default_value=(*base,1);p.inputs['Emission Strength'].default_value=emission
 return m

silver=mat('Silver_Anodized_Aluminum',(.38,.41,.45),.96,.28)
rim=mat('Machined_Reflective_Edge',(.61,.65,.7),1,.19)
black=mat('Black_Keyboard_Recess',(.007,.009,.012),.05,.48)
keymat=mat('Black_Keycap',(.009,.011,.014),0,.5)
letter=mat('Keycap_Legend',(.75,.78,.81),0,.62,.06)
track=mat('Trackpad_Anodized',(.34,.37,.405),.92,.34)
lens=mat('Camera_Glass',(.006,.014,.023),.35,.12)

def empty(name,loc=(0,0,0),parent=None):
 o=bpy.data.objects.new('V3__'+name,None);scene.collection.objects.link(o);o.location=loc;o.parent=parent;return o
def cube(name,loc,dims,material,parent=None,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.name='V3__'+name;o.scale=dims;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  m=o.modifiers.new('Machined radius','BEVEL');m.width=bevel;m.segments=4;m.harden_normals=True
  bpy.ops.object.modifier_apply(modifier=m.name)
  n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');n.keep_sharp=True
  bpy.ops.object.modifier_apply(modifier=n.name)
 o.data.materials.append(material);o.parent=parent;o.location=loc;return o
def cylinder(name,loc,radius,depth,material,parent=None,segments=24):
 bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=radius,depth=depth);o=bpy.context.object;o.name='V3__'+name;o.data.materials.append(material);o.parent=parent;o.location=loc
 for p in o.data.polygons:p.use_smooth=True
 return o
def legend(text,x,y,parent,size=.095):
 curve=bpy.data.curves.new('Key legend','FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=size;curve.resolution_u=4;curve.extrude=0
 o=bpy.data.objects.new('V3__Legend_'+text,curve);scene.collection.objects.link(o);o.parent=parent;o.location=(x,y,.147);curve.materials.append(letter)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return bpy.context.object

root=empty('LaptopRoot')
cube('Unibody',(0,0,-.025),(6.6,4.56,.22),silver,root,.115)
cube('Lower_Rim',(0,0,-.111),(6.58,4.54,.04),rim,root,.09)
cube('Front_Lip',(0,-2.276,.04),(1.35,.024,.045),track,root,.018)
cube('Keyboard_Recess',(0,.36,.092),(5.54,2.69,.035),black,root,.085)
cube('Trackpad_Edge',(0,-1.48,.088),(2.46,1.11,.015),rim,root,.07)
cube('Trackpad',(0,-1.48,.098),(2.43,1.08,.014),track,root,.062)

rows=[
 [('esc',1.3)]+[(f'F{i}',1) for i in range(1,13)]+[('',1)],
 [('`',1)]+[(str(i),1) for i in range(1,10)]+[('0',1),('-',1),('=',1),('delete',1.5)],
 [('tab',1.5)]+[(c,1) for c in 'QWERTYUIOP']+[('[',1),(']',1),('\\',1)],
 [('caps',1.75)]+[(c,1) for c in 'ASDFGHJKL']+[(';',1),("'",1),('return',1.75)],
 [('shift',2.25)]+[(c,1) for c in 'ZXCVBNM']+[(',',1),('.',1),('/',1),('shift',2.25)],
 [('fn',1),('ctrl',1),('opt',1),('cmd',1.25),('',5.9),('cmd',1.25),('opt',1),('◀',.8),('▲',.8),('▶',.8)]
]
for row,items in enumerate(rows):
 total=sum(w for _,w in items);unit=5.22/total;left=-2.61;y=1.45-row*.385
 for text,w in items:
  width=w*unit-.055;x=left+w*unit/2;left+=w*unit
  cube('Keycap',(x,y,.125),(width,.315 if row else .28,.035),keymat,root,.032)
  if text:legend(text,x,y,root,.068 if len(text)>1 else .095)
touch=cylinder('Touch_ID_Ring',(2.48,1.45,.148),.108,.007,rim,root)
cylinder('Touch_ID_Glass',(2.48,1.45,.154),.094,.007,black,root)
for side in (-1,1):
 for row in range(20):
  for col in range(3):
   cylinder('Speaker_Perforation',(side*(2.91+col*.045),-.77+row*.115,.091),.009,.005,black,root,8)
 for y in [.28,.76]:cube('USB_C_Port',(side*3.301,y,-.024),(.013,.20,.068),black,root,.018)
cube('Headphone_Port',(-3.303,1.44,-.024),(.012,.085,.085),black,root,.04)
cube('HDMI_Port',(3.303,1.25,-.02),(.012,.34,.072),black,root,.02)
for x in [-2.72,2.72]:
 hinge=cylinder('Hinge',(x,2.08,.09),.12,.7,black,root);hinge.rotation_euler[1]=math.pi/2

lid=empty('LaptopLid',(0,2.08,.09),root);lid.rotation_euler[0]=math.radians(-11)
cube('Display_Aluminum',(0,0,2.075),(6.6,.105,4.15),silver,lid,.098)
cube('Display_Edge',(0,-.049,2.075),(6.57,.018,4.12),rim,lid,.09)
cube('Display_Bezel',(0,-.063,2.075),(6.43,.018,4.0),black,lid,.075)

# Actual product texture, retained as a separate screen plane for camera bounds.
m=bpy.data.materials.new('V3_Product_Display');m.use_nodes=True;nodes=m.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');em=nodes.new('ShaderNodeEmission');tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/'assets/product-screen.jpg'));tex.image.pack();em.inputs['Strength'].default_value=.72;m.node_tree.links.new(tex.outputs['Color'],em.inputs['Color']);m.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
x=3.15;bottom=.13;top=4.02;r=.055;y=-.078
coords=[(-x+r,y,bottom),(x-r,y,bottom),(x,y,bottom+r),(x,y,top-r),(x-r,y,top),(-x+r,y,top),(-x,y,top-r),(-x,y,bottom+r)]
mesh=bpy.data.meshes.new('V3_Rounded_Display');mesh.from_pydata(coords,[],[tuple(range(8))]);mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:
 v=mesh.vertices[loop.vertex_index].co;mesh.uv_layers.active.data[loop.index].uv=((v.x+x)/(2*x),(v.z-bottom)/(top-bottom))
screen=bpy.data.objects.new('V3__Actual_Product_Screen',mesh);scene.collection.objects.link(screen);screen.parent=lid;screen.data.materials.append(m)
cube('Camera_Notch',(0,-.091,3.95),(.62,.02,.19),black,lid,.043)
cam=cylinder('FaceTime_Lens',(0,-.108,3.955),.023,.009,lens,lid,24);cam.rotation_euler[0]=math.pi/2

# Consolidate opaque assemblies. Keep the display and lid transforms inspectable.
for parent,name in [(root,'BodyAssembly'),(lid,'DisplayAssembly')]:
 meshes=[o for o in list(parent.children) if o.type=='MESH' and o!=screen]
 bpy.ops.object.select_all(action='DESELECT')
 for o in meshes:o.select_set(True)
 bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();bpy.context.object.name='V3__'+name

world=bpy.data.worlds.new('V3_Peach_Studio');world.use_nodes=True;scene.world=world;world.node_tree.nodes.get('Background').inputs[0].default_value=(.10,.13,.2,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.35
for name,loc,power,col,size in [('Key',(-5,-5,9),1800,(1,.77,.57),7),('Rim',(4,4,7),2200,(.64,.77,1),6),('Fill',(2,-6,3),500,(1,.91,.8),5)]:
 data=bpy.data.lights.new('V3_'+name,'AREA');data.energy=power;data.color=col;data.shape='DISK';data.size=size;o=bpy.data.objects.new('V3_'+name,data);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,.2,1.2))-o.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('V3_Review_Camera');cam=bpy.data.objects.new('V3_Review_Camera',data);scene.collection.objects.link(cam);cam.location=(7,-10,6.4);cam.rotation_euler=(Vector((0,.4,1.3))-cam.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=10;scene.camera=cam;scene.render.resolution_x=1600;scene.render.resolution_y=1000

bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for o in root.children_recursive:o.select_set(True)
with contextlib.redirect_stdout(io.StringIO()):
 bpy.ops.export_scene.gltf(filepath=str(OUT/'assets/bizbox-scene.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(Path(__file__).resolve().parent / 'bizbox-macbook.blend'))
p=OUT/'assets/bizbox-scene.glb';raw=p.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);tail=raw[20+length:]
for node in doc.get('nodes',[]):node['name']=node.get('name','').removeprefix('V3__')
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
p.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail)
print(json.dumps({'asset':str(p),'bytes':p.stat().st_size,'objects':len(scene.objects),'root':'LaptopRoot','screen':'Actual_Product_Screen','assemblies':'BodyAssembly + DisplayAssembly + screen','source_blend':str(OUT/'assets/bizbox-macbook-v3.blend')}))
