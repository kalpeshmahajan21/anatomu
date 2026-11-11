/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

/**
 * Builds a layer's BVH (the box tree used for click detection) off the main thread, so the
 * body can be drawn while this runs. "Indirect" mode keeps the triangle order unchanged,
 * so the main thread can attach the result without touching the geometry on the GPU.
 */
self.onmessage = (e: MessageEvent<{ id: string; position: Float32Array; index: Uint32Array }>) => {
  const { id, position, index } = e.data
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  const bvh = new MeshBVH(geometry, { indirect: true })
  const data = MeshBVH.serialize(bvh, { cloneBuffers: false })
  const transfer: Transferable[] = [...data.roots]
  if (data.indirectBuffer) transfer.push(data.indirectBuffer.buffer)
  ;(self as DedicatedWorkerGlobalScope).postMessage({ id, roots: data.roots, indirectBuffer: data.indirectBuffer }, transfer)
}
