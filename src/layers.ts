export type LayerId = 'skeleton' | 'muscles' | 'organs' | 'vessels' | 'nerves' | 'reproductive' | 'endocrine'

export interface LayerDef {
  id: LayerId
  label: string
  system: string // shown on the info panel
  color: string // chip colour + default part colour
  roughness: number
}

/** Order here = order of the chips in the bottom bar. */
export const LAYERS: LayerDef[] = [
  { id: 'skeleton', label: 'Skeleton', system: 'Skeletal system', color: '#e9e1cf', roughness: 0.62 },
  { id: 'muscles', label: 'Muscles', system: 'Muscular system', color: '#b4473f', roughness: 0.5 },
  { id: 'organs', label: 'Organs', system: 'Visceral organs', color: '#e6967f', roughness: 0.42 },
  { id: 'vessels', label: 'Vessels', system: 'Cardiovascular system', color: '#d9383a', roughness: 0.38 },
  { id: 'nerves', label: 'Nerves', system: 'Nervous system', color: '#f2cf5b', roughness: 0.5 },
  { id: 'reproductive', label: 'Reproductive', system: 'Reproductive system', color: '#d58aa6', roughness: 0.45 },
  { id: 'endocrine', label: 'Endocrine', system: 'Endocrine system', color: '#a687e8', roughness: 0.45 },
]

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, LayerDef>

/** The Build animation assembles the body in this order, inside out. */
export const BUILD_ORDER: LayerId[] = ['skeleton', 'organs', 'vessels', 'nerves', 'muscles']

export const modelUrl = (id: LayerId) => `${import.meta.env.BASE_URL}models/${id}.glb`
export const infoUrl = (id: LayerId) => `${import.meta.env.BASE_URL}models/info/${id}.json`

/**
 * Natural colour per structure, chosen from keywords in its name.
 * First matching rule wins; otherwise the layer colour is used.
 */
const COLOR_RULES: Partial<Record<LayerId, [RegExp, string][]>> = {
  skeleton: [
    [/tooth|incisor|canine|premolar|molar/i, '#f6f2e7'],
    [/cartilage|disc|menisc|labrum/i, '#b9d3dd'],
  ],
  muscles: [[/tendon/i, '#e9e3d4']],
  organs: [
    [/atrium|ventricle|leaflet|papillary|valve|heart/i, '#c4323a'],
    [/gallbladder|bile/i, '#5f8f3e'],
    [/liver/i, '#8a2f2a'],
    [/lobe of (right|left) lung|lung/i, '#e9a5ab'],
    [/bronch|trachea|epiglottis|larynx/i, '#ead2c8'],
    [/kidney|renal/i, '#8c3a33'],
    [/pancrea/i, '#e8c27a'],
    [/bladder|ureter|urethra/i, '#e2b47c'],
    [/tongue|gingiva|palate|uvula|pharynx|mucosa/i, '#d5767a'],
    [/parotid|sublingual|submandibular|salivary/i, '#e6bd92'],
    [/stomach|oesophag|esophag|duoden|jejun|ileum|colon|caecum|cecum|appendix|rectum|taenia|intestin/i, '#f0aa8c'],
    [/spleen/i, '#7c2e48'],
  ],
  vessels: [[/vein|venous|vena|sinus|venule/i, '#3f7fd8']],
  nerves: [
    [/eye|retina|lens|cornea|iris|sclera|choroid|vitreous|ciliary/i, '#dbe5ef'],
    [/cochlea|ossicle|tympan|semicircular|vestibul|labyrinth|auricle|ear/i, '#ead9b8'],
    [
      /cerebr|gyrus|gyri|lobe|lobule|cortex|cerebell|thalam|pons|medulla|midbrain|hippocamp|amygdal|nucleus|sulc|callosum|brain|vermis|tonsil|fornix|insula|cuneus|uncus|peduncle|colliculus|ventricle|putamen|pallidus|caudate|claustrum|mammillary|hypothal|tegment|tectum|olive|pyramid|falx|tentorium|dura|arachnoid/i,
      '#ecd8d4',
    ],
    [/spinal cord|cauda|conus|filum/i, '#f1e3c4'],
  ],
  reproductive: [
    [/^breast/i, '#e8c194'], // fatty tissue
    [/nipple|areola/i, '#b8796a'],
    [/mammary|lactiferous/i, '#f0c3ae'],
    [/ovary/i, '#ead6c9'],
    [/uterine tube/i, '#e39aa3'],
    [/uter|cervix/i, '#cf6f7f'],
    [/testis|epididym/i, '#e7c6c0'],
    [/prostate|seminal/i, '#d9a07e'],
  ],
}

export function partColor(layer: LayerId, rawName: string): string {
  for (const [re, color] of COLOR_RULES[layer] ?? []) if (re.test(rawName)) return color
  return LAYER_BY_ID[layer].color
}
