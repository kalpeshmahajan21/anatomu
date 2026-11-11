import { useEffect, useState } from 'react'
import { useStore, type Sex } from '../store'

const OPTIONS: { id: Sex; label: string; icon: React.ReactNode }[] = [
  {
    id: 'm',
    label: 'Male',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="6.5" cy="9.5" r="4" />
        <path d="M9.5 6.5L14 2M10 2h4v4" />
      </svg>
    ),
  },
  {
    id: 'f',
    label: 'Female',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="8" cy="6" r="4" />
        <path d="M8 10v5M5.5 12.5h5" />
      </svg>
    ),
  },
]

/**
 * Male / Female switch. Only the pelvis, reproductive organs, breasts and bladder differ;
 * the rest is one shared (male) model. After a switch, a short note says exactly that and
 * offers to show the reproductive layer if it's off.
 */
export function SexSwitch() {
  const sex = useStore((s) => s.sex)
  const sexNonce = useStore((s) => s.sexNonce)
  const reproOn = useStore((s) => s.enabled.reproductive)
  const building = useStore((s) => s.building)
  const { setSex, setEnabled } = useStore.getState()
  const [note, setNote] = useState(false)

  useEffect(() => {
    if (sexNonce === 0) return
    setNote(true)
    const t = setTimeout(() => setNote(false), 8000)
    return () => clearTimeout(t)
  }, [sexNonce])

  return (
    <div className="pointer-events-auto relative">
      <div role="radiogroup" aria-label="Body" className="glass relative flex rounded-2xl p-1 shadow-2xl shadow-black/40">
        {/* Sliding highlight behind the active option. */}
        <span
          className={`absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl transition-all duration-300 ease-out ${
            sex === 'f' ? 'translate-x-full bg-pink-300/20' : 'bg-sky-300/20'
          }`}
        />
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={sex === o.id}
            disabled={building}
            onClick={() => setSex(o.id)}
            title={o.id === 'f' ? 'Female pelvis and reproductive organs' : 'Male pelvis and reproductive organs'}
            className={`relative z-10 flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold transition-colors duration-200 disabled:opacity-60 ${
              sex === o.id ? (o.id === 'f' ? 'text-pink-100' : 'text-sky-100') : 'text-white/45 hover:text-white/80'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>

      <div
        className={`glass absolute top-full left-0 mt-2 w-64 rounded-2xl p-3 text-[12px] leading-snug text-white/75 shadow-2xl shadow-black/50 transition-all duration-300 ${
          note ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
        }`}
      >
        <p className="font-semibold text-white">{sex === 'f' ? 'Female pelvis & reproductive organs' : 'Male pelvis & reproductive organs'}</p>
        <p className="mt-1">
          {sex === 'f'
            ? 'Swaps in a female pelvis, uterus, ovaries, uterine tubes, bladder and breasts.'
            : 'Shows the male pelvis, testes, prostate and penis.'}
        </p>
        <p className="mt-1.5 text-[11px] text-white/45">
          The rest of the skeleton, the muscles and the other organs come from one male model and are the same in both views.
        </p>
        {!reproOn && (
          <button
            onClick={() => {
              setEnabled('reproductive', true)
              setNote(false)
            }}
            className="mt-2 rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white transition hover:bg-white/20"
          >
            Show reproductive organs
          </button>
        )}
      </div>
    </div>
  )
}
