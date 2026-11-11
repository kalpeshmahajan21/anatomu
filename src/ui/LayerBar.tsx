import { useEffect, useRef, useState } from 'react'
import { LAYERS } from '../layers'
import { useStore } from '../store'
import { IconChevron, IconLayers } from './icons'

/** Bottom bar: Build button + one chip per layer. Scrolls sideways on narrow screens. */
export function LayerBar() {
  const enabled = useStore((s) => s.enabled)
  const status = useStore((s) => s.status)
  const building = useStore((s) => s.building)
  const { toggleLayer, startBuild } = useStore.getState()

  // On narrow screens the chips scroll sideways. Fade only the edge that has more chips
  // behind it, and show an arrow on the right until the end is reached.
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () =>
      setMore({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="glass pointer-events-auto mx-auto flex w-full max-w-[860px] items-center gap-1 rounded-2xl p-1.5 shadow-2xl shadow-black/40">
      <button
        onClick={startBuild}
        disabled={building}
        title="Assemble the body layer by layer"
        className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold transition active:scale-95 ${
          building ? 'bg-sky-400/20 text-sky-200' : 'bg-white text-slate-900 hover:bg-white/90'
        }`}
      >
        <IconLayers width={15} height={15} className={building ? 'animate-pulse' : ''} />
        {building ? 'Building…' : 'Build'}
      </button>
      <div className="mx-1 h-6 w-px shrink-0 bg-white/10" />
      <div className="relative flex min-w-0 flex-1 items-center">
        <div
          ref={scroller}
          className="no-scrollbar fade-x flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth"
          style={
            {
              '--fade-l': more.left ? '28px' : '0px',
              '--fade-r': more.right ? '56px' : '0px',
            } as React.CSSProperties
          }
        >
          {LAYERS.map((l) => {
            const on = enabled[l.id]
            const loading = status[l.id] === 'loading'
            return (
              <button
                key={l.id}
                onClick={() => toggleLayer(l.id)}
                aria-pressed={on}
                disabled={building}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium transition-colors duration-200 active:scale-95 disabled:opacity-60 ${
                  on ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                <span className="relative flex h-3 w-3 items-center justify-center">
                  {loading ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/20" style={{ borderTopColor: l.color }} />
                  ) : (
                    <span
                      className="h-2 w-2 rounded-full transition-all duration-200"
                      style={{
                        background: on ? l.color : 'transparent',
                        boxShadow: on ? `0 0 8px ${l.color}` : `inset 0 0 0 1.5px ${l.color}aa`,
                      }}
                    />
                  )}
                </span>
                {l.label}
              </button>
            )
          })}
        </div>
        <button
          aria-label="More layers"
          tabIndex={more.right ? 0 : -1}
          onClick={() =>
            scroller.current?.scrollBy({
              left: scroller.current.clientWidth * 0.7,
            })
          }
          className={`absolute right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/10 backdrop-blur transition-all duration-200 hover:bg-white/20 active:scale-90 ${
            more.right ? 'opacity-100' : 'pointer-events-none translate-x-1 opacity-0'
          }`}
        >
          <IconChevron width={14} height={14} />
        </button>
      </div>
    </div>
  )
}
