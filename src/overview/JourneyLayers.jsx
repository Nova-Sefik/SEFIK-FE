import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { GROUPS, GROUP_COLOR, GROUP_LABEL, OPPORTUNITY_COLOR, fmt, fmtCompact } from '../components/theme'
import Panel from './Panel'

// Evidence for the destination of the chain's last leg. The transfer into that
// leg is always inferred from two taps by the same card within 60 minutes.
const EVIDENCE_LABEL = ['Metro-exit confirmed destination', 'Next-boarding inferred destination']
const MATCH_OPTIONS = [
  { id: 'either', label: 'Area or destination' },
  { id: 'hub', label: 'Transfer area' },
  { id: 'to', label: 'Destination' },
]
const ROW_HEIGHT = 20

function locationTotals(paths) {
  const totals = new Map()
  const add = (id, name, n) => {
    if (!totals.has(id)) totals.set(id, { id, name, n: 0 })
    totals.get(id).n += n
  }
  for (const path of paths) {
    add(path.hub, path.hubName, path.n)
    if (path.to !== path.hub) add(path.to, path.toName, path.n)
  }
  return [...totals.values()].sort((a, b) => b.n - a.n)
}

function volumeOrder(paths, field) {
  const totals = new Map()
  for (const path of paths) totals.set(path[field], (totals.get(path[field]) ?? 0) + path.n)
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value)
}

// Every path is drawn: no top-N cut and no "other" bucket, so the drawn total
// always equals the stated total.
function buildJourneySankey(paths) {
  const nodes = []
  const nodeIndex = new Map()
  const links = new Map()

  const node = (key, value) => {
    if (!nodeIndex.has(key)) {
      nodeIndex.set(key, nodes.length)
      nodes.push(value)
    }
    return nodeIndex.get(key)
  }

  // Insert nodes busiest-first so each column starts in volume order
  const names = new Map(paths.flatMap((path) => [[`1:${path.hub}`, path.hubName], [`3:${path.to}`, path.toName]]))
  for (const group of GROUPS) {
    if (paths.some((path) => path.from === group)) node(`0:${group}`, { name: GROUP_LABEL[group], group, layer: 0 })
  }
  for (const hub of volumeOrder(paths, 'hub')) node(`1:${hub}`, { name: names.get(`1:${hub}`), layer: 1 })
  for (const group of GROUPS) {
    if (paths.some((path) => path.via === group)) node(`2:${group}`, { name: GROUP_LABEL[group], group, layer: 2 })
  }
  for (const to of volumeOrder(paths, 'to')) node(`3:${to}`, { name: names.get(`3:${to}`), layer: 3 })

  const addLink = (source, target, value, group, confidence) => {
    const key = `${source}-${target}-${group}`
    if (!links.has(key)) links.set(key, { source, target, value: 0, group, observed: 0, inferred: 0 })
    const link = links.get(key)
    link.value += value
    link[confidence === 0 ? 'observed' : 'inferred'] += value
  }

  for (const path of paths) {
    const origin = nodeIndex.get(`0:${path.from}`)
    const hub = nodeIndex.get(`1:${path.hub}`)
    const nextMode = nodeIndex.get(`2:${path.via}`)
    const destination = nodeIndex.get(`3:${path.to}`)
    addLink(origin, hub, path.n, path.from, path.confidence)
    addLink(hub, nextMode, path.n, path.via, path.confidence)
    addLink(nextMode, destination, path.n, path.via, path.confidence)
  }
  const column = (layer) => nodes.filter((item) => item.layer === layer).length
  return { nodes, links: [...links.values()], rows: Math.max(column(1), column(3), 4) }
}

function JourneyNode({ x, y, width, height, payload }) {
  const rightLabel = payload.layer >= 2
  const fill = payload.group ? GROUP_COLOR[payload.group] : payload.layer === 1 ? OPPORTUNITY_COLOR : '#9aa0a6'
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} rx={1} fill={fill} />
      <text
        x={rightLabel ? x + width + 7 : x - 7}
        y={y + height / 2}
        textAnchor={rightLabel ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={10}
        fill="#3c4043"
      >
        {payload.name}
      </text>
    </g>
  )
}

function JourneyLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  const observedShare = payload.observed / Math.max(payload.value, 1)
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={GROUP_COLOR[payload.group]}
      strokeOpacity={0.18 + observedShare * 0.28}
      strokeWidth={Math.max(linkWidth, 0.5)}
      className="transition-[stroke-opacity] hover:[stroke-opacity:0.7]"
    />
  )
}

function JourneyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload?.payload
  if (!item) return null
  if (!item.source) {
    return (
      <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink shadow-float">
        <p>{item.name}</p>
        <p className="mt-1 tabular-nums">{fmt(item.value)} transfer chains</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink shadow-float">
      <p>{item.source.name} → {item.target.name}</p>
      <p className="mt-1 tabular-nums text-ink">{fmt(item.value)} transfer chains</p>
      <p className="text-xs tabular-nums text-ink-3">{EVIDENCE_LABEL[0]}: {fmt(item.observed)}</p>
      <p className="text-xs tabular-nums text-ink-3">{EVIDENCE_LABEL[1]}: {fmt(item.inferred)}</p>
    </div>
  )
}

function LocationPicker({ options, selected, onToggle }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const query = search.trim().toLowerCase()
  const visible = query ? options.filter((option) => option.name.toLowerCase().includes(query)) : options

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 transition hover:bg-subtle"
      >
        {selected.length ? `${selected.length} location${selected.length > 1 ? 's' : ''}` : 'All locations'} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-line bg-surface p-2 shadow-float">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search locations"
            className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-4 focus:border-primary"
          />
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {visible.map((option) => {
              const on = selected.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggle(option.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                    on ? 'bg-primary-soft text-primary-ink' : 'text-ink-2 hover:bg-subtle'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-3.5 w-3.5 shrink-0 rounded border ${on ? 'border-primary bg-primary' : 'border-ink-4'}`} />
                    {option.name}
                  </span>
                  <span className="tabular-nums text-[10px] text-ink-4">{fmtCompact(option.n)}</span>
                </button>
              )
            })}
            {!visible.length && <p className="px-2.5 py-2 text-xs text-ink-4">No matching location.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function JourneyLayers({ paths, locationFilter = true }) {
  const [selected, setSelected] = useState([])
  const [match, setMatch] = useState('either')
  const locations = useMemo(() => locationTotals(paths), [paths])

  const visiblePaths = useMemo(() => {
    if (!selected.length) return paths
    const chosen = new Set(selected)
    return paths.filter((path) => (match !== 'to' && chosen.has(path.hub)) || (match !== 'hub' && chosen.has(path.to)))
  }, [paths, selected, match])
  const data = useMemo(() => buildJourneySankey(visiblePaths), [visiblePaths])

  const total = paths.reduce((sum, path) => sum + path.n, 0)
  const shown = visiblePaths.reduce((sum, path) => sum + path.n, 0)
  const confirmed = visiblePaths.reduce((sum, path) => sum + (path.confidence === 0 ? path.n : 0), 0)
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const nameOf = new Map(locations.map((location) => [location.id, location.name]))

  return (
    <Panel
      title="Transfer chains: how modes connect"
      subtitle="Origin mode → transfer area → next mode → next detected destination"
      className="lg:col-span-2"
      actions={(
        <span className="text-xs tabular-nums text-ink-3">
          {selected.length ? `${fmt(shown)} of ${fmt(total)}` : fmt(total)} transfer chains
        </span>
      )}
    >
      {locationFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <LocationPicker options={locations} selected={selected} onToggle={toggle} />
          {selected.length > 0 && (
            <>
              <div className="flex rounded-full border border-line bg-surface p-0.5" aria-label="Match selected locations as">
                {MATCH_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMatch(option.id)}
                    aria-pressed={match === option.id}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                      match === option.id ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {selected.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary-ink hover:underline"
                  title="Remove location"
                >
                  {nameOf.get(id)} ×
                </button>
              ))}
              <button type="button" onClick={() => setSelected([])} className="text-xs text-primary-ink hover:underline">
                Show all
              </button>
            </>
          )}
        </div>
      )}
      <div className="mb-3 grid grid-cols-4 text-center text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <span>Origin mode</span>
        <span>Transfer area</span>
        <span>Next mode</span>
        <span>Next destination</span>
      </div>
      {visiblePaths.length ? (
        <div style={{ height: Math.max(360, data.rows * ROW_HEIGHT + 16) }}>
          <ResponsiveContainer>
            <Sankey
              data={data}
              node={<JourneyNode />}
              link={<JourneyLink />}
              nodePadding={data.rows > 12 ? 12 : 16}
              nodeWidth={9}
              iterations={24}
              margin={{ top: 8, right: 210, bottom: 8, left: 100 }}
            >
              <Tooltip content={<JourneyTooltip />} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-ink-3">No transfer chains match these locations.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-ink-3">
        <span>Band width = transfer chains</span>
        <span>{EVIDENCE_LABEL[0]}: {fmt(confirmed)}</span>
        <span>{EVIDENCE_LABEL[1]}: {fmt(shown - confirmed)}</span>
        <span>Stronger colour = larger Metro-exit confirmed share</span>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-ink-4">
        <li>
          A chain is two boardings by the same card within 60 minutes plus the next detected destination. It is not a
          complete door-to-door journey, and a longer journey can add more than one chain.
        </li>
        <li>
          The transfer is always inferred from consecutive taps. The destination is confirmed only when the last leg
          ends at a Metro exit; bus, rail and ferry destinations use the next boarding location.
        </li>
        <li>Areas are clustered zones named after their busiest stop, not necessarily the exact transfer stop.</li>
        <li>
          Whole-sample aggregate: date, time and line filters do not apply. Origin location is not recorded, so
          location filters match the transfer area or the destination.
        </li>
      </ul>
    </Panel>
  )
}
