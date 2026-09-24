import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { GROUP_COLOR, GROUP_LABEL, OPPORTUNITY_COLOR, fmt, fmtCompact } from '../components/theme'
import Panel from './Panel'

const MAX_HUBS = 7
const MAX_DESTINATIONS = 9
const MAX_PATHS = 100

function topValues(paths, field, limit) {
  const totals = new Map()
  for (const path of paths) totals.set(path[field], (totals.get(path[field]) ?? 0) + path.n)
  return new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value))
}

function buildJourneySankey(rawPaths) {
  const paths = rawPaths.slice(0, MAX_PATHS)
  const topHubs = topValues(paths, 'hub', MAX_HUBS)
  const topDestinations = topValues(paths, 'to', MAX_DESTINATIONS)
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

  const addLink = (source, target, value, group, confidence) => {
    const key = `${source}-${target}-${group}`
    if (!links.has(key)) links.set(key, { source, target, value: 0, group, observed: 0, inferred: 0 })
    const link = links.get(key)
    link.value += value
    link[confidence === 0 ? 'observed' : 'inferred'] += value
  }

  for (const path of paths) {
    const hubKey = topHubs.has(path.hub) ? String(path.hub) : 'other'
    const destinationKey = topDestinations.has(path.to) ? String(path.to) : 'other'
    const origin = node(`0:${path.from}`, { name: GROUP_LABEL[path.from], group: path.from, layer: 0 })
    const hub = node(`1:${hubKey}`, {
      name: hubKey === 'other' ? 'Other transfer hubs' : path.hubName,
      layer: 1,
    })
    const nextMode = node(`2:${path.via}`, { name: GROUP_LABEL[path.via], group: path.via, layer: 2 })
    const destination = node(`3:${destinationKey}`, {
      name: destinationKey === 'other' ? 'Other destinations' : path.toName,
      layer: 3,
    })
    addLink(origin, hub, path.n, path.from, path.confidence)
    addLink(hub, nextMode, path.n, path.via, path.confidence)
    addLink(nextMode, destination, path.n, path.via, path.confidence)
  }
  return { nodes, links: [...links.values()] }
}

function JourneyNode({ x, y, width, height, payload }) {
  const rightLabel = payload.layer >= 2
  const fill = payload.group ? GROUP_COLOR[payload.group] : payload.layer === 1 ? OPPORTUNITY_COLOR : '#9aa0a6'
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={fill} />
      {height > 7 && (
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
      )}
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
      strokeWidth={linkWidth}
      className="transition-[stroke-opacity] hover:[stroke-opacity:0.7]"
    />
  )
}

function JourneyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload?.payload
  if (!item?.source) return null
  return (
    <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink shadow-float">
      <p>{item.source.name} → {item.target.name}</p>
      <p className="mt-1 tabular-nums text-ink">{fmt(item.value)} journeys</p>
      <p className="text-xs text-ink-3">
        {fmt(item.observed)} observed · {fmt(item.inferred)} strongly inferred
      </p>
    </div>
  )
}

export default function JourneyLayers({ paths }) {
  const data = buildJourneySankey(paths)
  const total = paths.reduce((sum, path) => sum + path.n, 0)

  return (
    <Panel
      title="Journey layers: how modes connect"
      subtitle="Origin mode → transfer hub → next mode → destination zone"
      className="lg:col-span-2"
      actions={<span className="text-xs tabular-nums text-ink-3">{fmtCompact(total)} supported chains</span>}
    >
      <div className="mb-3 grid grid-cols-4 text-center text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <span>Origin mode</span>
        <span>Transfer hub</span>
        <span>Next mode</span>
        <span>Destination</span>
      </div>
      <div className="h-[470px]">
        <ResponsiveContainer>
          <Sankey
            data={data}
            node={<JourneyNode />}
            link={<JourneyLink />}
            nodePadding={14}
            nodeWidth={9}
            iterations={24}
            margin={{ top: 8, right: 100, bottom: 8, left: 100 }}
          >
            <Tooltip content={<JourneyTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span>Band width = passenger volume</span>
        <span>Stronger colour = more observed evidence</span>
        <span>Bus and ferry destinations may be inferred from the next tap</span>
      </div>
    </Panel>
  )
}
