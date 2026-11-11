import type { Mesh, Sphere } from 'three'
import type { LayerId } from '../layers'

/**
 * Plain (non-React) lookups shared by the viewer pieces.
 * Kept out of the store because these objects are big and never drive UI renders.
 */
export const layerMeshes = new Map<LayerId, Mesh>()
/** The "glass" copy of each layer (see createGhostMaterial). */
export const ghostMeshes = new Map<LayerId, Mesh>()
/** Bounding sphere of every loaded structure, by global part id. Used by the camera fly-to. */
export const partSpheres = new Map<number, Sphere>()
/** Per-layer shader values (the Build animation's reveal height). */
export const layerUniforms = new Map<LayerId, { uReveal: { value: number } }>()

export function getLayerUniforms(id: LayerId) {
  let u = layerUniforms.get(id)
  if (!u) layerUniforms.set(id, (u = { uReveal: { value: 1e9 } })) // 1e9 = fully revealed
  return u
}

/** Hover tooltip position, updated straight from pointer events (no React re-render per move). */
export const hoverPointer = { x: 0, y: 0, listeners: new Set<() => void>() }

/**
 * Zoom level for the toolbar slider: 0 = whole body (or further), 1 = as close as allowed.
 * CameraRig keeps `level` up to date and provides `setLevel`; the slider listens.
 */
export const cameraZoom = {
  level: 0,
  setLevel: (_level: number) => {},
  listeners: new Set<() => void>(),
}
