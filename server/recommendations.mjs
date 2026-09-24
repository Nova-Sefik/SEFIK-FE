const ACTIONS = new Set([
  'investigate_direct_link',
  'increase_frequency',
  'rebalance_service',
  'improve_transfer',
  'monitor',
])

const PRIORITIES = new Set(['high', 'medium', 'low'])

function cleanText(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function geometryFor(row) {
  if (row.from_place && row.to_place) {
    return {
      kind: 'corridor',
      from: row.from,
      to: row.to,
      from_point: row.from_place,
      to_point: row.to_place,
      supported_journeys: row.supported_journeys ?? row.multi_vehicle_journeys_per_day ?? 0,
    }
  }
  if (row.from_zone !== undefined && row.to_zone !== undefined) {
    return {
      kind: 'corridor',
      from_zone: String(row.from_zone),
      to_zone: String(row.to_zone),
      from: row.from,
      to: row.to,
      supported_journeys: row.supported_journeys ?? row.journeys ?? 0,
    }
  }
  if (row.hub !== undefined && row.to !== undefined) {
    return {
      kind: 'corridor',
      from_zone: String(row.hub),
      to_zone: String(row.to),
      from: row.hubName ?? row.transfer_hub,
      to: row.toName ?? row.destination,
      supported_journeys: row.n ?? row.journeys ?? 0,
    }
  }
  if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
    return {
      kind: 'stop',
      stop_id: row.stop_id ?? row.key,
      stop: row.stop,
      lat: row.lat,
      lon: row.lon,
      pressure_pct: row.pressure_pct ?? null,
      change_pct: row.change_pct ?? null,
    }
  }
  return null
}

export function validateRecommendations(items, context) {
  if (!Array.isArray(items) || !Array.isArray(context?.evidence)) return { recommendations: [], overlays: [] }
  const evidence = new Map(context.evidence.map((row) => [String(row.key), row]))
  const recommendations = []
  const overlays = []
  const used = new Set()

  for (const item of items.slice(0, 4)) {
    const evidenceKey = String(item?.evidence_key ?? '')
    const row = evidence.get(evidenceKey)
    if (!row || used.has(evidenceKey) || !ACTIONS.has(item?.action) || !PRIORITIES.has(item?.priority)) continue
    const title = cleanText(item.title, 100)
    const rationale = cleanText(item.rationale, 320)
    if (!title || !rationale) continue
    const recommendation = {
      evidence_key: evidenceKey,
      action: item.action,
      priority: item.priority,
      title,
      rationale,
    }
    recommendations.push(recommendation)
    used.add(evidenceKey)
    const geometry = geometryFor(row)
    if (geometry) overlays.push({ id: `proposal-${evidenceKey}`, ...recommendation, ...geometry })
  }

  return { recommendations, overlays }
}
