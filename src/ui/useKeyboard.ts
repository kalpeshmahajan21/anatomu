import { useEffect } from 'react'
import { useStore, type ViewName } from '../store'

const VIEW_KEYS: Record<string, ViewName> = { '1': 'front', '2': 'right', '3': 'back', '4': 'left', '5': 'top' }

/**
 * Keyboard shortcuts (desktop):
 *   1-5 views · + / - zoom · 0 reset · Esc close / show all
 *   A turntable on/off · Space: hold + drag = pan (handled in CameraRig)
 *   / or Ctrl+K search (handled in SearchBar)
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const s = useStore.getState()
      if (VIEW_KEYS[e.key]) s.setView(VIEW_KEYS[e.key])
      else if (e.key === '+' || e.key === '=') s.zoomStep(1)
      else if (e.key === '-' || e.key === '_') s.zoomStep(-1)
      else if (e.key === '0') s.resetView()
      else if (e.key === 'a' || e.key === 'A') s.toggleAutoRotate()
      else if (e.key === 'Escape') s.clearSelection()
      else return
      e.preventDefault()
    }
    // A button clicked with the mouse or a finger lets go of the keyboard focus, so the next
    // shortcut doesn't draw a focus ring on it (Tab navigation still focuses as usual).
    const onPointerUp = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest?.('button')
      if (b && b === document.activeElement) setTimeout(() => b.blur(), 0)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])
}
