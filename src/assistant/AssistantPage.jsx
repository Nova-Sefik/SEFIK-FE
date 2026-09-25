import { useEffect, useMemo, useRef, useState } from 'react'
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

// Each preset runs one backend tool without the model: the same code and numbers as an AI answer.
const GRAPHS = [
  { id: 'flows', label: 'Flow map', chart: 'mobility_map', tool: JOURNEY_TOOL },
  { id: 'journeys', label: 'Journey paths', chart: 'journey_path_traffic', tool: JOURNEY_TOOL },
  { id: 'typical', label: 'vs typical', chart: 'hour_vs_average', tool: 'query_live_compare', args: { measure: 'network_boardings', subject: null } },
  { id: 'supply', label: 'Demand vs supply', chart: 'demand_supply', tool: 'query_live_line_capacity', args: { line: null } },
  { id: 'routes', label: 'Direct links', chart: 'route_opportunities', tool: 'query_live_golden_routes', args: { origin: null, destination: null, verdict: null, limit: 16 } },
  { id: 'transfers', label: 'Transfers', chart: 'mobility_map', tool: 'query_live_transfers' },
  { id: 'anomalies', label: 'Unusual activity', chart: 'anomalies', tool: 'query_live_anomalies' },
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

function initialQuestion() {
  const query = window.location.hash.split('?')[1]
  return new URLSearchParams(query || '').get('prompt') || ''
}

function Spinner() {
  return <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-primary-soft border-t-primary" />
}

// Shown over the chart while the planner works, so no placeholder graph appears first
function PlannerLoading({ question }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <section className="flex h-[calc(100vh-13rem)] min-h-[34rem] items-center justify-center rounded-3xl border border-line bg-surface p-6" role="status" aria-live="polite">
      <div className="max-w-md text-center">
        <Spinner />
        <p className="mt-5 text-sm font-medium text-ink">The AI planner is working on your question</p>
        <p className="mt-2 text-sm text-ink-2">“{question}”</p>
        <p className="mt-4 text-xs leading-5 text-ink-3">It chooses the right data, queries the live mobility backend, and then draws the chart from those exact numbers. This usually takes 5–15 seconds.</p>
        <p className="mt-3 text-[11px] tabular-nums text-ink-4">{seconds}s</p>
      </div>
    </section>
  )
}

function GraphLoading({ label }) {
  return (
    <section className="flex h-[calc(100vh-13rem)] min-h-[34rem] items-center justify-center rounded-3xl border border-line bg-surface p-6" role="status" aria-live="polite">
      <div className="text-center">
        <Spinner />
        <p className="mt-4 text-sm text-ink-2">Loading {label} from the live backend…</p>
      </div>
    </section>
  )
}

export default function AssistantPage() {
  const live = useLiveData()
  const [question, setQuestion] = useState(initialQuestion)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [response, setResponse] = useState(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [error, setError] = useState(null)
  const [conversation, setConversation] = useState([])
  const filtersAtOpen = useRef('')
  const prompts = useMemo(() => (response?.followups?.length ? response.followups : STARTERS), [response?.followups])
  const liveFilters = useMemo(() => ({
    day: live.day,
    hour: live.hour,
    ops: live.ops,
    segment: live.segment,
  }), [live.day, live.hour, live.ops, live.segment])
  const filterKey = JSON.stringify([liveFilters, journeyArgs(live.journey)])
  const dayLabel = live.meta.data?.days?.find((item) => item.date === live.day)?.label ?? live.day
  const busy = loading || Boolean(graphLoading)

  const runGraph = async ({ tool, args, chart, graphId, label }) => {
    setGraphLoading(label)
    setShowAnswer(false)
    setError(null)
    try {
      const context = await runTool(tool, args, liveFilters)
      setResponse({ chart: { type: chart }, context, graphId, question: label, followups: STARTERS })
    } catch (requestError) {
      setError({ source: 'graph', message: requestError.message })
    } finally {
      setGraphLoading('')
    }
  }

  const selectGraph = (graph) => {
    const args = graph.tool === JOURNEY_TOOL ? journeyArgs(live.journey) : { ...(graph.args ?? {}) }
    runGraph({ tool: graph.tool, args, chart: graph.chart, graphId: graph.id, label: graph.label })
  }

  // Re-run whatever is on screen (preset or AI answer) with the current live filters
  const rerun = () => {
    const tool = response?.context?.tool
    if (!tool) return
    const args = Object.fromEntries(Object.entries(tool.args ?? {}).filter(([key]) => !LIVE_KEYS.includes(key)))
    if (tool.name === JOURNEY_TOOL) Object.assign(args, journeyArgs(live.journey, tool.args?.limit ?? 50))
    runGraph({ tool: tool.name, args, chart: response.chart.type, graphId: response.graphId, label: 'the updated graph' })
  }

  useEffect(() => {
    selectGraph(GRAPHS[0])
    // Load the first preset once; later runs are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFilters = () => {
    filtersAtOpen.current = filterKey
    setFiltersOpen(true)
  }

  const closeFilters = () => {
    setFiltersOpen(false)
    if (filtersAtOpen.current !== filterKey) rerun()
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

  const selectView = (type) => {
    setResponse((current) => ({ ...current, chart: { ...current.chart, type } }))
  }

  const ask = async (value) => {
    const next = value.trim()
    if (!next || busy) return
    setPendingQuestion(next)
    setQuestion('')
    setLoading(true)
    setShowAnswer(false)
    setError(null)
    try {
      const result = await askPlanner(next, conversation, liveFilters)
      syncFilters(result.context)
      setResponse({ ...result, question: next, graphId: null })
      setConversation((current) => [
        ...current,
        { role: 'user', content: next },
        { role: 'assistant', content: result.answer },
      ].slice(-8))
      setShowAnswer(true)
    } catch (requestError) {
      setError({ source: 'ai', message: requestError.message })
    } finally {
      setLoading(false)
    }
  }

  const tabs = (className) => GRAPHS.map((graph) => (
    <button
      key={graph.id}
      type="button"
      onClick={() => selectGraph(graph)}
      disabled={busy}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] transition disabled:opacity-60 ${response?.graphId === graph.id ? 'bg-primary-soft font-medium text-primary-ink' : `text-ink-3 hover:text-ink ${className}`}`}
    >
      {graph.label}
    </button>
  ))

  return (
    <main className="relative min-h-screen overflow-hidden bg-page text-ink">
      <nav className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 p-4 sm:p-6">
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

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[96rem] flex-col px-3 pb-40 pt-16 sm:px-6 sm:pt-20">
        <div className="mb-2 flex gap-1 overflow-x-auto md:hidden">{tabs('border border-line')}</div>
        <div className="min-h-0 flex-1">
          {loading ? <PlannerLoading question={pendingQuestion} />
            : graphLoading || !response ? <GraphLoading label={graphLoading || 'the graph'} />
              : <AssistantChart response={response} onViewChange={selectView} />}
        </div>
      </div>

      {showAnswer && response?.answer && (
        <aside className="fixed left-4 top-20 z-40 max-h-[calc(100vh-14rem)] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-float sm:left-8 sm:top-24">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary-ink">AI recommendation</p>
            <button type="button" onClick={() => setShowAnswer(false)} aria-label="Hide recommendation" className="text-ink-3 hover:text-ink">✕</button>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink">{response.answer}</p>
          {response.findings?.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-line pt-3 text-xs leading-5 text-ink-3">
              {response.findings.map((finding) => <li key={finding}>• {finding}</li>)}
            </ul>
          )}
          {response.recommendations?.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Mapped improvements</p>
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
            <p className="mt-3 rounded-lg border border-good/25 bg-good-soft px-2.5 py-2 text-[10px] text-good">
              Data queried: {response.toolsUsed.map((name) => name.replace(/^query_/, '').replaceAll('_', ' ')).join(' · ')}
            </p>
          )}
          {response.context.filter_limitations?.length > 0 && (
            <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft p-2 text-[11px] leading-4 text-warn">
              {response.context.filter_limitations.map((item) => <p key={item}>{item}</p>)}
            </div>
          )}
          <p className="mt-3 text-[10px] text-ink-4">Based only on aggregated, anonymised evidence supplied with this graph.</p>
        </aside>
      )}

      {error && (
        <aside className="fixed left-4 top-20 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-danger/30 bg-surface p-4 shadow-float sm:left-8 sm:top-24">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-danger">{error.source === 'ai' ? 'AI planner' : 'Live backend'}</p>
              <p className="mt-1 text-sm leading-6 text-ink">{error.message}</p>
            </div>
            <button type="button" onClick={() => setError(null)} aria-label="Hide error" className="text-ink-3 hover:text-ink">✕</button>
          </div>
          <p className="mt-2 text-xs text-ink-3">The graph still shows the last successful result; nothing is invented to fill the gap.</p>
        </aside>
      )}

      {filtersOpen && <AssistantFilters onClose={closeFilters} />}

      <div className="fixed inset-x-0 bottom-0 z-50 bg-gradient-to-t from-page via-page/95 to-transparent px-3 pb-4 pt-12 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-ink-4">
            <span>Live filters · {dayLabel} · {hourLabel(live.hour)} · {live.ops.length} operator{live.ops.length === 1 ? '' : 's'} · {live.segment === 'all' ? 'all passengers' : live.segment}</span>
            <button type="button" onClick={openFilters} className="text-primary-ink hover:underline">Change filters</button>
          </div>
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
              placeholder="Try: Show journeys from Odivelas through Campo Grande above 20"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="submit"
              disabled={!question.trim() || busy}
              className="flex h-10 min-w-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <span className="animate-pulse">•••</span> : <span>Ask ↑</span>}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
