import { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { Mesh } from 'three'
import { LAYER_BY_ID, LAYERS, modelUrl, partColor, type LayerId } from '../layers'
import { useStore } from '../store'
import { createAnatomyMaterial, createGhostMaterial } from './anatomyMaterial'
import { mergeLayer } from './mergeLayer'
import { buildBVHInWorker } from './bvhBuilder'
import { getLayerUniforms, ghostMeshes, layerMeshes, partSpheres } from './registry'

const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`

// The skeleton is on at start, so begin downloading it right away (in parallel with
// index.json and the canvas setup) instead of waiting for <LayerModel> to mount.
useGLTF.preload(modelUrl('skeleton'), DRACO_PATH)

/**
 * LAZY LOADING
 * <Layers> only mounts a <LayerModel> the first time its toggle is switched on.
 * Mounting calls useGLTF(), which starts the download and "suspends" (React shows the
 * Suspense fallback, i.e. nothing) until the file arrives. The bottom bar shows a spinner
 * from status 'loading' until this component reports 'ready'.
 * Turning a layer OFF later just hides it (visible=false); it never downloads twice.
 */
export function Layers() {
  const enabled = useStore((s) => s.enabled)
  const status = useStore((s) => s.status)
  const ready = useStore((s) => s.parts.length > 0)
  if (!ready) return null
  return (
    <>
      {LAYERS.map((l) => l.id)
        .filter((id) => enabled[id] || status[id] !== 'idle')
        .map((id) => (
          <LayerSlot key={id} id={id} visible={enabled[id]} />
        ))}
    </>
  )
}

function LayerSlot({ id, visible }: { id: LayerId; visible: boolean }) {
  const setStatus = useStore((s) => s.setStatus)
  useEffect(() => {
    if (useStore.getState().status[id] === 'idle') setStatus(id, 'loading')
  }, [id, setStatus])
  return (
    <Suspense fallback={null}>
      <LayerModel id={id} visible={visible} />
    </Suspense>
  )
}

function LayerModel({ id, visible }: { id: LayerId; visible: boolean }) {
  const gltf = useGLTF(modelUrl(id), DRACO_PATH)
  const partByRaw = useStore((s) => s.partByRaw)
  const setStatus = useStore((s) => s.setStatus)

  // Merge all meshes of this layer into one (see mergeLayer.ts), once.
  const { mesh, ghost } = useMemo(() => {
    performance.mark(`gltf:${id}`)
    const t0 = performance.now()
    const { geometry, spheres, mixedSex } = mergeLayer(gltf.scene, partByRaw, (p) => partColor(id, p.raw))
    performance.measure(`mergeOnly:${id}`, { start: t0 })
    const uniforms = getLayerUniforms(id)
    const m = new Mesh(geometry, createAnatomyMaterial(LAYER_BY_ID[id].roughness, uniforms))
    m.userData.mixedSex = mixedSex // has male-only/female-only parts (see Picker)
    m.raycast = acceleratedRaycast // uses the BVH once the worker has built it (see Picker)
    m.name = id
    // Same geometry drawn a second time as see-through glass (focus mode / Build).
    // Child of the solid mesh so it hides with the layer; drawn after all solid layers.
    const g = new Mesh(geometry, createGhostMaterial(uniforms))
    g.renderOrder = 10
    g.raycast = () => {} // clicks are tested on the solid mesh, which has the same triangles
    g.visible = false // switched on only while needed (see Picker.tsx)
    m.add(g)
    spheres.forEach((s, partId) => partSpheres.set(partId, s))
    return { mesh: m, ghost: g }
  }, [gltf, partByRaw, id])

  useEffect(() => {
    layerMeshes.set(id, mesh)
    ghostMeshes.set(id, ghost)
    setStatus(id, 'ready')
    // Timing marks (read by the load-time test; cheap enough to keep).
    performance.measure(`merge:${id}`, `gltf:${id}`)
    requestAnimationFrame(() => requestAnimationFrame(() => performance.mark(`visible:${id}`)))
    // Body first, click detection a moment later.
    if (!mesh.geometry.boundsTree) void buildBVHInWorker(id, mesh.geometry).then(() => performance.mark(`bvh-ready:${id}`))
    return () => {
      layerMeshes.delete(id)
      ghostMeshes.delete(id)
    }
  }, [id, mesh, ghost, setStatus])

  return <primitive object={mesh} visible={visible} />
}
