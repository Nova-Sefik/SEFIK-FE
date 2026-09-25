import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ABOVE, FLOW_COLOR, GRID, MUTED, OPPORTUNITY_COLOR, OPPORTUNITY_LIGHT, fmt } from '../components/theme'
import HourVsTypical from '../journeys/HourVsTypical'
import JourneySankey from '../journeys/JourneySankey'
import PathList from '../journeys/PathList'
import { coverageSuggestions, formatHours } from '../journeys/coverage'
import { useLiveData } from '../live/LiveDataContext'
import { hourLabel } from '../live/utils'
import { VIEW_LABELS, chartsFor } from './charts'
import DirectionalMap from './DirectionalMap'

const TITLES = {
  route_opportunities: 'Direct-link opportunities',
  demand_supply: 'Demand versus supply',
  anomalies: 'Observed demand versus same-time baseline',
  journey_path_traffic: 'Journeys along paths',
  hour_vs_average: 'This hour versus typical',
}

const MAP_TITLES = {
  route: 'Direct-link directions',
  supply: 'Demand by stop',
  transfer: 'Interchanges and transfer waits',
  anomaly: 'Unusual stop-hours',
  journey: 'Where journeys go',
}

const COMPARE_UNITS = { stop_boardings: 'boardings', network_boardings: 'boardings', line_boardings: 'boardings', transfers: 'transfers' }

function JourneyTraffic({ context }) {
  const journey = context.journey
  if (!journey) return null
  const { totals } = journey
  return (
    <div className="h-full overflow-y-auto pr-1">
      <p className="mb-3 text-xs text-ink-3">
        {fmt(totals.shown_volume)} journeys on {fmt(totals.shown_paths)} paths
        {totals.below_min_volume > 0 && ` · ${fmt(totals.below_min_volume)} in paths under the minimum volume`}
        {totals.below_privacy_threshold > 0 && ` · ${fmt(totals.below_privacy_threshold)} in paths under ${journey.privacy_min} (counted, never listed)`}
        {!journey.coverage.complete && ' · period not fully covered by the source data'}
      </p>
      <JourneySankey sankey={journey.sankey} />
      <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-ink-3">Paths · busiest first</h3>
      <PathList paths={context.evidence} />
      <p className="mt-3 text-[10px] leading-4 text-ink-4">{journey.method}</p>
    </div>
  )
}

function GraphTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="max-w-xs rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-float">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="flex items-center justify-between gap-5 text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
            {item.name}
          </span>
          <span className="tabular-nums text-ink">{fmt(item.value)}</span>
        </p>
      ))}
    </div>
  )
}

function HorizontalBars({ data, bars, domain, labelWidth = 150 }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 34, bottom: 24, left: 8 }} barGap={2}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          domain={domain}
          stroke={MUTED}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          fontSize={11}
          tickFormatter={(value) => new Intl.NumberFormat('en', { notation: 'compact' }).format(value)}
        />
        <YAxis type="category" dataKey="label" width={labelWidth} stroke={MUTED} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip content={<GraphTooltip />} cursor={{ fill: '#202124', fillOpacity: 0.04 }} />
        <Legend wrapperStyle={{ fontSize: 11, color: MUTED }} />
        {bars.map((bar) => <Bar key={bar.dataKey} {...bar} radius={[0, 3, 3, 0]} isAnimationActive />)}
      </BarChart>
    </ResponsiveContainer>
  )
}

function RouteChart({ evidence }) {
  const data = evidence.slice(0, 8).map((row) => ({
    ...row,
    label: `${row.from} ↔ ${row.to}`,
  }))
  return (
    <HorizontalBars
      data={data}
      labelWidth={175}
      bars={[
        { dataKey: 'from_to', name: 'First direction', fill: OPPORTUNITY_COLOR, stackId: 'journeys' },
        { dataKey: 'to_from', name: 'Reverse direction', fill: OPPORTUNITY_LIGHT, stackId: 'journeys' },
      ]}
    />
  )
}

function SupplyChart({ evidence }) {
  const measure = evidence[0]?.measure
  const names = measure === 'boardings_vs_expected'
    ? ['Boardings', 'Expected baseline']
    : measure === 'estimated_load_vs_places'
      ? ['Estimated peak load', 'Places offered']
      : ['Validations per departure', 'Nominal capacity']
  const data = evidence.slice(0, 8).map((row) => ({
    ...row,
    label: row.stop,
  }))
  return (
    <HorizontalBars
      data={data}
      labelWidth={180}
      bars={[
        { dataKey: 'validations_per_departure', name: names[0], fill: FLOW_COLOR },
        { dataKey: 'nominal_capacity', name: names[1], fill: OPPORTUNITY_COLOR, fillOpacity: 0.58 },
      ]}
    />
  )
}

function AnomalyChart({ evidence }) {
  const data = evidence.slice(0, 8).map((row) => ({ ...row, label: `${row.stop} · ${row.period.split(' ')[0]}` }))
  return (
    <HorizontalBars
      data={data}
      labelWidth={180}
      bars={[
        { dataKey: 'expected', name: 'Expected', fill: '#9aa0a6' },
        { dataKey: 'observed', name: 'Observed', fill: ABOVE },
      ]}
    />
  )
}

// Friendly explanation instead of a bare error when a query returns nothing
function NoData({ context, onTryPeriod }) {
  const { meta } = useLiveData()
  const applied = context.applied_filters ?? {}
  const coverage = context.journey?.coverage
  const dayLabel = (date) => meta.data?.days?.find((item) => item.date === date)?.label ?? date

  if (context.intent === 'journey' && coverage && !coverage.complete) {
    const suggestions = coverageSuggestions(coverage, applied.day, applied.hour)
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-lg">
          <p className="text-base font-medium text-ink">No journey data for {dayLabel(applied.day)}{applied.hour != null ? ` at ${hourLabel(applied.hour)}` : ''} yet</p>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            Journey paths are built from part of this week’s raw validation files, and this period isn’t covered.
            {coverage.complete_hours.length ? ` On ${dayLabel(applied.day)} they cover ${formatHours(coverage.complete_hours)}.` : ` ${dayLabel(applied.day)} has no fully covered hours.`}
          </p>
          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((item) => (
                <button key={`${item.date}-${item.hour}`} type="button" onClick={() => onTryPeriod?.(item)} className="rounded-full border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft-2">
                  Show {dayLabel(item.date)} {hourLabel(item.hour)}
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-ink-4">Stop demand, crowded lines, transfers and unusual activity cover the whole week.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-lg">
        <p className="text-base font-medium text-ink">Nothing to show{applied.human_summary ? ` for ${applied.human_summary}` : ''}</p>
        <p className="mt-2 text-sm leading-6 text-ink-3">Try another day or hour, fewer path stops, or a lower minimum volume. You can also just ask a question below.</p>
        {context.filter_limitations?.length > 0 && (
          <details className="mt-3 text-left text-[11px] leading-4 text-ink-4">
            <summary className="cursor-pointer text-center text-ink-3">Why might this be empty?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">{context.filter_limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  )
}

export default function AssistantChart({ response, onViewChange, onTryPeriod }) {
  const { context } = response
  const type = response.chart.type
  const evidence = context.evidence ?? []
  const views = chartsFor(context)
  const title = type === 'mobility_map' ? (MAP_TITLES[context.intent] ?? 'Map') : TITLES[type]
  const summary = context.applied_filters?.human_summary

  return (
    <section className="relative h-full overflow-hidden rounded-3xl border border-line bg-surface p-4 sm:p-6">
      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-2 sm:left-6 sm:right-6">
        <div className="flex min-w-0 items-center gap-2">
          <p className="hidden max-w-64 truncate rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 sm:block" title={title}>
            {title}
          </p>
          {views.length > 1 && (
            <div className="flex shrink-0 rounded-full border border-line bg-surface p-0.5 shadow-card" aria-label="Choose graph or map view">
              {views.map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => onViewChange(view)}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition ${type === view ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle hover:text-ink'}`}
                >
                  {VIEW_LABELS[view]}
                </button>
              ))}
            </div>
          )}
        </div>
        {summary && (
          <p className="hidden max-w-[45%] truncate rounded-full border border-line bg-surface px-3 py-1 text-[10px] text-ink-3 md:block" title={summary}>
            {summary}
          </p>
        )}
      </div>
      <div className="h-full pt-8">
        {!evidence.length && type !== 'hour_vs_average' && <NoData context={context} onTryPeriod={onTryPeriod} />}
        {evidence.length > 0 && type === 'mobility_map' && (
          <DirectionalMap evidence={evidence} intent={context.intent} overlays={response.mapOverlays ?? []} />
        )}
        {evidence.length > 0 && type === 'route_opportunities' && <RouteChart evidence={evidence} />}
        {evidence.length > 0 && type === 'demand_supply' && <SupplyChart evidence={evidence} />}
        {evidence.length > 0 && type === 'anomalies' && <AnomalyChart evidence={evidence} />}
        {evidence.length > 0 && type === 'journey_path_traffic' && <JourneyTraffic context={context} />}
        {type === 'hour_vs_average' && (context.comparison ? (
          <div className="h-full overflow-y-auto pr-1">
            <HourVsTypical comparison={context.comparison} unit={COMPARE_UNITS[context.measure] ?? 'journeys'} />
          </div>
        ) : <NoData context={context} onTryPeriod={onTryPeriod} />)}
      </div>
      {type === 'demand_supply' && evidence.length > 0 && (
        <p className="absolute bottom-4 left-6 right-6 text-center text-[10px] text-ink-4">
          {evidence[0]?.measure === 'estimated_load_vs_places'
            ? 'Estimated peak on-board load versus places offered. Load is inferred from boardings, not measured occupancy.'
            : 'Observed boardings versus the same-time expected baseline. Expected is not vehicle capacity.'}
        </p>
      )}
    </section>
  )
}
