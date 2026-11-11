import { useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { useStore } from '../store'

/** A soft pool of light under the feet, so the body stands somewhere instead of floating. */
export function Floor() {
  const bounds = useStore((s) => s.bodyBounds)
  const texture = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(170,190,225,0.30)')
    g.addColorStop(0.35, 'rgba(120,140,180,0.12)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
  if (!bounds) return null
  const height = bounds.max[1] - bounds.min[1]
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  return (
    <mesh position={[cx, bounds.min[1] - 0.002, cz]} rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={-1}>
      <planeGeometry args={[height * 0.9, height * 0.9]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}
