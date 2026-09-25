import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AssistantChart from './AssistantChart'
import AssistantFilters from './AssistantFilters'
import { askPlanner } from './client'
import { runTool } from '../live/api'
import { useLiveData } from '../live/LiveDataContext'
import { hourLabel } from '../live/utils'

const STARTERS = [
  'Show traffic through Campo Grande above 50 journeys',
  'Is this hour busier than a typical weekday?',
  'Show the best direct routes',
  'Where are lines most crowded right now?',
  'What demand looks unusual?',
]

const JOURNEY_TOOL = 'query_live_journey_traffic'
const LIVE_KEYS = ['day', 'hour', 'ops', 'segment']
// Tools whose result depends on the hour, so their blocks get an hour slider
const HOURLY_TOOLS = new Set([JOURNEY_TOOL, 'query_live_compare', 'query_live_stop_demand', 'query_live_line_capacity'])
const HOURS = Array.from({ length: 20 }, (_, index) => index + 5)

// Each preset runs one backend tool without the model: the same code and numbers as an AI answer.
const GRAPHS = [
  { id: 'flows', label: 'Flow map', chart: 'mobility_map', tool: JOURNEY_TOOL, about: 'The busiest journey paths for the selected period, drawn as tap sequences on the map.' },
  { id: 'journeys', label: 'Journey paths', chart: 'journey_path_traffic', tool: JOURNEY_TOOL, about: 'Every privacy-safe journey path for the selected period, as a flow diagram and a ranked list.' },
  { id: 'typical', label: 'vs typical', chart: 'hour_vs_average', tool: 'query_live_compare', args: { measure: 'network_boardings', subject: null }, about: 'Network boardings at the selected hour against a typical day of the same type.' },
  { id: 'supply', label: 'Demand vs supply', chart: 'demand_supply', tool: 'query_live_line_capacity', args: { line: null }, about: 'Estimated peak on-board load against places offered, per line.' },
  { id: 'routes', label: 'Direct links', chart: 'route_opportunities', tool: 'query_live_golden_routes', args: { origin: null, destination: null, verdict: null, limit: 16 }, about: 'Area pairs where a direct line would save the most time on a typical weekday.' },
  { id: 'transfers', label: 'Transfers', chart: 'mobility_map', tool: 'query_live_transfers', about: 'The busiest interchanges and their transfer waits for the selected day.' },
  { id: 'anomalies', label: 'Unusual activity', chart: 'anomalies', tool: 'query_live_anomalies', about: 'Stop-hours whose boardings were far from the same-time baseline.' },
]

function journeyArgs(journey, limit = 50) {
  return {
    origin: journey.origin?.stop_id ?? null,
    through: journey.through.map((place) => place.stop_id),
    destination: journey.destination?.stop_id ?? null,
    any: journey.any.map((place) => place.stop_id),
    match: journey.match,
    min_volume: journey.minVolume,
    whole_day: journey.wholeDay,
    limit,
  }
}

const placeRef = (place) => (place ? { stop_id: place.stop_id, name: place.name } : null)
let nextTurnId = 0

function initialQuestion() {
  const query = window.location.hash.split('?')[1]
  return new URLSearchParams(query || '').get('prompt') || ''
}

function Spinner({ small = false }) {
  return <span className={`block animate-spin rounded-full border-primary-soft border-t-primary ${small ? 'h-4 w-4 border-2' : 'mx-auto h-10 w-10 border-4'}`} />
}

function useSeconds() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return seconds
}

// Diagram area while the planner works, so no placeholder graph appears first
function PlannerLoading() {
  const seconds = useSeconds()
  return (
    <section className="flex h-full items-center justify-center rounded-3xl border border-line bg-surface p-6" role="status" aria-live="polite">
      <div className="max-w-sm text-center">
        <Spinner />
        <p className="mt-5 text-sm font-medium text-ink">Drawing the chart for this question</p>
        <p className="mt-2 text-xs leading-5 text-ink-3">The AI chooses the right data, queries the live mobility backend, and the chart is drawn from those exact numbers. This usually takes 5–15 seconds.</p>
        <p className="mt-3 text-[11px] tabular-nums text-ink-4">{seconds}s</p>
      </div>
    </section>
  )
}

function GraphLoading({ label }) {
  return (
    <section className="flex h-full items-center justify-center rounded-3xl border border-line bg-surface p-6" role="status" aria-live="polite">
      <div className="text-center">
        <Spinner />
        <p className="mt-4 text-sm text-ink-2">Loading {label} from the live backend…</p>
      </div>
    </section>
  )
}

function NoChart() {
  return (
    <section className="flex h-full items-center justify-center rounded-3xl border border-dashed border-line bg-surface p-6">
      <p className="text-sm text-ink-3">No chart for this message.</p>
    </section>
  )
}

// First screen: invite a question instead of guessing a graph for whatever filters were saved
function Welcome({ onAsk, disabled }) {
  return (
    <section className="mx-auto max-w-3xl px-6 text-center">
      <p className="text-2xl font-medium text-ink">Hello, I’m the Carrolinha planning assistant</p>
      <p className="mt-3 text-sm leading-6 text-ink-3">
        Ask me anything about how people moved around the Lisbon area in the week of 31 August–6 September 2026.
        Each answer appears with its own chart, and follow-up questions are added below.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {STARTERS.map((prompt) => (
          <button key={prompt} type="button" disabled={disabled} onClick={() => onAsk(prompt)} className="rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs text-primary-ink hover:bg-primary-soft-2 disabled:opacity-50">
            {prompt}
          </button>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-ink-4">
        I can look at stop demand, crowded lines, transfers and waits, unusual activity, the best direct routes,
        journeys along a path, and how an hour compares with a typical day. Or open a ready-made view from the tabs above.
      </p>
    </section>
  )
}

function Thinking() {
  const seconds = useSeconds()
  return (
    <div className="flex items-center gap-2 text-sm text-ink-3" role="status">
      <Spinner small />
      Looking at the data… <span className="tabular-nums text-ink-4">{seconds}s</span>
    </div>
  )
}

function Caveats({ items }) {
  if (!items?.length) return null
  return (
    <details className="mt-3 text-[11px] leading-4 text-ink-4">
      <summary className="cursor-pointer text-ink-3">Caveats ({items.length})</summary>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </details>
  )
}

function AnswerText({ response }) {
  return (
    <>
      <p className="text-sm leading-6 text-ink">{response.answer}</p>
      {response.findings?.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs leading-5 text-ink-2">
          {response.findings.map((finding) => <li key={finding}>• {finding}</li>)}
        </ul>
      )}
      {response.recommendations?.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Suggested improvements</p>
          {response.recommendations.map((recommendation) => (
            <div key={recommendation.evidence_key} className="rounded-xl border border-primary/25 bg-primary-soft p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink">{recommendation.title}</p>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-medium uppercase text-primary-ink">{recommendation.priority}</span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-ink-3">{recommendation.rationale}</p>
            </div>
          ))}
        </div>
      )}
      {response.toolsUsed?.length > 0 && (
        <p className="mt-3 inline-block rounded-full bg-good-soft px-2 py-1 text-[10px] text-good">
          Data: {response.toolsUsed.map((name) => name.replace(/^query_(live_)?/, '').replaceAll('_', ' ')).join(' · ')}
        </p>
      )}
    </>
  )
}

// Hour slider for one block: dragging redraws that block's chart; play steps through the day
function HourScrubber({ hour, onHour, disabled }) {
  const [draft, setDraft] = useState(null)
  const [playing, setPlaying] = useState(false)
  const timer = useRef(null)
  const shown = draft ?? hour

  // Step to the next hour only after the previous chart has arrived
  useEffect(() => {
    if (!playing || disabled) return undefined
    const step = setTimeout(() => {
      if (hour >= HOURS.at(-1)) setPlaying(false)
      else onHour(hour + 1)
    }, 1400)
    return () => clearTimeout(step)
  }, [playing, disabled, hour, onHour])

  const change = (value) => {
    setDraft(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { onHour(value); setDraft(null) }, 350)
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
      <button
        type="button"
        onClick={() => { if (!playing && hour >= HOURS.at(-1)) onHour(HOURS[0]); setPlaying(!playing) }}
        aria-label={playing ? 'Pause' : 'Play through the day'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-white hover:bg-primary-hover"
      >
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <input
        type="range"
        min={HOURS[0]}
        max={HOURS.at(-1)}
        step="1"
        value={shown}
        onChange={(event) => change(Number(event.target.value))}
        aria-label="Service hour"
        className="min-w-0 flex-1 accent-primary"
      />
      <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums text-ink">{hourLabel(shown)}</span>
    </div>
  )
}

// One conversation block: the question, then the text answer on the left and its diagram on the right
function Turn({ turn, onViewChange, onTryPeriod, onRetry }) {
  const { response } = turn
  const applied = response?.context?.applied_filters ?? {}
  const summary = applied.human_summary
  const hourly = HOURLY_TOOLS.has(response?.context?.tool?.name) && Number.isFinite(applied.hour) && !applied.whole_day
  const onHour = useCallback((hour) => onTryPeriod(turn, { date: applied.day, hour }), [onTryPeriod, turn, applied.day])
  return (
    <article className="rounded-3xl border border-line bg-subtle p-3 sm:p-4" aria-label={turn.kind === 'ai' ? turn.question : turn.title}>
      <header className="mb-3 flex items-center justify-between gap-3">
        {turn.kind === 'ai'
          ? <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-primary px-3.5 py-2 text-sm leading-6 text-white">{turn.question}</p>
          : <p className="text-sm font-medium text-ink">{turn.title}</p>}
        {summary && <span className="hidden shrink-0 truncate text-[10px] text-ink-4 sm:block">{summary}</span>}
      </header>
      <div className="grid gap-3 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <div className="max-h-[34rem] overflow-y-auto rounded-3xl border border-line bg-surface p-4">
          {turn.status === 'loading' && !turn.updating && <Thinking />}
          {turn.status === 'error' && (
            <div className="text-sm leading-6 text-danger">
              {turn.error}
              <p className="mt-1 text-xs text-ink-3">Nothing was invented to fill the gap.</p>
              {turn.kind === 'ai' && <button type="button" onClick={() => onRetry(turn)} className="mt-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover">Try again</button>}
            </div>
          )}
          {turn.updatedTo && <p className="mb-3 rounded-lg bg-warn-soft px-2.5 py-2 text-[11px] leading-4 text-warn">Chart updated to {turn.updatedTo}. {turn.kind === 'ai' ? 'The written answer below describes the original result.' : ''}</p>}
          {response && turn.kind === 'ai' && <AnswerText response={response} />}
          {response && turn.kind === 'preset' && (
            <>
              <p className="text-sm leading-6 text-ink">{turn.about}</p>
              <p className="mt-3 text-xs text-ink-3">Ask a follow-up question below to have the AI explain it.</p>
            </>
          )}
          <Caveats items={response?.context?.filter_limitations} />
        </div>
        <div className="flex h-[60vh] min-h-[26rem] flex-col gap-2 lg:h-[34rem]">
          <div className="relative min-h-0 flex-1">
            {turn.status === 'loading' && !(turn.updating && response)
              ? (turn.kind === 'ai' ? <PlannerLoading /> : <GraphLoading label={turn.title} />)
              : response ? <AssistantChart response={response} onViewChange={(type) => onViewChange(turn.id, type)} onTryPeriod={(period) => onTryPeriod(turn, period)} />
                : <NoChart />}
            {turn.status === 'loading' && turn.updating && response && (
              <span className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-3 shadow-card"><Spinner small />Updating…</span>
            )}
          </div>
          {hourly && <HourScrubber hour={applied.hour} onHour={onHour} disabled={turn.status === 'loading'} />}
        </div>
      </div>
    </article>
  )
}

export default function AssistantPage() {
  const live = useLiveData()
  const [question, setQuestion] = useState(initialQuestion)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [turns, setTurns] = useState([])
  const filtersAtOpen = useRef('')
  const feedEnd = useRef(null)
  const lastAnswer = [...turns].reverse().find((turn) => turn.kind === 'ai' && turn.response)?.response
  const prompts = useMemo(() => (lastAnswer?.followups?.length ? lastAnswer.followups : STARTERS), [lastAnswer])
  const liveFilters = useMemo(() => ({
    day: live.day,
    hour: live.hour,
    ops: live.ops,
    segment: live.segment,
  }), [live.day, live.hour, live.ops, live.segment])
  const filterKey = JSON.stringify([liveFilters, journeyArgs(live.journey)])
  const dayLabel = live.meta.data?.days?.find((item) => item.date === live.day)?.label ?? live.day
  const busy = turns.some((turn) => turn.status === 'loading')

  // New blocks are appended below; keep the newest one in view
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns.length])

  const addTurn = (turn) => {
    const id = nextTurnId++
    setTurns((current) => [...current, { id, status: 'loading', ...turn }])
    return id
  }
  const patchTurn = (id, patch) => setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)))

  const loadGraph = async (id, { tool, args, chart, graphId, filters = liveFilters }) => {
    try {
      const context = await runTool(tool, args, filters)
      patchTurn(id, { status: 'done', updating: false, response: { chart: { type: chart }, context, graphId } })
    } catch (requestError) {
      patchTurn(id, { status: 'error', updating: false, error: `The live backend could not load this view: ${requestError.message}` })
    }
  }

  const selectGraph = (graph) => {
    const args = graph.tool === JOURNEY_TOOL ? journeyArgs(live.journey) : { ...(graph.args ?? {}) }
    const id = addTurn({ kind: 'preset', title: graph.label, about: graph.about })
    loadGraph(id, { tool: graph.tool, args, chart: graph.chart, graphId: graph.id })
  }

  // Re-run one block's chart with the current live filters (optionally another day and hour);
  // the block updates in place and says so, so an AI answer never silently mismatches its chart.
  const rerunTurn = (turn, period = null) => {
    const tool = turn?.response?.context?.tool
    if (!tool) return
    const args = Object.fromEntries(Object.entries(tool.args ?? {}).filter(([key]) => !LIVE_KEYS.includes(key)))
    if (tool.name === JOURNEY_TOOL) Object.assign(args, journeyArgs(live.journey, tool.args?.limit ?? 50), period ? { whole_day: false } : {})
    const filters = period ? { ...liveFilters, day: period.date, hour: period.hour } : liveFilters
    const label = live.meta.data?.days?.find((item) => item.date === filters.day)?.label ?? filters.day
    patchTurn(turn.id, { status: 'loading', updating: true, updatedTo: `${label} ${hourLabel(filters.hour)}` })
    loadGraph(turn.id, { tool: tool.name, args, chart: turn.response.chart.type, graphId: turn.response.graphId, filters })
  }

  const tryPeriod = (turn, period) => {
    live.setDay(period.date)
    live.setHour(period.hour)
    if (live.journey.wholeDay) live.setJourney({ wholeDay: false })
    rerunTurn(turn, period)
  }

  const openFilters = () => {
    filtersAtOpen.current = filterKey
    setFiltersOpen(true)
  }

  // Changing filters updates the newest block's chart
  const closeFilters = () => {
    setFiltersOpen(false)
    if (filtersAtOpen.current === filterKey) return
    const latest = [...turns].reverse().find((turn) => turn.response?.context?.tool)
    if (latest) rerunTurn(latest)
  }

  // An AI answer writes its resolved day, hour, operators, segment and path back to the
  // shared filters, so the drawer and the explorer describe exactly what is on screen.
  const syncFilters = (context) => {
    const applied = context?.applied_filters ?? {}
    if (live.meta.data?.days?.some((item) => item.date === applied.day)) live.setDay(applied.day)
    if (Number.isFinite(applied.hour)) live.setHour(applied.hour)
    if (Array.isArray(applied.ops) && applied.ops.length) live.setOps(applied.ops)
    if (typeof applied.segment === 'string') live.setSegment(applied.segment)
    if (context?.tool?.name === JOURNEY_TOOL) {
      live.setJourney({
        origin: placeRef(applied.origin),
        through: (applied.through ?? []).map(placeRef),
        destination: placeRef(applied.destination),
        any: (applied.any ?? []).map(placeRef),
        match: applied.match ?? 'contains',
        minVolume: applied.min_volume ?? 0,
        wholeDay: Boolean(applied.whole_day),
      })
    }
  }

  const changeView = (id, type) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, response: { ...turn.response, chart: { ...turn.response.chart, type } } } : turn)))
  }

  // Ask the planner and fill block `id` with the answer (or the error)
  const answerInto = async (id, text) => {
    // The model sees the recent questions and answers as plain text
    const conversation = turns
      .filter((turn) => turn.kind === 'ai' && turn.response && turn.id !== id)
      .flatMap((turn) => [{ role: 'user', content: turn.question }, { role: 'assistant', content: turn.response.answer }])
      .slice(-8)
    try {
      const result = await askPlanner(text, conversation, liveFilters)
      syncFilters(result.context)
      patchTurn(id, { status: 'done', response: { ...result, question: text, graphId: null } })
    } catch (requestError) {
      patchTurn(id, { status: 'error', error: requestError.message })
    }
  }

  const ask = (value) => {
    const next = value.trim()
    if (!next || busy) return
    setQuestion('')
    answerInto(addTurn({ kind: 'ai', question: next }), next)
  }

  const retry = (turn) => {
    if (busy) return
    patchTurn(turn.id, { status: 'loading', error: null })
    answerInto(turn.id, turn.question)
  }

  const tabs = (className) => GRAPHS.map((graph) => (
    <button
      key={graph.id}
      type="button"
      onClick={() => selectGraph(graph)}
      disabled={busy}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] text-ink-3 transition hover:text-ink disabled:opacity-60 ${className}`}
    >
      {graph.label}
    </button>
  ))

  return (
    <main className="min-h-screen bg-page text-ink">
      <nav className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-page/95 px-4 py-3 backdrop-blur sm:px-6">
        <a href="#/" className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
          ← Explorer
        </a>
        <div className="hidden min-w-0 gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 md:flex">{tabs('')}</div>
        <button
          type="button"
          onClick={openFilters}
          className="shrink-0 rounded-full border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft-2"
        >
          Filters
        </button>
      </nav>
      <div className="flex gap-1 overflow-x-auto px-3 md:hidden">{tabs('border border-line')}</div>

      {/* Conversation feed: each block has its text on the left and its chart on the right */}
      <div className="mx-auto flex max-w-[96rem] flex-col gap-4 px-3 pb-56 pt-2 sm:px-6">
        {turns.length === 0 && (
          <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center">
            <Welcome onAsk={ask} disabled={busy} />
          </div>
        )}
        {turns.map((turn) => <Turn key={turn.id} turn={turn} onViewChange={changeView} onTryPeriod={tryPeriod} onRetry={retry} />)}
        <div ref={feedEnd} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-page via-page/95 to-transparent px-3 pb-4 pt-10 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-ink-4">
            <span className="truncate">Filters · {dayLabel} · {hourLabel(live.hour)} · {live.ops.length} operator{live.ops.length === 1 ? '' : 's'} · {live.segment === 'all' ? 'all passengers' : live.segment}</span>
            <button type="button" onClick={openFilters} className="shrink-0 text-primary-ink hover:underline">Change filters</button>
          </div>
          {turns.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt)}
                  disabled={busy}
                  className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:border-primary/40 hover:text-ink disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              ask(question)
            }}
            className="flex items-center gap-2 rounded-[28px] border border-line bg-surface p-2 shadow-float focus-within:border-primary"
          >
            <button type="button" onClick={openFilters} aria-label="Open filters" className="rounded-full px-2.5 py-2 text-ink-3 hover:bg-subtle hover:text-ink">☷</button>
            <label htmlFor="planner-question" className="sr-only">Ask the planning assistant</label>
            <input
              id="planner-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={turns.length ? 'Ask a follow-up question…' : 'Try: Show journeys from Odivelas through Campo Grande above 20'}
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="submit"
              disabled={!question.trim() || busy}
              className="flex h-10 min-w-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <span className="animate-pulse">•••</span> : <span>Ask ↑</span>}
            </button>
          </form>
        </div>
      </div>

      {filtersOpen && <AssistantFilters onClose={closeFilters} />}
    </main>
  )
}
