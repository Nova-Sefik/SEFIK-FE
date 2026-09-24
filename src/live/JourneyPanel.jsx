import { useEffect, useRef, useState } from 'react'
import HourVsTypical from '../journeys/HourVsTypical'
import PathList from '../journeys/PathList'
import { liveApi } from './api'
import { EMPTY_JOURNEY, useLiveData } from './LiveDataContext'
import { compact, hourLabel, integer } from './utils'

function PlacePicker({ placeholder, onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) return undefined
    const timer = setTimeout(() => {
      liveApi.places(text).then((body) => { setResults(body.places); setOpen(true) }).catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-4 focus:border-primary"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-[700] mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float">
          {results.map((place) => (
            <button
              key={place.stop_id}
              type="button"
              onClick={() => { onPick({ stop_id: place.stop_id, name: place.name }); setQuery(''); setResults([]); setOpen(false) }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-subtle"
            >
              <span className="truncate">{place.name}</span>
              <span className="shrink-0 text-[9px] text-ink-4">{place.operators.join(' · ')}</span>
            </button>
          ))}
          {!results.length && <p className="px-2 py-1.5 text-xs text-ink-4">No matching place.</p>}
        </div>
      )}
    </div>
  )
}

function Chip({ place, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary-ink">
      {place.name}
      <button type="button" onClick={onRemove} className="text-primary-ink/70 hover:text-primary-ink" aria-label={`Remove ${place.name}`}>×</button>
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  )
}

function Single({ value, onChange, placeholder }) {
  return value ? <div><Chip place={value} onRemove={() => onChange(null)} /></div> : <PlacePicker placeholder={placeholder} onPick={onChange} />
}

function Multiple({ values, onChange, placeholder, ordered = false }) {
  return (
    <>
      {values.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {values.map((place, index) => (
            <span key={`${place.stop_id}-${index}`} className="contents">
              {ordered && index > 0 && <span className="text-[10px] text-ink-4">→</span>}
              <Chip place={place} onRemove={() => onChange(values.filter((_, i) => i !== index))} />
            </span>
          ))}
        </div>
      )}
      <PlacePicker placeholder={placeholder} onPick={(place) => onChange([...values, place])} />
    </>
  )
}

function Kpi({ value, label }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-[10px] leading-4 text-ink-3">{label}</p>
    </div>
  )
}

export default function JourneyPanel() {
  const { journey, setJourney, journeyTraffic, showMorePaths, selectedPath, setSelectedPath, hour } = useLiveData()
  const data = journeyTraffic.data
  const hasPath = Boolean(journey.origin || journey.through.length || journey.destination)
  const active = hasPath || journey.any.length || journey.minVolume > 0
  const swap = () => setJourney((current) => ({ origin: current.destination, destination: current.origin, through: [...current.through].reverse() }))

  return (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Journey paths · {journey.wholeDay ? 'whole day' : hourLabel(hour)}</p>
        <h2 className="mt-1 text-lg font-medium text-ink">Traffic along a path</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">Every journey counts by default. Add places to follow a directed path, or set a minimum volume.</p>
      </header>

      <section className="flex flex-col gap-2.5 rounded-2xl border border-line p-3">
        <Field label="From"><Single value={journey.origin} onChange={(origin) => setJourney({ origin })} placeholder="Any origin" /></Field>
        <Field label="Through"><Multiple ordered values={journey.through} onChange={(through) => setJourney({ through })} placeholder={journey.through.length ? 'Then through…' : 'Any stop, in order'} /></Field>
        <Field label="To"><Single value={journey.destination} onChange={(destination) => setJourney({ destination })} placeholder="Any destination" /></Field>
        <Field label="Touching"><Multiple values={journey.any} onChange={(any) => setJourney({ any })} placeholder="Any of these places" /></Field>
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
          <div className="flex rounded-full border border-line p-0.5" aria-label="Path matching">
            {[['contains', 'Contains path'], ['exact', 'Exact journey']].map(([id, label]) => (
              <button key={id} type="button" disabled={id === 'exact' && !hasPath} onClick={() => setJourney({ match: id })} className={`rounded-full px-2.5 py-0.5 text-[10px] disabled:opacity-40 ${journey.match === id ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle'}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={swap} disabled={!hasPath} className="rounded-full border border-line px-2.5 py-0.5 text-[10px] text-ink-3 hover:bg-subtle disabled:opacity-40" title="A→B and B→A are counted separately">⇄ Reverse</button>
          <div className="flex rounded-full border border-line p-0.5" aria-label="Period">
            {[[false, 'This hour'], [true, 'Whole day']].map(([value, label]) => (
              <button key={label} type="button" onClick={() => setJourney({ wholeDay: value })} className={`rounded-full px-2.5 py-0.5 text-[10px] ${journey.wholeDay === value ? 'bg-primary text-white' : 'text-ink-3 hover:bg-subtle'}`}>{label}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-ink-2">
          <span className="w-[4.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-3">Min</span>
          <input type="range" min="0" max="500" step="5" value={Math.min(journey.minVolume, 500)} onChange={(event) => setJourney({ minVolume: Number(event.target.value) })} className="flex-1 accent-primary" />
          <input type="number" min="0" value={journey.minVolume} onChange={(event) => setJourney({ minVolume: Math.max(0, Number(event.target.value) || 0) })} className="w-16 rounded-lg border border-line px-2 py-1 text-right text-xs tabular-nums" />
          <span className="text-[10px] text-ink-4">journeys</span>
        </label>
        {active && <button type="button" onClick={() => setJourney(EMPTY_JOURNEY)} className="self-start text-[10px] text-primary-ink hover:underline">× Clear filters and show everything</button>}
      </section>

      {journeyTraffic.error && <p className="rounded-xl border border-danger/25 bg-danger-soft p-3 text-sm text-danger">{journeyTraffic.error.message}</p>}
      {!data && !journeyTraffic.error && <p className="rounded-xl bg-subtle px-3 py-6 text-center text-sm text-ink-3">Loading journey paths…</p>}

      {data && (
        <>
          <p className="text-[11px] text-ink-3">{data.applied_filters.human_summary}</p>
          {!data.coverage.complete && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-4 text-warn">This period is not fully covered by the source validation files, so counts are incomplete. Fully covered hours today: {data.coverage.complete_hours.length ? data.coverage.complete_hours.map(hourLabel).join(', ') : 'none'}.</p>}
          <section className="grid grid-cols-2 gap-2">
            <Kpi value={integer.format(data.totals.shown_volume)} label={`journeys on ${integer.format(data.totals.shown_paths)} listed paths`} />
            <Kpi value={data.totals.matched_volume == null ? `< ${data.privacy_min}` : integer.format(data.totals.matched_volume)} label="journeys match the filters" />
            <Kpi value={compact.format(data.totals.below_min_volume)} label={journey.minVolume ? `in paths under your minimum of ${integer.format(journey.minVolume)}` : 'no minimum volume set'} />
            <Kpi value={compact.format(data.totals.below_privacy_threshold)} label={`in paths under ${data.privacy_min} (privacy: counted, never listed)`} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{journey.wholeDay ? 'Covered hours vs typical' : 'This hour vs typical'}</h3>
            <HourVsTypical comparison={data.comparison} hour={hour} compact />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Paths · busiest first</h3>
            <PathList paths={data.paths} selectedKey={selectedPath} onSelect={setSelectedPath} />
            {data.totals.shown_paths > data.paths.length && (
              <button type="button" onClick={showMorePaths} disabled={journeyTraffic.fetching} className="mt-2 w-full rounded-full border border-line py-1.5 text-xs text-ink-2 hover:bg-subtle disabled:opacity-50">
                Show more · {integer.format(data.paths.length)} of {integer.format(data.totals.shown_paths)}
              </button>
            )}
          </section>

          <ul className="list-disc space-y-1 pl-4 text-[10px] leading-4 text-ink-4">
            {data.limitations.map((item) => <li key={item}>{item}</li>)}
            <li>{data.method}</li>
            <li>{data.coverage.source}</li>
          </ul>
        </>
      )}
    </div>
  )
}
