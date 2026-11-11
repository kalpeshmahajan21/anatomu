import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three'
import CameraControlsImpl from 'camera-controls'
import { useStore, type ViewName } from '../store'
import { cameraZoom, partSpheres } from './registry'

const NORMAL_SMOOTH = 0.25 // seconds; how "soft" zoom/orbit feel
const FLY_SMOOTH = 0.7 // slower, cinematic smoothing while flying somewhere
const AUTO_ROTATE_SPEED = 0.35 // radians per second

/** [azimuth, polar] of each preset view. Polar: 0 = straight down from above. */
const VIEWS: Record<ViewName, [number, number]> = {
  front: [0, Math.PI / 2],
  back: [Math.PI, Math.PI / 2],
  left: [-Math.PI / 2, Math.PI / 2], // the body's left side
  right: [Math.PI / 2, Math.PI / 2],
  top: [0, 0.12],
}

/**
 * Orbit / zoom / pan with mouse and touch, via camera-controls:
 *   mouse: left = orbit, right or middle (wheel button) = pan, wheel = zoom
 *          hold Space + left-drag = pan ("hand" tool, like an image viewer)
 *   touch: 1 finger = orbit, 2 fingers = pinch-zoom + pan
 *
 * WHY IT FEELS STABLE
 *  - The orbit centre always stays inside the body's box (setBoundary), so you can't
 *    "lose" the body by panning away, and the pivot never ends up somewhere strange.
 *  - Wheel / pinch zoom goes toward the point under the cursor (or between the fingers),
 *    so you can zoom straight into the head or a foot. The pivot moves with it, but the
 *    boundary above keeps it inside the body, so orbiting stays predictable.
 *  - The camera can't go over the top of the head or under the feet (polar limits),
 *    so the body never flips upside down.
 *
 * CAMERA FLY-TO
 * camera-controls never teleports: when we give it a new camera position + target
 * with `transition = true`, it eases from where it is now over ~smoothTime seconds.
 * To fly to a structure we:
 *   1. take its bounding sphere (center + radius, computed when the layer loaded),
 *   2. pick a distance where that sphere fills about half of the screen,
 *   3. come from the side of the body the structure is on (so a shoulder blade is
 *      approached from the back), blended with the current view so it doesn't whip around,
 *   4. call setLookAt(..., true) and let it glide.
 * If the structure's layer is still downloading, we wait and fly once it's ready.
 */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const bounds = useStore((s) => s.bodyBounds)
  const fly = useStore((s) => s.fly)
  const view = useStore((s) => s.view)
  const zoom = useStore((s) => s.zoom)
  const autoRotate = useStore((s) => s.autoRotate)
  const status = useStore((s) => s.status)
  const doneNonce = useRef(-1)
  const placed = useRef(false)
  const bodyBox = useRef(new Box3())

  /** Use slow, cinematic smoothing until the camera settles or the user grabs it. */
  const glide = () => {
    const c = ref.current
    if (!c) return
    c.smoothTime = FLY_SMOOTH
    const restore = () => {
      c.smoothTime = NORMAL_SMOOTH
      c.removeEventListener('rest', restore)
      c.removeEventListener('controlstart', restore)
    }
    c.addEventListener('rest', restore)
    c.addEventListener('controlstart', restore)
  }

  /** Distance at which the whole body fits the screen (portrait or landscape). */
  const bodyDistance = () => {
    const box = bodyBox.current
    const bh = box.max.y - box.min.y
    const bw = box.max.x - box.min.x
    const vFov = MathUtils.degToRad(camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height))
    // Portrait phones lose more height to the search bar and bottom bar, so step back more.
    const margin = size.width < size.height ? 1.4 : 1.28
    return Math.max(bh / 2 / Math.tan(vFov / 2), bw / 2 / Math.tan(hFov / 2)) * margin
  }

  /** Whole body from one of the preset directions. */
  const frameBody = (name: ViewName, animate: boolean) => {
    const c = ref.current
    if (!c) return
    const box = bodyBox.current
    const center = box.getCenter(new Vector3())
    const bh = box.max.y - box.min.y
    const [az, polar] = VIEWS[name]
    const dist = bodyDistance() * (name === 'top' ? 0.75 : 1)
    // Aim a bit low so the body sits above the bottom bar.
    const target = new Vector3(center.x, name === 'top' ? center.y : center.y - bh * 0.03, center.z)
    const pos = new Vector3().setFromSphericalCoords(dist, polar, az).add(target)
    if (animate) glide()
    void c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, animate)
  }

  // First frame: set up limits and place the camera in front of the body (no animation).
  useEffect(() => {
    const c = ref.current
    if (!c || !bounds || placed.current) return
    placed.current = true
    const box = bodyBox.current.set(new Vector3(...bounds.min), new Vector3(...bounds.max))
    const height = box.max.y - box.min.y
    camera.near = height * 0.0005
    camera.far = height * 30
    camera.updateProjectionMatrix()
    c.minDistance = height * 0.03
    c.maxDistance = height * 4
    c.minPolarAngle = 0.08
    c.maxPolarAngle = Math.PI - 0.15
    c.smoothTime = NORMAL_SMOOTH
    c.draggingSmoothTime = 0.1
    c.dollyToCursor = true
    c.dollySpeed = 1.5
    c.azimuthRotateSpeed = 0.9
    c.polarRotateSpeed = 0.9
    c.mouseButtons.middle = CameraControlsImpl.ACTION.TRUCK // wheel button = hand / pan
    c.setBoundary(box.clone().expandByScalar(height * 0.05))
    c.boundaryFriction = 0.2
    frameBody('front', false)

    // Zoom slider (toolbar). Log scale, so each part of the slider feels like the same
    // amount of zoom. The far end is "whole body", not the (much further) max distance.
    const far = () => Math.min(c.maxDistance, bodyDistance() * 1.15)
    const near = c.minDistance
    const toLevel = (d: number) => MathUtils.clamp(Math.log(far() / d) / Math.log(far() / near), 0, 1)
    cameraZoom.setLevel = (t) => void c.dollyTo(far() * Math.pow(near / far(), MathUtils.clamp(t, 0, 1)), true)
    const publish = () => {
      const level = toLevel(c.distance)
      if (Math.abs(level - cameraZoom.level) < 0.002) return
      cameraZoom.level = level
      cameraZoom.listeners.forEach((f) => f())
    }
    c.addEventListener('update', publish)
    publish()

    // Depth precision: keep the near plane as far out as the zoom allows. A fixed tiny near
    // plane leaves too little precision at whole-body distance, and surfaces under ~1 mm
    // apart (vessels on muscle, cartilage on bone) flicker against each other while orbiting.
    const fitClip = () => {
      const nearPlane = Math.max(height * 0.0005, c.distance * 0.02)
      const farPlane = c.distance + height * 4
      if (Math.abs(camera.near - nearPlane) < nearPlane * 0.01 && Math.abs(camera.far - farPlane) < farPlane * 0.01) return
      camera.near = nearPlane
      camera.far = farPlane
      camera.updateProjectionMatrix()
    }
    c.addEventListener('update', fitClip)
    fitClip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, camera])

  // Preset views (toolbar buttons, keyboard, Reset).
  useEffect(() => {
    if (view.nonce > 0) frameBody(view.name, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // "Hand" tool: hold Space and drag to pan. Space does nothing else (the turntable is on
  // the A key). The middle (wheel) button pans too, without a key.
  useEffect(() => {
    const el = gl.domElement
    let held = false
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey
    }
    const onDrag = () => {
      if (held) el.style.cursor = 'grabbing'
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || typing(e)) return
      e.preventDefault() // no page scroll, no "click" on a focused button
      if (e.repeat || held) return
      held = true
      const c = ref.current
      if (c) c.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK
      el.style.cursor = 'grab'
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !held) return
      e.preventDefault()
      held = false
      const c = ref.current
      if (c) c.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE
      el.style.cursor = ''
    }
    const onBlur = () => {
      held = false
      if (ref.current) ref.current.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE
      el.style.cursor = ''
    }
    // Middle button: show the hand while dragging.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault() // no browser auto-scroll circle
        el.style.cursor = 'grabbing'
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 1 && !held) el.style.cursor = ''
    }
    const c = ref.current
    c?.addEventListener('controlstart', onDrag)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      c?.removeEventListener('controlstart', onDrag)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [gl])

  // Zoom buttons / keys: move 30% closer or further.
  useEffect(() => {
    const c = ref.current
    if (!c || zoom.nonce === 0) return
    void c.dolly(c.distance * 0.3 * zoom.dir, true)
  }, [zoom])

  // Slow turntable while auto-rotate is on. Stops when the user grabs the camera.
  useEffect(() => {
    const c = ref.current
    if (!c || !autoRotate) return
    let raf = 0
    let last = performance.now()
    const stop = () => useStore.getState().toggleAutoRotate(false)
    c.addEventListener('controlstart', stop)
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      void c.rotate(AUTO_ROTATE_SPEED * dt, 0, false)
      invalidate() // drei's <CameraControls> applies it on the next frame
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      c.removeEventListener('controlstart', stop)
    }
  }, [autoRotate, invalidate])

  // Phones: the info sheet covers the lower part of the screen, so while something is
  // selected the fly-to slides the picture up (camera "focal offset"). Undo it on deselect.
  const selectedId = useStore((s) => s.selectedId)
  useEffect(() => {
    if (selectedId === -1) void ref.current?.setFocalOffset(0, 0, 0, true)
  }, [selectedId])

  // Fly to a structure (or back to the whole body).
  useEffect(() => {
    const c = ref.current
    if (!c || !bounds || fly.nonce === 0 || doneNonce.current === fly.nonce) return

    if (fly.id === -1) {
      doneNonce.current = fly.nonce
      void c.setFocalOffset(0, 0, 0, true)
      frameBody('front', true)
      return
    }

    const sphere = flySphere(fly)
    if (!sphere) return // layer not loaded yet; this effect re-runs when `status` changes
    doneNonce.current = fly.nonce

    // Distance so the sphere fills about half of the narrower screen direction.
    const vFov = MathUtils.degToRad(camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height))
    const fov = Math.min(vFov, hFov)
    const height = bodyBox.current.max.y - bodyBox.current.min.y
    const r = Math.max(sphere.radius, height * 0.02)
    const dist = Math.min(r / Math.sin(fov / 2) / 0.55, bodyDistance())

    // Direction: current view direction, pulled toward "outward from the body's spine".
    const target = new Vector3()
    c.getTarget(target)
    const current = new Vector3().subVectors(camera.position, target).normalize()
    const axis = bodyBox.current.getCenter(new Vector3())
    const outward = new Vector3(sphere.center.x - axis.x, 0, sphere.center.z - axis.z)
    const dir = current.clone()
    if (outward.lengthSq() > 1e-8) dir.lerp(outward.normalize(), 0.45)
    dir.y = MathUtils.clamp(dir.y, -0.35, 0.45) // avoid looking straight down/up
    dir.normalize()

    const pos = sphere.center.clone().addScaledVector(dir, dist)
    glide()
    // Portrait phone: shift the camera up so the part sits ~22% of the screen height, above the info sheet.
    const portrait = size.width < 768 && size.width < size.height
    // Desktop: the panel covers ~440px on the right, so shift the part left by half of that.
    const visibleH = 2 * dist * Math.tan(vFov / 2)
    const visibleW = visibleH * (size.width / size.height)
    const sideShift = size.width >= 768 ? visibleW * (220 / size.width) : 0
    void c.setFocalOffset(sideShift, portrait ? visibleH * 0.22 : 0, 0, true)
    void c.setLookAt(pos.x, pos.y, pos.z, sphere.center.x, sphere.center.y, sphere.center.z, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly, status, bounds, camera, size])

  return <CameraControls ref={ref} makeDefault />
}

/** Sphere around the fly-to target: one structure, or all parts of a whole one. Null while
 *  any of them is still loading. */
function flySphere(fly: { id: number; ids?: number[] }): Sphere | null {
  if (!fly.ids) return partSpheres.get(fly.id) ?? null
  const box = new Box3()
  for (const id of fly.ids) {
    const s = partSpheres.get(id)
    if (!s) return null
    box.expandByPoint(s.center.clone().addScalar(-s.radius))
    box.expandByPoint(s.center.clone().addScalar(s.radius))
  }
  return box.getBoundingSphere(new Sphere())
}
