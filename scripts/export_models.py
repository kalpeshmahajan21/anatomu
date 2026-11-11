"""
Export Z-Anatomy layers to Draco-compressed .glb files for the web viewer,
plus an info file per layer (descriptions, Latin names, groups).

Run (from the project root):
    blender -b source_models/Z-Anatomy/Startup.blend --python scripts/export_models.py -- --out public/models

Options (after the "--"):
    --out DIR            output folder (default: public/models)
    --layers a,b         only export some layers (default: all)
    --budget-scale X     multiply every triangle budget by X (e.g. 0.7 = smaller files)
    --ta FILE            Terminologia Anatomica CSV for Latin names
                         (default: source_models/ta/TA2.csv, skipped if missing)

What it does, per layer:
  1. Picks the real anatomical objects from the Z-Anatomy collections (see LAYERS).
     Skipped: text labels (.g/.t, FONT objects), empty label anchors (.j/.i, 0 faces),
     muscle-attachment patches (.ol/.el...), the hidden "Bonus collection" duplicates.
  2. Bakes each object's final shape (all modifiers: mirror, subdivision, hooks...)
     and world position into a new plain mesh that keeps the ORIGINAL object name.
     That name is what the app shows (after cleaning) and searches.
  3. Decimates to a triangle budget so the whole set stays small and phone-friendly.
  4. Exports a .glb with Draco compression, no materials/UVs (the app colours layers).
  5. Writes info/<layer>.json: for each structure its description (from the Wikipedia
     texts bundled in the Z-Anatomy file), Latin name + TA2 id, and its group path.
Finally writes index.json: every structure name per layer, which ones exist in only one sex
("sex": raw name -> "m" or "f"), and the overall body bounds.

Female structures (pelvis, uterus, ovaries, uterine tubes, breasts, bladder) come from the
NIH Human Reference Atlas, because Z-Anatomy only models a male body. See female_parts.py.
"""

import bpy
import csv
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import female_parts  # noqa: E402
import groups  # noqa: E402
from clinical_terms import CLINICAL as CLINICAL_WORDS  # noqa: E402

# ---------------------------------------------------------------------------
# Layer definitions. A structure goes into the FIRST layer (in this order) that claims
# it, so the small specific layers (reproductive, endocrine) come before "organs".
#   collections: Z-Anatomy collections (or sub-collections) to take objects from
#   budget:      triangle budget after decimation
#   exclude:     regex of object names to skip
#   groups:      Z-Anatomy top folders used for the structure's group path in the info panel
# ---------------------------------------------------------------------------
LAYERS = {
    'skeleton': {'collections': ['1: Skeletal system'], 'budget': 420_000, 'groups': ['Skeletal system']},
    # Muscles: skip the sheets that wrap muscles (fascia, retinacula, septa...) and the small
    # bursae/tendon sheaths; they cover the muscles and look like a smooth skin.
    # (\bfascia\b keeps "Tensor fasciae latae", which is a muscle.)
    'muscles': {'collections': ['4: Muscular system'], 'budget': 650_000, 'groups': ['Muscular system'],
                'exclude': r'\bfascia\b|aponeurosis|retinacul|septum|bursa|sheath|ligament|iliotibial tract'},
    'reproductive': {'collections': ["Genital systems'"], 'budget': 60_000, 'groups': ['Visceral systems']},
    'endocrine': {'collections': ['Endocrine glands'], 'budget': 40_000, 'groups': ['Visceral systems']},
    # Organs: skip membranes that drape over everything (omentum, pleura, mesentery) and the
    # liver's segments, which overlap the whole "Liver" mesh.
    'organs': {'collections': ['8: Visceral systems', 'Heart'], 'budget': 200_000,
               'groups': ['Visceral systems', 'Cardiovascular system'],
               'exclude': r'omentum|pleura|meso|peritone|segment of liver'},
    'vessels': {'collections': ['5: Cardiovascular system'], 'budget': 420_000, 'groups': ['Cardiovascular system']},
    'nerves': {'collections': ['7: Nervous system & Sense organs'], 'budget': 380_000, 'groups': ['Nervous system']},
}

# The female structures are decimated on their own: each one to at most this many triangles
# (the source meshes range from 400 to 370,000 triangles).
FEMALE_MAX_TRIS = 8_000

# Objects below this many triangles are never decimated (they'd lose their shape).
MIN_TRIS_TO_DECIMATE = 300

SKIP_SUFFIX = re.compile(r'\.(j|i|g|t|s|o\d*[lr]?|e\d*[lr]?)$')
SIDE_SUFFIX = re.compile(r'\.(l|r)$')

# Description sections worth showing. Everything else (History, Other animals, See also,
# and the odd wrong-article section like "Tactics") is dropped.
KEEP_SECTIONS = {
    'structure': 'Structure', 'anatomy': 'Structure', 'human anatomy': 'Structure', 'overview': 'Structure',
    'course': 'Course', 'branches': 'Branches',
    'function': 'Function', 'functions': 'Function', 'physiology': 'Function',
    'origin and insertion': 'Origin & insertion', 'innervation': 'Nerve supply', 'nerve supply': 'Nerve supply',
    'blood supply': 'Blood supply', 'development': 'Development', 'variation': 'Variation',
    'clinical significance': 'Clinical significance', 'clinical relevance': 'Clinical significance',
    'pathology': 'Clinical significance',
}
# A description must mention at least one of these, or it's probably the wrong article.
ANATOMY_WORDS = re.compile(
    r'\b(bone|muscle|nerve|organ|arter|vein|anatom|tissue|gland|joint|ligament|human|brain|blood|skin|'
    r'cartilage|tendon|duct|lobe|vertebra|skull|heart|lung|liver|kidney|body|cranial|spinal|limb|cell)',
    re.I)
SECTION_MAX = 1100  # characters per section
INTRO_MAX = 700


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = {'out': 'public/models', 'layers': list(LAYERS), 'budget_scale': 1.0, 'ta': 'source_models/ta/TA2.csv',
            'hra': female_parts.HRA_DIR}
    i = 0
    while i < len(argv):
        if argv[i] == '--out':
            args['out'] = argv[i + 1]; i += 2
        elif argv[i] == '--layers':
            args['layers'] = [s.strip() for s in argv[i + 1].split(',') if s.strip()]; i += 2
        elif argv[i] == '--budget-scale':
            args['budget_scale'] = float(argv[i + 1]); i += 2
        elif argv[i] == '--ta':
            args['ta'] = argv[i + 1]; i += 2
        elif argv[i] == '--hra':
            args['hra'] = argv[i + 1]; i += 2
        else:
            raise SystemExit(f'Unknown argument: {argv[i]}')
    return args


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------
def collection_tree():
    """Parent of each collection. The detailed anatomy hierarchy ("Muscles of upper limb"...)
    lives under the hidden 'Bonus collection', so it's included; its top folders
    ("Muscular system"...) and the numbered main folders count as roots."""
    parent = {}

    def walk(col, root_name):
        for c in col.children:
            if c.name == 'Bonus collection':
                walk(c, None)
                continue
            parent.setdefault(c.name, root_name if root_name is not None else '__root__')
            walk(c, c.name)
    walk(bpy.context.scene.collection, None)
    return parent


def find_collection(name):
    """Find a collection by name, preferring the main tree over the 'Bonus collection'."""
    def walk(col, inside_bonus):
        for c in col.children:
            bonus = inside_bonus or c.name == 'Bonus collection'
            if c.name == name and not bonus:
                return c
            hit = walk(c, bonus)
            if hit:
                return hit
        return None
    col = walk(bpy.context.scene.collection, False)
    if col is None:  # some groupings (e.g. "Heart") only exist inside the Bonus collection
        col = bpy.data.collections.get(name)
    if col is None:
        raise SystemExit(f'Collection not found: {name!r}')
    return col


def root_of(name, parent):
    """Top folder a collection sits in, e.g. 'Muscular system'."""
    while name in parent and parent[name] != '__root__':
        name = parent[name]
    return name


def deepest(obj, parent, roots):
    """obj's most specific collection whose top folder is one of `roots`."""
    best, best_depth = None, -1
    for c in obj.users_collection:
        if c.name not in parent or root_of(c.name, parent) not in roots:
            continue
        if re.match(r'^(Left|Right) ', c.name):  # side buckets aren't real groups
            continue
        depth, n = 0, c.name
        while n in parent:
            n = parent[n]; depth += 1
        if depth > best_depth:
            best, best_depth = c.name, depth
    return best


def group_path(obj, parent, roots):
    """Group path inside the structure's own system, like ['Muscles', 'Muscles of lower limb'].
    (Z-Anatomy also files structures under other systems, e.g. a muscle under the nerve that
    supplies it, so we only look inside the layer's own top folders.)"""
    path = []
    n = deepest(obj, parent, roots)
    while n and n in parent:
        if parent[n] != '__root__':  # drop the top folder itself
            path.append(n.rstrip("'"))  # a few Z-Anatomy names end with a stray quote
        n = parent[n]
    return list(reversed(path))


def unhide_everything():
    """Hidden things aren't evaluated by Blender, so show all collections/objects first."""
    def walk(lc):
        if lc.name != 'Bonus collection':
            lc.hide_viewport = False
            lc.collection.hide_viewport = False
            for c in lc.children:
                walk(c)
    walk(bpy.context.view_layer.layer_collection)
    for o in bpy.data.objects:
        o.hide_viewport = False
        try:
            o.hide_set(False)
        except RuntimeError:
            pass  # object not in this view layer (e.g. only in Bonus collection)


def is_structure(obj):
    if obj.type not in {'MESH', 'CURVE'}:
        return False  # FONT = text labels, LIGHT, CAMERA...
    if SKIP_SUFFIX.search(obj.name):
        return False
    if obj.type == 'MESH':
        if len(obj.data.polygons) == 0:
            return False
        if any(m and m.name == 'Text' for m in obj.data.materials):
            return False
    if obj.type == 'CURVE':
        c = obj.data
        if c.bevel_depth <= 0 and c.bevel_object is None and c.extrude <= 0 and c.bevel_mode != 'PROFILE':
            return False  # a thin guide line with no thickness
    return True


# ---------------------------------------------------------------------------
# Descriptions + Latin names
# ---------------------------------------------------------------------------
def load_texts():
    texts = {}
    for t in bpy.data.texts:
        try:
            texts[t.name] = t.as_string()
        except UnicodeDecodeError:
            texts[t.name] = '\n'.join(l.body for l in t.lines)
    return texts


def load_ta(path):
    """English term (lowercase) -> (Latin, TA2 id)."""
    ta = {}
    if not os.path.exists(path):
        print(f'(no TA file at {path}; Latin names skipped)')
        return ta
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            row = line.strip().strip('"').split(';')
            if len(row) >= 3 and row[0].isdigit():
                ta.setdefault(row[1].strip().lower(), (row[2].strip(), int(row[0])))
    return ta


def base_name(name):
    """'(Adductor minimus).l' -> 'Adductor minimus'"""
    n = SIDE_SUFFIX.sub('', name).strip()
    if n.startswith('(') and n.endswith(')'):
        n = n[1:-1]
    return n.strip()


# A sentence starter glued to the word before it, e.g. "Pars distalisThe pars distalis" (a
# definition-list term that lost its line break).
GLUED_TERM = re.compile(
    r'([a-z]{3})(The|This|These|It|Its|In|A|An|They|Each|Some|Most|Both)(?= [a-zA-Z])'
    r'|(?<!Neuro)([a-z]{4})([A-Z][a-z]{2,})(?= [a-z(]|[.,;])')  # "Cerebral veinsBlood leaves"


def fix_line(s):
    s = re.sub(r'([a-z)\]]{2}[.!?:;])([A-Z])', r'\1 \2', s)  # "process.An abnormally" -> "process. An"
    s = re.sub(r'([a-z][)\]"”])([A-Z][a-z])', r'\1 \2', s)  # '("hip hiking")Additional'
    s = GLUED_TERM.sub(lambda m: f'{m.group(1) or m.group(3)}: {m.group(2) or m.group(4)}', s)
    s = re.sub(r'^[-•*]\s*', '', s)  # list bullets
    s = re.sub(r'\s*https?://\S+', '', s)  # stray source links
    s = re.sub(r'\s*(\{\{|\(\()[^{}()]{0,30}\}\}', '', s)  # left-over wiki templates: "SA node.((cn}}"
    s = re.sub(r'\s*==[^=]{1,120}==\.?', '', s)  # a sub-heading glued into the text: "== Volar branch =="
    return s.replace('�', '—')  # a dash lost in the source encoding


def join_lines(lines):
    """
    Wikipedia plain text keeps lists as one item per line, and drops tables entirely. Join
    lines into prose: list items become "a; b; c.", and a lead-in like "The following muscles
    attach to the scapula:" whose list was lost (a heading or the end comes next) is dropped.
    `None` in `lines` marks a heading.
    """
    out, in_list = [], False
    for s in lines + [None]:
        if s is not None and (not s.strip('.;,: ') or re.fullmatch(r'\S+(;\S*){2,}\.?', s)):
            continue  # an empty table cell, or a table row like "English;Latin;Français"
        item = s is not None and not re.search(r'[.!?:]["”)\]]?$', s) and len(s) <= 200
        if in_list and not item:
            out[-1] += '.'  # the list ended
            in_list = False
        if s is None:
            if out and out[-1].endswith(':'):
                out.pop()  # its list didn't survive
            continue
        if in_list and item:
            out[-1] += '; ' + s
        elif item and out and out[-1].endswith(':'):
            out[-1] += ' ' + s
            in_list = True
        else:
            out.append(s if not item else s + '.')
    return ' '.join(out)


def tidy(text):
    text = re.sub(r'\(\s*[,;]\s*', '(', text)          # "(, pl. femora)" -> "(pl. femora)"
    text = re.sub(r'\(\s*\)', '', text)                # empty brackets left by removed audio/IPA
    text = re.sub(r'\[\d+\]', '', text)                # citation marks
    text = re.sub(r'\s+([,.;:])', r'\1', text)
    text = re.sub(r'([a-z)\]]{2}[.!?:;])([A-Z])', r'\1 \2', text)  # that can glue "peritoneum .Other"
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()


def clip(text, limit):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = cut.rfind('. ')
    return (cut[:end + 1] if end > limit * 0.5 else cut.rstrip() + '…')


CLINICAL_KEY = 'Clinical significance'
# Sub-sections that are clinical even when they sit under an anatomy heading, e.g.
# "== Function == / === Fractures ===" in the femur article.
CLINICAL_SUBHEADING = re.compile(
    r'fractur|injur|disorder|disease|patholog|clinical|surg|treat|syndrome|lesion|palsy|'
    r'dislocat|tumou?r|cancer|infect|inflamm|trauma|deficien|abnormal|imaging|examination', re.I)


def split_sentences(text):
    return [x for x in re.split(r'(?<=[.!?])\s+(?=[A-Z])', text) if x]


def parse_description(raw):
    """
    Wikipedia plain text -> {'intro': str, 'sections': [[title, text], ...]} or None.

    Clinical content (injuries, disease, treatment...) is Wikipedia text nobody has reviewed,
    so it must only end up in "Clinical significance", which the app labels "Not reviewed":
    clinical sub-sections go there, and so does any other paragraph using clinical words
    (in the intro, sentence by sentence, so the opening definition stays).
    """
    if not raw:
        return None
    current, parts, order = 'intro', {'intro': []}, ['intro']
    section = 'intro'  # the level-2 section we're in (sub-sections may override `current`)

    def bucket(key):
        if key not in parts:
            parts[key] = []
            order.append(key)
        return parts[key]

    for line in raw.splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r'^(=+)\s*(.+?)\s*=+$', s)
        if m:
            if current is not None:
                parts[current].append(None)  # boundary for join_lines
            title = m.group(2).lower()
            if len(m.group(1)) == 2:  # top-level section; sub-sections fold into it
                section = KEEP_SECTIONS.get(title)  # None = skip this section
                current = section
            elif section is not None:
                current = CLINICAL_KEY if CLINICAL_SUBHEADING.search(title) else section
            if current:
                bucket(current)
            continue
        if current is None:
            continue
        if current == 'intro' and s.isupper() and len(parts['intro']) == 0:
            continue  # the "FEMUR" title line
        s = fix_line(s)
        if current != CLINICAL_KEY and CLINICAL_WORDS.search(s):
            if current == 'intro':
                keep = [x for x in split_sentences(s) if not CLINICAL_WORDS.search(x)]
                moved = [x for x in split_sentences(s) if CLINICAL_WORDS.search(x)]
                bucket(CLINICAL_KEY).append(' '.join(moved))
                if keep:
                    parts['intro'].append(' '.join(keep))
            else:
                bucket(CLINICAL_KEY).append(s)
            continue
        parts[current].append(s)
    intro = tidy(join_lines(parts['intro']))
    if not intro or not ANATOMY_WORDS.search(intro):
        return None
    sections = []
    # Anatomy sections in article order; the clinical one always last.
    for key in [k for k in order[1:] if k != CLINICAL_KEY] + ([CLINICAL_KEY] if CLINICAL_KEY in parts else []):
        txt = tidy(join_lines(parts[key]))
        if len(txt) > 60:
            sections.append([key, clip(txt, SECTION_MAX)])
    return {'intro': clip(intro, INTRO_MAX), 'sections': sections}


def describe(obj, texts, ta, parent_tree, roots):
    base = base_name(obj.name)
    info = {}
    desc = parse_description(texts.get(base) or texts.get(f'({base})'))
    if desc:
        info['d'] = desc
    latin = ta.get(base.lower())
    if latin:
        info['la'], info['ta'] = latin
    path = group_path(obj, parent_tree, roots)
    if path:
        info['g'] = path
    # Muscles are also filed under the nerve that supplies them: show that as a fact.
    if 'Muscular system' in roots:
        nerve = deepest(obj, parent_tree, {'Nervous system'})
        if nerve and re.search(r'nerve|plexus|ramus|branch', nerve, re.I):
            info['n'] = nerve.rstrip("'")
    # "Part of": Z-Anatomy parents sub-parts to a group object, e.g. "Pectoralis major muscle.g".
    if obj.parent and obj.parent.name.endswith('.g'):
        whole = base_name(obj.parent.name[:-2])
        if whole.lower() != base.lower():
            info['p'] = PART_OF_FIXES.get(base, whole)
    return info


# Mistakes in the source's "part of" links.
PART_OF_FIXES = {
    # A mitral (left) valve leaflet filed under the tricuspid (right) valve.
    'Posterior leaflet of left atrioventricular valve': 'Left atrioventricular valve',
}


def describe_female(spec, texts, ta):
    """Info for a Human Reference Atlas structure. spec = (text name, TA term, group path)."""
    text, ta_term, group = spec
    info = {'g': group, 'src': 'hra'}  # 'src': the app credits the Human Reference Atlas
    desc = parse_description(texts.get(text))
    if desc:
        info['d'] = desc
    latin = ta.get(ta_term.lower()) or ta.get(text.lower())
    if latin:
        info['la'], info['ta'] = latin
    return info


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def bake(obj, depsgraph):
    """New mesh = obj's final evaluated shape, in world space, without materials."""
    ev = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=depsgraph)
    mesh.transform(ev.matrix_world)
    mesh.materials.clear()
    for uv in list(mesh.uv_layers):
        mesh.uv_layers.remove(uv)
    return mesh


def export_layer(layer_id, cfg, args, ctx):
    t0 = time.time()
    sources = []
    seen = set()
    exclude = re.compile(cfg['exclude'], re.I) if cfg.get('exclude') else None
    for cname in cfg['collections']:
        for obj in find_collection(cname).all_objects:
            # (__src__ = an original already exported by an earlier layer this run)
            if obj.name in seen or obj.name in ctx['used'] or obj.name.startswith('__src__') or not is_structure(obj):
                continue
            if exclude and exclude.search(obj.name):
                continue
            seen.add(obj.name)
            sources.append(obj)

    # Bake everything first (the source objects keep their names until then).
    baked = []
    info = {}
    for obj in sources:
        mesh = bake(obj, ctx['depsgraph'])
        if len(mesh.polygons) == 0:
            bpy.data.meshes.remove(mesh)
            continue
        baked.append((obj.name, mesh))
        info[obj.name] = describe(obj, ctx['texts'], ctx['ta'], ctx['parent_tree'], set(cfg['groups']))

    for name, _ in baked:
        if female_parts.MALE_ONLY.search(name):
            ctx['sex'][name] = 'm'

    # Female structures for this layer (already moved into place by female_parts).
    female = []
    for obj, spec in ctx['female'].get(layer_id, []):
        mesh = obj.data.copy()
        mesh.materials.clear()
        for uv in list(mesh.uv_layers):
            mesh.uv_layers.remove(uv)
        female.append((obj.name, mesh))
        info[obj.name] = describe_female(spec, ctx['texts'], ctx['ta'])
        ctx['sex'][obj.name] = 'f'

    total = sum(tri_count(m) for _, m in baked)
    budget = cfg['budget'] * args['budget_scale']
    ratio = min(1.0, budget / max(total, 1))
    f_total = sum(tri_count(m) for _, m in female)
    f_cap = FEMALE_MAX_TRIS * args['budget_scale']
    described = sum(1 for v in info.values() if 'd' in v)
    print(f'[{layer_id}] {len(baked)} + {len(female)} female structures ({described} with descriptions), '
          f'{total:,} + {f_total:,} tris -> ratio {ratio:.3f}')

    # Free the original names, then create export objects that reuse them exactly.
    new_objs = []
    for name, mesh, r in [(n, m, ratio) for n, m in baked] + [(n, m, min(1.0, f_cap / max(tri_count(m), 1))) for n, m in female]:
        src = bpy.data.objects.get(name)
        if src:
            src.name = '__src__' + name
        obj = bpy.data.objects.new(name, mesh)
        if obj.name != name:  # should not happen, but never export a renamed structure silently
            print(f'  warning: name clash for {name!r} -> {obj.name!r}')
        ctx['export_col'].objects.link(obj)
        if r < 1.0 and tri_count(mesh) > MIN_TRIS_TO_DECIMATE:
            mod = obj.modifiers.new('Decimate', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = r
            mod.use_collapse_triangulate = True
        new_objs.append(obj)
        ctx['used'].add(name)

    bpy.ops.object.select_all(action='DESELECT')
    for o in new_objs:
        o.select_set(True)

    path = os.path.abspath(os.path.join(args['out'], f'{layer_id}.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,  # applies the Decimate modifier
        export_yup=True,
        export_materials='NONE',
        export_texcoords=False,
        export_vertex_color='NONE',
        export_normals=True,
        export_tangents=False,
        export_attributes=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=8,
    )

    os.makedirs(os.path.join(args['out'], 'info'), exist_ok=True)
    with open(os.path.join(args['out'], 'info', f'{layer_id}.json'), 'w', encoding='utf-8') as f:
        json.dump({o.name: info[o.name] for o in new_objs}, f, ensure_ascii=False, separators=(',', ':'))

    # World-space bounds (Blender Z-up), for the camera's first framing.
    xs, ys, zs = [], [], []
    for o in new_objs:
        for v in o.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)

    size_mb = os.path.getsize(path) / 1e6
    print(f'[{layer_id}] wrote {path} ({size_mb:.2f} MB) in {time.time() - t0:.0f}s')

    # Remove the export objects so the next layer's selection starts clean.
    for o in new_objs:
        o.select_set(False)
        ctx['export_col'].objects.unlink(o)

    return {
        'names': [o.name for o in new_objs],
        'bounds': (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)) if xs else None,
    }


def main():
    args = parse_args()
    os.makedirs(args['out'], exist_ok=True)
    unhide_everything()
    bpy.context.view_layer.update()

    export_col = bpy.data.collections.new('__EXPORT__')
    bpy.context.scene.collection.children.link(export_col)
    ctx = {
        'depsgraph': bpy.context.evaluated_depsgraph_get(),
        'export_col': export_col,
        'texts': load_texts(),
        'ta': load_ta(args['ta']),
        'parent_tree': collection_tree(),
        'used': set(),  # a structure goes into the first layer that claims it
        'sex': {},  # raw name -> 'm' | 'f' for structures that exist in only one sex
    }
    # Female structures, fitted onto our skeleton (empty if source_models/hra is missing).
    ctx['female'] = female_parts.add_female_parts(args['hra'], ctx['depsgraph'])

    index_path = os.path.join(args['out'], 'index.json')
    index = {'layers': {}, 'bounds': None}
    if os.path.exists(index_path):  # partial re-export keeps the other layers' entries
        with open(index_path, encoding='utf-8') as f:
            index = json.load(f)

    results = {}
    old_sex = index.get('sex', {})
    for layer_id in LAYERS:
        if layer_id not in args['layers']:
            ctx['used'].update(index['layers'].get(layer_id, []))
            for n in index['layers'].get(layer_id, []):  # keep the skipped layers' sex marks
                if n in old_sex:
                    ctx['sex'][n] = old_sex[n]
            continue
        results[layer_id] = export_layer(layer_id, LAYERS[layer_id], args, ctx)
        index['layers'][layer_id] = results[layer_id]['names']

    # Body bounds come from the skeleton (it defines the body's extent), converted to glTF Y-up:
    # Blender (x, y, z) -> glTF (x, z, -y).
    if 'skeleton' in results and results['skeleton']['bounds']:
        x0, y0, z0, x1, y1, z1 = results['skeleton']['bounds']
        index['bounds'] = {'min': [x0, z0, -y1], 'max': [x1, z1, -y0]}

    index['sex'] = ctx['sex']
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

    # Whole structures (heart, hip bone, knee joint...) for search and "select whole".
    groups.build(args['out'], ctx['texts'], ctx['ta'], parse_description)

    total = sum(os.path.getsize(os.path.join(args['out'], f'{l}.glb')) for l in LAYERS
                if os.path.exists(os.path.join(args['out'], f'{l}.glb'))) / 1e6
    print(f'Done. Total model size: {total:.2f} MB')


main()
