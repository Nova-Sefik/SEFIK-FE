import logo from './assets/carrolinha-logo.jpeg'
import JourneySankey from './journeys/JourneySankey'
import LiveMap from './live/LiveMap'
import LiveSidePanel from './live/LivePanels'
import { API_URL } from './live/api'
import { useLiveData } from './live/LiveDataContext'
import { hourLabel, integer } from './live/utils'

const MODES = [
  { id: 'demand', label: 'Demand', hint: 'Where are people boarding?' },
  { id: 'load', label: 'Load vs capacity', hint: 'Where is service under pressure?' },
  { id: 'anomalies', label: 'Anomalies', hint: 'What is different from expected?' },
  { id: 'transfers', label: 'Transfers', hint: 'Where do journeys change operator?' },
  { id: 'golden', label: 'Best routes', hint: 'Where would a direct line save the most time?' },
  { id: 'journeys', label: 'Journey paths', hint: 'Where do journeys go, and along which paths?' },
]

function Segmented({ options, value, onChange, label, small = false }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-full border border-line bg-surface p-0.5">
      {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} title={option.hint} onClick={() => onChange(option.id)} className={`whitespace-nowrap rounded-full ${small ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs'} transition ${value === option.id ? 'bg-primary-soft font-medium text-primary-ink' : 'text-ink-3 hover:bg-subtle hover:text-ink'}`}>{option.label}</button>)}
    </div>
  )
}

function Timeline() {
  const { meta, overview, scales, hour, setHour, playing, setPlaying } = useLiveData()
  const hours = meta.data?.hours?.map((item) => item.hour) ?? []
  const values = new Map((overview.data?.network_hourly ?? []).map((item) => [item.hour, item.boardings]))
  const maximum = scales?.network_hour_max || Math.max(1, ...values.values())
  const min = hours[0] ?? 5
  const max = hours.at(-1) ?? 24
  return (
    <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-3">
      <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause day' : 'Play day'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-card hover:bg-primary-hover">{playing ? 'Ⅱ' : '▶'}</button>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-end gap-0.5" aria-hidden="true">{hours.map((item) => <button key={item} tabIndex={-1} type="button" onClick={() => setHour(item)} className={`min-w-1 flex-1 rounded-t-sm transition ${item === hour ? 'bg-primary' : 'bg-primary-soft-2 hover:bg-primary-soft'}`} style={{ height: `${Math.max(10, Math.min(100, ((values.get(item) ?? 0) / maximum) * 100))}%` }} />)}</div>
        <input type="range" min={min} max={max} step="1" value={hour} onChange={(event) => { setPlaying(false); setHour(Number(event.target.value)) }} aria-label="Hour of day" className="mt-1 h-1 w-full cursor-pointer accent-primary" />
      </div>
      <div className="w-20 shrink-0 text-right"><p className="text-lg font-semibold tabular-nums text-ink">{hourLabel(hour)}</p><p className="text-[10px] text-ink-3">service hour</p></div>
    </div>
  )
}

export default function App() {
  const {
    meta, overview, mode, setMode, layer, setLayer, day, setDay, ops, toggleOperator,
    segment, setSegment, setSelectedStop, setSelectedAlert, setSelectedFlow, setSelectedGolden, setWhatif,
    journeyView, setJourneyView, journeyTraffic,
  } = useLiveData()

  if (meta.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-page p-6 text-ink">
        <section className="w-full max-w-xl rounded-3xl border border-line bg-surface p-8 shadow-float">
          <p className="text-xs font-medium uppercase tracking-wide text-danger">Mobility API offline</p>
          <h1 className="mt-2 text-2xl font-medium">Cannot reach the live backend.</h1>
          <p className="mt-3 text-sm leading-6 text-ink-3">Expected the API at <code className="rounded bg-subtle px-1.5 py-0.5 text-ink">{API_URL}</code>. Start <code>carrolinha-BE</code>, or set <code>VITE_API_URL</code> in <code>.env.local</code>, then reload.</p>
          <div className="mt-5 flex gap-2"><button type="button" onClick={() => window.location.reload()} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white">Try again</button><a href="#/assistant" className="rounded-full border border-line px-4 py-2 text-sm text-ink-2">Open AI workspace</a></div>
        </section>
      </main>
    )
  }

  const activeMode = MODES.find((item) => item.id === mode)
  const resetSelection = (nextMode) => {
    setMode(nextMode)
    setSelectedStop(null)
    setSelectedAlert(null)
    setSelectedFlow(null)
    setSelectedGolden(null)
    setWhatif(0)
  }

  return (
    <div className="min-h-screen bg-page text-ink lg:grid lg:h-screen lg:grid-cols-[21rem_minmax(0,1fr)_25rem] lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 lg:col-span-3">
        <div className="mr-auto min-w-52">
          <div className="flex items-center gap-3"><img src={logo} alt="Carrolinha" className="h-7 w-auto" /><p className="text-[10px] text-ink-3">AI mobility intelligence for Lisbon</p></div>
        </div>
        <a href="#/overview" className="hidden text-xs text-ink-3 hover:text-ink md:inline">Research overview</a>
        <a href="#/assistant" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-primary-hover">Ask AI planner</a>
        {meta.data?.is_mock ? <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[10px] font-medium text-warn" title={meta.data.note}>Mock backend</span> : meta.data ? <span className="rounded-full bg-good-soft px-2.5 py-1 text-[10px] font-medium text-good">Live backend</span> : <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] text-ink-3">Connecting…</span>}
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2 lg:col-span-3">
        <Segmented options={MODES} value={mode} onChange={resetSelection} label="Analysis view" />
        <div className="flex-1" />
        {(mode === 'demand' || mode === 'anomalies') && <Segmented small options={[{ id: 'hex', label: 'Areas' }, { id: 'stops', label: 'Stops' }]} value={layer} onChange={setLayer} label="Map layer" />}
        {mode === 'journeys' && <Segmented small options={[{ id: 'map', label: 'Map' }, { id: 'sankey', label: 'Flow diagram' }]} value={journeyView} onChange={setJourneyView} label="Journey view" />}
        {(mode === 'demand' || mode === 'anomalies') && <Segmented small options={(meta.data?.segments ?? []).map((item) => ({ id: item.id, label: item.id === 'all' ? 'All passengers' : item.label }))} value={segment} onChange={setSegment} label="Passenger segment" />}
      </div>

      <aside className="order-2 overflow-y-auto border-line lg:order-none lg:col-start-1 lg:row-start-3 lg:border-r">
        <div className="border-b border-line p-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Current question</p>
          <p className="mt-1 text-sm text-ink">{activeMode?.hint}</p>
          {overview.data && <p className="mt-1 text-[10px] text-ink-4">{integer.format(overview.data.kpis.boardings)} boardings in the filtered day</p>}
        </div>
        {mode === 'journeys' ? (
          <div className="p-4 text-[11px] leading-5 text-ink-3">
            Journey paths use the selected day and hour plus the path controls on the right. Operator and passenger-segment filters do not apply to this aggregate.
          </div>
        ) : (
          <div className="p-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-3">Operators</p>
            <div className="flex flex-wrap gap-1.5">{(meta.data?.operators ?? []).map((operator) => { const active = ops.includes(operator.id); return <button key={operator.id} type="button" aria-pressed={active} onClick={() => toggleOperator(operator.id)} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${active ? 'border-transparent bg-primary-soft text-primary-ink' : 'border-line text-ink-4'}`}><span className="h-2 w-2 rounded-full" style={{ background: active ? operator.color : '#bdc1c6' }} />{operator.name}</button> })}</div>
          </div>
        )}
      </aside>

      <main className="relative order-1 h-[58vh] lg:order-none lg:col-start-2 lg:row-start-3 lg:h-auto">
        {/* Day selector floats over the map so it never collides with the analysis tabs */}
        <div className="absolute left-1/2 top-3 z-[600] hidden -translate-x-1/2 gap-1 rounded-full border border-line bg-surface p-1 shadow-card lg:flex">
          {(meta.data?.days ?? []).map((item) => <button key={item.date} type="button" onClick={() => setDay(item.date)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] ${day === item.date ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle'}`}>{item.label}</button>)}
        </div>
        {mode === 'journeys' && journeyView === 'sankey' ? (
          <div className="h-full overflow-y-auto bg-surface p-5 lg:pt-16">
            <p className="mb-1 text-sm font-medium text-ink">Journeys by tap sequence</p>
            <p className="mb-4 text-[11px] text-ink-3">{journeyTraffic.data ? `${journeyTraffic.data.applied_filters.human_summary} · ${integer.format(journeyTraffic.data.totals.shown_volume)} journeys on the paths shown. Busiest 20 places per column; the rest share a visible “Other” node.` : 'Loading…'}</p>
            {journeyTraffic.data && <JourneySankey sankey={journeyTraffic.data.sankey} />}
          </div>
        ) : <LiveMap />}
      </main>

      <aside className="order-3 max-h-[70vh] overflow-y-auto border-t border-line lg:order-none lg:col-start-3 lg:row-start-3 lg:max-h-none lg:border-l lg:border-t-0"><LiveSidePanel /></aside>

      <div className="order-4 border-line lg:order-none lg:col-span-3 lg:row-start-4"><Timeline /></div>

      <div className="fixed bottom-20 left-1/2 z-[600] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-line bg-surface/95 p-1 shadow-card lg:hidden">
        {(meta.data?.days ?? []).map((item) => <button key={item.date} type="button" onClick={() => setDay(item.date)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] ${day === item.date ? 'bg-primary text-white' : 'text-ink-3'}`}>{item.label}</button>)}
      </div>

    </div>
  )
}
