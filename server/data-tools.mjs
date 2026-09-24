import { readFileSync } from 'node:fs'
import { calculateRouteFeasibility } from './feasibility.mjs'

const demand = JSON.parse(readFileSync(new URL('../src/data/demand.json', import.meta.url), 'utf8'))
const overview = JSON.parse(readFileSync(new URL('../src/data/overview.json', import.meta.url), 'utf8'))

const CAPACITY = { metro: 600, bus: 80, ferry: 500, train: 1000 }
const EMPTY_FILTERS = { locations: [], modes: [], lines: [], days: [], fromTime: null, toTime: null, evidence: [] }
const EVIDENCE_IDS = { observed: 0, strongly_inferred: 1, weakly_inferred: 2 }
const EVIDENCE_NAMES = ['observed', 'strongly_inferred', 'weakly_inferred']
const normalize = (value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mean = (series, indices) => indices.reduce((sum, index) => sum + (series[index] ?? 0), 0) / Math.max(indices.length, 1)

const slots = demand.slots.map((slot, index) => {
  const [date, hm] = slot.t.split('T')
  const [hour, minute] = hm.split(':').map(Number)
  return { index, date, weekday: slot.w, tod: hour * 60 + minute }
})
const slotsByTod = new Map()
for (const slot of slots) {
  if (!slotsByTod.has(slot.tod)) slotsByTod.set(slot.tod, [])
  slotsByTod.get(slot.tod).push(slot.index)
}
const serviceOrder = (tod) => (tod - 240 + 1440) % 1440
const typicalPositions = [...slotsByTod.keys()].sort((a, b) => serviceOrder(a) - serviceOrder(b)).map((tod) => ({ tod, slots: slotsByTod.get(tod) }))
const replayPositions = slots.map((slot) => ({ tod: slot.tod, slots: [slot.index] }))

const zoneByName = new Map(demand.zones.map((zone) => [normalize(zone.name), String(zone.id)]))
const stopZoneByName = new Map(demand.stops.map((stop) => [normalize(stop.name), String(stop.zone)]))
const lineByName = new Map(demand.lines.map((line) => [normalize(line.line), `${line.group}:${line.line}`]))

function clock(minute) {
  const value = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function parseTime(value) {
  if (value === null || value === undefined || value === '') return null
  if (Number.isFinite(value)) return Number(value)
  const match = String(value).match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return null
  return (Number(match[1]) % 24) * 60 + Number(match[2] ?? 0)
}

function resolveLocations(values) {
  return [...new Set(values.flatMap((value) => {
    if (demand.zones[Number(value)]) return [String(Number(value))]
    const query = normalize(value)
    const exact = zoneByName.get(query)
    if (exact !== undefined) return [exact]
    const exactStop = stopZoneByName.get(query)
    if (exactStop !== undefined) return [exactStop]
    const zoneMatches = demand.zones.filter((zone) => normalize(zone.name).includes(query)).map((zone) => String(zone.id))
    if (zoneMatches.length) return zoneMatches
    return demand.stops.filter((stop) => normalize(stop.name).includes(query)).map((stop) => String(stop.zone))
  }))]
}

function resolveLines(values) {
  return [...new Set(values.flatMap((value) => {
    if (String(value).includes(':')) return [String(value)]
    const query = normalize(value)
    const exact = lineByName.get(query)
    if (exact) return [exact]
    return demand.lines.filter((line) => normalize(line.line).includes(query)).map((line) => `${line.group}:${line.line}`)
  }))]
}

function resolveDays(values) {
  const available = [...new Set(slots.map((slot) => slot.date))]
  return [...new Set(values.flatMap((value) => {
    if (available.includes(value)) return [value]
    const query = normalize(value).slice(0, 3)
    return available.filter((date) => normalize(new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))).startsWith(query))
  }))]
}

function mergeFilters(base = EMPTY_FILTERS, requested = {}) {
  const current = { ...EMPTY_FILTERS, ...base }
  return {
    locations: requested.locations?.length ? resolveLocations(requested.locations) : current.locations,
    modes: requested.modes?.length ? [...new Set(requested.modes)] : current.modes,
    lines: requested.lines?.length ? resolveLines(requested.lines) : current.lines,
    days: requested.days?.length ? resolveDays(requested.days) : current.days,
    fromTime: requested.from_time ? parseTime(requested.from_time) : current.fromTime,
    toTime: requested.to_time ? parseTime(requested.to_time) : current.toTime,
    evidence: requested.evidence?.length ? requested.evidence.map((name) => EVIDENCE_IDS[name]).filter(Number.isInteger) : current.evidence,
  }
}

function timeMatches(tod, filters) {
  const { fromTime, toTime } = filters
  if (fromTime === null && toTime === null) return true
  if (fromTime !== null && toTime === null) return tod >= fromTime
  if (fromTime === null && toTime !== null) return tod < toTime
  if (fromTime === toTime) return true
  if (fromTime < toTime) return tod >= fromTime && tod < toTime
  return tod >= fromTime || tod < toTime
}

function positionsFor(filters, forceReplay = false) {
  const positions = forceReplay || filters.days.length ? replayPositions : typicalPositions
  return positions.filter((position) => {
    const date = slots[position.slots[0]].date
    return (!filters.days.length || filters.days.includes(date)) && timeMatches(position.tod, filters)
  })
}

function capacityOf(stop) {
  if (stop.group === 'metro') return CAPACITY.metro
  if (stop.id.startsWith('LTP61')) return CAPACITY.ferry
  if (stop.id.startsWith('7NTB1')) return CAPACITY.train
  return CAPACITY.bus
}

function baselineSlots(position) {
  if (position.slots.length !== 1) return []
  const index = position.slots[0]
  return slotsByTod.get(slots[index].tod).filter((other) => other !== index)
}

function stopState(stop, position) {
  const validations = mean(stop.in, position.slots)
  const departures = stop.dep ? mean(stop.dep, position.slots) : 0
  const baseline = baselineSlots(position)
  const expected = baseline.length ? mean(stop.in, baseline) : null
  return { validations, departures, expected, change: expected ? (validations - expected) / expected : null }
}

function stopMatches(stop, filters) {
  if (filters.locations.length && !filters.locations.includes(String(stop.zone))) return false
  if (filters.modes.length && !filters.modes.includes(stop.group)) return false
  if (filters.lines.length) {
    const stopLines = new Set((stop.lines ?? []).map((line) => `${stop.group}:${line}`))
    if (!filters.lines.some((line) => stopLines.has(line))) return false
  }
  return true
}

function flowsAt(position, confidences) {
  const rows = new Map()
  for (const index of position.slots) {
    for (const [a, b, count, confidence] of demand.flows[index]) {
      if (!confidences.includes(confidence)) continue
      const key = `${a}-${b}`
      const row = rows.get(key) ?? { key, a, b, n: 0, byConf: [0, 0, 0] }
      row.n += count / position.slots.length
      row.byConf[confidence] += count / position.slots.length
      rows.set(key, row)
    }
  }
  return [...rows.values()]
}

function supplyEvidence(filters, limit) {
  const positions = positionsFor(filters)
  return demand.stops.filter((stop) => stop.dep && stopMatches(stop, filters)).map((stop) => {
    let validations = 0
    let departures = 0
    for (const position of positions) {
      const state = stopState(stop, position)
      validations += state.validations
      departures += state.departures
    }
    const perDeparture = departures ? validations / departures : 0
    return {
      key: stop.id, stop_id: stop.id, stop: stop.name, area: stop.area, zone: String(stop.zone), lat: stop.lat, lon: stop.lon,
      mode: stop.group, mode_name: demand.groups[stop.group], lines: stop.lines ?? [],
      period: positions.length === 1 ? `${clock(positions[0].tod)}–${clock(positions[0].tod + demand.meta.slotMinutes)}` : `${positions.length} sampled half-hours`,
      validations: Math.round(validations), departures: Number(departures.toFixed(1)), validations_per_departure: Math.round(perDeparture),
      nominal_capacity: capacityOf(stop), pressure_pct: Math.round((perDeparture / capacityOf(stop)) * 100),
    }
  }).filter((row) => row.departures > 0 && row.validations > 0)
    .sort((a, b) => b.pressure_pct - a.pressure_pct || b.validations - a.validations).slice(0, limit)
}

function flowEvidence(filters, limit) {
  const confidences = filters.evidence.length ? filters.evidence : [0, 1]
  const totals = new Map()
  for (const position of positionsFor(filters)) {
    for (const flow of flowsAt(position, confidences)) {
      if (filters.locations.length && !filters.locations.includes(String(flow.a)) && !filters.locations.includes(String(flow.b))) continue
      const row = totals.get(flow.key) ?? { a: flow.a, b: flow.b, n: 0, byConf: [0, 0, 0] }
      row.n += flow.n
      row.byConf = row.byConf.map((value, index) => value + flow.byConf[index])
      totals.set(flow.key, row)
    }
  }
  return [...totals.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((row) => ({
    key: `${row.a}-${row.b}`, from: demand.zones[row.a].name, to: demand.zones[row.b].name,
    from_zone: String(row.a), to_zone: String(row.b), journeys: Math.round(row.n),
    observed: Math.round(row.byConf[0]), strongly_inferred: Math.round(row.byConf[1]), weakly_inferred: Math.round(row.byConf[2]),
  }))
}

function routeEvidence(filters, limit, requested = {}) {
  const temporal = filters.days.length || filters.fromTime !== null || filters.toTime !== null
  const confidence = filters.evidence.length > 0
  const selectedSlots = [...new Set(positionsFor(filters).flatMap((position) => position.slots))]
  const origin = requested.origin ? resolveLocations([requested.origin])[0] : null
  const destination = requested.destination ? resolveLocations([requested.destination])[0] : null
  return demand.opportunities
    .filter((row) => origin || destination || !filters.locations.length || filters.locations.includes(String(row.a)) || filters.locations.includes(String(row.b)))
    .filter((row) => {
      const a = String(row.a)
      const b = String(row.b)
      if (origin && destination) return (a === origin && b === destination) || (a === destination && b === origin)
      if (origin) return a === origin || b === origin
      if (destination) return a === destination || b === destination
      return true
    })
    .map((row) => {
      let total = temporal ? selectedSlots.reduce((sum, index) => sum + (row.series[index] ?? 0), 0) : row.n
      if (confidence && !temporal) total = filters.evidence.reduce((sum, id) => sum + (row.byConf[id] ?? 0), 0)
      const forward = Math.round(total * (row.n ? row.ab / row.n : 0.5))
      const observed = confidence && !temporal
        ? (filters.evidence.includes(0) ? row.byConf[0] ?? 0 : 0)
        : Math.round(total * (row.n ? (row.byConf[0] ?? 0) / row.n : 0))
      const stronglyInferred = confidence && !temporal
        ? (filters.evidence.includes(1) ? row.byConf[1] ?? 0 : 0)
        : Math.round(total) - observed
      return {
        key: row.key, from: demand.zones[row.a].name, to: demand.zones[row.b].name, from_zone: String(row.a), to_zone: String(row.b),
        supported_journeys: Math.round(total), from_to: forward, to_from: Math.max(0, Math.round(total) - forward),
        sampled_days: temporal ? new Set(selectedSlots.map((index) => slots[index].date)).size : row.days,
        straight_line_km: row.distanceKm, observed: Math.round(observed), strongly_inferred: Math.max(0, Math.round(stronglyInferred)), score: row.score,
      }
    }).filter((row) => row.supported_journeys > 0).sort((a, b) => b.supported_journeys - a.supported_journeys).slice(0, limit)
}

function transferMatches(filters) {
  const confidences = filters.evidence.length ? filters.evidence : [0, 1]
  return overview.journeyLayers
    .filter((row) => !filters.locations.length || filters.locations.includes(String(row.hub)) || filters.locations.includes(String(row.to)))
    .filter((row) => !filters.modes.length || filters.modes.includes(row.from) || filters.modes.includes(row.via))
    .filter((row) => confidences.includes(row.confidence))
}

function transferEvidence(filters, limit) {
  return transferMatches(filters).slice(0, limit).map((row) => ({
    ...row, key: `${row.from}-${row.hub}-${row.via}-${row.to}-${row.confidence}`,
    origin_mode: row.from, origin_mode_name: demand.groups[row.from], transfer_hub: row.hubName,
    next_mode: row.via, next_mode_name: demand.groups[row.via], destination: row.toName,
    evidence: EVIDENCE_NAMES[row.confidence],
    destination_evidence: row.confidence === 0 ? 'metro_exit_confirmed' : 'next_boarding_inferred',
    journeys: row.n, transfer_chains: row.n,
  }))
}

function anomalyEvidence(filters, limit) {
  const rows = []
  for (const position of positionsFor(filters, true)) {
    for (const stop of demand.stops.filter((item) => stopMatches(item, filters))) {
      const state = stopState(stop, position)
      if (state.expected === null || state.expected < 50 || state.change === null) continue
      if (Math.abs(state.validations - state.expected) < 60 || (state.change < 1 && state.change > -0.6)) continue
      rows.push({
        key: `${stop.id}-${position.slots[0]}`, stop: stop.name, area: stop.area, zone: String(stop.zone), lat: stop.lat, lon: stop.lon,
        mode: stop.group, lines: stop.lines ?? [], period: `${slots[position.slots[0]].date} ${clock(position.tod)}`,
        observed: Math.round(state.validations), expected: Math.round(state.expected), change_pct: Math.round(state.change * 100),
      })
    }
  }
  return rows.sort((a, b) => Math.abs(b.observed - b.expected) - Math.abs(a.observed - a.expected)).slice(0, limit)
}

function limitations(analysis, filters, requested = {}, limit = Infinity) {
  const rows = []
  if (analysis === 'transfer') {
    rows.push('Journey layers count transfer chains (two boardings by the same card within 60 minutes plus the next detected destination), not complete journeys; a longer journey can add more than one chain. Origin location is not recorded, so location filters match the transfer area or destination.')
    const matches = transferMatches(filters)
    if (matches.length > limit) {
      const sum = (items) => items.reduce((total, row) => total + row.n, 0).toLocaleString('en-US')
      rows.push(`Showing the top ${limit} of ${matches.length} matching combinations (${sum(matches.slice(0, limit))} of ${sum(matches)} transfer chains).`)
    }
  }
  if (['supply', 'anomaly'].includes(analysis) && filters.evidence.length) rows.push('Journey-confidence filters do not apply to stop validation totals.')
  if (analysis === 'route' && (filters.modes.length || filters.lines.length)) rows.push('Route-opportunity aggregates do not retain mode or line attribution.')
  if (analysis === 'route' && filters.evidence.length && (filters.days.length || filters.fromTime !== null || filters.toTime !== null)) rows.push('Time and evidence can each be filtered, but their joint split is not retained; the time-filtered total takes precedence.')
  if (analysis === 'transfer' && (filters.lines.length || filters.days.length || filters.fromTime !== null || filters.toTime !== null)) rows.push('Journey-layer aggregates do not retain line, date, or time dimensions.')
  if (analysis === 'flow' && (filters.modes.length || filters.lines.length)) rows.push('Zone-to-zone flow aggregates do not retain mode or line attribution.')
  if (analysis === 'route' && Boolean(requested.origin) !== Boolean(requested.destination)) rows.push('A route-specific comparison needs both an origin and a destination; one endpoint is missing.')
  if (analysis === 'route' && requested.origin && !resolveLocations([requested.origin]).length) rows.push(`The requested origin “${requested.origin}” could not be resolved to an available zone or stop.`)
  if (analysis === 'route' && requested.destination && !resolveLocations([requested.destination]).length) rows.push(`The requested destination “${requested.destination}” could not be resolved to an available zone or stop.`)
  return rows
}

function filterSummary(filters) {
  const parts = []
  if (filters.locations.length) parts.push(filters.locations.map((id) => demand.zones[Number(id)]?.name).filter(Boolean).join(' or '))
  if (filters.modes.length) parts.push(filters.modes.map((id) => demand.groups[id]).join(' or '))
  if (filters.lines.length) parts.push(filters.lines.map((id) => id.split(':').slice(1).join(':')).join(' or '))
  if (filters.days.length) parts.push(filters.days.join(' or '))
  if (filters.fromTime !== null || filters.toTime !== null) parts.push(`${filters.fromTime === null ? 'start' : clock(filters.fromTime)}–${filters.toTime === null ? 'end' : clock(filters.toTime)}`)
  if (filters.evidence.length) parts.push(filters.evidence.map((id) => EVIDENCE_NAMES[id]).join(' or '))
  return parts.length ? parts.join(' · ') : 'All locations, modes, and sampled times'
}

const chartOptions = {
  route: ['route_opportunities', 'route_feasibility', 'mobility_map'], supply: ['demand_supply', 'mobility_map'],
  transfer: ['journey_layers', 'mobility_map'], anomaly: ['anomalies', 'mobility_map'], flow: ['passenger_flows', 'mobility_map'],
}

function query(analysis, filters, limit, requested = {}) {
  const evidence = analysis === 'supply' ? supplyEvidence(filters, limit)
    : analysis === 'flow' ? flowEvidence(filters, limit)
      : analysis === 'transfer' ? transferEvidence(filters, limit)
        : analysis === 'anomaly' ? anomalyEvidence(filters, limit)
          : routeEvidence(filters, limit, requested)
  const originZone = requested.origin ? resolveLocations([requested.origin])[0] ?? null : null
  const destinationZone = requested.destination ? resolveLocations([requested.destination])[0] ?? null : null
  return {
    schema_version: '2.0', analysis, intent: analysis, evidence,
    applied_filters: { ...filters, human_summary: filterSummary(filters), logic: 'OR within dimensions; AND across dimensions.' },
    requested_route: analysis === 'route' ? {
      origin: requested.origin ?? null,
      destination: requested.destination ?? null,
      origin_zone: originZone,
      destination_zone: destinationZone,
    } : null,
    filter_limitations: limitations(analysis, filters, requested, limit), allowed_charts: chartOptions[analysis],
    sample: { validations: demand.meta.validations, anonymous_cards: demand.meta.cards, slot_minutes: demand.meta.slotMinutes, coverage_windows: demand.meta.windows },
    evidence_rules: {
      observed: 'Metro entry and exit recorded for the same anonymous card.',
      strongly_inferred: 'The same anonymous card boards a different line within 60 minutes.',
      demand_pressure: 'Validations per scheduled departure divided by nominal mode capacity; not measured occupancy.',
      route_opportunity: 'Recurring flow on at least three sampled days with no one-seat trip in the applicable GTFS.',
      transfer_chain: 'Two boardings by the same card within 60 minutes (the transfer is always inferred) plus the next detected destination: observed = confirmed by a Metro exit, strongly_inferred = the next boarding location.',
    },
  }
}

const filterProperties = {
  locations: { type: 'array', items: { type: 'string' }, description: 'Location names explicitly requested. Empty means retain the UI location filter.' },
  modes: { type: 'array', items: { type: 'string', enum: ['metro', 'carris', 'cm', 'other'] }, description: 'Operator groups explicitly requested. Empty means retain UI filters.' },
  lines: { type: 'array', items: { type: 'string' }, description: 'Line names explicitly requested. Empty means retain UI filters.' },
  days: { type: 'array', items: { type: 'string' }, description: 'Dates YYYY-MM-DD or weekday names explicitly requested.' },
  from_time: { type: ['string', 'null'], description: 'Start time HH:MM, or null.' },
  to_time: { type: ['string', 'null'], description: 'End time HH:MM, or null.' },
  evidence: { type: 'array', items: { type: 'string', enum: EVIDENCE_NAMES }, description: 'Evidence levels explicitly requested.' },
  limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum rows needed for analysis and visualization.' },
}
const queryParameters = { type: 'object', additionalProperties: false, required: Object.keys(filterProperties), properties: filterProperties }
const routeProperties = {
  ...filterProperties,
  origin: { type: ['string', 'null'], description: 'Ordered route origin zone or stop named by the user; null for a network-wide opportunity search.' },
  destination: { type: ['string', 'null'], description: 'Ordered route destination zone or stop named by the user; null for a network-wide opportunity search.' },
}
const routeQueryParameters = { type: 'object', additionalProperties: false, required: Object.keys(routeProperties), properties: routeProperties }

export const DATA_TOOLS = [
  {
    type: 'function', name: 'list_mobility_data_catalog', strict: true,
    description: 'List available locations, modes, lines, dates, evidence levels, analyses, and visualizations. Call when resolving an uncertain filter name.',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  { type: 'function', name: 'query_demand_supply', strict: true, description: 'Compare passenger validations per scheduled departure with nominal vehicle capacity at filtered stops.', parameters: queryParameters },
  { type: 'function', name: 'query_passenger_flows', strict: true, description: 'Find directional origin-to-destination passenger flows for maps or ranked-flow charts.', parameters: queryParameters },
  { type: 'function', name: 'query_route_opportunities', strict: true, description: 'Find recurring demand corridors without a one-seat GTFS connection. For a from-to question, pass both ordered origin and destination; for a network-wide search, pass both as null.', parameters: routeQueryParameters },
  { type: 'function', name: 'query_route_feasibility', strict: true, description: 'Compare the current stop-level GTFS transfer path with an assumption-based direct service, including estimated time saved, captured demand, daily vehicle kilometres, fleet and operating cost. Pass both origin and destination.', parameters: routeQueryParameters },
  { type: 'function', name: 'query_journey_layers', strict: true, description: 'Find transfer chains (origin mode to transfer area to next mode to next detected destination) for Sankey or map diagrams. Chains are transfer windows, not complete journeys.', parameters: queryParameters },
  { type: 'function', name: 'query_anomalies', strict: true, description: 'Find stop and time periods with observed validations far from the same-time baseline.', parameters: queryParameters },
]

export function executeDataTool(name, args = {}, baseFilters = EMPTY_FILTERS) {
  if (name === 'list_mobility_data_catalog') {
    return {
      locations: demand.zones.map((zone) => ({ id: String(zone.id), name: zone.name, area: zone.area })),
      modes: Object.entries(demand.groups).map(([id, label]) => ({ id, label })),
      lines: demand.lines.map((line) => ({ id: `${line.group}:${line.line}`, name: line.line, mode: line.group })),
      dates: [...new Set(slots.map((slot) => slot.date))], evidence_levels: EVIDENCE_NAMES,
      analyses: Object.keys(chartOptions), visualizations: [...new Set(Object.values(chartOptions).flat())],
    }
  }
  const analysisByTool = {
    query_demand_supply: 'supply', query_passenger_flows: 'flow', query_route_opportunities: 'route',
    query_route_feasibility: 'route', query_journey_layers: 'transfer', query_anomalies: 'anomaly',
  }
  const analysis = analysisByTool[name]
  if (!analysis) throw new Error(`Unknown data tool: ${name}`)
  const filters = mergeFilters(baseFilters, args)
  const result = query(analysis, filters, Math.min(Math.max(args.limit ?? 20, 1), 100), args)
  if (name === 'query_route_feasibility') {
    result.evidence = result.evidence.map((row) => ({ ...row, feasibility: calculateRouteFeasibility(row) }))
    result.feasibility_method = 'Current path from representative-weekday GTFS; proposed service, demand capture and cost use editable planning assumptions.'
  }
  return result
}
