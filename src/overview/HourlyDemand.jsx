import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { GRID, GROUP_COLOR, GROUP_LABEL, MUTED, fmt, fmtCompact } from '../components/theme'
import Panel from './Panel'

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`

function HourTooltip({ active, payload, label, groups }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (!row.samples) return null
  return (
    <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm shadow-float">
      <p className="mb-1 font-medium text-ink">{hourLabel(label)}</p>
      {groups.map((g) => (
        <p key={g} className="flex items-center gap-2 text-ink-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} />
          <span className="flex-1">{GROUP_LABEL[g]}</span>
          <span className="tabular-nums text-ink">{fmt(row[g])}</span>
        </p>
      ))}
      <p className="mt-1 text-xs text-ink-3">
        Average of {row.samples} weekday hour{row.samples > 1 ? 's' : ''}
      </p>
    </div>
  )
}

export default function HourlyDemand({ hourly, groups }) {
  return (
    <Panel title="When people travel" subtitle="Average boardings per hour, weekdays 31 Aug to 4 Sep">
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        {groups.map((g) => (
          <li key={g} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: GROUP_COLOR[g] }} />
            {GROUP_LABEL[g]}
          </li>
        ))}
      </ul>
      <div className="min-h-72 flex-1">
        <ResponsiveContainer>
          <LineChart data={hourly} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 23]}
              tickFormatter={hourLabel}
              ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
              stroke={MUTED}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              fontSize={12}
            />
            <YAxis tickFormatter={fmtCompact} stroke={MUTED} tickLine={false} axisLine={false} fontSize={12} />
            <ReferenceArea
              x1={13.5}
              x2={16.5}
              fill="#202124"
              fillOpacity={0.04}
              label={{ value: 'no data', position: 'insideTop', fill: MUTED, fontSize: 12 }}
            />
            <Tooltip content={<HourTooltip groups={groups} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
            {groups.map((g) => (
              <Line
                key={g}
                dataKey={g}
                name={GROUP_LABEL[g]}
                stroke={GROUP_COLOR[g]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
