import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { integer } from '../live/utils'

// Drawn from the backend's sankey block exactly as returned: every shown path
// contributes, and "Other" / "Unknown destination" nodes are real groups, not cuts.
const NODE_FILL = { stop: null, other: '#bdc1c6', more: '#bdc1c6', unknown: '#dadce0' }
const LAYER_FILL = ['#1a73e8', '#8430ce', '#b06000', '#b06000', '#188038']

function layerFill(layer, lastLayer) {
  if (layer === 0) return LAYER_FILL[0]
  if (layer === lastLayer) return LAYER_FILL[4]
  return LAYER_FILL[Math.min(layer, 3)]
}

function makeNode(lastLayer) {
  return function JourneyNode({ x, y, width, height, payload }) {
    const right = payload.layer === lastLayer || (payload.layer > 0 && payload.layer >= lastLayer / 2)
    const fill = NODE_FILL[payload.kind] ?? layerFill(payload.layer, lastLayer)
    return (
      <g>
        <rect x={x} y={y} width={width} height={Math.max(height, 1)} rx={1} fill={fill} />
        <text
          x={right ? x + width + 6 : x - 6}
          y={y + height / 2}
          textAnchor={right ? 'start' : 'end'}
          dominantBaseline="middle"
          fontSize={10}
          fill={payload.kind === 'stop' ? '#3c4043' : '#80868b'}
        >
          {payload.name}
        </text>
      </g>
    )
  }
}

function JourneyLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={payload.source.kind === 'stop' ? '#8ab4f8' : '#dadce0'}
      strokeOpacity={0.45}
      strokeWidth={Math.max(linkWidth, 0.5)}
      className="transition-[stroke-opacity] hover:[stroke-opacity:0.8]"
    />
  )
}

function SankeyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload?.payload
  if (!item) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink shadow-float">
      <p>{item.source ? `${item.source.name} → ${item.target.name}` : item.name}</p>
      <p className="mt-1 tabular-nums">{integer.format(item.value)} journeys</p>
    </div>
  )
}

export default function JourneySankey({ sankey }) {
  if (!sankey?.links?.length) {
    return <p className="rounded-xl bg-subtle p-6 text-center text-sm text-ink-3">No paths at or above the thresholds.</p>
  }
  const lastLayer = sankey.layers.length - 1
  const rows = Math.max(4, ...sankey.layers.map((_, layer) => sankey.nodes.filter((node) => node.layer === layer).length))
  return (
    <div>
      <div className="mb-2 grid text-center text-[10px] font-medium uppercase tracking-wide text-ink-3" style={{ gridTemplateColumns: `repeat(${sankey.layers.length}, minmax(0, 1fr))` }}>
        {sankey.layers.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div style={{ height: Math.max(320, rows * 22 + 24) }}>
        <ResponsiveContainer>
          <Sankey
            data={{ nodes: sankey.nodes, links: sankey.links }}
            node={makeNode(lastLayer)}
            link={<JourneyLink />}
            align="justify"
            nodePadding={rows > 12 ? 12 : 16}
            nodeWidth={8}
            iterations={32}
            margin={{ top: 8, right: 170, bottom: 8, left: 130 }}
          >
            <Tooltip content={<SankeyTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
