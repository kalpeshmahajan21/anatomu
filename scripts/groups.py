"""
Whole structures ("groups") for the app: the heart, the aortic valve, the hip bone, the
knee joint... so a user can select or search a whole organ instead of one piece of it.

Two kinds:
  - FOLDERS from Z-Anatomy: each structure's folder path (info 'g') plus the structure it
    is "part of" (info 'p'). E.g. a valve leaflet -> Heart > Aortic valve.
  - JOINTS: Z-Anatomy files joints with the ligaments, which aren't exported, so a joint is
    shown as the bones that form it (standard anatomy, listed in JOINTS below).

Writes into index.json:
  groups.names   every group name
  groups.paths   per layer, per structure (same order as index.layers): its group ids,
                 outermost first
  groups.joints  [{name, side, members: [raw names]}]
and info/groups.json: description / Latin name per group name (when the source has one).

Run by export_models.py at the end of an export, or on its own (no Blender needed) from a
text dump: python scripts/groups.py public/models texts.json [source_models/ta/TA2.csv]
"""
import json
import os
import re
import sys

# Bones forming each joint (they are what the 3D model has of it).
JOINTS = {
    'Knee joint': ['Femur', 'Tibia', 'Patella'],
    'Hip joint': ['Hip bone', 'Femur'],
    'Ankle joint': ['Tibia', 'Fibula', 'Talus'],
    'Shoulder joint': ['Scapula', 'Humerus'],
    'Elbow joint': ['Humerus', 'Radius', 'Ulna'],
    'Wrist joint': ['Radius', 'Scaphoid bone', 'Lunate bone', 'Triquetrum bone'],
}
SIDE = re.compile(r'\.(l|r)$')


def base_name(raw):
    n = SIDE.sub('', raw).replace('(female)', '').strip()
    if n.startswith('(') and n.endswith(')'):
        n = n[1:-1]
    return n.strip()


def norm(name):
    """'Bones of free part of lower limb' and 'Bones of free lower limb' -> same key."""
    n = re.sub(r'\b(part|of|the)\b', ' ', name.lower())
    return re.sub(r'\s+', '', n)


def is_name_list(text):
    """True for a text that only lists names: every sentence has at most 4 words, no verb."""
    sentences = [s for s in re.split(r'[.;]\s*', text) if s.strip()]
    return all(len(s.split()) <= 4 for s in sentences)


def build(out_dir, texts, ta, parse_description):
    with open(os.path.join(out_dir, 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    infos = {}
    for layer in index['layers']:
        p = os.path.join(out_dir, 'info', f'{layer}.json')
        infos[layer] = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

    names, ids = [], {}

    def gid(name):
        if name not in ids:
            ids[name] = len(names)
            names.append(name)
        return ids[name]

    paths = {}
    hip_parts = []  # anything that is (part of) the hip bone, male or female
    for layer, raws in index['layers'].items():
        paths[layer] = []
        for raw in raws:
            info = infos[layer].get(raw, {})
            path = [g for g in (info.get('g') or [])]
            p = info.get('p')
            if p and norm(p) not in {norm(x) for x in path} and norm(p) != norm(base_name(raw)):
                path.append(p)
            paths[layer].append([gid(n) for n in path])
            if layer == 'skeleton' and (base_name(raw) == 'Hip bone' or 'Hip bone' in path):
                hip_parts.append(raw)

    joints = []
    skeleton = index['layers'].get('skeleton', [])
    for joint, bones in JOINTS.items():
        for side in ('r', 'l'):
            members = []
            for raw in skeleton:
                if not raw.endswith('.' + side):
                    continue
                if base_name(raw) in bones or ('Hip bone' in bones and raw in hip_parts):
                    members.append(raw)
            if len(members) >= 2:
                joints.append({'name': joint, 'side': side, 'members': members})

    index['groups'] = {'names': names, 'paths': paths, 'joints': joints}
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

    # Descriptions of the wholes, where the source has a text for them.
    info = {}
    for name in names + list(JOINTS):
        entry = {}
        desc = parse_description(texts.get(name) or texts.get(f'({name})'))
        if desc and not desc['sections'] and is_name_list(desc['intro']):
            desc = None  # "Mandible. Hyoid bone." is a list of the parts, not a description
        if desc:
            entry['d'] = desc
        latin = ta.get(name.lower())
        if latin:
            entry['la'], entry['ta'] = latin
        if entry:
            info[name] = entry
    with open(os.path.join(out_dir, 'info', 'groups.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, separators=(',', ':'))
    print(f'groups: {len(names)} folder groups, {len(joints)} joints, {len(info)} with descriptions')


def _standalone():
    """Rebuild groups from a text dump (texts.json: {text name: text}) without Blender."""
    out_dir, texts_path = sys.argv[1], sys.argv[2]
    ta_path = sys.argv[3] if len(sys.argv) > 3 else 'source_models/ta/TA2.csv'
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    from clinical_terms import CLINICAL  # noqa: E402
    # Reuse the exporter's text helpers without importing Blender.
    src = open(os.path.join(here, 'export_models.py'), encoding='utf-8').read()
    ns = {'CLINICAL_WORDS': CLINICAL, 're': re}
    exec(src[src.index('KEEP_SECTIONS = {'):src.index('def parse_args')], ns)
    exec(src[src.index('def load_ta('):src.index('def base_name(')], {**ns, 'os': os}, ns)
    exec(src[src.index('# A sentence starter glued'):src.index('def describe(')], ns)
    texts = json.load(open(texts_path, encoding='utf-8'))
    build(out_dir, texts, ns['load_ta'](ta_path), ns['parse_description'])


if __name__ == '__main__':
    _standalone()
