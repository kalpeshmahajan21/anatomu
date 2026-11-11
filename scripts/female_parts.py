"""
Female anatomy for the Male / Female switch.

Z-Anatomy (and BodyParts3D) are built from ONE male body: their female folders are empty.
The female structures come from the NIH Human Reference Atlas (HRA) 3D reference organs,
made from the Visible Human female, licensed CC BY 4.0:
    https://humanatlas.io/3d-reference-library
Download the files listed in HRA_FILES into source_models/hra/ (see README).

FITTING THEM INTO OUR BODY
The HRA organs all share one coordinate frame (metres, Y-up glTF; after Blender's import the
body faces -Y and its left side is +X, the same as Z-Anatomy). They come from a different
person, so we move and scale them onto our skeleton with ONE transform for all of them:
  - The female pelvis must sit on our femurs. We find the centre of each femoral head
    (sphere fit) and the centre of each female hip socket (where ilium, ischium and pubis
    meet), then pick the uniform scale + offset that puts the sockets on the heads.
  - The uterus, tubes, ovaries and bladder use the same transform, so they stay exactly
    where they are inside the female pelvis.
  - The breasts use the same scale, then are moved onto the front of our ribcage
    (their own vertical position is kept relative to the nipple line of the chest).
The female pelvis keeps its own (wider, shallower) shape; only its size and position change.
"""

import os
import re

import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree

HRA_DIR = 'source_models/hra'

# file -> list of (HRA mesh name, our raw name, layer, text to describe it with, TA term, group path)
# Raw names follow Z-Anatomy style (".l"/".r" = side). "(female)" marks a female version of a
# structure that also exists in the male model; the app hides it from the visible name.
FG = 'Female genital system'
HRA_FILES = {
    'VH_F_Pelvis.glb': [
        ('VH_F_ilium_compact_bone_L', 'Ilium.l', 'skeleton', 'Ilium', 'ilium', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_ilium_compact_bone_R', 'Ilium.r', 'skeleton', 'Ilium', 'ilium', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_ischium_compact_bone_L', 'Ischium.l', 'skeleton', 'Ischium', 'ischium', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_ischium_compact_bone_R', 'Ischium.r', 'skeleton', 'Ischium', 'ischium', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_pubis_compact_bone_L', 'Pubis.l', 'skeleton', 'Pubis', 'pubis', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_pubis_compact_bone_R', 'Pubis.r', 'skeleton', 'Pubis', 'pubis', ['Pelvic girdle', 'Hip bone']),
        ('VH_F_sacrum', 'Sacrum (female)', 'skeleton', 'Sacrum', 'sacrum', ['Vertebral column', 'Sacrum']),
        ('VH_F_coccyx', 'Coccyx (female)', 'skeleton', 'Coccyx', 'coccyx', ['Vertebral column', 'Coccyx']),
    ],
    'VH_F_Uterus.glb': [
        ('VH_F_fundus_of_uterus', 'Fundus of uterus', 'reproductive', 'Uterus', 'fundus of uterus', [FG, 'Uterus']),
        ('VH_F_body_of_uterus', 'Body of uterus', 'reproductive', 'Uterus', 'body of uterus', [FG, 'Uterus']),
        ('VH_F_anterior_wall_of_uterus', 'Anterior wall of uterus', 'reproductive', 'Uterus', 'anterior surface of uterus', [FG, 'Uterus']),
        ('VH_F_posterior_wall_of_uterus', 'Posterior wall of uterus', 'reproductive', 'Uterus', 'intestinal surface of uterus', [FG, 'Uterus']),
        ('VH_F_lower_uterine_segment', 'Lower uterine segment', 'reproductive', 'Uterus', 'isthmus of uterus', [FG, 'Uterus']),
        ('VH_F_cervix', 'Cervix of uterus', 'reproductive', 'Uterus', 'cervix of uterus', [FG, 'Uterus']),
        ('VH_F_cornua', 'Uterine horns', 'reproductive', 'Uterus', 'uterine horn', [FG, 'Uterus']),
    ],
    'VH_F_Fallopian_Tube_L.glb': [
        ('VH_F_ampulla_of_uterine_tube_L', 'Ampulla of uterine tube.l', 'reproductive', 'Fallopian tube', 'ampulla of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_fibria_of_uterine_tube_L', 'Fimbriae of uterine tube.l', 'reproductive', 'Fallopian tube', 'fimbriae of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_isthmus_of_fallopian_tube_L', 'Isthmus of uterine tube.l', 'reproductive', 'Fallopian tube', 'isthmus of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_uterine_tube_infundibulum_L', 'Infundibulum of uterine tube.l', 'reproductive', 'Fallopian tube', 'infundibulum of uterine tube', [FG, 'Uterine tube']),
    ],
    'VH_F_Fallopian_Tube_R.glb': [
        ('VH_F_ampulla_of_uterine_tube_R', 'Ampulla of uterine tube.r', 'reproductive', 'Fallopian tube', 'ampulla of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_fibria_of_uterine_tube_R', 'Fimbriae of uterine tube.r', 'reproductive', 'Fallopian tube', 'fimbriae of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_isthmus_of_fallopian_tube_R', 'Isthmus of uterine tube.r', 'reproductive', 'Fallopian tube', 'isthmus of uterine tube', [FG, 'Uterine tube']),
        ('VH_F_uterine_tube_infundibulum_R', 'Infundibulum of uterine tube.r', 'reproductive', 'Fallopian tube', 'infundibulum of uterine tube', [FG, 'Uterine tube']),
    ],
    'VH_F_Ovary_L.glb': [('VH_F_left_ovary', 'Ovary.l', 'reproductive', 'Ovary', 'ovary', [FG, 'Ovary'])],
    'VH_F_Ovary_R.glb': [('VH_F_right_ovary', 'Ovary.r', 'reproductive', 'Ovary', 'ovary', [FG, 'Ovary'])],
    'VH_F_Urinary_Bladder.glb': [
        ('VH_F_fundus_of_urinary_bladder_dome', 'Urinary bladder (female)', 'organs', 'Urinary bladder', 'urinary bladder', ['Urinary system', 'Urinary bladder']),
        ('VH_F_fundus_of_urinary_bladder_base', 'Base of urinary bladder (female)', 'organs', 'Urinary bladder', 'fundus of urinary bladder', ['Urinary system', 'Urinary bladder']),
        ('VH_F_trigone_of_urinary_bladder', 'Trigone of bladder (female)', 'organs', 'Urinary bladder', 'trigone of bladder', ['Urinary system', 'Urinary bladder']),
        ('VH_F_urinary_bladder_neck_smooth_muscle', 'Neck of bladder (female)', 'organs', 'Urinary bladder', 'neck of bladder', ['Urinary system', 'Urinary bladder']),
    ],
}
# The breasts: the fatty tissue gives the breast its shape; the gland (lobes, ducts) sits
# inside it. (The suspensory-ligament shell is left out: it's a second skin over the fat.)
for side, s in (('L', 'l'), ('R', 'r')):
    HRA_FILES[f'VH_F_Mammary_Gland_{s}.glb'] = [
        (f'VH_F_fat_{side}', f'Breast.{s}', 'reproductive', 'Breast', 'breast', ['Breast']),
        (f'VH_F_mammary_lobes_{side}', f'Lobes of mammary gland.{s}', 'reproductive', 'Mammary gland', 'lobes of mammary gland', ['Breast', 'Mammary gland']),
        (f'VH_F_main_lactiferous_ducts_{side}', f'Lactiferous ducts.{s}', 'reproductive', 'Lactiferous duct', 'lactiferous duct', ['Breast', 'Mammary gland']),
        (f'VH_F_main_lactiferous_sinuses_{side}', f'Lactiferous sinuses.{s}', 'reproductive', 'Lactiferous duct', 'lactiferous sinus', ['Breast', 'Mammary gland']),
        (f'VH_F_nipple_{side}', f'Nipple.{s}', 'reproductive', 'Nipple', 'nipple', ['Breast']),
        (f'VH_F_areola_{side}', f'Areola.{s}', 'reproductive', 'Areola', 'areola', ['Breast']),
    ]

# Male-only structures in the Z-Anatomy model (hidden in Female view).
MALE_ONLY = re.compile(
    r'^(Hip bone\.[lr]|Sacrum|Coccyx|Urinary bladder|Urethra)$'
    r'|testis|epididym|ductus deferens|seminal gland|prostate|ejaculatory|penis', re.I)

HEAD_RADIUS_FRACTION = 0.8  # hip socket floor sits ~0.8 head-radius medial of the head centre
STRIP_FRACTION = 0.25  # breast fit: vertical strip through the middle, +-25% of its width


def world_verts(obj, depsgraph=None):
    ev = obj.evaluated_get(depsgraph) if depsgraph else obj
    mesh = ev.to_mesh()
    pts = np.array([tuple(ev.matrix_world @ v.co) for v in mesh.vertices])
    ev.to_mesh_clear()
    return pts


def fit_sphere(pts):
    """Least-squares sphere through points -> (centre, radius)."""
    A = np.c_[2 * pts, np.ones(len(pts))]
    b = (pts ** 2).sum(1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = sol[:3]
    return c, float(np.sqrt(sol[3] + c @ c))


def femoral_head(femur_pts, side_sign):
    """Centre/radius of the femoral head: the medial part of the top 7 cm of the femur."""
    top = femur_pts[femur_pts[:, 2] > femur_pts[:, 2].max() - 0.07]
    mid_x = (top[:, 0].min() + top[:, 0].max()) / 2
    medial = top[(top[:, 0] - mid_x) * side_sign < 0]  # closer to the body's midline
    return fit_sphere(medial)


def socket_point(ilium, ischium, pubis, tol=0.006):
    """Where the three hip-bone parts meet = floor of the hip socket (acetabulum)."""
    trees = []
    for pts in (ischium, pubis):
        t = kdtree.KDTree(len(pts))
        for i, p in enumerate(pts):
            t.insert(p, i)
        t.balance()
        trees.append(t)
    hits = [p for p in ilium if all(t.find(p)[2] < tol for t in trees)]
    if not hits:
        return None
    return np.mean(hits, axis=0)


def import_hra(hra_dir):
    """Import every HRA file -> {hra mesh name: object}. Returns {} if the folder is missing."""
    found = {}
    if not os.path.isdir(hra_dir):
        print(f'(no HRA folder at {hra_dir}; Female view will be empty)')
        return found
    # Import into a collection of our own: the glTF importer uses the ACTIVE collection, which
    # in Startup.blend is inside the skeleton folder (the export would pick the files up twice).
    col = bpy.data.collections.new('__HRA__')
    bpy.context.scene.collection.children.link(col)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[col.name]
    for fname in HRA_FILES:
        path = os.path.join(hra_dir, fname)
        if not os.path.exists(path):
            print(f'  missing {path}')
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        for o in set(bpy.data.objects) - before:
            if o.type == 'MESH':
                found[o.name] = o
            o.hide_set(False)
    return found


def add_female_parts(hra_dir, depsgraph):
    """
    Import, fit and rename the female structures.
    Returns {layer: [(object, describe_spec)]} where describe_spec = (text name, TA term, group path).
    """
    objs = import_hra(hra_dir)
    if not objs:
        return {}
    bpy.context.view_layer.update()

    # 1. Our femoral heads (male skeleton).
    heads = {}
    for s, sign in (('l', 1), ('r', -1)):
        c, r = femoral_head(world_verts(bpy.data.objects[f'Femur.{s}'], depsgraph), sign)
        heads[s] = (c - np.array([sign * HEAD_RADIUS_FRACTION * r, 0, 0]), r)

    # 2. The female hip sockets.
    sockets = {}
    for s, S in (('l', 'L'), ('r', 'R')):
        parts = [world_verts(objs[f'VH_F_{b}_compact_bone_{S}']) for b in ('ilium', 'ischium', 'pubis')]
        sockets[s] = socket_point(*parts)
        if sockets[s] is None:
            raise SystemExit(f'Could not find the female hip socket ({s}); check the HRA pelvis file.')

    # 3. Uniform scale + offset that puts the sockets onto the heads.
    m_l, m_r = heads['l'][0], heads['r'][0]
    f_l, f_r = sockets['l'], sockets['r']
    scale = np.linalg.norm(m_l - m_r) / np.linalg.norm(f_l - f_r)
    offset = (m_l + m_r) / 2 - scale * (f_l + f_r) / 2
    pelvis_fit = Matrix.Translation(Vector(offset)) @ Matrix.Scale(scale, 4)
    print(f'[female] head radius {heads["l"][1]*1000:.1f} mm, socket spread female '
          f'{np.linalg.norm(f_l - f_r)*1000:.0f} mm -> male {np.linalg.norm(m_l - m_r)*1000:.0f} mm, scale {scale:.3f}')

    # 4. Breasts: same scale. The female torso is shorter than ours, so the pelvis transform
    #    leaves them too low. The base of the breast spans the 2nd to 6th ribs, so centre it
    #    there. Then each breast is tilted to follow the slope of our chest and slid
    #    forward/back until its base rests on the chest muscles (see fit_breast).
    breast_fit = {'l': pelvis_fit, 'r': pelvis_fit}
    shells = {s: objs.get(f'VH_F_fat_{S}') for S, s in (('L', 'l'), ('R', 'r'))}
    if all(shells.values()):
        pts = {s: transform(world_verts(o), pelvis_fit) for s, o in shells.items()}
        both = np.vstack(list(pts.values()))
        half_width = np.abs(both[:, 0]).mean()
        top, bottom = rib_front_z('Second', half_width, depsgraph), rib_front_z('Sixth', half_width, depsgraph)
        dz = (top + bottom) / 2 - (both[:, 2].min() + both[:, 2].max()) / 2
        lift = Matrix.Translation((0, 0, dz)) @ pelvis_fit
        chest = chest_points(depsgraph)
        for s in ('l', 'r'):
            breast_fit[s] = fit_breast(transform(world_verts(shells[s]), lift), chest, s) @ lift
        print(f'[female] breasts lifted {dz*1000:+.0f} mm')

    # 5. Bake the transform, rename, sort into layers.
    by_layer = {}
    for fname, rows in HRA_FILES.items():
        for hra_name, raw, layer, text, ta_term, group in rows:
            o = objs.get(hra_name)
            if not o:
                print(f'  missing mesh {hra_name}')
                continue
            fit = breast_fit[fname[-5]] if 'Mammary' in fname else pelvis_fit  # ..._l.glb / _r.glb
            o.data = o.data.copy()
            o.data.transform(fit @ o.matrix_world)
            o.parent = None
            o.matrix_world = Matrix.Identity(4)
            o.name = raw
            if o.name != raw:
                raise SystemExit(f'name clash for female part {raw!r}')
            by_layer.setdefault(layer, []).append((o, (text, ta_term, group)))
    return by_layer


def rib_front_z(which, half_width, depsgraph):
    """Height of a rib where it passes the breast line (front half of the body)."""
    zs = []
    for s in ('l', 'r'):
        p = world_verts(bpy.data.objects[f'{which} rib.{s}'], depsgraph)
        sel = p[(p[:, 1] < 0) & (np.abs(np.abs(p[:, 0]) - half_width) < 0.02)]
        if len(sel):
            zs.append(sel[:, 2].mean())
    if not zs:
        raise SystemExit(f'Could not find the {which.lower()} rib.')
    return float(np.mean(zs))


def chest_points(depsgraph):
    """Front-of-chest surface points: ribs, costal cartilages, sternum and the chest muscles."""
    pat = re.compile(r'( rib\.[lr]$|^Costal cartilage|sternum$|head of pectoralis major muscle\.[lr]$|^Serratus anterior)', re.I)
    pts = [world_verts(o, depsgraph) for o in bpy.data.objects if o.type == 'MESH' and pat.search(o.name)]
    if not pts:
        raise SystemExit('Could not find the chest wall.')
    return np.vstack(pts)


def transform(pts, m):
    """Apply a 4x4 Matrix to an (n, 3) array of points."""
    return (np.c_[pts, np.ones(len(pts))] @ np.array(m).T)[:, :3]


def contact_need(pts, chest, gap, cell=0.01):
    """For each point: the forward/back shift (Y) that would put it `gap` in front of the
    chest surface (NaN where there's no chest behind it). The chest is binned into 1 cm
    cells (x, z); each cell keeps its most forward point."""
    front = {}
    for x, y, z in chest:
        k = (int(np.floor(x / cell)), int(np.floor(z / cell)))
        if y < front.get(k, 1e9):
            front[k] = y
    out = np.full(len(pts), np.nan)
    for i, (x, y, z) in enumerate(pts):
        f = front.get((int(np.floor(x / cell)), int(np.floor(z / cell))))
        if f is not None:
            out[i] = f - gap - y
    return out


def fit_breast(pts, chest, side, gap=0.002):
    """
    Rest one breast on the chest. Returns a Matrix (tilt + forward/back shift).
    The HRA breast comes from a body with a different chest shape, so its base doesn't
    match ours. We look at a narrow vertical strip through the middle of the breast (what a
    side view shows) and, per 1 cm of height, how far its back is from the chest:
      1. Tilt the breast (about a left-right axis) until that distance is the same at the
         top and the bottom, i.e. the base follows the lean of our chest.
      2. Slide it forward/back so the base sits on the chest (half the strip just touching,
         the rest a few mm in front or tucked into the muscle).
    """
    c = (pts.min(0) + pts.max(0)) / 2
    h = (pts.max(0) - pts.min(0)) / 2
    strip = pts[np.abs(pts[:, 0] - c[0]) < STRIP_FRACTION * h[0]]
    centre = Vector(tuple(strip.mean(0)))

    def tilt_by(a):
        return Matrix.Translation(centre) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Translation(-centre)

    def gaps(points):
        """[(height, distance from the breast's back to the chest)] per 1 cm band."""
        need = contact_need(points, chest, gap)
        bands = {}
        for z, n in zip(points[:, 2], need):
            if not np.isnan(n):
                k = int(np.floor(z / 0.01))
                bands[k] = min(n, bands.get(k, 1e9))  # the back-most point of the band
        return [((k + 0.5) * 0.01, n) for k, n in sorted(bands.items())]

    # Distance growing with height = the chest falls away behind the top of the breast, so
    # rotate the top backwards (+Y): about X, a negative angle moves +Z points toward +Y.
    # Damped steps, because tilting also changes which points are the back surface.
    angle = 0.0
    for _ in range(10):
        rows = gaps(transform(strip, tilt_by(angle)))
        if len(rows) < 3:
            break
        angle -= 0.6 * np.arctan(np.polyfit(*zip(*rows), 1)[0])
    tilt = tilt_by(angle)

    rows = gaps(transform(strip, tilt))
    dy = float(np.median([n for _, n in rows]))
    after = [round((n - dy) * 1000) for _, n in rows]
    print(f'[female] breast {side}: tilted {np.degrees(angle):+.1f} deg, moved {dy*1000:+.0f} mm; '
          f'gap by height (mm, bottom to top) {after}')
    return Matrix.Translation((0, dy, 0)) @ tilt
