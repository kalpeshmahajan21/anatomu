import { useEffect, useRef } from 'react'
import { LAYER_BY_ID } from '../layers'
import { useStore, wholeTarget } from '../store'
import { hoverPointer } from '../viewer/registry'

/** Name tag that follows the mouse while it's over a structure (desktop only). */
export function HoverLabel() {
  const part = useStore((s) => (s.hoveredId !== s.selectedId || s.hoverWhole ? s.parts[s.hoveredId] : undefined))
  // Ctrl/Cmd held: name the whole structure a click would select.
  const whole = useStore((s) => (s.hoverWhole && s.hoveredId !== -1 ? s.groups[wholeTarget(s, s.hoveredId)] : undefined))
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Move the label directly (no React render per mouse move).
    const move = () => {
      if (el.current) el.current.style.transform = `translate(${hoverPointer.x + 16}px, ${hoverPointer.y + 14}px)`
    }
    move()
    hoverPointer.listeners.add(move)
    return () => {
      hoverPointer.listeners.delete(move)
    }
  }, [part])

  if (!part) return null
  return (
    <div ref={el} className="pointer-events-none fixed top-0 left-0 z-30 hidden md:block">
      <div className="glass flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-white shadow-xl shadow-black/40">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER_BY_ID[part.layer].color }} />
        {whole ? whole.label : part.name}
        {whole && <span className="text-[11px] font-normal text-sky-200/80">· whole, click to select</span>}
      </div>
    </div>
  )
}
