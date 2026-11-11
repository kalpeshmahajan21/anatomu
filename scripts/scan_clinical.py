"""
Report clinical wording (fracture, surgery, treatment, disease, injury...) that appears
OUTSIDE the "Clinical significance" section of the exported descriptions.

usage: python scripts/scan_clinical.py [public/models/info] [--all]
Prints one line per flagged sentence, then totals. --all also lists the words found inside
the clinical sections (for checking the word list). Exit code 1 if anything leaked.
"""
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clinical_terms import clinical_words  # noqa: E402

CLINICAL_SECTION = 'Clinical significance'


def sentences(text):
    return [s for s in re.split(r'(?<=[.!?])\s+(?=[A-Z])', text) if s]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    folder = args[0] if args else 'public/models/info'
    sys.stdout.reconfigure(encoding='utf-8')
    leaks = []
    words = collections.Counter()
    described = 0
    for path in sorted(glob.glob(os.path.join(folder, '*.json'))):
        layer = os.path.splitext(os.path.basename(path))[0]
        for raw, info in json.load(open(path, encoding='utf-8')).items():
            d = info.get('d')
            if not d:
                continue
            described += 1
            parts = [('Intro', d['intro'])] + [(t, x) for t, x in d['sections'] if t != CLINICAL_SECTION]
            for title, text in parts:
                for s in sentences(text):
                    found = clinical_words(s)
                    if found:
                        leaks.append((layer, raw, title, found, s))
                        words.update(found)

    for layer, raw, title, found, s in leaks:
        print(f'[{layer}] {raw} / {title}: {", ".join(found)}\n    {s[:220]}')
    print()
    print(f'Descriptions scanned: {described}')
    print(f'Clinical sentences outside "{CLINICAL_SECTION}": {len(leaks)} '
          f'in {len({(l, r) for l, r, *_ in leaks})} structures')
    if words:
        print('Most common words:', ', '.join(f'{w} ({n})' for w, n in words.most_common(15)))
    return 1 if leaks else 0


if __name__ == '__main__':
    sys.exit(main())
