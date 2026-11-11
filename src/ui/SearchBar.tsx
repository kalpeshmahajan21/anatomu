import { useEffect, useMemo, useRef, useState } from 'react'
import { LAYER_BY_ID } from '../layers'
import { groupMembers, inBody, useStore, type Group, type Part } from '../store'
import { IconWhole } from './icons'

const MAX_RESULTS = 8

/** A search result: one structure, or a whole one (the heart, the knee joint...). */
type Result = { kind: 'part'; p: Part; key: string } | { kind: 'group'; g: Group; size: number; layer: Part['layer']; key: string }

/** Rank: whole name starts with query > a word starts with it > contains it. Shorter names
 *  first; on a tie the whole structure comes before a part of it. */
function score(name: string, query: string) {
  const n = name.toLowerCase()
  const i = n.indexOf(query)
  if (i === -1) return -1
  return (i === 0 ? 0 : n[i - 1] === ' ' || n[i - 1] === '(' ? 1 : 2) * 1000 + n.length
}

function search(parts: Part[], groups: { g: Group; size: number; layer: Part['layer'] }[], q: string): Result[] {
  const query = q.trim().toLowerCase()
  if (query.length < 2) return []
  const scored: { r: Result; score: number }[] = []
  for (const x of groups) {
    // Ranked by the name without "(right)"/"(left)", so the right side comes first, as listed.
    const sc = score(x.g.name, query)
    if (sc >= 0) scored.push({ r: { kind: 'group', ...x, key: 'g' + x.g.id }, score: sc - 0.5 })
  }
  for (const p of parts) {
    const sc = score(p.name, query)
    if (sc >= 0) scored.push({ r: { kind: 'part', p, key: 'p' + p.id }, score: sc })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, MAX_RESULTS).map((s) => s.r)
}

export function SearchBar() {
  const allParts = useStore((s) => s.parts)
  const sex = useStore((s) => s.sex)
  // Only structures of the body being shown (Male/Female switch).
  const parts = useMemo(() => allParts.filter((p) => inBody(p, sex)), [allParts, sex])
  const allGroups = useStore((s) => s.groups)
  // Whole structures with at least 2 parts in this body; the right side before the left.
  const groups = useMemo(() => {
    const out: { g: Group; size: number; layer: Part['layer'] }[] = []
    for (const g of allGroups) {
      const m = groupMembers(g, allParts, sex)
      if (m.length > 1) out.push({ g, size: m.length, layer: allParts[m[0]].layer })
    }
    return out
  }, [allGroups, allParts, sex])
  const focusPart = useStore((s) => s.focusPart)
  const selectGroup = useStore((s) => s.selectGroup)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => search(parts, groups, q), [parts, groups, q])

  // "/" or Ctrl+K jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'INPUT'
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (r: Result) => {
    if (r.kind === 'part') focusPart(r.p.id)
    else selectGroup(r.g.id)
    setQ('')
    setOpen(false)
    input.current?.blur() // closes the phone keyboard so the body is visible
  }

  return (
    <div className="pointer-events-auto relative mx-auto w-full max-w-md">
      <div className="glass flex items-center gap-2 rounded-2xl px-3.5 shadow-2xl shadow-black/40">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-white/40">
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5L14 14" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!results.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % results.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + results.length) % results.length)
            } else if (e.key === 'Enter') {
              choose(results[active])
            } else if (e.key === 'Escape') {
              // First Esc closes the list; with nothing open it hands the keyboard back to the shortcuts.
              if (open && results.length) setOpen(false)
              else e.currentTarget.blur()
            }
          }}
          placeholder={parts.length ? `Search ${parts.length.toLocaleString()} structures…` : 'Loading…'}
          className="h-11 w-full bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {!q && <kbd className="hidden shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10.5px] text-white/35 md:block">/</kbd>}
        {q && (
          <button onClick={() => setQ('')} aria-label="Clear" className="text-white/40 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="glass card-in absolute top-full right-0 left-0 mt-2 overflow-hidden rounded-2xl py-1 shadow-2xl shadow-black/50">
          {results.map((r, i) => {
            const layer = r.kind === 'part' ? r.p.layer : r.layer
            return (
              <li key={r.key}>
                <button
                  onPointerDown={(e) => e.preventDefault()} // keep input focused until we choose
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm ${i === active ? 'bg-white/10 text-white' : 'text-white/75'}`}
                >
                  {r.kind === 'part' ? (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LAYER_BY_ID[layer].color }} />
                  ) : (
                    <IconWhole width={12} height={12} className="-mx-0.5 shrink-0" style={{ color: LAYER_BY_ID[layer].color }} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{r.kind === 'part' ? r.p.name : r.g.label}</span>
                  {r.kind === 'group' ? (
                    <span className="shrink-0 rounded-md bg-sky-400/15 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-200">Whole · {r.size} parts</span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-white/35">{LAYER_BY_ID[layer].label}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
