import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, type ViewName } from '../store'
import { cameraZoom } from '../viewer/registry'
import { IconMinus, IconPlus, IconReset, IconRotate } from './icons'

const VIEWS: { name: ViewName; label: string; title: string }[] = [
  { name: 'front', label: 'F', title: 'Front view (1)' },
  { name: 'right', label: 'R', title: 'Right side (2)' },
  { name: 'back', label: 'B', title: 'Back view (3)' },
  { name: 'left', label: 'L', title: 'Left side (4)' },
  { name: 'top', label: 'T', title: 'Top view (5)' },
]

function Btn(props: { title: string; onClick: () => void; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active === undefined ? undefined : props.active}
      onClick={props.onClick}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-xl text-[12px] font-semibold transition-all duration-150 active:scale-90 ${
        props.active ? 'bg-white text-slate-900 shadow-lg shadow-white/10' : 'text-white/60 hover:bg-white/10 hover:text-white'
      } ${props.className ?? ''}`}
    >
      {props.children}
      {/* Tooltip (desktop) */}
      <span className="pointer-events-none absolute right-full mr-2.5 hidden translate-x-1 rounded-lg bg-black/80 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 md:block">
        {props.title}
      </span>
    </button>
  )
}

/** Right-side camera toolbar: zoom, preset views, turntable, reset. */
export function Toolbar() {
  const autoRotate = useStore((s) => s.autoRotate)
  const { setView, zoomStep, toggleAutoRotate, resetView } = useStore.getState()

  return (
    <div className="glass pointer-events-auto flex flex-col items-center gap-0.5 rounded-2xl p-1 shadow-2xl shadow-black/40">
      <div className="hidden flex-col gap-0.5 md:flex">
        <Btn title="Zoom in (+)" onClick={() => zoomStep(1)}>
          <IconPlus />
        </Btn>
        <ZoomSlider />
        <Btn title="Zoom out (−)" onClick={() => zoomStep(-1)}>
          <IconMinus />
        </Btn>
        <div className="mx-auto my-1 h-px w-5 bg-white/10" />
      </div>
      {VIEWS.map((v) => (
        <Btn key={v.name} title={v.title} onClick={() => setView(v.name)}>
          {v.label}
        </Btn>
      ))}
      <div className="mx-auto my-1 h-px w-5 bg-white/10" />
      <Btn title="Turntable (A)" active={autoRotate} onClick={() => toggleAutoRotate()}>
        <IconRotate />
      </Btn>
      <Btn title="Reset view (0)" onClick={resetView}>
        <IconReset />
      </Btn>
    </div>
  )
}

/**
 * Vertical zoom slider between + and −: top = close, bottom = whole body. It follows the
 * camera both ways, so wheel / pinch / button zooms move it too. Drag, click the track,
 * scroll over it, or use the arrow keys when it has focus.
 */
function ZoomSlider() {
  const [level, setLevel] = useState(cameraZoom.level)
  const [dragging, setDragging] = useState(false)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const f = () => setLevel(cameraZoom.level)
    cameraZoom.listeners.add(f)
    f()
    return () => void cameraZoom.listeners.delete(f)
  }, [])

  const fromPointer = (clientY: number) => {
    const r = track.current!.getBoundingClientRect()
    const t = 1 - (clientY - r.top) / r.height
    cameraZoom.setLevel(Math.min(1, Math.max(0, t)))
  }
  const nudge = (d: number) => cameraZoom.setLevel(Math.min(1, Math.max(0, cameraZoom.level + d)))

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Zoom"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      title="Zoom"
      className="group relative mx-auto flex h-28 w-9 cursor-pointer touch-none justify-center rounded-xl py-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-sky-300/60"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        fromPointer(e.clientY)
      }}
      onPointerMove={(e) => dragging && fromPointer(e.clientY)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onWheel={(e) => nudge(e.deltaY < 0 ? 0.06 : -0.06)}
      onKeyDown={(e) => {
        const d = { ArrowUp: 0.06, ArrowRight: 0.06, ArrowDown: -0.06, ArrowLeft: -0.06, PageUp: 0.2, PageDown: -0.2 }[e.key]
        if (d === undefined) return
        e.preventDefault()
        e.stopPropagation()
        nudge(d)
      }}
    >
      <div ref={track} className="relative h-full w-1 rounded-full bg-white/12">
        {/* Filled part: from the bottom (whole body) up to the current zoom. */}
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-sky-400/50 to-sky-300" style={{ height: `${level * 100}%` }} />
        <div
          className={`absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md shadow-black/40 ring-2 ring-sky-300/70 transition-transform duration-150 ${
            dragging ? 'scale-125' : 'group-hover:scale-110'
          }`}
          style={{ bottom: `${level * 100}%` }}
        />
      </div>
      <span className="pointer-events-none absolute top-1/2 right-full mr-2.5 hidden -translate-y-1/2 translate-x-1 rounded-lg bg-black/80 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 md:block">
        Zoom {Math.round(level * 100)}%
      </span>
    </div>
  )
}
