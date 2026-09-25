import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import HourVsTypical from '../journeys/HourVsTypical'
import JourneySankey from '../journeys/JourneySankey'
import { liveApi } from '../live/api'
import { useLiveData } from '../live/LiveDataContext'
import useLiveQuery from '../live/useLiveQuery'
import { ALL_OPERATORS, compact, hourLabel, integer, pct } from '../live/utils'
import Panel from './Panel'

// Week overview: every number comes from the live backend. The browser only formats.
const ALL = { ops: ALL_OPERATORS, segment: 'all' }

function Message({ children, tone = 'text-ink-3 bg-subtle' }) {
  return <p className={`rounded-xl px-3 py-6 text-center text-sm ${tone}`}>{children}</p>
}

function DayCard({ day, overview, selected, onSelect }) {
  const kpis = overview?.kpis
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border px-3 py-3 text-left transition ${selected ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-subtle'}`}
    >
      <p className={`text-xs font-medium ${selected ? 'text-primary-ink' : 'text-ink-2'}`}>{day.label}{day.is_weekend ? ' · weekend' : ''}</p>
      <p className="mt-1 text-xl tabular-nums text-ink">{kpis ? compact.format(kpis.boardings) : '…'}</p>
      <p className="text-[10px] text-ink-3">boardings{kpis ? ` · peak ${hourLabel(kpis.busiest_hour)}` : ''}</p>
      {kpis && <p className="mt-1 text-[10px] text-ink-4">{compact.format(kpis.transfers)} transfers · {kpis.alerts} alerts</p>}
    </button>
  )
}

export default function OverviewPage() {
  const { meta, day, setDay } = useLiveData()
  const days = meta.data?.days ?? []
  const operatorById = Object.fromEntries((meta.data?.operators ?? []).map((item) => [item.id, item]))

  const week = useLiveQuery(
    `week-overview|${days.map((item) => item.date).join(',')}`,
    () => Promise.all(days.map((item) => liveApi.overview({ day: item.date, ...ALL }))),
    { enabled: days.length > 0 },
  )
  const byDay = Object.fromEntries((week.data ?? []).map((item) => [item.date, item]))
  const selected = byDay[day]
  const busiest = selected?.kpis.busiest_hour
  const peakComparison = useLiveQuery(
    `overview-compare|${day}|${busiest}`,
    () => liveApi.compare({ measure: 'network_boardings', day, hour: busiest }),
    { enabled: busiest != null },
  )
  const transfers = useLiveQuery(`overview-transfers|${day}`, () => liveApi.transfers(day), { enabled: days.length > 0 })
  const journeys = useLiveQuery(
    `overview-journeys|${day}`,
    () => liveApi.journeyTraffic({ day, limit: 20, compare: false }),
    { enabled: days.length > 0 },
  )

  if (meta.error) {
    return <main className="min-h-screen bg-page p-8"><Message tone="bg-danger-soft text-danger">{meta.error.message}</Message></main>
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header>
          <div className="flex flex-wrap gap-4 text-sm">
            <a href="#/" className="text-primary-ink hover:underline">← Back to the explorer</a>
            <a href="#/assistant" className="text-primary-ink hover:underline">Ask AI planner →</a>
          </div>
          <p className="mt-3 text-sm font-medium text-primary-ink">Hack the City · Challenge #1 · Week overview</p>
          <h1 className="mt-1 text-3xl text-ink">Passenger demand in the Lisbon Metropolitan Area</h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-3">
            {meta.data?.note ?? 'Loading…'} Every number on this page comes from the live mobility backend, for all operators and passengers.
          </p>
        </header>

        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">The week at a glance</h2>
          {week.error && <Message tone="bg-danger-soft text-danger">{week.error.message}</Message>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {days.map((item) => <DayCard key={item.date} day={item} overview={byDay[item.date]} selected={item.date === day} onSelect={() => setDay(item.date)} />)}
          </div>
        </section>

        {!selected ? <Message>Loading {day}…</Message> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Boardings by hour" subtitle={`${days.find((item) => item.date === day)?.label} · busiest hour ${hourLabel(busiest)}`}>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={selected.network_hourly} margin={{ top: 6, right: 4, bottom: 0, left: -10 }}>
                    <CartesianGrid vertical={false} stroke="#e8eaed" />
                    <XAxis dataKey="hour" tickFormatter={(value) => (value === 24 ? '00' : String(value).padStart(2, '0'))} ticks={[6, 9, 12, 15, 18, 21, 24]} tick={{ fontSize: 10, fill: '#80868b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#80868b' }} tickFormatter={(value) => compact.format(value)} tickLine={false} axisLine={false} width={44} />
                    <Tooltip labelFormatter={(value) => hourLabel(Number(value))} formatter={(value) => [integer.format(value), 'Boardings']} contentStyle={{ border: '1px solid #dadce0', borderRadius: 10, fontSize: 11 }} />
                    <Bar dataKey="boardings" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {selected.network_hourly.map((item) => <Cell key={item.hour} fill={item.hour === busiest ? '#1967d2' : '#aecbfa'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Busiest hour versus typical" subtitle="Whole network, same hour on the other days of the same type">
              {peakComparison.data ? <HourVsTypical comparison={peakComparison.data.comparison} unit="boardings" compact />
                : <Message>{peakComparison.error?.message ?? 'Loading comparison…'}</Message>}
            </Panel>

            <Panel title="Boardings by operator">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {selected.operator_share.filter((item) => item.share > 0).map((item) => <span key={item.operator} style={{ flex: item.share, background: operatorById[item.operator]?.color || '#9aa0a6' }} />)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                {selected.operator_share.map((item) => (
                  <div key={item.operator} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: operatorById[item.operator]?.color || '#9aa0a6' }} />
                    <span className="min-w-0 flex-1 truncate text-ink-3">{operatorById[item.operator]?.name || item.operator}</span>
                    <span className="tabular-nums text-ink">{pct(item.share)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Busiest interchanges" subtitle="Cross-operator transfers within 60 minutes">
              <div className="-mx-2">
                {selected.top_interchanges.map((item) => (
                  <div key={item.stop_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                    <span className="tabular-nums text-ink-3">{integer.format(item.transfers)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Most common cross-operator journeys" subtitle="Origin → interchanges → destination, per day" className="lg:col-span-2">
              {transfers.data ? (
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {transfers.data.flows.slice(0, 12).map((flow) => (
                    <div key={`${flow.from_stop_id}>${flow.to_stop_id}`} className="flex items-center gap-3 border-b border-line-soft py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-ink-2">{[flow.from_name, ...(flow.via ?? []).map((place) => place.name), flow.to_name].join(' → ')}</span>
                      <span className="tabular-nums text-ink-3">{integer.format(flow.journeys)}</span>
                    </div>
                  ))}
                </div>
              ) : <Message>{transfers.error?.message ?? 'Loading journeys…'}</Message>}
            </Panel>

            <Panel title="Journeys along paths" subtitle="Whole day, by tap sequence: busiest 20 places per column" className="lg:col-span-2">
              {journeys.data ? (
                <>
                  <p className="mb-3 text-xs text-ink-3">
                    {integer.format(journeys.data.totals.shown_volume)} journeys on {integer.format(journeys.data.totals.shown_paths)} paths
                    {' · '}{integer.format(journeys.data.totals.below_privacy_threshold)} more in paths under {journeys.data.privacy_min} (counted, never listed)
                    {!journeys.data.coverage.complete || journeys.data.coverage.complete_hours.length < (meta.data?.hours?.length ?? 20)
                      ? ` · journey data fully covers ${journeys.data.coverage.complete_hours.length} of this day's hours` : ''}
                  </p>
                  <JourneySankey sankey={journeys.data.sankey} />
                  <p className="mt-2 text-[10px] leading-4 text-ink-4">{journeys.data.method}</p>
                </>
              ) : <Message>{journeys.error?.message ?? 'Loading journey paths…'}</Message>}
            </Panel>
          </div>
        )}

        <p className="text-[11px] leading-5 text-ink-4">
          Boardings are entry validations. Transfers and journeys link taps by the same anonymous card, so groups under the backend’s privacy threshold are counted in totals but never shown on their own. Journey paths are tap sequences, not vehicle routes.
        </p>
      </div>
    </main>
  )
}
