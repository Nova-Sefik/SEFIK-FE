import { API_URL } from '../live/api'
import { chartForQuestion, CHART_TYPES } from './context'

const compatibleCharts = {
  route: ['route_opportunities', 'route_feasibility', 'mobility_map'],
  supply: ['demand_supply', 'mobility_map'],
  transfer: ['journey_layers', 'mobility_map'],
  anomaly: ['anomalies', 'mobility_map'],
  flow: ['passenger_flows', 'mobility_map'],
  journey: ['journey_path_traffic', 'hour_vs_average', 'mobility_map'],
  compare: ['hour_vs_average'],
  limits: ['route_opportunities'],
}

function validResponse(value, context) {
  if (!value || typeof value.answer !== 'string') return null
  const promptChart = chartForQuestion(context.question, context.intent)
  const explicitlyRequestedMap = /\bmap\b|geographic|geospatial/i.test(context.question)
  const modelChartIsValid = CHART_TYPES.includes(value.chart?.type) && compatibleCharts[context.intent]?.includes(value.chart.type)
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.slice(0, 4).filter((item) => item && typeof item.evidence_key === 'string')
    : []
  const mapOverlays = Array.isArray(value.map_overlays)
    ? value.map_overlays.slice(0, 4).filter((item) => item?.kind === 'corridor' || item?.kind === 'stop')
    : []
  const feasibility = Array.isArray(value.feasibility) ? value.feasibility.slice(0, 4) : []
  const hasDrawableRecommendation = mapOverlays.length > 0
  const chartType = explicitlyRequestedMap || (hasDrawableRecommendation && value.chart?.type !== 'route_feasibility')
    ? 'mobility_map'
    : modelChartIsValid ? value.chart.type : promptChart
  return {
    answer: value.answer,
    findings: Array.isArray(value.findings) ? value.findings.slice(0, 5).map(String) : [],
    recommendations,
    mapOverlays,
    feasibility,
    chart: {
      type: chartType,
      highlight: typeof value.chart?.highlight === 'string' ? value.chart.highlight : '',
    },
    followups: Array.isArray(value.followups) ? value.followups.slice(0, 4).map(String) : [],
  }
}

export async function askPlanner(question, conversation = [], filters, liveFilters) {
  // The planner runs in the backend next to the data; the OpenAI key never reaches the browser.
  const endpoint = import.meta.env.VITE_AI_ENDPOINT || `${API_URL}/api/planner`

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ question, filters, live_filters: liveFilters, conversation: conversation.slice(-8) }),
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
