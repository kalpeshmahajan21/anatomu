import { create } from 'zustand'
import { infoUrl, LAYERS, type LayerId } from './layers'
import { cleanName } from './names'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top'
/** Which body is shown: the male model (Z-Anatomy) or female (pelvis, reproductive organs,
 *  breasts and bladder swapped for the Human Reference Atlas female ones). */
export type Sex = 'm' | 'f'

/** One anatomical structure. `id` is a global number shared by all layers. */
export interface Part {
  id: number
  raw: string // original mesh/object name, exactly as exported
  name: string // cleaned-up display name
  layer: LayerId
  sex?: Sex // only exists in one body (e.g. uterus, prostate); undefined = both
}

/**
 * A whole structure made of several parts: the heart (chambers, valves...), a hip bone (ilium,
 * ischium, pubis), the knee joint (the bones that form it)... From index.json `groups`.
 * Groups whose parts all come in left/right pairs are split per side ("Hip bone (right)").
 */
export interface Group {
  id: number
  name: string // e.g. "Heart", "Knee joint"
  label: string // name plus side, e.g. "Knee joint (right)"
  side?: 'l' | 'r'
  members: number[] // part ids
  joint?: boolean // shown as the bones that form it
}

/** Is this structure part of the body currently shown? */
export const inBody = (p: Part, sex: Sex) => !p.sex || p.sex === sex

const SEX_KEY = 'bodyExplorer.sex'
function savedSex(): Sex {
  try {
    return localStorage.getItem(SEX_KEY) === 'f' ? 'f' : 'm'
  } catch {
    return 'm'
  }
}

/** Extra info for a structure (public/models/info/<layer>.json, from export_models.py). */
export interface PartInfo {
  d?: { intro: string; sections: [string, string][] } // description (Wikipedia, via Z-Anatomy)
  la?: string // Latin name
  ta?: number // Terminologia Anatomica 2 id
  g?: string[] // group path, e.g. ["Muscles", "Muscles of lower limb"]
  p?: string // "part of" this larger structure
  n?: string // nerve supply (muscles)
  src?: 'hra' // 3D model from the Human Reference Atlas (female structures)
}

/** Shape of public/models/index.json (written by scripts/export_models.py). */
interface ModelIndex {
  bounds: { min: [number, number, number]; max: [number, number, number] }
  layers: Partial<Record<LayerId, string[]>>
  sex?: Record<string, Sex>
  groups?: {
    names: string[]
    paths: Partial<Record<LayerId, number[][]>> // per structure: group name ids, outermost first
    joints: { name: string; side: 'l' | 'r'; members: string[] }[]
  }
}

interface State {
  parts: Part[]
  partByRaw: Map<string, Part>
  groups: Group[]
  /** Per part id: the groups it belongs to, innermost first (joints not included). */
  partGroups: number[][]
  /** Per part id: the joints it helps form. */
  partJoints: number[][]
  /** Descriptions of whole structures (info/groups.json), loaded on first use. */
  groupInfo: Record<string, PartInfo> | null
  bodyBounds: ModelIndex['bounds'] | null
  enabled: Record<LayerId, boolean>
  status: Record<LayerId, LoadStatus>
  info: Partial<Record<LayerId, Record<string, PartInfo>>>
  sex: Sex
  /** Bumped on every Male/Female switch (the UI shows a short note). */
  sexNonce: number

  hoveredId: number
  /** Selected structure. Selecting also turns on "focus mode": everything else turns to glass. */
  selectedId: number
  /** Whole structure selected (Ctrl+click, search, "Select whole"); -1 = just `selectedId`. */
  selectedGroup: number
  /** Ctrl/Cmd held while hovering: the hover glow covers the whole structure. */
  hoverWhole: boolean
  /** Isolate: only the selection is drawn; everything else is hidden. */
  isolated: boolean

  /** Bumping a nonce asks the 3D view to do something (fly, change view, zoom). */
  fly: { id: number; ids?: number[]; nonce: number } // id -1 = whole body; ids = several parts
  view: { name: ViewName; nonce: number }
  zoom: { dir: 1 | -1; nonce: number }
  autoRotate: boolean
  building: boolean
  buildNonce: number

  loadIndex: () => Promise<void>
  toggleLayer: (id: LayerId) => void
  setEnabled: (id: LayerId, on: boolean) => void
  setStatus: (id: LayerId, s: LoadStatus) => void
  setHovered: (id: number, whole?: boolean) => void
  setSex: (sex: Sex) => void
  /** Click on a structure (or -1 on empty space). Selects it and flies the camera to it. */
  pick: (id: number) => void
  /** Ctrl/Cmd+click: select the whole structure the part belongs to. Again on the same
   *  selection climbs one level (valve → heart). */
  pickWhole: (id: number) => void
  selectGroup: (groupId: number, anchor?: number) => void
  clearSelection: () => void
  /** Isolate the current selection (one part or a whole structure). */
  isolate: () => void
  showAll: () => void
  flyTo: (id: number) => void
  /** Fly to the whole current selection (one part or all parts of a whole structure). */
  flyToSelection: () => void
  setView: (name: ViewName) => void
  zoomStep: (dir: 1 | -1) => void
  resetView: () => void
  toggleAutoRotate: (on?: boolean) => void
  startBuild: () => void
  endBuild: () => void
  /** Search result / related-part chip: make sure its layer is on, then fly + select. */
  focusPart: (id: number) => void
  ensureInfo: (layer: LayerId) => void
  ensureGroupInfo: () => void
}

const allOff = Object.fromEntries(LAYERS.map((l) => [l.id, false])) as Record<LayerId, boolean>
const allIdle = Object.fromEntries(LAYERS.map((l) => [l.id, 'idle'])) as Record<LayerId, LoadStatus>
const infoRequested = new Set<LayerId>()
let groupInfoRequested = false

/** Parts of a group that exist in the body shown (Male/Female). */
export function groupMembers(g: Group, parts: Part[], sex: Sex): number[] {
  return g.members.filter((id) => inBody(parts[id], sex))
}

/** The part ids currently selected: a whole structure's parts, or the one part. */
export function selectionIds(s: Pick<State, 'selectedGroup' | 'selectedId' | 'groups' | 'parts' | 'sex'>): number[] {
  const g = s.groups[s.selectedGroup]
  if (g) return groupMembers(g, s.parts, s.sex)
  return s.selectedId === -1 ? [] : [s.selectedId]
}

/** Groups a part can be "selected whole" as, smallest first. Each has at least 2 parts in the
 *  body shown and is bigger than the one before. */
export function wholeChain(s: Pick<State, 'partGroups' | 'groups' | 'parts' | 'sex'>, id: number): number[] {
  const out: number[] = []
  let last = 1
  for (const gid of s.partGroups[id] ?? []) {
    const n = groupMembers(s.groups[gid], s.parts, s.sex).length
    if (n > last) {
      out.push(gid)
      last = n
    }
  }
  return out
}

/** What Ctrl+click on part `id` selects: its smallest whole, or one level up if that whole is
 *  already selected. -1 = just the part (nothing bigger, or already at the top). */
export function wholeTarget(s: Pick<State, 'partGroups' | 'groups' | 'parts' | 'sex' | 'selectedGroup'>, id: number): number {
  const chain = wholeChain(s, id)
  const at = chain.indexOf(s.selectedGroup)
  return (at === -1 ? chain[0] : chain[at + 1]) ?? -1
}

const SIDE_RE = /\.(l|r)$/

/** Turn index.json groups into Group objects (split per side where the parts are paired). */
function buildGroups(index: ModelIndex, parts: Part[], partByRaw: Map<string, Part>) {
  const G = index.groups
  const partGroups: number[][] = parts.map(() => [])
  const partJoints: number[][] = parts.map(() => [])
  if (!G) return { groups: [] as Group[], partGroups, partJoints }
  // Pass 1: members of each group name, in layer order (same as `parts`).
  const byName = new Map<number, number[]>()
  let id = 0
  for (const layer of LAYERS) {
    const paths = G.paths[layer.id] ?? []
    for (let i = 0; i < (index.layers[layer.id]?.length ?? 0); i++, id++) {
      for (const g of paths[i] ?? []) {
        let list = byName.get(g)
        if (!list) byName.set(g, (list = []))
        list.push(id)
      }
    }
  }
  // Pass 2: groups. All members sided -> one group per side.
  const groups: Group[] = []
  const add = (name: string, members: number[], side?: 'l' | 'r', joint?: boolean) => {
    const label = side ? `${name} (${side === 'r' ? 'right' : 'left'})` : name
    const g: Group = { id: groups.length, name, label, side, members, joint }
    groups.push(g)
    return g
  }
  const pathGroup = new Map<string, number>() // "name id|side" -> group id
  byName.forEach((members, nameId) => {
    const name = G.names[nameId]
    const sides = members.map((m) => SIDE_RE.exec(parts[m].raw)?.[1] as 'l' | 'r' | undefined)
    if (sides.every(Boolean)) {
      for (const side of ['r', 'l'] as const) {
        const ms = members.filter((_, i) => sides[i] === side)
        if (ms.length) pathGroup.set(`${nameId}|${side}`, add(name, ms, side).id)
      }
    } else pathGroup.set(`${nameId}|`, add(name, members).id)
  })
  // Each part's groups, innermost first.
  id = 0
  for (const layer of LAYERS) {
    const paths = G.paths[layer.id] ?? []
    for (let i = 0; i < (index.layers[layer.id]?.length ?? 0); i++, id++) {
      const side = SIDE_RE.exec(parts[id].raw)?.[1] ?? ''
      partGroups[id] = (paths[i] ?? [])
        .map((g) => pathGroup.get(`${g}|${side}`) ?? pathGroup.get(`${g}|`))
        .filter((g): g is number => g !== undefined)
        .reverse()
    }
  }
  for (const j of G.joints) {
    const members = j.members.map((raw) => partByRaw.get(raw)?.id).filter((m): m is number => m !== undefined)
    const g = add(j.name, members, j.side, true)
    members.forEach((m) => partJoints[m].push(g.id))
  }
  return { groups, partGroups, partJoints }
}

export const useStore = create<State>((set, get) => ({
  parts: [],
  partByRaw: new Map(),
  groups: [],
  partGroups: [],
  partJoints: [],
  groupInfo: null,
  bodyBounds: null,
  enabled: { ...allOff, skeleton: true },
  status: allIdle,
  info: {},
  sex: savedSex(),
  sexNonce: 0,
  hoveredId: -1,
  selectedId: -1,
  selectedGroup: -1,
  hoverWhole: false,
  isolated: false,
  fly: { id: -1, nonce: 0 },
  view: { name: 'front', nonce: 0 },
  zoom: { dir: 1, nonce: 0 },
  autoRotate: false,
  building: false,
  buildNonce: 0,

  async loadIndex() {
    if (get().parts.length) return
    const res = await fetch(`${import.meta.env.BASE_URL}models/index.json`)
    const index: ModelIndex = await res.json()
    const parts: Part[] = []
    for (const layer of LAYERS) {
      for (const raw of index.layers[layer.id] ?? []) {
        parts.push({ id: parts.length, raw, name: cleanName(raw), layer: layer.id, sex: index.sex?.[raw] })
      }
    }
    const partByRaw = new Map(parts.map((p) => [p.raw, p]))
    performance.mark('index-parsed')
    const groups = buildGroups(index, parts, partByRaw)
    performance.mark('groups-built')
    set({ parts, partByRaw, bodyBounds: index.bounds, ...groups })
    performance.mark('index-ready')
  },

  toggleLayer(id) {
    get().setEnabled(id, !get().enabled[id])
  },
  setEnabled(id, on) {
    const enabled = { ...get().enabled, [id]: on }
    // If the selected structure's layer is switched off, drop the selection.
    const s = get()
    const ids = selectionIds(s)
    const clear = !on && ids.length > 0 && ids.every((p) => s.parts[p].layer === id)
    set({ enabled, ...(clear ? { selectedId: -1, selectedGroup: -1, isolated: false, hoveredId: -1 } : {}) })
  },
  setStatus: (id, s) => set({ status: { ...get().status, [id]: s } }),
  setHovered: (id, whole = false) => {
    if (get().hoveredId !== id || get().hoverWhole !== whole) set({ hoveredId: id, hoverWhole: whole })
  },
  setSex(sex) {
    if (sex === get().sex) return
    try {
      localStorage.setItem(SEX_KEY, sex)
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    // A selected structure that doesn't exist in the other body is dropped. A whole
    // structure stays if some of its parts exist in both (e.g. the hip joint).
    const s = get()
    const sel = s.parts[s.selectedId]
    const g = s.groups[s.selectedGroup]
    const left = g ? groupMembers(g, s.parts, sex) : []
    const anchor = sel && inBody(sel, sex) ? sel.id : (left[0] ?? -1)
    const drop = !!sel && anchor === -1
    set({
      sex,
      sexNonce: s.sexNonce + 1,
      hoveredId: -1,
      ...(drop ? { selectedId: -1, selectedGroup: -1, isolated: false } : sel ? { selectedId: anchor } : {}),
    })
    if (drop) get().flyTo(-1)
  },

  pick(id) {
    if (id === -1) return get().clearSelection()
    const part = get().parts[id]
    if (part) get().ensureInfo(part.layer)
    set({ selectedId: id, selectedGroup: -1, autoRotate: false })
    get().flyTo(id)
  },
  pickWhole(id) {
    if (id === -1) return get().clearSelection()
    // Ctrl+click again inside the current whole: one level up; past the top: back to the part.
    const next = wholeTarget(get(), id)
    if (next === -1) return get().pick(id)
    get().selectGroup(next, id)
  },
  selectGroup(groupId, anchor) {
    const s = get()
    const g = s.groups[groupId]
    if (!g) return
    const members = groupMembers(g, s.parts, s.sex)
    if (!members.length) return
    const enabled = { ...s.enabled }
    for (const m of members) enabled[s.parts[m].layer] = true
    new Set(members.map((m) => s.parts[m].layer)).forEach((l) => s.ensureInfo(l))
    s.ensureGroupInfo()
    const sel = anchor !== undefined && members.includes(anchor) ? anchor : members[0]
    set({ enabled, selectedId: sel, selectedGroup: groupId, autoRotate: false, hoveredId: -1 })
    set({ fly: { id: sel, ids: members, nonce: get().fly.nonce + 1 } })
  },
  clearSelection() {
    if (get().isolated) return get().showAll()
    set({ selectedId: -1, selectedGroup: -1 })
  },
  isolate() {
    const ids = selectionIds(get())
    if (!ids.length) return
    set({ isolated: true, hoveredId: -1 })
    get().flyToSelection()
  },
  showAll() {
    set({ isolated: false })
    get().flyTo(-1)
  },
  flyTo: (id) => set({ fly: { id, nonce: get().fly.nonce + 1 } }),
  flyToSelection() {
    const ids = selectionIds(get())
    if (ids.length) set({ fly: { id: ids[0], ids: ids.length > 1 ? ids : undefined, nonce: get().fly.nonce + 1 } })
  },
  setView: (name) => set({ view: { name, nonce: get().view.nonce + 1 } }),
  zoomStep: (dir) => set({ zoom: { dir, nonce: get().zoom.nonce + 1 } }),
  resetView() {
    set({ selectedId: -1, selectedGroup: -1, isolated: false, autoRotate: false })
    get().setView('front')
  },
  toggleAutoRotate: (on) => set({ autoRotate: on ?? !get().autoRotate }),
  startBuild() {
    if (get().building) return
    set({ building: true, buildNonce: get().buildNonce + 1, selectedId: -1, selectedGroup: -1, isolated: false })
    get().setView('front')
  },
  endBuild: () => set({ building: false }),

  focusPart(id) {
    const part = get().parts[id]
    if (!part) return
    if (!inBody(part, get().sex)) get().setSex(part.sex!) // e.g. "Uterus" while viewing the male body
    set({
      enabled: { ...get().enabled, [part.layer]: true },
      // Staying in isolate mode would hide the new structure.
      isolated: false,
    })
    get().pick(id)
  },

  ensureGroupInfo() {
    if (groupInfoRequested) return
    groupInfoRequested = true
    fetch(`${import.meta.env.BASE_URL}models/info/groups.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, PartInfo>) => set({ groupInfo: data }))
      .catch(() => set({ groupInfo: {} }))
  },
  ensureInfo(layer) {
    if (infoRequested.has(layer)) return
    infoRequested.add(layer)
    fetch(infoUrl(layer))
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, PartInfo>) => set({ info: { ...get().info, [layer]: data } }))
      .catch(() => set({ info: { ...get().info, [layer]: {} } }))
  },
}))
