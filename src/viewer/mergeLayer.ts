import { BufferAttribute, BufferGeometry, Color, Matrix3, Sphere, Box3, type Mesh, type Object3D } from 'three'
import type { Part } from '../store'

/**
 * WHY WE MERGE
 * A layer has hundreds or thousands of separate meshes. Drawing each one is a separate
 * "draw call", and a mid-range phone chokes at a few hundred of those per frame.
 * So we glue every mesh of a layer into ONE big geometry (1 draw call per layer).
 *
 * HOW WE STILL KNOW WHICH STRUCTURE IS WHICH
 * Every vertex gets an extra number, `partId`, saying which structure it came from.
 *  - The shader reads it to glow just the hovered/selected structure, or hide all others.
 *  - Click detection reads it from the triangle that the mouse ray hit.
 */
export function mergeLayer(root: Object3D, partByRaw: Map<string, Part>, colorOf: (part: Part) => string) {
  root.updateMatrixWorld(true)

  // Collect meshes and the structure each one belongs to.
  const items: { mesh: Mesh; part: Part }[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    // The original Blender name lives in userData.name (three.js "sanitizes" .name).
    // Walk up the parents in case the exporter split one object into several primitives.
    let node: Object3D | null = mesh
    while (node) {
      const part = partByRaw.get(node.userData.name ?? node.name)
      if (part) {
        items.push({ mesh, part })
        return
      }
      node = node.parent
    }
  })

  let vCount = 0
  let iCount = 0
  for (const { mesh } of items) {
    const g = mesh.geometry
    vCount += g.attributes.position.count
    iCount += g.index ? g.index.count : g.attributes.position.count
  }

  const positions = new Float32Array(vCount * 3)
  const normals = new Float32Array(vCount * 3)
  const partIds = new Float32Array(vCount)
  const colors = new Uint8Array(vCount * 3) // each structure's natural colour (see partColor)
  // Which body the structure belongs to: 0 = both, 1 = male only, 2 = female only.
  // The shader hides the ones that don't match the Male/Female switch.
  const sexes = new Uint8Array(vCount)
  const index = new Uint32Array(iCount)
  const c = new Color()

  const normalMatrix = new Matrix3()
  const box = new Box3()
  const spheres = new Map<number, Sphere>()
  let vOff = 0
  let iOff = 0
  let missingNormals = false
  let mixedSex = false

  for (const { mesh, part } of items) {
    const g = mesh.geometry
    const pos = g.attributes.position
    const nor = g.attributes.normal
    if (!nor) missingNormals = true
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    box.makeEmpty()
    c.set(colorOf(part)) // hex is sRGB; three converts it to linear, which vertex colours expect
    const [cr, cg, cb] = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
    const sexCode = part.sex === 'm' ? 1 : part.sex === 'f' ? 2 : 0
    if (sexCode) mixedSex = true
    sexes.fill(sexCode, vOff, vOff + pos.count)

    // Hot loop (a layer has up to ~300k vertices): plain array maths, no per-vertex objects.
    // Draco gives plain (non-interleaved, non-normalized) float arrays, so read them directly.
    const m = mesh.matrixWorld.elements
    const n = normalMatrix.elements
    const P = pos.array as ArrayLike<number>
    const N = nor ? (nor.array as ArrayLike<number>) : null
    const direct = !(pos as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute && pos.itemSize === 3 && !pos.normalized
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < pos.count; i++) {
      const x = direct ? P[i * 3] : pos.getX(i)
      const y = direct ? P[i * 3 + 1] : pos.getY(i)
      const z = direct ? P[i * 3 + 2] : pos.getZ(i)
      const o = (vOff + i) * 3
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
      positions[o] = wx
      positions[o + 1] = wy
      positions[o + 2] = wz
      if (wx < minX) minX = wx
      if (wx > maxX) maxX = wx
      if (wy < minY) minY = wy
      if (wy > maxY) maxY = wy
      if (wz < minZ) minZ = wz
      if (wz > maxZ) maxZ = wz
      if (nor) {
        const a = direct && N ? N[i * 3] : nor.getX(i)
        const b = direct && N ? N[i * 3 + 1] : nor.getY(i)
        const cz = direct && N ? N[i * 3 + 2] : nor.getZ(i)
        const nx = n[0] * a + n[3] * b + n[6] * cz
        const ny = n[1] * a + n[4] * b + n[7] * cz
        const nz = n[2] * a + n[5] * b + n[8] * cz
        const len = Math.hypot(nx, ny, nz) || 1
        normals[o] = nx / len
        normals[o + 1] = ny / len
        normals[o + 2] = nz / len
      }
      colors[o] = cr
      colors[o + 1] = cg
      colors[o + 2] = cb
    }
    partIds.fill(part.id, vOff, vOff + pos.count)
    box.min.set(minX, minY, minZ)
    box.max.set(maxX, maxY, maxZ)

    if (g.index) {
      const src = g.index.array
      for (let i = 0; i < src.length; i++) index[iOff + i] = src[i] + vOff
      iOff += src.length
    } else {
      for (let i = 0; i < pos.count; i++) index[iOff + i] = vOff + i
      iOff += pos.count
    }

    // A structure split into several primitives: grow its sphere to cover all pieces.
    const s = box.getBoundingSphere(new Sphere())
    const prev = spheres.get(part.id)
    spheres.set(part.id, prev ? prev.union(s) : s)
    vOff += pos.count
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('partId', new BufferAttribute(partIds, 1))
  // Linear colour as normalized bytes (0-255 -> 0-1): 3 bytes per vertex instead of 12.
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true))
  geometry.setAttribute('sex', new BufferAttribute(sexes, 1))
  geometry.setIndex(new BufferAttribute(index, 1))
  if (missingNormals) geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  // The BVH for click detection is built afterwards in a worker (see bvhBuilder.ts).

  // Free the per-mesh copies; we only keep the merged one.
  for (const { mesh } of items) mesh.geometry.dispose()

  return { geometry, spheres, mixedSex }
}
