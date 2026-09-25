import { Area, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compact, hourLabel, integer } from '../live/utils'

// Renders a backend comparison block exactly: current, typical and the
// differences are backend values; the chart never derives its own.
const STATUS_TEXT = {
  incomplete_coverage: 'Not fully covered by the source data',
  insufficient_baseline: 'Not enough comparable days',
  below_privacy_threshold: 'Below the privacy threshold',
}

function signed(value, suffix = '') {
  if (value == null) return '–'
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${integer.format(Math.abs(value))}${suffix}`
}

function Stat({ label, value, tone = 'text-ink' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-ink-3">{label}</p>
    </div>
  )
}

export default function HourVsTypical({ comparison, hour, unit = 'journeys', compact: small = false }) {
  if (!comparison) return null
  const selected = comparison.hours_compared.length === 1 ? comparison.hours_compared[0] : hour
  const data = comparison.hourly.map((item) => ({ ...item, label: hourLabel(item.hour) }))
  const pctTone = comparison.difference_pct == null ? 'text-ink' : comparison.difference_pct >= 0 ? 'text-danger' : 'text-primary-ink'
  const period = comparison.hours_compared.length === 1 ? hourLabel(comparison.hours_compared[0])
    : comparison.hours_compared.length ? `${comparison.hours_compared.length} covered hours` : 'no covered hours'

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={`${period} · ${unit}`} value={comparison.current == null ? '–' : integer.format(comparison.current)} />
        <Stat label={`Typical · ${comparison.sample_days} other ${comparison.day_type === 'weekend' ? 'weekend days' : 'weekdays'}`} value={comparison.typical == null ? '–' : integer.format(comparison.typical)} />
        <Stat label={comparison.difference == null ? 'Difference' : `${signed(comparison.difference)} ${unit}`} value={signed(comparison.difference_pct, '%')} tone={pctTone} />
      </div>
      {comparison.status !== 'ok' && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-4 text-warn">
          {STATUS_TEXT[comparison.status] ?? comparison.status}. {comparison.note}
        </p>
      )}
      {comparison.status === 'ok' && comparison.note && <p className="text-[10px] text-ink-4">{comparison.note}</p>}
      <div style={{ height: small ? 150 : 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke="#e8eaed" />
            <XAxis dataKey="hour" tickFormatter={(value) => (value === 24 ? '00' : String(value).padStart(2, '0'))} ticks={[6, 9, 12, 15, 18, 21, 24]} tick={{ fontSize: 10, fill: '#80868b' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#80868b' }} tickFormatter={(value) => compact.format(value)} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              labelFormatter={(value) => hourLabel(Number(value))}
              formatter={(value, name) => [value == null ? 'not available' : integer.format(value), name]}
              contentStyle={{ border: '1px solid #dadce0', borderRadius: 10, fontSize: 11 }}
            />
            <Area
              dataKey="typical"
              name="Typical"
              type="monotone"
              fill="#dadce0"
              fillOpacity={0.72}
              stroke="#9aa0a6"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Bar dataKey="current" name="This day" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((item) => <Cell key={item.hour} fill={item.hour === selected ? '#1967d2' : item.complete ? '#aecbfa' : '#e8eaed'} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary" />Selected day</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[#dadce0]" />Typical in the background</span>
      </div>
      <p className="text-[10px] leading-4 text-ink-4">
        Bars = this day (pale grey = hour not fully covered); the soft grey area behind them = typical. {comparison.method}
        {comparison.baseline_days.length > 0 && ` Compared with ${comparison.baseline_days.map((day) => day.date).join(', ')}.`}
      </p>
    </div>
  )
}
