import { useEffect, useState } from 'react'
import { useStore } from '../store'

const KEY = 'bodyExplorer.hintSeen'

function seen() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** First-visit tip on how to move around. Fades out after a few seconds or on the first click. */
export function Hint() {
  const ready = useStore((s) => s.status.skeleton === 'ready')
  const selected = useStore((s) => s.selectedId !== -1)
  const [show, setShow] = useState(() => !seen())
  const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    if (!show || !ready) return
    const t = setTimeout(() => setShow(false), 7000)
    return () => clearTimeout(t)
  }, [show, ready])

  useEffect(() => {
    if (selected) setShow(false)
  }, [selected])

  useEffect(() => {
    if (show) return
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode: fine, the hint just shows again next time */
    }
  }, [show])

  if (!ready) return null
  const items = touch
    ? ['Drag to rotate', 'Pinch to zoom', 'Tap any part']
    : ['Drag to rotate', 'Scroll to zoom', 'Right-drag to pan', 'Click any part', 'Ctrl+click: whole organ']
  return (
    <div className={`pointer-events-none transition-all duration-700 ${show ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
      <div className="glass flex items-center gap-3 rounded-full px-4 py-2 text-[12px] text-white/70">
        {items.map((t, i) => (
          <span key={t} className="flex items-center gap-3 whitespace-nowrap">
            {i > 0 && <span className="h-1 w-1 rounded-full bg-white/25" />}
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
