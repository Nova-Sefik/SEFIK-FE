import { API_URL } from '../live/api'
import { chartForQuestion, chartsFor } from './charts'

function validResponse(value, context) {
  if (!value || typeof value.answer !== 'string') return null
  const charts = chartsFor(context)
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.slice(0, 4).filter((item) => item && typeof item.evidence_key === 'string')
    : []
  const mapOverlays = Array.isArray(value.map_overlays)
    ? value.map_overlays.slice(0, 4).filter((item) => item?.kind === 'corridor' || item?.kind === 'stop')
    : []
  const wantsMap = /\bmap\b|geographic|geospatial/i.test(context.question) || mapOverlays.length > 0
  const chartType = wantsMap && charts.includes('mobility_map')
    ? 'mobility_map'
    : charts.includes(value.chart?.type) ? value.chart.type : chartForQuestion(context.question, context)
  return {
    answer: value.answer,
    findings: Array.isArray(value.findings) ? value.findings.slice(0, 5).map(String) : [],
    recommendations,
    mapOverlays,
    chart: {
      type: chartType,
      highlight: typeof value.chart?.highlight === 'string' ? value.chart.highlight : '',
    },
    followups: Array.isArray(value.followups) ? value.followups.slice(0, 4).map(String) : [],
  }
}

export async function askPlanner(question, conversation = [], liveFilters = {}) {
  // The planner runs in the backend next to the data; the OpenAI key never reaches the browser.
  const endpoint = import.meta.env.VITE_AI_ENDPOINT || `${API_URL}/api/planner`

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ question, live_filters: liveFilters, conversation: conversation.slice(-8) }),
    })
  } catch {
    throw new Error(`Cannot reach the planner at ${endpoint}. Start carrolinha-BE, or check VITE_API_URL.`)
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || body.error || `The planner returned ${response.status}.`)

  const context = body.context
  if (!context?.evidence || !context?.applied_filters) throw new Error('OpenAI did not return a verified data-tool result.')
  const parsed = validResponse(body, context)
  if (!parsed) throw new Error('OpenAI returned an invalid planner response.')
  return {
    ...parsed,
    context,
    resolvedFilters: body.resolved_filters,
    toolsUsed: Array.isArray(body.tools_used) ? body.tools_used : [],
    source: 'openai',
  }
}
