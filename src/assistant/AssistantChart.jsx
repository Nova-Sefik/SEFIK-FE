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
import { ABOVE, FLOW_COLOR, FLOW_TINTS, GRID, MUTED, OPPORTUNITY_COLOR, OPPORTUNITY_LIGHT, fmt } from '../components/theme'
import HourVsTypical from '../journeys/HourVsTypical'
import JourneySankey from '../journeys/JourneySankey'
import PathList from '../journeys/PathList'
import JourneyLayers from '../overview/JourneyLayers'
import AssistantTimeline from './AssistantTimeline'
import DirectionalMap from './DirectionalMap'
import FeasibilityChart from './FeasibilityChart'

const TITLES = {
  mobility_map: 'Passenger movement and route directions',
  route_opportunities: 'Direct-link opportunities',
  route_feasibility: 'Route feasibility comparison',
  demand_supply: 'Direct demand versus supply comparison',
  journey_layers: 'How journeys connect across modes',
  anomalies: 'Observed demand versus same-time baseline',
  passenger_flows: 'Strongest passenger flows',
  journey_path_traffic: 'Journeys along paths',
  hour_vs_average: 'This hour versus typical',
}

const INTENT_TITLES = {
  route: 'Direct-link directions',
  supply: 'Demand and supply by stop',
  transfer: 'Transfer paths by location',
  anomaly: 'Demand anomalies by stop',
  flow: 'Passenger movement and traffic levels',
  journey: 'Journey paths on the map',
  compare: 'This hour versus typical',
}

const VIEWS = {
  route: [{ type: 'mobility_map', label: 'Map' }, { type: 'route_opportunities', label: 'Bars' }, { type: 'route_feasibility', label: 'Feasibility' }],
  supply: [{ type: 'mobility_map', label: 'Map' }, { type: 'demand_supply', label: 'Bars' }],
  transfer: [{ type: 'mobility_map', label: 'Map' }, { type: 'journey_layers', label: 'Sankey' }],
  anomaly: [{ type: 'mobility_map', label: 'Map' }, { type: 'anomalies', label: 'Bars' }],
  flow: [{ type: 'mobility_map', label: 'Map' }, { type: 'passenger_flows', label: 'Bars' }],
  journey: [{ type: 'mobility_map', label: 'Map' }, { type: 'journey_path_traffic', label: 'Paths' }, { type: 'hour_vs_average', label: 'vs typical' }],
  compare: [{ type: 'hour_vs_average', label: 'vs typical' }],
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

function FlowChart({ evidence }) {
  const data = evidence.slice(0, 9).map((row) => ({ ...row, label: `${row.from} → ${row.to}` }))
  return (
    <HorizontalBars
      data={data}
      labelWidth={180}
      bars={[
        { dataKey: 'observed', name: 'Observed', fill: FLOW_COLOR, stackId: 'evidence' },
        { dataKey: 'strongly_inferred', name: 'Strongly inferred', fill: FLOW_TINTS[1], stackId: 'evidence' },
        { dataKey: 'weakly_inferred', name: 'Weakly inferred', fill: FLOW_TINTS[2], stackId: 'evidence' },
      ]}
    />
  )
}

function EmptyGraph({ limitations }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-lg">
        <p className="text-sm font-medium text-ink-2">No evidence matches this combination.</p>
        <p className="mt-2 text-xs leading-5 text-ink-3">Try widening the locations, modes, lines, dates, or time window.</p>
        {limitations?.map((item) => <p key={item} className="mt-2 text-[11px] leading-4 text-warn">{item}</p>)}
      </div>
    </div>
  )
}

export default function AssistantChart({ response, filterLabel, filters, onFiltersChange, onViewChange }) {
  const type = response.chart.type
  const evidence = response.context.evidence
  const limitations = response.context.filter_limitations
  const intent = response.context.intent === 'limits' ? 'route' : response.context.intent
  const views = VIEWS[intent] ?? []
  const title = type === 'mobility_map' ? (INTENT_TITLES[intent] ?? TITLES[type]) : TITLES[type]
  const supportsTimeline = !['transfer', 'journey', 'compare'].includes(intent) && type !== 'route_feasibility'

  return (
    <section className="relative h-[calc(100vh-13rem)] min-h-[34rem] overflow-hidden rounded-3xl border border-line bg-surface p-4 sm:p-6">
      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-2 sm:left-6 sm:right-6">
        <div className="flex min-w-0 items-center gap-2">
          <p className="hidden max-w-64 truncate rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 sm:block" title={title}>
            {title}
          </p>
          {views.length > 1 && (
            <div className="flex shrink-0 rounded-full border border-line bg-surface p-0.5 shadow-card" aria-label="Choose graph or map view">
              {views.map((view) => (
                <button
                  key={view.type}
                  type="button"
                  onClick={() => onViewChange(view.type)}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition ${type === view.type ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle hover:text-ink'}`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="hidden max-w-[45%] truncate rounded-full border border-line bg-surface px-3 py-1 text-[10px] text-ink-3 md:block" title={filterLabel}>
          {filterLabel}
        </p>
      </div>
      <div className={`h-full pt-8 ${supportsTimeline ? 'pb-16' : ''}`}>
        {!evidence.length && <EmptyGraph limitations={limitations} />}
        {evidence.length > 0 && type === 'mobility_map' && (
          <DirectionalMap evidence={evidence} intent={intent} overlays={response.mapOverlays ?? []} />
        )}
        {evidence.length > 0 && type === 'route_opportunities' && <RouteChart evidence={evidence} />}
        {type === 'route_feasibility' && <FeasibilityChart rows={response.feasibility ?? []} />}
        {evidence.length > 0 && type === 'demand_supply' && <SupplyChart evidence={evidence} />}
        {evidence.length > 0 && type === 'journey_layers' && (
          <div className="h-full overflow-y-auto">
            <JourneyLayers paths={evidence} locationFilter={false} />
          </div>
        )}
        {evidence.length > 0 && type === 'anomalies' && <AnomalyChart evidence={evidence} />}
        {evidence.length > 0 && type === 'passenger_flows' && <FlowChart evidence={evidence} />}
        {evidence.length > 0 && type === 'journey_path_traffic' && <JourneyTraffic context={response.context} />}
        {type === 'hour_vs_average' && response.context.comparison && (
          <div className="h-full overflow-y-auto pr-1">
            <HourVsTypical comparison={response.context.comparison} unit={COMPARE_UNITS[response.context.measure] ?? 'journeys'} />
          </div>
        )}
      </div>
      {type === 'demand_supply' && evidence.length > 0 && (
        <p className="absolute bottom-16 left-6 right-6 text-center text-[10px] text-ink-4">
          {evidence[0]?.measure === 'boardings_vs_expected'
            ? 'Live backend comparison: observed boardings versus the same-time expected baseline. Expected is not vehicle capacity.'
            : evidence[0]?.measure === 'estimated_load_vs_places'
              ? 'Live backend comparison: estimated peak on-board load versus places offered. Load is inferred, not measured occupancy.'
              : 'Demand = validations per scheduled departure · Supply = nominal vehicle capacity · This is a pressure proxy, not measured occupancy.'}
        </p>
      )}
      {supportsTimeline && <AssistantTimeline filters={filters} onChange={onFiltersChange} />}
    </section>
  )
}
