"""Build original, editable articulated toy animals. Run with Blender --background --python.
All visible pieces have rigid bone weights; no images, textures or external assets.
Blender Z is up, -Y faces the camera. Bone local Y follows the upright axis.
"""
import bpy
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def material(name, rgb, roughness=.55):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return m

def build(kind):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    cat = kind == 'kitten'
    fur = material('Fur', (.83, .43, .18) if cat else (.66, .36, .16))
    cream = material('Cream', (.98, .87, .67))
    darkfur = material('Markings', (.42, .19, .08))
    pink = material('Pink', (.91, .36, .42))
    black = material('Eyes', (.018, .025, .034), .2)
    white = material('Eye glints', (1, .98, .93), .2)
    collar = material('Collar', (.12, .48, .48) if cat else (.26, .40, .78))
    gold = material('Tag', (1, .66, .16), .3)
    pieces = []

    def sphere(name, pos, scale, mat, bone, rot=None):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=pos)
        o = bpy.context.object
        o.name = name
        o.scale = scale
        if rot: o.rotation_euler = rot
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(mat)
        for face in o.data.polygons: face.use_smooth = True
        pieces.append((o, bone))
        return o

    def curve(name, points, radius, mat, bone):
        data = bpy.data.curves.new(name, 'CURVE')
        data.dimensions = '3D'
        data.bevel_depth = radius
        data.bevel_resolution = 3
        data.use_fill_caps = True
        spl = data.splines.new('BEZIER')
        spl.bezier_points.add(len(points)-1)
        for p, co in zip(spl.bezier_points, points):
            p.co = co
            p.handle_left_type = p.handle_right_type = 'AUTO'
        o = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.convert(target='MESH')
        o.data.materials.append(mat)
        pieces.append((o, bone))
        o.select_set(False)

    # Rounded, seated silhouette with clearly separate forelegs and hind paws.
    sphere('Torso', (0, .08, .82), (.48, .35, .59), fur, 'Torso')
    sphere('Bib', (0, -.235, .9), (.30, .08, .40), cream, 'Torso')
    for side, x in [('L', -.36), ('R', .36)]:
        sphere('Haunch_'+side, (x, .10, .35), (.25, .28, .30), fur, 'HindLeg_'+side)
        sphere('BackPaw_'+side, (x, -.10, .14), (.25, .30, .14), cream, 'HindPaw_'+side)
        sx = x * .70
        sphere('Foreleg_'+side, (sx, -.29, .57), (.14, .15, .34), fur, 'Foreleg_'+side)
        sphere('FrontPaw_'+side, (sx, -.36, .27), (.17, .21, .14), cream, 'FrontPaw_'+side)
        for n in [-1, 1]:
            sphere('Toe_'+side+str(n), (sx+n*.047, -.553, .28), (.011, .01, .046), darkfur, 'FrontPaw_'+side)
    sphere('Head', (0, -.015, 1.54), (.57, .40, .47), fur, 'Head')
    sphere('MuzzleL', (-.135, -.371, 1.38), (.21, .14, .16), cream, 'Head')
    sphere('MuzzleR', (.135, -.371, 1.38), (.21, .14, .16), cream, 'Head')
    sphere('Jaw', (0, -.31, 1.28), (.20, .15, .11), cream, 'Jaw')
    sphere('Nose', (0, -.515, 1.46), (.085, .05, .06), pink if cat else black, 'Head')
    curve('Smile', [(-.14,-.493,1.35),(0,-.48,1.31),(.14,-.493,1.35)], .015, darkfur, 'Jaw')
    if not cat:
        sphere('Tongue', (0, -.455, 1.27), (.065, .035, .085), pink, 'Jaw')
    for side, sign in [('L', -1), ('R', 1)]:
        x = .23*sign
        if not cat:
            sphere('EyePatch_'+side, (x, -.332, 1.65), (.20, .084, .235), darkfur, 'Head')
        sphere('Eye_'+side, (x, -.391, 1.64), (.115, .048, .148), black, 'Eye_'+side)
        sphere('Glint_'+side, (x-.032, -.435, 1.70), (.035, .018, .044), white, 'Eye_'+side)
        sphere('GlintSmall_'+side, (x+.035, -.435, 1.61), (.015, .012, .019), white, 'Eye_'+side)
        sphere('Cheek_'+side, (.36*sign, -.338, 1.43), (.087, .026, .045), pink, 'Head')
        if cat:
            # Rounded triangular ears made from a bevelled triangular prism.
            verts = [(sign*.22,-.10,1.80),(sign*.54,-.07,1.80),(sign*.46,-.03,2.20),
                     (sign*.22,.10,1.80),(sign*.54,.12,1.80),(sign*.46,.13,2.20)]
            mesh = bpy.data.meshes.new('EarMesh')
            mesh.from_pydata(verts, [], [(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)])
            mesh.update()
            o = bpy.data.objects.new('Ear_'+side, mesh)
            bpy.context.collection.objects.link(o)
            o.data.materials.append(fur)
            mod = o.modifiers.new('Soft ear edges','BEVEL'); mod.width=.065; mod.segments=3
            bpy.context.view_layer.objects.active=o
            bpy.ops.object.modifier_apply(modifier=mod.name)
            for poly in o.data.polygons: poly.use_smooth=True
            pieces.append((o,'Ear_'+side))
            sphere('InnerEar_'+side,(sign*.415,-.105,1.97),(.066,.027,.135),pink,'Ear_'+side, (0,sign*.22,0))
            for z in [1.38,1.45]:
                curve('Whisker', [(sign*.26,-.456,z),(sign*.48,-.44,z+.025),(sign*.66,-.35,z+.06)], .009, cream, 'Head')
        else:
            sphere('Ear_'+side,(sign*.53,.005,1.58),(.18,.17,.39),darkfur,'Ear_'+side,(0,sign*-.24,0))
            sphere('InnerEar_'+side,(sign*.57,-.14,1.56),(.09,.035,.24),fur,'Ear_'+side,(0,sign*-.24,0))
    if cat:
        for x in [-.14,0,.14]:
            sphere('ForeheadStripe', (x,-.279,1.9), (.032,.035,.105), darkfur, 'Head',(0,x*1.4,0))
    sphere('Collar', (0,-.025,1.14), (.37,.32,.07), collar, 'Torso')
    sphere('Tag', (0,-.351,1.09), (.062,.022,.074), gold, 'Torso')
    tailpoints = [(.28,.29,.46),(.65,.31,.5),(.85,.25,.83),( .85,.20,1.13)] if cat else [(.3,.3,.48),(.6,.3,.6),(.74,.23,.92)]
    curve('TailBase', tailpoints[:-1], .095 if cat else .13, fur, 'Tail')
    curve('TailTip', tailpoints[-2:], .095 if cat else .12, cream, 'TailTip')
    tip_radius = .095 if cat else .12
    sphere('TailRound', tailpoints[-1], (tip_radius,)*3, cream, 'TailTip')

    # Every visible piece is bound to its own articulated joint hierarchy.
    defs = [('Root',(0,0,0),None),('Torso',(0,0,.6),'Root'),('Head',(0,0,1.2),'Torso'),
            ('Jaw',(0,-.30,1.34),'Head'),('Tail',(.28,.29,.46),'Torso'),
            ('TailTip',tailpoints[-2],'Tail')]
    for side, sign in [('L',-1),('R',1)]:
        defs += [('Ear_'+side,(sign*.40,0,1.85),'Head'),('Eye_'+side,(sign*.23,-.39,1.64),'Head'),
                 ('Foreleg_'+side,(sign*.252,-.29,.86),'Torso'),
                 ('FrontPaw_'+side,(sign*.252,-.32,.36),'Foreleg_'+side),
                 ('HindLeg_'+side,(sign*.36,.1,.49),'Root'),
                 ('HindPaw_'+side,(sign*.36,-.04,.2),'HindLeg_'+side)]
    arm_data = bpy.data.armatures.new('AnimalSkeleton')
    arm = bpy.data.objects.new('AnimalRig', arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, pos, parent in defs:
        bone = arm_data.edit_bones.new(name)
        bone.head = pos
        bone.tail = (pos[0],pos[1],pos[2]+.18)
        if parent: bone.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.show_in_front=True
    for o, bone in pieces:
        o.name = 'Mesh_' + o.name
        group = o.vertex_groups.new(name=bone)
        group.add(list(range(len(o.data.vertices))),1,'REPLACE')
        mod = o.modifiers.new('Articulated','ARMATURE'); mod.object=arm
        o.parent = arm
    # Pose clips are baked on the rig and retained in both GLB and .blend.
    for mood in ['idle','working','happy','sleeping','wave','dance','curious','shake','yawn','kiss','grabbed','petting','sniff','paw','groom']:
        arm.animation_data_create()
        action = bpy.data.actions.new(mood)
        arm.animation_data.action=action
        for frame in range(1,50,4):
            t=(frame-1)/48*math.tau
            for b in arm.pose.bones:
                b.rotation_mode='XYZ'; b.rotation_euler=(0,0,0); b.location=(0,0,0); b.scale=(1,1,1)
            b=arm.pose.bones
            b['Torso'].scale=(1+.018*math.sin(t),1+.025*math.sin(t),1)
            b['Head'].rotation_euler.z=.045*math.sin(t)
            b['Tail'].rotation_euler.y=(.13 if cat else .32)*math.sin(t*2)
            b['TailTip'].rotation_euler.x=.15*math.sin(t*2+.6)
            b['Ear_L'].rotation_euler.z=.06*math.sin(t)
            b['Ear_R'].rotation_euler.z=-.05*math.sin(t+.5)
            if mood in ['happy','dance','grabbed','working']:
                b['Root'].location.y=.045*(1-math.cos(t*2))
                for side, sign in [('L',1),('R',-1)]:
                    b['Foreleg_'+side].rotation_euler.x=.25*math.sin(t*2)*sign
                    b['FrontPaw_'+side].rotation_euler.x=.16*math.cos(t*2)*sign
                    b['HindLeg_'+side].rotation_euler.x=.14*math.sin(t*2)*-sign
                    b['HindPaw_'+side].rotation_euler.x=.12*math.cos(t*2)*sign
                b['Tail'].rotation_euler.y=.5*math.sin(t*3)
            # Soft envelopes return each interaction to rest before the clip ends.
            ease = math.sin(t/2)**2
            if mood == 'petting':
                b['Head'].rotation_euler.z=(.16 if cat else -.12)*ease
                b['Head'].rotation_euler.x=-.10*ease
                b['Eye_L'].scale.y=b['Eye_R'].scale.y=1-.65*ease
                b['Ear_L'].rotation_euler.x=-.16*ease
                b['Ear_R'].rotation_euler.x=-.16*ease
                b['Tail'].rotation_euler.y=(.22 if cat else .55)*math.sin(t*2)*ease
            if mood == 'sniff':
                b['Head'].rotation_euler.x=.22*ease
                b['Head'].rotation_euler.z=.18*math.sin(t)*ease
                b['Head'].location.y=-.035*math.sin(t*3)*ease
                b['Ear_L'].rotation_euler.x=-.12*ease
                b['Ear_R'].rotation_euler.x=-.12*ease
            if mood == 'paw':
                b['Foreleg_R'].rotation_euler.x=-.85*ease
                b['Foreleg_R'].rotation_euler.z=.25*ease
                b['FrontPaw_R'].rotation_euler.x=.35*ease
                b['Head'].rotation_euler.z=-.12*ease
                b['Tail'].rotation_euler.y=(.2 if cat else .5)*math.sin(t*2)*ease
            if mood == 'groom':
                if cat:
                    b['Foreleg_L'].rotation_euler.x=-1.35*ease
                    b['Foreleg_L'].rotation_euler.z=-.3*ease
                    b['FrontPaw_L'].rotation_euler.x=.5*ease
                    b['Head'].rotation_euler.x=.22*ease
                    b['Head'].rotation_euler.z=-.18*ease
                    b['Jaw'].rotation_euler.x=.15*(1-math.cos(t*3))*ease
                else:
                    b['HindLeg_R'].rotation_euler.z=-.65*ease
                    b['HindLeg_R'].rotation_euler.x=-.45*ease
                    b['HindPaw_R'].rotation_euler.x=.45*math.sin(t*4)*ease
                    b['Head'].rotation_euler.z=.22*ease
                    b['Ear_R'].rotation_euler.x=.2*math.sin(t*4)*ease
            if mood == 'wave':
                b['Foreleg_R'].rotation_euler.z=1.95+.2*math.sin(t*3)
                b['FrontPaw_R'].rotation_euler.z=.4*math.sin(t*3)
            if mood == 'dance': b['Torso'].rotation_euler.z=.14*math.sin(t*2)
            if mood == 'curious': b['Head'].rotation_euler.z=.25*math.sin(t/2)
            if mood == 'shake':
                b['Head'].rotation_euler.y=.22*math.sin(t*4)
                b['Ear_L'].rotation_euler.x=.3*math.sin(t*4)
                b['Ear_R'].rotation_euler.x=-.3*math.sin(t*4)
            if mood == 'sleeping':
                b['Head'].rotation_euler.x=.20
                b['Eye_L'].scale.y=b['Eye_R'].scale.y=.08
                b['Torso'].scale.y=.86+.015*math.sin(t)
                b['Tail'].rotation_euler.y=.6
            if mood == 'yawn':
                b['Head'].rotation_euler.x=-.18*math.sin(t/2)
                b['Jaw'].rotation_euler.x=.5*math.sin(t/2)
                b['Eye_L'].scale.y=b['Eye_R'].scale.y=.35
            if mood == 'kiss':
                b['Head'].rotation_euler.z=.16*math.sin(t/2)
                b['Jaw'].scale=(.8,1,1)
            for bone in b:
                for prop in ['rotation_euler','location','scale']:
                    bone.keyframe_insert(data_path=prop,frame=frame,group=bone.name)
        action.use_fake_user=True
        track=arm.animation_data.nla_tracks.new(); track.name=mood
        track.strips.new(mood,1,action)
        track.mute=True
    arm.animation_data.action=bpy.data.actions.get('idle')
    for b in arm.pose.bones:
        b.rotation_euler=(0,0,0); b.location=(0,0,0); b.scale=(1,1,1)
    bpy.context.scene.frame_set(1)
    bpy.context.scene.render.fps=24
    bpy.context.scene.frame_end=49
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender'/f'{kind}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'src/renderer/models'/f'{kind}.glb'),
        export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',
        export_force_sampling=True,export_nla_strips=True)

for kind in ['kitten','puppy']:
    build(kind)
