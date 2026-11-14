"""Build the HAC-115 laptop in Blender; run with exec(compile(...)).

Offline authoring only. The source is jackbaeten's CC BY 4.0 model,
obtained from the pinned distribution recorded in README.md.
Preserves other Blender scenes and writes only this task's asset paths.
"""

import json
import math
from pathlib import Path

import bmesh
import bpy
import io_scene_gltf2
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUTPUT = ROOT / "public" / "landing-assets" / "macbook"
SCENE_NAME = "BizBox_HAC115_Prepared"
SOURCE_WIDTH = 35.482521057128906
SCALE = 0.3557 / SOURCE_WIDTH
GROUND_OFFSET = 1.0662333965301514 * SCALE
HINGE = Vector((0, 12.2 * SCALE, -0.5 * SCALE + GROUND_OFFSET))


def enum_value(operator, name, requested):
    values = {v.identifier for v in operator.get_rna_type().properties[name].enum_items}
    # Blender 5.3's format enum is a dynamic callback, absent from RNA items.
    if not values and name == "export_format":
        values = {item[0] for item in io_scene_gltf2.get_format_items(scene, bpy.context)}
    if requested not in values:
        raise RuntimeError(f"Unsupported {name}: {requested}; available: {values}")
    return requested


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def split_shells(obj):
    """Keep whole connected shells on one side of the physical hinge seam."""
    mesh = obj.data
    parent = list(range(len(mesh.vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for edge in mesh.edges:
        a, b = edge.vertices
        parent[find(a)] = find(b)
    components = {}
    for vertex in mesh.vertices:
        key = find(vertex.index)
        total, count = components.get(key, (0, 0))
        components[key] = (total + vertex.co.y, count + 1)
    lid = {key: total / count > HINGE.y for key, (total, count) in components.items()}
    face_is_lid = [lid[find(p.vertices[0])] for p in mesh.polygons]
    if all(face_is_lid) or not any(face_is_lid):
        return [(obj, all(face_is_lid))]
    result = []
    for keep_lid in (False, True):
        piece = obj.copy()
        piece.data = mesh.copy()
        scene.collection.objects.link(piece)
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        bm.faces.ensure_lookup_table()
        discard = [f for f in bm.faces if face_is_lid[f.index] != keep_lid]
        bmesh.ops.delete(bm, geom=discard, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(piece.data)
        bm.free()
        piece.data.update()
        result.append((piece, keep_lid))
    bpy.data.objects.remove(obj, do_unlink=True)
    return result


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


if bpy.data.scenes.get(SCENE_NAME):
    raise RuntimeError(f"Scene {SCENE_NAME} already exists; choose a new name for a rebuild")
OUTPUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new(SCENE_NAME)
bpy.context.window.scene = scene
bpy.ops.import_scene.gltf(filepath=str(HERE / "macbook-source.glb"))
source_objects = list(scene.objects)
root = empty("HAC115_LaptopRoot")
root["source"] = "jackbaeten / MacBook Pro M3 16-inch 2024"
root["license"] = "https://creativecommons.org/licenses/by/4.0/"
root["units"] = "metres"
root["screen_node"] = "HAC115_Screen"
base = empty("HAC115_LaptopBase", root)
lid_pivot = empty("HAC115_LidPivot", root, HINGE)
bpy.context.view_layer.update()
screen = None
for source in source_objects:
    if source.type != "MESH":
        continue
    source_name = source.name
    world = source.matrix_world.copy()
    source.data.transform(world)
    source.matrix_world = Matrix.Identity(4)
    for vertex in source.data.vertices:
        vertex.co *= SCALE
        vertex.co.z += GROUND_OFFSET
    is_screen = any(m.name.startswith("sfCQkHOWyrsLmor") for m in source.data.materials)
    for piece, is_lid in split_shells(source):
        piece.parent = lid_pivot if is_lid else base
        piece.matrix_parent_inverse = piece.parent.matrix_world.inverted()
        piece.name = "HAC115_Screen" if is_screen else f"{'Lid' if is_lid else 'Base'}_{source_name}"
        if is_screen:
            screen = piece
        # Preserve authored normals, UVs, key legends and physical port geometry.
        piece.data.update()
if screen is None:
    raise RuntimeError("Source display panel not found")
bpy.context.view_layer.update()

material = bpy.data.materials.new("BizBox_Display_Interim_Product_Map")
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
output = nodes.new("ShaderNodeOutputMaterial")
emission = nodes.new("ShaderNodeEmission")
texture = nodes.new("ShaderNodeTexImage")
texture.image = bpy.data.images.load(str(OUTPUT / "bizbox-map-screen.png"), check_existing=True)
texture.image.pack()
material.node_tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
material.node_tree.links.new(emission.outputs[0], output.inputs["Surface"])
emission.inputs["Strength"].default_value = 1
screen.data.materials.clear()
screen.data.materials.append(material)

# Use the imported UV orientation. Screen corners are measured from its plane,
# including the physical notch in the original mesh; no rectangular bezel fake.
points = [screen.matrix_world @ v.co for v in screen.data.vertices]
right = Vector((1, 0, 0))
normal = (screen.matrix_world.to_3x3() @ screen.data.polygons[0].normal).normalized()
if normal.y > 0:
    normal.negate()
up = normal.cross(right).normalized()
if up.z < 0:
    up.negate()
center = sum(points, Vector()) / len(points)
u = [p.dot(right) for p in points]
v = [p.dot(up) for p in points]
plane_offset = center.dot(normal)
# The source wallpaper's V direction was reversed. Derive UVs from the physical
# display axes so real UI text is upright and the screen can later show replay.
uv_layer = screen.data.uv_layers.active
for loop in screen.data.loops:
    point = screen.matrix_world @ screen.data.vertices[loop.vertex_index].co
    uv_layer.data[loop.index].uv = (
        (point.dot(right) - min(u)) / (max(u) - min(u)),
        (point.dot(up) - min(v)) / (max(v) - min(v)),
    )
corners = []
for label, x, y in [("ScreenTopLeft", min(u), max(v)), ("ScreenTopRight", max(u), max(v)),
                    ("ScreenBottomRight", max(u), min(v)), ("ScreenBottomLeft", min(u), min(v))]:
    position = right * x + up * y + normal * plane_offset
    anchor = empty("HAC115_" + label, lid_pivot)
    anchor.matrix_world = Matrix.Translation(position)
    corners.append({"node": anchor.name, "position_blender": list(position)})
screen["content_status"] = "Interim actual map capture; consultant composition is HAC-118"
screen["replace_material"] = True
root["screen_aspect"] = (max(u) - min(u)) / (max(v) - min(v))

world = bpy.data.worlds.new("HAC115_Studio")
world.use_nodes = True
background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
background.inputs["Color"].default_value = (0.09, 0.11, 0.15, 1)
background.inputs["Strength"].default_value = 0.5
scene.world = world
for name, location, power, size in [
    ("HAC115_Key", (-0.3, -0.2, 0.55), 12, 0.5),
    ("HAC115_Rim", (0.4, 0.3, 0.4), 16, 0.35),
    ("HAC115_Fill", (0.05, -0.5, 0.2), 4, 0.4),
]:
    light = bpy.data.lights.new(name, "AREA")
    light.energy = power
    light.shape = "DISK"
    light.size = size
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    aim(obj, (0, 0.03, 0.08))
camera_data = bpy.data.cameras.new("HAC115_ReviewCamera")
camera = bpy.data.objects.new("HAC115_ReviewCamera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0.32, -0.65, 0.39)
camera_data.lens = 55
aim(camera, (0, 0.035, 0.10))
scene.camera = camera
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.film_transparent = True

# Only this scene's selected asset hierarchy is distributed, never review lights
# or another scene from the user's Blender session.
bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    obj.select_set(obj.type in {"MESH", "EMPTY"})
bpy.context.view_layer.objects.active = root
export = bpy.ops.export_scene.gltf
export(filepath=str(OUTPUT / "macbook.glb"),
       export_format=enum_value(export, "export_format", "GLB"),
       use_selection=True, use_active_scene=True, export_extras=True, export_cameras=False,
       export_lights=False, export_animations=False)
temporary_modifiers = []
try:
    for obj in scene.objects:
        if obj.type == "MESH" and obj != screen and len(obj.data.polygons) > 1000:
            modifier = obj.modifiers.new("HAC115_MobileLOD", "DECIMATE")
            modifier.ratio = 0.42
            temporary_modifiers.append((obj, modifier))
    export(filepath=str(OUTPUT / "macbook-mobile.glb"),
           export_format=enum_value(export, "export_format", "GLB"),
           use_selection=True, use_active_scene=True, export_extras=True,
           export_cameras=False, export_lights=False, export_animations=False,
           export_apply=True)
finally:
    for obj, modifier in temporary_modifiers:
        obj.modifiers.remove(modifier)
bpy.data.libraries.write(str(HERE / "macbook-prepared.blend"), {scene}, compress=True)
manifest = {
    "model": "macbook.glb", "root": root.name, "hinge": lid_pivot.name,
    "mobile_model": "macbook-mobile.glb",
    "screen": screen.name, "units": "metres", "width": 0.3557,
    "source_axis": "Blender Z up; exported glTF Y up",
    "screen_aspect": root["screen_aspect"], "screen_corners": corners,
    "screen_status": "Interim actual app map; requested consultant composition pending HAC-118",
    "attribution_url": "./credits.html",
    "triangles": sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH"),
    "mesh_objects": sum(o.type == "MESH" for o in scene.objects),
}
(OUTPUT / "model-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
