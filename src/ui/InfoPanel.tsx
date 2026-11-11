import { useEffect, useMemo, useState } from 'react'
import { LAYER_BY_ID, type LayerId } from '../layers'
import { cleanName } from '../names'
import { groupMembers, inBody, useStore, wholeChain, type Group, type Part, type PartInfo } from '../store'
import { IconChevron, IconClose, IconEye, IconFocus, IconSwap, IconWhole } from './icons'

const MAX_RELATED = 10
const MAX_MEMBERS = 24
const touchScreen = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches

/**
 * Details for the selected structure, or for a whole structure (the heart, the knee joint...).
 * Desktop: floating panel on the right. Phone: bottom sheet; tap the handle (or "More") to expand it.
 */
export function InfoPanel() {
  const part = useStore((s) => s.parts[s.selectedId])
  const group = useStore((s) => s.groups[s.selectedGroup])
  const [expanded, setExpanded] = useState(false)
  const key = group ? `g${group.id}` : `p${part?.id}`
  useEffect(() => setExpanded(false), [key])
  if (!part) return null
  if (group) return <GroupPanel key={key} group={group} anchor={part} expanded={expanded} setExpanded={setExpanded} />
  return <Panel key={key} part={part} expanded={expanded} setExpanded={setExpanded} />
}

function Panel({ part, expanded, setExpanded }: { part: Part; expanded: boolean; setExpanded: (v: boolean) => void }) {
  const layerInfo = useStore((s) => s.info[part.layer])
  const isolated = useStore((s) => s.isolated)
  const parts = useStore((s) => s.parts)
  const partByRaw = useStore((s) => s.partByRaw)
  const sex = useStore((s) => s.sex)
  const groups = useStore((s) => s.groups)
  const partGroups = useStore((s) => s.partGroups)
  const partJoints = useStore((s) => s.partJoints)
  const { isolate, showAll, focusPart, flyToSelection, selectGroup } = useStore.getState()

  const layer = LAYER_BY_ID[part.layer]
  const info: PartInfo | undefined = layerInfo?.[part.raw]
  const loading = !layerInfo
  const side = /\.l$/.test(part.raw) ? 'Left' : /\.r$/.test(part.raw) ? 'Right' : null
  const twin = side ? partByRaw.get(part.raw.replace(/\.(l|r)$/, side === 'Left' ? '.r' : '.l')) : undefined

  // Other structures in the same group (same last group folder), same side first.
  const related = useMemo(() => {
    const group = info?.g?.at(-1)
    if (!group || !layerInfo) return []
    const out: Part[] = []
    for (const [raw, other] of Object.entries(layerInfo)) {
      if (raw === part.raw || other.g?.at(-1) !== group) continue
      const p = partByRaw.get(raw)
      if (!p || p.id === twin?.id || !inBody(p, sex)) continue
      if (side && /\.(l|r)$/.test(raw) && !raw.endsWith(side === 'Left' ? '.l' : '.r')) continue
      out.push(p)
      if (out.length >= MAX_RELATED) break
    }
    return out
  }, [info, layerInfo, part.raw, partByRaw, side, twin, sex])

  // Whole structures this part belongs to (smallest first), then the joints it forms.
  const wholes = useMemo(() => {
    const chain = wholeChain({ partGroups, groups, parts, sex }, part.id).map((g) => groups[g])
    const joints = (partJoints[part.id] ?? []).map((g) => groups[g]).filter((g) => groupMembers(g, parts, sex).length > 1)
    return [...chain.slice(0, 3), ...joints]
  }, [partGroups, partJoints, groups, parts, sex, part.id])

  const partOf = info?.p
    ? parts.find(
        (p) =>
          p.layer === part.layer &&
          inBody(p, sex) &&
          cleanName(p.raw)
            .replace(/^(Left|Right) /, '')
            .toLowerCase() === info.p!.toLowerCase(),
      )
    : undefined

  return (
    <Shell expanded={expanded} setExpanded={setExpanded}>
      <header className="shrink-0 px-5 pt-3 md:pt-5">
        <div className="flex items-center gap-2">
          <SystemTag layer={part.layer} />
          {side && <Badge>{side}</Badge>}
          {part.sex && <SexBadge sex={part.sex} />}
          <CloseButton />
        </div>
        <h2 className="mt-2 text-[22px] leading-tight font-semibold tracking-tight text-white">{part.name}</h2>
        {info?.la && <p className="mt-1 text-[13px] text-white/45 italic">{info.la}</p>}

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <Action onClick={flyToSelection} icon={<IconFocus width={15} height={15} />} label="Zoom to" />
          {isolated ? (
            <Action onClick={showAll} icon={<IconEye width={15} height={15} />} label="Show all" primary />
          ) : (
            <Action onClick={isolate} icon={<IconEye width={15} height={15} />} label="Isolate" primary />
          )}
          <Action
            onClick={() => twin && focusPart(twin.id)}
            disabled={!twin}
            icon={<IconSwap width={15} height={15} />}
            label={side === 'Left' ? 'Right side' : side === 'Right' ? 'Left side' : 'Other side'}
          />
        </div>
        {wholes[0] && (
          <button
            onClick={() => selectGroup(wholes[0].id, part.id)}
            className="mt-1.5 flex w-full items-center gap-2 rounded-2xl bg-white/[0.07] px-3 py-2.5 text-left text-[12.5px] font-semibold text-white/85 transition hover:bg-white/[0.13] active:scale-[0.98]"
          >
            <IconWhole width={15} height={15} className="shrink-0 text-sky-300" />
            <span className="min-w-0 flex-1 truncate">Select whole {wholes[0].label}</span>
            {!touchScreen && <kbd className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/40">Ctrl+click</kbd>}
          </button>
        )}
      </header>

      <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {loading ? (
          <Skeleton />
        ) : (
          <>
            <Description info={info} expanded={expanded} setExpanded={setExpanded} empty="No description for this structure yet." />

            <dl className="mt-4 space-y-1.5 rounded-2xl bg-white/[0.04] p-3 text-[12.5px]">
              {info?.g && info.g.length > 0 && <Fact label="Group" value={info.g.slice(-2).join(' › ')} />}
              {info?.p && info.p !== info.g?.at(-1) && <Fact label="Part of" value={info.p} onClick={partOf ? () => focusPart(partOf.id) : undefined} />}
              {info?.n && <Fact label="Nerve supply" value={info.n} />}
              {info?.ta && <Fact label="TA2 code" value={String(info.ta)} />}
              <Fact label="Layer" value={layer.label} />
            </dl>

            <Sections info={info} />

            {wholes.length > 1 && (
              <Chips title="Select a whole structure">
                {wholes.map((g) => (
                  <Chip key={g.id} onClick={() => selectGroup(g.id, part.id)} whole>
                    {g.label}
                  </Chip>
                ))}
              </Chips>
            )}

            {related.length > 0 && (
              <Chips title={`Nearby in ${info?.g?.at(-1)}`}>
                {related.map((p) => (
                  <Chip key={p.id} onClick={() => focusPart(p.id)}>
                    {p.name}
                  </Chip>
                ))}
              </Chips>
            )}

            <p className="mt-5 text-[10.5px] leading-snug text-white/30">
              {info?.src === 'hra' && (
                <>
                  3D model: NIH Human Reference Atlas (Visible Human female) · CC BY 4.0
                  <br />
                </>
              )}
              {info?.d && 'Description: Wikipedia, via Z-Anatomy · CC BY-SA'}
            </p>
          </>
        )}
      </div>
    </Shell>
  )
}

/** A whole structure: the heart, a hip bone, the knee joint... */
function GroupPanel({ group, anchor, expanded, setExpanded }: { group: Group; anchor: Part; expanded: boolean; setExpanded: (v: boolean) => void }) {
  const groupInfo = useStore((s) => s.groupInfo)
  const isolated = useStore((s) => s.isolated)
  const parts = useStore((s) => s.parts)
  const sex = useStore((s) => s.sex)
  const groups = useStore((s) => s.groups)
  const partGroups = useStore((s) => s.partGroups)
  const { isolate, showAll, flyToSelection, selectGroup, focusPart } = useStore.getState()
  const [allMembers, setAllMembers] = useState(false)

  const members = useMemo(() => groupMembers(group, parts, sex).map((id) => parts[id]), [group, parts, sex])
  const info = groupInfo?.[group.name]
  const layers = [...new Set(members.map((p) => p.layer))] as LayerId[]
  const twin = group.side ? groups.find((g) => g.name === group.name && g.side === (group.side === 'r' ? 'l' : 'r') && g.joint === group.joint) : undefined
  // The next bigger structure (one Ctrl+click further).
  const parent = useMemo(() => {
    if (group.joint) return undefined // a joint is not inside one of the folder groups
    const chain = wholeChain({ partGroups, groups, parts, sex }, anchor.id)
    return groups[chain[chain.indexOf(group.id) + 1]]
  }, [partGroups, groups, parts, sex, anchor.id, group.id, group.joint])
  const shown = allMembers ? members : members.slice(0, MAX_MEMBERS)

  return (
    <Shell expanded={expanded} setExpanded={setExpanded}>
      <header className="shrink-0 px-5 pt-3 md:pt-5">
        <div className="flex items-center gap-2">
          <SystemTag layer={layers[0] ?? anchor.layer} />
          <Badge tone="sky">
            <IconWhole width={11} height={11} />
            Whole
          </Badge>
          {group.side && <Badge>{group.side === 'r' ? 'Right' : 'Left'}</Badge>}
          <CloseButton />
        </div>
        <h2 className="mt-2 text-[22px] leading-tight font-semibold tracking-tight text-white">{group.name}</h2>
        {info?.la && <p className="mt-1 text-[13px] text-white/45 italic">{info.la}</p>}
        <p className="mt-1 text-[12px] text-white/45">
          {members.length} parts, all highlighted{group.joint ? ': the bones that form this joint' : ''}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <Action onClick={flyToSelection} icon={<IconFocus width={15} height={15} />} label="Zoom to" />
          {isolated ? (
            <Action onClick={showAll} icon={<IconEye width={15} height={15} />} label="Show all" primary />
          ) : (
            <Action onClick={isolate} icon={<IconEye width={15} height={15} />} label="Isolate" primary />
          )}
          <Action
            onClick={() => twin && selectGroup(twin.id)}
            disabled={!twin}
            icon={<IconSwap width={15} height={15} />}
            label={group.side === 'l' ? 'Right side' : group.side === 'r' ? 'Left side' : 'Other side'}
          />
        </div>
      </header>

      <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {!groupInfo ? (
          <Skeleton />
        ) : (
          <>
            <Description info={info} expanded={expanded} setExpanded={setExpanded} empty="No description for this structure yet." />
            {group.joint && (
              <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] leading-snug text-white/55">
                The 3D model has no ligaments, cartilage discs or joint capsule, so the joint is shown as the bones that meet in it.
              </p>
            )}

            <dl className="mt-4 space-y-1.5 rounded-2xl bg-white/[0.04] p-3 text-[12.5px]">
              <Fact label="Parts" value={String(members.length)} />
              {parent && <Fact label="Part of" value={parent.label} onClick={() => selectGroup(parent.id, anchor.id)} />}
              {info?.ta && <Fact label="TA2 code" value={String(info.ta)} />}
              <Fact label={layers.length > 1 ? 'Layers' : 'Layer'} value={layers.map((l) => LAYER_BY_ID[l].label).join(', ')} />
            </dl>

            <Sections info={info} />

            <Chips title="Parts (tap one for its details)">
              {shown.map((p) => (
                <Chip key={p.id} onClick={() => focusPart(p.id)}>
                  {p.name}
                </Chip>
              ))}
              {members.length > shown.length && (
                <button onClick={() => setAllMembers(true)} className="px-2 py-1 text-[12px] font-semibold text-sky-300">
                  +{members.length - shown.length} more
                </button>
              )}
            </Chips>

            {info?.d && <p className="mt-5 text-[10.5px] leading-snug text-white/30">Description: Wikipedia, via Z-Anatomy · CC BY-SA</p>}
          </>
        )}
      </div>
    </Shell>
  )
}

function Shell({ expanded, setExpanded, children }: { expanded: boolean; setExpanded: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <aside
      className={`glass card-in pointer-events-auto flex w-full flex-col overflow-hidden rounded-3xl shadow-2xl shadow-black/50 md:w-[360px] ${
        expanded ? 'max-h-[64vh]' : 'max-h-[42vh]'
      } md:max-h-[calc(100vh-150px)]`}
    >
      {/* Handle (phone) */}
      <button
        className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-white/20 md:hidden"
        aria-label={expanded ? 'Collapse' : 'Expand'}
        onClick={() => setExpanded(!expanded)}
      />
      {children}
    </aside>
  )
}

function SystemTag({ layer }: { layer: LayerId }) {
  const l = LAYER_BY_ID[layer]
  return (
    <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/55 uppercase">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />
      {l.system}
    </span>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'sky' }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${tone === 'sky' ? 'bg-sky-400/15 text-sky-200' : 'bg-white/8 text-white/60'}`}
    >
      {children}
    </span>
  )
}

function SexBadge({ sex }: { sex: 'm' | 'f' }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${sex === 'f' ? 'bg-pink-400/15 text-pink-200' : 'bg-sky-400/15 text-sky-200'}`}>
      {sex === 'f' ? 'Female' : 'Male'}
    </span>
  )
}

function CloseButton() {
  return (
    <button
      onClick={() => useStore.getState().clearSelection()}
      aria-label="Close (Esc)"
      title="Close (Esc)"
      className="-mr-2 ml-auto rounded-full p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
    >
      <IconClose width={16} height={16} />
    </button>
  )
}

function Description({ info, expanded, setExpanded, empty }: { info?: PartInfo; expanded: boolean; setExpanded: (v: boolean) => void; empty: string }) {
  if (!info?.d) return <p className="text-[13px] text-white/45">{empty}</p>
  return (
    <>
      <p className={`text-[13.5px] leading-relaxed text-white/80 ${expanded ? '' : 'line-clamp-3 md:line-clamp-none'}`}>{info.d.intro}</p>
      {!expanded && (
        <button className="mt-1 text-[12.5px] font-semibold text-sky-300 md:hidden" onClick={() => setExpanded(true)}>
          More
        </button>
      )}
    </>
  )
}

/** Anatomy sections first; unreviewed clinical text last and always collapsed. */
function Sections({ info }: { info?: PartInfo }) {
  const sections = info?.d?.sections ?? []
  return (
    <>
      {sections
        .filter(([title]) => title !== CLINICAL)
        .map(([title, text], i) => (
          <Section key={title} title={title} text={text} defaultOpen={i === 0} />
        ))}
      {sections
        .filter(([title]) => title === CLINICAL)
        .map(([title, text]) => (
          <Section key={title} title={title} text={text} defaultOpen={false} unreviewed />
        ))}
    </>
  )
}

function Chips({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/45 uppercase">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ onClick, whole, children }: { onClick: () => void; whole?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition ${
        whole ? 'bg-sky-400/10 text-sky-100 hover:bg-sky-400/20' : 'bg-white/[0.06] text-white/75 hover:bg-white/15 hover:text-white'
      }`}
    >
      {whole && <IconWhole width={11} height={11} className="text-sky-300" />}
      {children}
    </button>
  )
}

function Action(props: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-30 ${
        props.primary ? 'bg-sky-400 text-slate-950 hover:bg-sky-300' : 'bg-white/[0.07] text-white/85 hover:bg-white/[0.13]'
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  )
}

function Fact({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-white/40">{label}</dt>
      <dd className="min-w-0 text-white/80">
        {onClick ? (
          <button onClick={onClick} className="text-left text-sky-300 hover:underline">
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

const CLINICAL = 'Clinical significance'

function Section({ title, text, defaultOpen, unreviewed }: { title: string; text: string; defaultOpen: boolean; unreviewed?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-2 border-t border-white/[0.07] pt-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] font-semibold text-white/90"
      >
        {title}
        {unreviewed && (
          <span className="rounded-md bg-amber-400/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200/90 ring-1 ring-amber-300/20 ring-inset">
            Not reviewed
          </span>
        )}
        <IconChevron width={15} height={15} className={`ml-auto text-white/40 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          {unreviewed && (
            <p className="mb-2 rounded-xl bg-amber-400/[0.07] px-3 py-2 text-[11.5px] leading-snug text-amber-100/80 ring-1 ring-amber-300/15 ring-inset">
              From Wikipedia, not reviewed by a doctor. For learning only. Don't use it for diagnosis or treatment.
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-white/65">{text}</p>
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[100, 92, 96, 60].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-white/10" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}
