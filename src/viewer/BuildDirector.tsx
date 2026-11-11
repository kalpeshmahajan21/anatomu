import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { BUILD_ORDER, type LayerId } from '../layers'
import { useStore } from '../store'
import { getLayerUniforms } from './registry'
import { syncGhosts } from './Picker'

const SWEEP_SECONDS = 1.3
const HIDDEN = -1e9 // reveal line below everything = layer fully hidden (shown as glass)
const SHOWN = 1e9

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * BUILD ANIMATION
 * Assembles the body inside out: skeleton, organs, vessels, nerves, muscles.
 * Every layer's material has a "reveal height" (uReveal): above it nothing is drawn
 * solid (the glass copy shows instead), and just below it there's a glowing band.
 * We sweep that height from the feet to the top of the head, one layer after another,
 * waiting for each layer's download first if needed.
 */
export function BuildDirector() {
  const invalidate = useThree((s) => s.invalidate)
  const nonce = useStore((s) => s.buildNonce)

  useEffect(() => {
    if (nonce === 0) return
    let cancelled = false
    const store = useStore.getState()
    const bounds = store.bodyBounds
    if (!bounds) return store.endBuild()
    const [minY, maxY] = [bounds.min[1], bounds.max[1] + 0.02]

    const setReveal = (id: LayerId, y: number) => {
      getLayerUniforms(id).uReveal.value = y
      syncGhosts()
      invalidate()
    }

    const waitReady = (id: LayerId) =>
      new Promise<void>((resolve) => {
        if (useStore.getState().status[id] === 'ready') return resolve()
        const unsub = useStore.subscribe((s) => {
          if (s.status[id] === 'ready' || cancelled) {
            unsub()
            resolve()
          }
        })
      })

    const sweep = (id: LayerId) =>
      new Promise<void>((resolve) => {
        const start = performance.now()
        const tick = (now: number) => {
          if (cancelled) return resolve()
          const t = Math.min(1, (now - start) / (SWEEP_SECONDS * 1000))
          setReveal(id, minY + (maxY - minY) * easeInOut(t))
          if (t < 1) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })

    const run = async () => {
      // Turn the build layers on and hide them all; they start as a glass silhouette.
      for (const id of BUILD_ORDER) {
        setReveal(id, HIDDEN)
        useStore.getState().setEnabled(id, true)
      }
      for (const id of BUILD_ORDER) {
        await waitReady(id)
        if (cancelled) return
        await sweep(id)
        setReveal(id, SHOWN)
      }
      useStore.getState().endBuild()
    }
    void run()

    return () => {
      cancelled = true
      for (const id of BUILD_ORDER) setReveal(id, SHOWN)
    }
  }, [nonce, invalidate])

  return null
}
