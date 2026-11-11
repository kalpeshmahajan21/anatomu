import { useProgress } from '@react-three/drei'
import { useStore } from '../store'

/** Shown until the first layer (skeleton) is on screen. */
export function LoadingScreen() {
  const ready = useStore((s) => s.status.skeleton === 'ready')
  const { progress } = useProgress()
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center transition-opacity duration-700 ${
        ready ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="text-[13px] font-semibold tracking-[0.3em] text-white/70 uppercase">Anatomu</div>
      <div className="mt-4 h-[3px] w-44 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-200 transition-[width] duration-300" style={{ width: `${Math.max(6, progress)}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-white/35">Loading anatomy…</div>
    </div>
  )
}
