import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { liveApi } from './api'
import { useLiveData } from './LiveDataContext'
import useLiveQuery from './useLiveQuery'
import { anomalyColor, applyWhatIf, compact, demandColor, hourLabel, integer, pct, signedPct, waitColor } from './utils'

const AXIS = { fontSize: 10, fill: '#80868b' }

function Loading({ label = 'Loading live data…' }) {
  return <div className="rounded-xl bg-subtle px-3 py-6 text-center text-sm text-ink-3">{label}</div>
}

function ErrorBox({ error }) {
  return <div className="rounded-xl border border-danger/25 bg-danger-soft p-3 text-sm leading-5 text-danger">{error?.message || 'The data could not be loaded.'}</div>
}

function SectionTitle({ children }) {
  return <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{children}</h3>
}

function Kpi({ value, label, detail, tone = '' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone || 'border-line bg-surface'}`}>
      <p className="text-xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-ink-3">{label}</p>
      {detail && <p className="mt-1 text-[10px] leading-4 text-ink-4">{detail}</p>}
    </div>
  )
}

function ExpectedTick({ cx, cy }) {
  if (cx == null || cy == null) return null
  return <line x1={cx - 7} x2={cx + 7} y1={cy} y2={cy} stroke="#202124" strokeWidth={2} strokeLinecap="round" />
}

function HourChart({ data, lineName, expectedName, onHour, height = 150 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} onClick={(event) => {
        const item = data[Number(event?.activeIndex)]
        if (item && onHour) onHour(item.hour)
      }}>
        <CartesianGrid vertical={false} stroke="#e8eaed" />
        <XAxis dataKey="hour" tickFormatter={(value) => value === 24 ? '00' : String(value).padStart(2, '0')} ticks={[6, 9, 12, 15, 18, 21, 24]} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickFormatter={(value) => compact.format(value)} tickLine={false} axisLine={false} width={44} />
        <Tooltip labelFormatter={(value) => hourLabel(Number(value))} formatter={(value, name) => [integer.format(value), name]} contentStyle={{ border: '1px solid #dadce0', borderRadius: 10, fontSize: 11 }} />
        <Bar dataKey="value" name="Observed" radius={[3, 3, 0, 0]} isAnimationActive={false}>{data.map((item) => <Cell key={item.hour} fill={item.fill || '#8ab4f8'} />)}</Bar>
        {lineName && <Line dataKey="line" name={lineName} type="stepAfter" stroke="#e8710a" strokeWidth={2} dot={false} isAnimationActive={false} />}
        {expectedName && <Scatter dataKey="expected" name={expectedName} shape={<ExpectedTick />} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function OverviewPanel() {
  const { meta, overview, anomalies, stops, day, setMode, openStop, setSelectedTransfer } = useLiveData()
  if (overview.error) return <ErrorBox error={overview.error} />
  if (!overview.data) return <Loading />
  const data = overview.data
  const operatorById = Object.fromEntries((meta.data?.operators ?? []).map((item) => [item.id, item]))
  const stopById = Object.fromEntries((stops.data?.stops ?? []).map((item) => [item.stop_id, item]))
  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="rounded-2xl bg-primary-soft p-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">AI-ready network view</p>
        <h2 className="mt-1 text-lg font-medium text-ink">How Lisbon moved</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">Every visible number now comes from the mobility backend. Ask the planner to interpret the current filters.</p>
        <a href="#/assistant" className="mt-3 inline-flex rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover">Ask AI about this view →</a>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Kpi value={compact.format(data.kpis.boardings)} label="Boardings with current filters" />
        <Kpi value={hourLabel(data.kpis.busiest_hour)} label="Busiest service hour" />
        <Kpi value={compact.format(data.kpis.transfers)} label="Cross-operator transfers" />
        <Kpi value={String(data.kpis.alerts)} label="Anomaly alerts today" />
      </section>

      <section>
        <SectionTitle>Boardings by operator</SectionTitle>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {data.operator_share.filter((item) => item.share > 0).map((item) => <span key={item.operator} style={{ flex: item.share, background: operatorById[item.operator]?.color || '#9aa0a6' }} />)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {data.operator_share.map((item) => (
            <div key={item.operator} className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: operatorById[item.operator]?.color || '#9aa0a6' }} />
              <span className="min-w-0 flex-1 truncate text-ink-3">{operatorById[item.operator]?.name || item.operator}</span>
              <span className="tabular-nums text-ink">{pct(item.share)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Busiest interchanges</SectionTitle>
        <div className="-mx-2">
          {data.top_interchanges.map((item) => (
            <button key={item.stop_id} type="button" onClick={() => {
              if (stopById[item.stop_id]) openStop(item.stop_id)
              else { setSelectedTransfer(item.stop_id); setMode('transfers') }
            }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-subtle">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>
              <span className="text-xs tabular-nums text-ink-3">{compact.format(item.transfers)} transfers</span>
              <span className="text-ink-4">›</span>
            </button>
          ))}
        </div>
      </section>

      <button type="button" onClick={() => setMode('anomalies')} className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn-soft p-3 text-left text-xs text-warn">
        <span className="text-base">△</span><span className="flex-1">{anomalies.data?.alerts?.length ?? data.kpis.alerts} unusual stop-hours need review</span><span>›</span>
      </button>

      <p className="text-[10px] leading-4 text-ink-4">{meta.data?.note} Current day: {day}. Counts represent entry validations; expected values are backend-provided baselines.</p>
    </div>
  )
}

function StopPanel() {
  const { meta, stopDetail, hour, setHour, day, setDay, setSelectedStop, setMode, setSelectedTransfer } = useLiveData()
  const stop = stopDetail.data
  if (stopDetail.error) return <div className="p-4"><button className="mb-3 text-xs text-primary-ink" onClick={() => setSelectedStop(null)}>← Network</button><ErrorBox error={stopDetail.error} /></div>
  if (!stop) return <div className="p-4"><Loading label="Loading stop profile…" /></div>
  const operatorById = Object.fromEntries((meta.data?.operators ?? []).map((item) => [item.id, item]))
  const hours = meta.data?.hours?.map((item) => item.hour) ?? stop.hourly.map((item) => item.hour)
  const max = meta.data?.scales?.stop_boardings_max || 1
  const facilities = [['shelter', 'Shelter'], ['step_free', 'Step-free'], ['realtime_display', 'Real-time display'], ['wheelchair_boarding', 'Wheelchair boarding']]
  return (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <button type="button" onClick={() => setSelectedStop(null)} className="mb-2 text-xs text-primary-ink hover:underline">← Network</button>
        <h2 className="text-lg font-medium text-ink">{stop.name}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">{stop.operators.map((id) => <span key={id} className="flex items-center gap-1.5 rounded-full bg-subtle px-2 py-1 text-[10px] text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: operatorById[id]?.color }} />{operatorById[id]?.name || id}</span>)}</div>
      </header>

      <section className="grid grid-cols-2 gap-2">
        <Kpi value={integer.format(stop.now.boardings)} label={`Boardings at ${hourLabel(hour)}`} />
        <Kpi value={signedPct(stop.now.deviation_pct)} label="Versus typical" detail={`${integer.format(stop.now.expected)} expected`} tone={Math.abs(stop.now.deviation_pct) >= 40 ? 'border-danger/25 bg-danger-soft' : 'border-line bg-surface'} />
      </section>

      <section>
        <SectionTitle>Across the day</SectionTitle>
        <HourChart expectedName="Expected" onHour={setHour} data={stop.hourly.map((item) => ({ hour: item.hour, value: item.boardings, expected: item.expected, fill: item.hour === hour ? '#1967d2' : '#aecbfa' }))} />
        <p className="mt-1 text-[10px] text-ink-4">Bars = boardings · black ticks = expected. Select an hour to update the map.</p>
      </section>

      <section>
        <SectionTitle>Week by hour</SectionTitle>
        <div className="space-y-1">
          {stop.week_grid.map((row) => (
            <div key={row.date} className="grid grid-cols-[2rem_repeat(20,minmax(0,1fr))] gap-0.5">
              <span className={`text-[9px] ${row.date === day ? 'font-medium text-primary-ink' : 'text-ink-4'}`}>{row.weekday}</span>
              {row.hourly.map((value, index) => <button key={`${row.date}-${index}`} type="button" title={`${row.weekday} ${hourLabel(hours[index])}: ${integer.format(value)}`} onClick={() => { setDay(row.date); setHour(hours[index]) }} className={`h-3 rounded-[2px] ${row.date === day && hours[index] === hour ? 'ring-2 ring-ink ring-offset-1' : ''}`} style={{ background: demandColor(value, max) }} />)}
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Passenger mix</SectionTitle>
        <div className="flex h-3 overflow-hidden rounded-full"><span style={{ flex: stop.mix.regular, background: '#1a73e8' }} /><span style={{ flex: stop.mix.sub23, background: '#e8710a' }} /><span style={{ flex: stop.mix.senior, background: '#188038' }} /></div>
        <div className="mt-2 flex justify-between text-[10px] text-ink-3"><span>Regular {pct(stop.mix.regular)}</span><span>Sub-23 {pct(stop.mix.sub23)}</span><span>65+ {pct(stop.mix.senior)}</span></div>
      </section>

      <section>
        <SectionTitle>Stop facilities</SectionTitle>
        <div className="flex flex-wrap gap-1.5">{facilities.map(([key, label]) => <span key={key} className={`rounded-full px-2 py-1 text-[10px] ${stop.facilities[key] ? 'bg-good-soft text-good' : 'bg-muted text-ink-4'}`}>{stop.facilities[key] ? '✓' : '×'} {label}</span>)}</div>
      </section>

      {stop.transfers_here && <button type="button" onClick={() => { setSelectedTransfer(stop.stop_id); setMode('transfers') }} className="flex items-center rounded-xl border border-line px-3 py-2.5 text-left text-xs hover:bg-subtle"><span className="flex-1">{integer.format(stop.transfers_here.transfers)} transfers/day</span><span className="text-ink-3">worst wait {stop.transfers_here.worst_median_wait_min} min ›</span></button>}

      <details className="text-[10px] leading-4 text-ink-4"><summary className="cursor-pointer text-ink-3">Operator stop IDs grouped into this hub</summary>{Object.entries(stop.operator_stop_ids).map(([operator, ids]) => <p key={operator} className="mt-1"><strong>{operatorById[operator]?.name || operator}:</strong> {ids.join(', ')}</p>)}</details>
    </div>
  )
}

function LinePanel() {
  const { meta, day, hour, setHour, selectedLine, setSelectedLine, whatif, setWhatif } = useLiveData()
  const lines = meta.data?.lines ?? []
  const activeId = selectedLine ?? lines[0]?.line_id
  const profile = useLiveQuery(`line-panel|${activeId}|${day}`, () => liveApi.line(activeId, day), { enabled: Boolean(activeId) })
  if (!lines.length) return <div className="p-4"><Loading label="No lines with trip-level capacity are available." /></div>
  if (profile.error) return <div className="p-4"><ErrorBox error={profile.error} /></div>
  if (!profile.data) return <div className="p-4"><Loading label="Loading capacity profile…" /></div>
  const data = profile.data
  const adjusted = applyWhatIf(data, whatif)
  const peakBefore = data.hours.reduce((best, item) => item.load_factor > best.load_factor ? item : best)
  const peakAfter = adjusted.reduce((best, item) => item.load_factor > best.load_factor ? item : best)
  return (
    <div className="flex flex-col gap-5 p-4">
      <header><p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Load vs capacity</p><h2 className="mt-1 text-lg font-medium text-ink">{data.mode === 'ferry' ? 'Ferry' : 'Line'} {data.label} · {data.name}</h2></header>
      <div className="flex gap-1 overflow-x-auto pb-1">{lines.map((line) => <button key={line.line_id} type="button" onClick={() => { setSelectedLine(line.line_id); setWhatif(0) }} className={`rounded-full px-3 py-1.5 text-[10px] ${line.line_id === activeId ? 'bg-primary text-white' : 'border border-line text-ink-3'}`}>{line.label}</button>)}</div>
      <section className="grid grid-cols-2 gap-2"><Kpi value={pct(peakAfter.load_factor)} label={`Tightest hour · ${hourLabel(peakAfter.hour)}`} tone={peakAfter.load_factor > 1 ? 'border-danger/25 bg-danger-soft' : 'border-line bg-surface'} /><Kpi value={integer.format(data.vehicle.places)} label="Places per vehicle" detail={`${data.vehicle.seats} seated + ${data.vehicle.standing} standing`} /></section>
      <section><HourChart lineName="Places offered" onHour={setHour} height={180} data={adjusted.map((item) => ({ hour: item.hour, value: item.est_peak_load, line: item.places_offered, fill: item.hour === hour ? '#1967d2' : item.load_factor > 1 ? '#d93025' : '#8ab4f8' }))} /><p className="mt-1 text-[10px] text-ink-4">Bars = estimated peak on-board load · orange line = places offered.</p></section>
      {data.whatif.move_to_hours.length > 0 && <section className="rounded-2xl border border-primary/20 bg-primary-soft p-4"><label className="flex items-center justify-between text-xs font-medium text-ink"><span>What if we re-time quiet trips into peaks?</span><span>{whatif} moved</span></label><input type="range" min="0" max={data.whatif.move_to_hours.length} value={whatif} onChange={(event) => setWhatif(Number(event.target.value))} className="mt-3 w-full accent-primary" /><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><span className="text-ink-3">Before</span><p className="font-semibold text-ink">{pct(peakBefore.load_factor)}</p></div><div><span className="text-ink-3">After</span><p className="font-semibold text-primary-ink">{pct(peakAfter.load_factor)}</p></div></div><p className="mt-3 text-[10px] leading-4 text-ink-3">Same fleet and crew hours: trips are re-timed, not added. {data.whatif.note}</p></section>}
      <p className="text-[10px] leading-4 text-ink-4">Capacity is supplied by the backend from vehicle and trip data. Estimated on-board load uses inferred alightings; it is not a direct occupancy measurement.</p>
    </div>
  )
}

function TransferPanel() {
  const { transfers, selectedTransfer, setSelectedTransfer, openStop } = useLiveData()
  if (transfers.error) return <div className="p-4"><ErrorBox error={transfers.error} /></div>
  if (!transfers.data) return <div className="p-4"><Loading label="Loading transfer evidence…" /></div>
  const data = transfers.data
  const selected = data.interchanges.find((item) => item.stop_id === selectedTransfer) ?? data.interchanges[0]
  return (
    <div className="flex flex-col gap-5 p-4">
      <header><p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Cross-operator journeys</p><h2 className="mt-1 text-lg font-medium text-ink">Where journeys change operator</h2></header>
      <section className="-mx-2">{data.interchanges.map((item) => <button key={item.stop_id} type="button" onClick={() => setSelectedTransfer(item.stop_id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${item.stop_id === selected?.stop_id ? 'bg-primary-soft' : 'hover:bg-subtle'}`}><span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>{item.fragile && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[9px] text-danger">Fragile</span>}<span className="text-[10px] tabular-nums text-ink-3">{compact.format(item.transfers)}/day</span></button>)}</section>
      {selected && <section className="rounded-2xl border border-line p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-ink">{selected.name}</h3><button type="button" onClick={() => openStop(selected.stop_id)} className="text-[10px] text-primary-ink hover:underline">Stop profile</button></div><div className="mt-3 space-y-2">{selected.pairs.map((pair) => <div key={`${pair.from_operator}-${pair.to_operator}`} className="grid grid-cols-[1fr_auto] gap-2 border-t border-line-soft pt-2 text-[11px]"><span className="text-ink-2">{pair.from_operator} → {pair.to_operator} · {integer.format(pair.transfers)}</span><span style={{ color: waitColor(pair.median_wait_min) }}>{pair.median_wait_min} min median</span></div>)}</div><div className="mt-3"><HourChart height={105} data={selected.hourly.map((item) => ({ hour: item.hour, value: item.transfers, fill: '#8ab4f8' }))} /></div>{selected.fragile && <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[10px] leading-4 text-danger">The worst significant connection has a median wait of {selected.worst_median_wait_min} minutes. Check whether departures can be timed to incoming services.</p>}</section>}
      <section><SectionTitle>Top journeys with a transfer</SectionTitle>{data.flows.slice(0, 5).map((flow) => <div key={`${flow.from_stop_id}-${flow.to_stop_id}`} className="flex gap-2 border-b border-line-soft py-2 text-[11px]"><span className="flex-1 text-ink-2">{flow.from_name} → {flow.to_name}</span><span className="tabular-nums text-ink-3">{compact.format(flow.journeys)}</span></div>)}</section>
      <p className="text-[10px] leading-4 text-ink-4">{data.method}</p>
    </div>
  )
}

function AnomalyPanel() {
  const { meta, anomalies, selectedAlert, setSelectedAlert, setDay, setHour, setSelectedStop, setMode } = useLiveData()
  if (anomalies.error) return <div className="p-4"><ErrorBox error={anomalies.error} /></div>
  if (!anomalies.data) return <div className="p-4"><Loading label="Loading anomaly evidence…" /></div>
  const data = anomalies.data
  const selected = data.alerts.find((item) => item.alert_id === selectedAlert)
  const weekday = (date) => meta.data?.days?.find((item) => item.date === date)?.weekday ?? date
  const choose = (item) => { setSelectedAlert(item.alert_id); setDay(item.date); setHour(item.hour); setSelectedStop(item.stop_id) }
  return (
    <div className="flex flex-col gap-5 p-4">
      <header><p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Observed vs expected</p><h2 className="mt-1 text-lg font-medium text-ink">{data.alerts.length} anomalies this week</h2></header>
      <section className="-mx-2">{data.alerts.map((item) => <button key={item.alert_id} type="button" onClick={() => choose(item)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${item.alert_id === selectedAlert ? 'bg-primary-soft' : 'hover:bg-subtle'}`}><span className="w-16 shrink-0 rounded-full px-2 py-1 text-center text-[10px] font-medium" style={{ color: anomalyColor(item.observed / Math.max(1, item.expected)), background: item.direction === 'above' ? '#fce8e6' : '#e8f0fe' }}>{item.direction === 'above' ? '▲' : '▼'} {signedPct(item.deviation_pct)}</span><span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span><span className="text-[10px] text-ink-3">{weekday(item.date)} {hourLabel(item.hour)}</span></button>)}</section>
      {selected && <section className="rounded-2xl border border-line p-3"><h3 className="text-sm font-medium text-ink">{selected.name} · {weekday(selected.date)} {hourLabel(selected.hour)}</h3><div className="mt-3 grid grid-cols-3 gap-2"><Kpi value={integer.format(selected.observed)} label="Observed" /><Kpi value={integer.format(selected.expected)} label="Expected" /><Kpi value={signedPct(selected.deviation_pct)} label="Difference" /></div><div className="mt-3"><HourChart expectedName="Expected" data={selected.hourly.map((item) => ({ hour: item.hour, value: item.observed, expected: item.expected, fill: item.hour === selected.hour ? '#d93025' : '#bdc1c6' }))} /></div><button type="button" onClick={() => setMode('demand')} className="mt-3 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white">Open stop profile</button></section>}
      <p className="text-[10px] leading-4 text-ink-4">{data.method} These are descriptive alerts, not forecasts.</p>
    </div>
  )
}

export default function LiveSidePanel() {
  const { mode, selectedStop } = useLiveData()
  if (mode === 'demand' && selectedStop) return <StopPanel />
  if (mode === 'load') return <LinePanel />
  if (mode === 'transfers') return <TransferPanel />
  if (mode === 'anomalies') return <AnomalyPanel />
  return <OverviewPanel />
}
