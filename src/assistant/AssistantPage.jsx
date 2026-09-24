import { useMemo, useState } from 'react'
import AssistantChart from './AssistantChart'
import FilterPanel from './FilterPanel'
import { askPlanner } from './client'
import { buildAssistantContext, chartForQuestion } from './context'
import { EMPTY_FILTERS, activeFilterCount, filterSummary, resolveNaturalLanguageFilters } from './filters'
import { useLiveData } from '../live/LiveDataContext'
import { hourLabel } from '../live/utils'

const STARTERS = [
  'Show the best direct routes',
  'Show passenger movement directions on a map',
  'Where is demand above supply?',
  'Show movement from bus to Metro',
  'What demand looks unusual?',
]

const GRAPHS = [
  { type: 'mobility_map', intent: 'flow', label: 'Flow map', question: 'Show passenger movement directions on a map' },
  { type: 'demand_supply', intent: 'supply', label: 'Demand vs supply', question: 'Where is demand above supply?' },
  { type: 'route_opportunities', intent: 'route', label: 'Direct links', question: 'Show the best direct routes' },
  { type: 'journey_layers', intent: 'transfer', label: 'Journey layers', question: 'Show movement across transport modes' },
  { type: 'passenger_flows', intent: 'flow', label: 'Passenger flows', question: 'Show passenger movement between locations' },
  { type: 'anomalies', intent: 'anomaly', label: 'Unusual activity', question: 'What demand looks unusual?' },
]

const INTENT_QUESTIONS = {
  route: 'Show the best direct routes',
  supply: 'Where is demand above supply?',
  transfer: 'Show movement across transport modes',
  anomaly: 'What demand looks unusual?',
  flow: 'Show passenger movement between locations',
  limits: 'Show the best direct routes',
}

function initialQuestion() {
  const query = window.location.hash.split('?')[1]
  return new URLSearchParams(query || '').get('prompt') || ''
}

function graphResponse(type, filters) {
  const graph = GRAPHS.find((item) => item.type === type) ?? GRAPHS[0]
  return {
    chart: { type: graph.type },
    context: buildAssistantContext(graph.question, filters),
    followups: STARTERS,
    question: graph.question,
  }
}

export default function AssistantPage() {
  const live = useLiveData()
  const [question, setQuestion] = useState(initialQuestion)
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [response, setResponse] = useState(() => graphResponse('mobility_map', EMPTY_FILTERS))
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [conversation, setConversation] = useState([])
  const prompts = useMemo(() => response.followups?.length ? response.followups : STARTERS, [response.followups])
  const filterCount = activeFilterCount(filters)
  const liveFilters = useMemo(() => ({
    day: live.day,
    hour: live.hour,
    ops: live.ops,
    segment: live.segment,
  }), [live.day, live.hour, live.ops, live.segment])

  const changeFilters = (nextFilters) => {
    setFilters(nextFilters)
    setResponse((current) => ({
      ...current,
      context: buildAssistantContext(INTENT_QUESTIONS[current.context.intent] ?? current.question, nextFilters),
      recommendations: [],
      mapOverlays: [],
      feasibility: [],
    }))
    setShowAnswer(false)
    setError('')
  }

  const selectView = (type) => {
    setResponse((current) => ({ ...current, chart: { ...current.chart, type } }))
    setError('')
  }

  const selectGraph = (type) => {
    setResponse(graphResponse(type, filters))
    setShowAnswer(false)
    setError('')
  }

  const ask = async (value) => {
    const next = value.trim()
    if (!next || loading) return
    const resolvedFilters = resolveNaturalLanguageFilters(next, filters)
    const localContext = buildAssistantContext(next, resolvedFilters)
    const localChart = chartForQuestion(next, localContext.intent)
    setFilters(resolvedFilters)
    setResponse({ chart: { type: localChart }, context: localContext, question: next, followups: STARTERS })
    setQuestion('')
    setLoading(true)
    setShowAnswer(false)
    setError('')
    try {
      const result = await askPlanner(next, conversation, resolvedFilters, liveFilters)
      if (result.resolvedFilters) setFilters({ ...EMPTY_FILTERS, ...result.resolvedFilters })
      setResponse({ ...result, question: next })
      setConversation((current) => [
        ...current,
        { role: 'user', content: next },
        { role: 'assistant', content: result.answer },
      ].slice(-8))
      setShowAnswer(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-page text-ink">
      <nav className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 p-4 sm:p-6">
        <a href="#/" className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
          ← Explorer
        </a>
        <div className="hidden min-w-0 gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 md:flex">
          {GRAPHS.map((graph) => (
            <button
              key={graph.type}
              type="button"
              onClick={() => selectGraph(graph.type)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] transition ${response.chart.type === graph.type || (response.chart.type === 'mobility_map' && response.context.intent !== 'flow' && response.context.intent === graph.intent) ? 'bg-primary-soft font-medium text-primary-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {graph.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="shrink-0 rounded-full border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft-2"
        >
          Filters{filterCount ? ` · ${filterCount}` : ''}
        </button>
      </nav>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[96rem] flex-col px-3 pb-40 pt-16 sm:px-6 sm:pt-20">
        <div className="mb-2 flex gap-1 overflow-x-auto md:hidden">
          {GRAPHS.map((graph) => (
            <button
              key={graph.type}
              type="button"
              onClick={() => selectGraph(graph.type)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] ${response.chart.type === graph.type || (response.chart.type === 'mobility_map' && response.context.intent !== 'flow' && response.context.intent === graph.intent) ? 'border-transparent bg-primary-soft font-medium text-primary-ink' : 'border-line text-ink-3'}`}
            >
              {graph.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          <AssistantChart
            response={response}
            filterLabel={filterSummary(filters)}
            filters={filters}
            onFiltersChange={changeFilters}
            onViewChange={selectView}
          />
        </div>
      </div>

      {showAnswer && response.answer && (
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
              <p className="text-[11px] font-medium uppercase tracking-wide text-danger">OpenAI connection</p>
              <p className="mt-1 text-sm leading-6 text-ink">{error}</p>
            </div>
            <button type="button" onClick={() => setError('')} aria-label="Hide error" className="text-ink-3 hover:text-ink">✕</button>
          </div>
          <p className="mt-2 text-xs text-ink-3">Your filtered graph is still calculated locally; no AI recommendation is invented.</p>
        </aside>
      )}

      {filtersOpen && <FilterPanel filters={filters} onChange={changeFilters} onClose={() => setFiltersOpen(false)} />}

      <div className="fixed inset-x-0 bottom-0 z-50 bg-gradient-to-t from-page via-page/95 to-transparent px-3 pb-4 pt-12 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-ink-4">
            <span>Live backend context · {live.day} · {hourLabel(live.hour)} · {live.segment}</span>
            <a href="#/" className="text-primary-ink hover:underline">Change in explorer</a>
          </div>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                disabled={loading}
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
            <button type="button" onClick={() => setFiltersOpen(true)} aria-label="Open filters" className="rounded-full px-2.5 py-2 text-ink-3 hover:bg-subtle hover:text-ink">☷</button>
            <label htmlFor="planner-question" className="sr-only">Ask the planning assistant</label>
            <input
              id="planner-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Try: Compare Metro supply in Oriente and Cais do Sodré, Tue 07:00–10:00"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="submit"
              disabled={!question.trim() || loading}
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
