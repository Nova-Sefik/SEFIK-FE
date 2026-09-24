import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { GROUPS, GROUP_COLOR, GROUP_LABEL, MUTED, fmt, fmtCompact } from '../components/theme'
import Panel from './Panel'

// Left column = first boarding, right column = next boarding within the window
function buildSankey(flows) {
  const nodes = [
    ...GROUPS.map((g) => ({ name: GROUP_LABEL[g], group: g, side: 'from' })),
    ...GROUPS.map((g) => ({ name: GROUP_LABEL[g], group: g, side: 'to' })),
  ]
  const links = flows.map((f) => ({
    source: GROUPS.indexOf(f.from),
    target: GROUPS.length + GROUPS.indexOf(f.to),
    value: f.n,
  }))
  return { nodes, links }
}

function FlowNode({ x, y, width, height, payload }) {
  const left = payload.side === 'from'
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={GROUP_COLOR[payload.group]} />
      {height > 10 && (
        <text
          x={left ? x - 8 : x + width + 8}
          y={y + height / 2}
          textAnchor={left ? 'end' : 'start'}
          dominantBaseline="middle"
          fontSize={12}
          fill="#3c4043"
        >
          {payload.name}
        </text>
      )}
    </g>
  )
}

function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={GROUP_COLOR[payload.source.group]}
      strokeOpacity={0.3}
      strokeWidth={linkWidth}
      className="transition-[stroke-opacity] hover:[stroke-opacity:0.6]"
    />
  )
}

function FlowTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload?.payload
  if (!item?.source) return null
  return (
    <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink shadow-float">
      {item.source.name} → {item.target.name}
      <span className="ml-2 tabular-nums text-ink">{fmt(item.value)}</span>
    </div>
  )
}

export default function TransferFlows({ flows, metroOD, windowMin }) {
  const data = buildSankey(flows)
  const maxOD = metroOD[0]?.n ?? 1

  return (
    <Panel
      title="How journeys connect"
      subtitle={`Same card boarding a different line within ${windowMin} min: first boarding (left) to next boarding (right)`}
      className="lg:col-span-2"
    >
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="h-80">
          <ResponsiveContainer>
            <Sankey
              data={data}
              node={<FlowNode />}
              link={<FlowLink />}
              nodePadding={24}
              nodeWidth={10}
              iterations={0}
              margin={{ top: 8, right: 150, bottom: 8, left: 150 }}
            >
              <Tooltip content={<FlowTooltip />} />
            </Sankey>
          </ResponsiveContainer>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium text-ink">Top Metro trips, entry to exit</h3>
          <p className="mb-3 text-xs text-ink-3">Metro records exits, so these are true origin–destination pairs</p>
          <ol className="flex flex-col gap-2">
            {metroOD.slice(0, 8).map((od) => (
              <li key={`${od.from}-${od.to}`} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate text-ink">
                    {od.from} <span className="text-ink-3">→</span> {od.to}
                  </span>
                  <span className="tabular-nums text-ink-3">{fmtCompact(od.n)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(od.n / maxOD) * 100}%`, background: GROUP_COLOR.metro }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mt-3 text-xs" style={{ color: MUTED }}>
        Hover a band to see the number of transfers.
      </p>
    </Panel>
  )
}
