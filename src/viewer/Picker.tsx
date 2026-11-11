import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Raycaster, Vector2, type BufferAttribute, type Intersection, type Mesh } from 'three'
import { groupMembers, inBody, selectionIds, useStore, wholeTarget } from '../store'
import { ghostMeshes, hoverPointer, layerMeshes, layerUniforms } from './registry'
import { isMarkedSelected, setMask, sharedUniforms } from './anatomyMaterial'

const TAP_MAX_MOVE = 8 // px: moved further than this = it was a drag, not a click
const TAP_MAX_MOVE_TOUCH = 14 // fingers wobble more than a mouse
const TAP_MAX_TIME = 650 // ms
/** If the exact point misses, look this many px around it (see `pick`). */
const TOUCH_RINGS = [4, 8, 12] as const // ~12 px: about half a fingertip
const MOUSE_RINGS = [4, 8] as const
const HOVER_RINGS = [5] as const

/**
 * CLICK / HOVER DETECTION (raycasting)
 * To find what's under the finger or mouse we shoot an invisible ray from the camera
 * through that screen point into the scene and ask which triangle it hits first.
 * Every vertex carries a `partId` (see mergeLayer.ts), so the hit triangle tells us
 * the structure. The BVH makes this test cheap even with a million triangles.
 *
 * In focus mode the other structures are glass, but still clickable: clicking one
 * moves the focus to it. Clicking empty space leaves focus mode.
 *
 * Ctrl+click (Cmd+click on a Mac) selects the WHOLE structure the part belongs to (the
 * heart, a hip bone...); holding Ctrl while hovering previews it.
 *
 * We listen to raw pointer events ourselves (instead of R3F's onClick) so we can tell
 * a real tap apart from the end of an orbit drag or a pinch.
 */
export function Picker() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const downs = new Map<number, { x: number; y: number; t: number }>()
    let multiTouch = false
    let hoverQueued = false
    let lastMove = { x: 0, y: 0 }
    let ctrlHeld = false

    /**
     * FORGIVING PICK
     * A thin bone (a thigh bone seen whole-body on a phone) is only a few pixels wide, and a
     * fingertip covers ~40 px. So if the exact point hits nothing, we try rings of points
     * around it (closest ring first) and take the first structure found there.
     */
    const pick = (clientX: number, clientY: number, rings: readonly number[]): number => {
      const exact = pickAt(clientX, clientY)
      if (exact !== -1) return exact
      for (const r of rings) {
        let best = -1
        let bestDist = Infinity
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2
          const hit = pickAt(clientX + Math.cos(a) * r, clientY + Math.sin(a) * r, true)
          if (hit !== -1 && lastDistance < bestDist) {
            best = hit
            bestDist = lastDistance // several hits on the same ring: the nearest to the camera
          }
        }
        if (best !== -1) return best
      }
      return -1
    }

    let lastDistance = Infinity
    const pickAt = (clientX: number, clientY: number, trackDistance = false): number => {
      const rect = el.getBoundingClientRect()
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)

      const isolated = sharedUniforms.uIsolateOn.value > 0.5
      const { parts, sex } = useStore.getState()
      const hits: Intersection[] = []
      layerMeshes.forEach((m) => {
        // No BVH yet (still building in the worker): skip, a brute-force test would freeze the page.
        if (!m.visible || !m.geometry.boundsTree) return
        // The first hit is the answer unless hidden structures can be in the way: isolate
        // mode, or a layer holding both male and female versions (e.g. two pelvises).
        ;(raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = !isolated && !m.userData.mixedSex
        raycaster.intersectObject(m, false, hits)
      })
      hits.sort((a, b) => a.distance - b.distance)

      for (const hit of hits) {
        if (!hit.face) continue
        const ids = (hit.object as Mesh).geometry.getAttribute('partId') as BufferAttribute
        const id = Math.round(ids.getX(hit.face.a))
        // Hidden structures are still in the geometry (the shader hides them); skip them.
        if (isolated && !isMarkedSelected(id)) continue
        if (parts[id] && !inBody(parts[id], sex)) continue
        if (trackDistance) lastDistance = hit.distance
        return id
      }
      return -1
    }

    const onDown = (e: PointerEvent) => {
      downs.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp, // when the finger touched, even if the page was busy
      })
      if (downs.size > 1) multiTouch = true // a pinch is never a tap
      // The camera library cancels the browser's default focus change on the canvas, so a
      // focused search box would keep the keyboard (and swallow Esc, 0, 1-5...). Release it.
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body) active.blur()
    }

    const onUp = (e: PointerEvent) => {
      const d = downs.get(e.pointerId)
      downs.delete(e.pointerId)
      const wasMulti = multiTouch
      if (downs.size === 0) multiTouch = false
      if (!d || wasMulti || e.button > 0) return
      const touch = e.pointerType !== 'mouse'
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
      if (moved > (touch ? TAP_MAX_MOVE_TOUCH : TAP_MAX_MOVE) || e.timeStamp - d.t > TAP_MAX_TIME) return
      if (useStore.getState().building) return
      // It's a tap/click: select what's under it (or leave focus mode on empty space).
      const id = pick(e.clientX, e.clientY, touch ? TOUCH_RINGS : MOUSE_RINGS)
      if (e.ctrlKey || e.metaKey) useStore.getState().pickWhole(id)
      else useStore.getState().pick(id)
      invalidate()
    }

    // Hover (mouse only). Raycast at most once per animation frame.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      ctrlHeld = e.ctrlKey || e.metaKey
      lastMove = { x: e.clientX, y: e.clientY }
      hoverPointer.x = e.clientX
      hoverPointer.y = e.clientY
      hoverPointer.listeners.forEach((f) => f())
      if (e.buttons !== 0) {
        useStore.getState().setHovered(-1) // dragging the camera: no hover label
        return
      }
      if (hoverQueued) return
      hoverQueued = true
      requestAnimationFrame(() => {
        hoverQueued = false
        const id = useStore.getState().building ? -1 : pick(lastMove.x, lastMove.y, HOVER_RINGS)
        useStore.getState().setHovered(id, ctrlHeld)
        el.style.cursor = id === -1 ? '' : 'pointer'
      })
    }
    const onLeave = () => {
      useStore.getState().setHovered(-1)
      el.style.cursor = ''
    }
    // Pressing / releasing Ctrl without moving the mouse updates the hover preview.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return
      ctrlHeld = e.type === 'keydown'
      const s = useStore.getState()
      if (s.hoveredId !== -1) s.setHovered(s.hoveredId, ctrlHeld)
    }
    const onBlur = () => {
      ctrlHeld = false
      const s = useStore.getState()
      if (s.hoverWhole) s.setHovered(s.hoveredId, false)
    }
    const onCancel = (e: PointerEvent) => {
      downs.delete(e.pointerId)
      if (downs.size === 0) multiTouch = false
    }

    // Never let the browser turn a touch on the 3D view into a page scroll/zoom (that cancels the tap).
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [gl, camera, invalidate])

  // Push hover/selection/isolation from the store into the shader uniforms.
  useEffect(() => {
    const apply = () => {
      const s = useStore.getState()
      const sel = selectionIds(s)
      let hov = s.hoveredId === -1 ? [] : [s.hoveredId]
      if (s.hoverWhole && s.hoveredId !== -1) {
        const g = s.groups[wholeTarget(s, s.hoveredId)]
        if (g) hov = groupMembers(g, s.parts, s.sex)
      }
      setMask(sel, hov)
      sharedUniforms.uSex.value = s.sex === 'f' ? 2 : 1
      sharedUniforms.uIsolateOn.value = s.isolated && sel.length ? 1 : 0
      sharedUniforms.uFocusOn.value = !s.isolated && !s.building && sel.length ? 1 : 0
      syncGhosts()
      invalidate() // we render on demand, so ask for a new frame
    }
    apply()
    const unsub = useStore.subscribe(apply)
    return unsub
  }, [invalidate])

  return null
}

/** The glass copies cost a full extra draw, so they're on only during focus mode or Build. */
export function syncGhosts() {
  const focus = sharedUniforms.uFocusOn.value > 0.5
  ghostMeshes.forEach((g, id) => {
    const revealing = (layerUniforms.get(id)?.uReveal.value ?? 1e9) < 1e8
    g.visible = focus || revealing
  })
}
