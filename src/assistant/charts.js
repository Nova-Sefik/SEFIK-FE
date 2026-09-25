// Which charts can show which analysis. The backend's allowed_charts is the
// authority for a given result; this is the browser-side fallback and ordering.
export const CHART_TYPES = ['mobility_map', 'route_opportunities', 'demand_supply', 'anomalies', 'journey_path_traffic', 'hour_vs_average']

export const COMPATIBLE_CHARTS = {
  route: ['route_opportunities', 'mobility_map'],
  supply: ['demand_supply', 'mobility_map'],
  transfer: ['mobility_map'],
  anomaly: ['anomalies', 'mobility_map'],
  journey: ['journey_path_traffic', 'hour_vs_average', 'mobility_map'],
  compare: ['hour_vs_average'],
}

export const VIEW_LABELS = {
  mobility_map: 'Map',
  route_opportunities: 'Bars',
  demand_supply: 'Bars',
  anomalies: 'Bars',
  journey_path_traffic: 'Paths',
  hour_vs_average: 'vs typical',
}

export function chartsFor(context) {
  const allowed = context?.allowed_charts?.filter((type) => CHART_TYPES.includes(type))
  return allowed?.length ? allowed : COMPATIBLE_CHARTS[context?.intent] ?? ['mobility_map']
}

export function chartForQuestion(question, context) {
  const charts = chartsFor(context)
  if (/\bmap\b|geographic|geospatial/i.test(question) && charts.includes('mobility_map')) return 'mobility_map'
  return charts[0]
}
