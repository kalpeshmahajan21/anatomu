import type { BufferGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

/**
 * Click detection needs a BVH per layer, which takes ~1 s of CPU on a phone. We build it in
 * a Web Worker so the body appears first; clicks work a moment later (Picker skips layers
 * whose BVH isn't ready yet).
 */
let worker: Worker | null = null
const waiting = new Map<string, (data: { roots: ArrayBuffer[]; indirectBuffer: Uint32Array | null }) => void>()

export function buildBVHInWorker(id: string, geometry: BufferGeometry): Promise<void> {
  if (!worker) {
    worker = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
  }
  // Copies: the main thread keeps using its own arrays for rendering.
  const position = (geometry.getAttribute('position').array as Float32Array).slice()
  const index = (geometry.getIndex()!.array as Uint32Array).slice()
  return new Promise((resolve) => {
    waiting.set(id, ({ roots, indirectBuffer }) => {
      const own = geometry.getIndex()!.array as Uint32Array // `index` was handed to the worker
      const data = { version: 1, roots, index: own, indirectBuffer } as unknown as Parameters<typeof MeshBVH.deserialize>[0]
      // (cast: drei ships its own copy of the three-mesh-bvh types for `boundsTree`)
      ;(geometry as { boundsTree?: unknown }).boundsTree = MeshBVH.deserialize(data, geometry, { setIndex: false })
      resolve()
    })
    worker!.postMessage({ id, position, index }, [position.buffer, index.buffer])
  })
}
