import overview from '../data/overview.json'
import {
  GROUP_NAMES,
  LENSES,
  capacityOf,
  flowsAt,
  meta,
  opportunities,
  slots,
  stopState,
  stops,
  zones,
} from '../lib/model'
import { EMPTY_FILTERS, filterSummary } from './filters'

export const CHART_TYPES = ['mobility_map', 'route_opportunities', 'route_feasibility', 'demand_supply', 'journey_layers', 'anomalies', 'passenger_flows', 'journey_path_traffic', 'hour_vs_average']

const normalise = (value) => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function classifyQuestion(question) {
  const q = normalise(question)
  if (/limit|caveat|trust|data quality|uncertain|certainty/.test(q)) return 'limits'
  if (/\broute\b|\bdirect\b|connection|corridor|better way|new line/.test(q)) return 'route'
  if (/supply|capacity|departure|overload|pressure|service|vehicle/.test(q)) return 'supply'
  if (/transfer|interchange|bus.*metro|metro.*bus|mode|layer|sankey|change/.test(q)) return 'transfer'
  if (/anomal|unusual|spike|drop|alert|different/.test(q)) return 'anomaly'
  if (/flow|move|journey|where.*people|origin|destination|activity/.test(q)) return 'flow'
  return 'route'
}

const DEFAULT_CHART = {
  route: 'route_opportunities',
  supply: 'demand_supply',
  transfer: 'journey_layers',
  anomaly: 'anomalies',
  flow: 'passenger_flows',
  journey: 'journey_path_traffic',
  compare: 'hour_vs_average',
  limits: 'route_opportunities',
}

export function chartForQuestion(question, intent = classifyQuestion(question)) {
  const q = normalise(question)
  if (/\bmap\b|geographic|geospatial/.test(q)) return 'mobility_map'
  if (intent === 'route' && /feasib|operating cost|cost per|time sav|pilot economics|business case/.test(q)) return 'route_feasibility'
  return DEFAULT_CHART[intent] ?? 'route_opportunities'
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
  const replay = forceReplay || filters.days.length > 0
  return (replay ? LENSES.replay : LENSES.typical).filter((position) => {
    const date = slots[position.slots[0]].date
    return (!filters.days.length || filters.days.includes(date)) && timeMatches(position.tod, filters)
  })
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

function namedOpportunity(opportunity, filters) {
  const temporalFilter = filters.days.length || filters.fromTime !== null || filters.toTime !== null
  const confidenceFilter = filters.evidence.length > 0
  const positions = positionsFor(filters)
  const selectedSlots = [...new Set(positions.flatMap((position) => position.slots))]
  let supported = temporalFilter
    ? selectedSlots.reduce((sum, index) => sum + (opportunity.series[index] ?? 0), 0)
    : opportunity.n

  if (confidenceFilter && !temporalFilter) {
    supported = filters.evidence.reduce((sum, confidence) => sum + (opportunity.byConf[confidence] ?? 0), 0)
  }

  const directionRatio = opportunity.n ? opportunity.ab / opportunity.n : 0.5
  const observedRatio = opportunity.n ? (opportunity.byConf[0] ?? 0) / opportunity.n : 0
  const fromTo = Math.round(supported * directionRatio)
  const observed = confidenceFilter && !temporalFilter
    ? (filters.evidence.includes(0) ? opportunity.byConf[0] ?? 0 : 0)
    : Math.round(supported * observedRatio)
  const stronglyInferred = confidenceFilter && !temporalFilter
    ? (filters.evidence.includes(1) ? opportunity.byConf[1] ?? 0 : 0)
    : Math.round(supported) - observed
  return {
    key: opportunity.key,
    from: zones[opportunity.a].name,
    to: zones[opportunity.b].name,
    from_zone: String(opportunity.a),
    to_zone: String(opportunity.b),
    supported_journeys: Math.round(supported),
    from_to: fromTo,
    to_from: Math.max(0, Math.round(supported) - fromTo),
    sampled_days: temporalFilter ? new Set(selectedSlots.map((index) => slots[index].date)).size : opportunity.days,
    straight_line_km: opportunity.distanceKm,
    observed: Math.round(observed),
    strongly_inferred: Math.max(0, Math.round(stronglyInferred)),
    score: opportunity.score,
    filtered_value_note: temporalFilter || confidenceFilter
      ? 'Filtered volume is exact for the selected time or evidence dimension; its directional split is allocated using the corridor-wide ratio.'
      : null,
  }
}

function routeEvidence(filters) {
  return opportunities
    .filter((opportunity) => !filters.locations.length
      || filters.locations.includes(String(opportunity.a))
      || filters.locations.includes(String(opportunity.b)))
    .map((opportunity) => namedOpportunity(opportunity, filters))
    .filter((row) => row.supported_journeys > 0)
    .sort((a, b) => b.supported_journeys - a.supported_journeys)
    .slice(0, 12)
}

function supplyEvidence(filters) {
  const positions = positionsFor(filters)
  const rows = []
  for (const stop of stops.filter((item) => item.dep && stopMatches(item, filters))) {
    let validations = 0
    let departures = 0
    for (const position of positions) {
      const state = stopState(stop, position)
      validations += state.v
      departures += state.dep
    }
    if (!departures || validations < 1) continue
    const demandPerDeparture = validations / departures
    rows.push({
      key: stop.id,
      stop_id: stop.id,
      stop: stop.name,
      area: stop.area,
      zone: String(stop.zone),
      lat: stop.lat,
      lon: stop.lon,
      mode: stop.group,
      mode_name: GROUP_NAMES[stop.group],
      lines: stop.lines ?? [],
      period: positions.length === 1 ? positions[0].label : `${positions.length} sampled half-hours`,
      validations: Math.round(validations),
      departures: Number(departures.toFixed(1)),
      validations_per_departure: Math.round(demandPerDeparture),
      nominal_capacity: capacityOf(stop),
      pressure_pct: Math.round((demandPerDeparture / capacityOf(stop)) * 100),
    })
  }
  return rows
    .sort((a, b) => b.pressure_pct - a.pressure_pct || b.validations - a.validations)
    .slice(0, 16)
}

function transferEvidence(filters) {
  const confidences = filters.evidence.length ? filters.evidence : [0, 1]
  return overview.journeyLayers
    .filter((path) => !filters.locations.length
      || filters.locations.includes(String(path.hub))
      || filters.locations.includes(String(path.to)))
    .filter((path) => !filters.modes.length
      || filters.modes.includes(path.from)
      || filters.modes.includes(path.via))
    .filter((path) => confidences.includes(path.confidence))
    .map((path) => ({
      ...path,
      key: `${path.from}-${path.hub}-${path.via}-${path.to}-${path.confidence}`,
      origin_mode: path.from,
      origin_mode_name: GROUP_NAMES[path.from],
      transfer_hub: path.hubName,
      next_mode: path.via,
      next_mode_name: GROUP_NAMES[path.via],
      destination: path.toName,
      evidence: path.confidence === 0 ? 'observed' : 'strongly_inferred',
      journeys: path.n,
    }))
}

function anomalyEvidence(filters) {
  const rows = []
  for (const [positionIndex, position] of positionsFor(filters, true).entries()) {
    for (const stop of stops.filter((item) => stopMatches(item, filters))) {
      const state = stopState(stop, position)
      if (state.typical === null || state.typical < 50 || state.change === null) continue
      const difference = state.v - state.typical
      if (Math.abs(difference) < 60 || (state.change < 1 && state.change > -0.6)) continue
      rows.push({
        key: `${stop.id}-${position.key}`,
        stop: stop.name,
        area: stop.area,
        zone: String(stop.zone),
        lat: stop.lat,
        lon: stop.lon,
        mode: stop.group,
        lines: stop.lines ?? [],
        period: `${position.title} ${position.label}`,
        observed: Math.round(state.v),
        expected: Math.round(state.typical),
        change_pct: Math.round(state.change * 100),
        position_index: positionIndex,
      })
    }
  }
  return rows
    .sort((a, b) => Math.abs(b.observed - b.expected) - Math.abs(a.observed - a.expected))
    .slice(0, 16)
}

function flowEvidence(filters) {
  const totals = new Map()
  const confidences = filters.evidence.length ? filters.evidence : [0, 1]
  for (const position of positionsFor(filters)) {
    for (const flow of flowsAt(position, confidences)) {
      if (filters.locations.length
        && !filters.locations.includes(String(flow.a))
        && !filters.locations.includes(String(flow.b))) continue
      const current = totals.get(flow.key) ?? { a: flow.a, b: flow.b, n: 0, observed: 0, inferred: 0, weak: 0 }
      current.n += flow.n
      current.observed += flow.byConf[0]
      current.inferred += flow.byConf[1]
      current.weak += flow.byConf[2]
      totals.set(flow.key, current)
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 20)
    .map((flow) => ({
      key: `${flow.a}-${flow.b}`,
      from: zones[flow.a].name,
      to: zones[flow.b].name,
      from_zone: String(flow.a),
      to_zone: String(flow.b),
      journeys: Math.round(flow.n),
      observed: Math.round(flow.observed),
      strongly_inferred: Math.round(flow.inferred),
      weakly_inferred: Math.round(flow.weak),
    }))
}

function filterLimitations(intent, filters) {
  const limitations = []
  if (intent === 'supply' && filters.evidence.length) {
    limitations.push('Journey-confidence filters do not apply to validation and scheduled-departure totals.')
  }
  if (intent === 'route' && (filters.modes.length || filters.lines.length)) {
    limitations.push('Route-opportunity OD aggregates do not retain mode or line attribution; location and time filters still apply.')
  }
  if (intent === 'route' && filters.evidence.length && (filters.days.length || filters.fromTime !== null || filters.toTime !== null)) {
    limitations.push('The source does not retain the joint time-by-confidence split for route opportunities, so time takes precedence over evidence in the filtered total.')
  }
  if (intent === 'transfer' && (filters.lines.length || filters.days.length || filters.fromTime !== null || filters.toTime !== null)) {
    limitations.push('Journey-layer aggregates support location, mode and evidence filters, but not line, date or time filters.')
  }
  if (intent === 'flow' && (filters.modes.length || filters.lines.length)) {
    limitations.push('Zone-to-zone flow aggregates support location, date, time and evidence filters, but do not retain mode or line attribution.')
  }
  if (intent === 'anomaly' && filters.evidence.length) {
    limitations.push('Journey-confidence filters do not apply to stop validation anomalies.')
  }
  return limitations
}

export function buildAssistantContext(question, suppliedFilters = EMPTY_FILTERS) {
  const filters = { ...EMPTY_FILTERS, ...suppliedFilters }
  const intent = classifyQuestion(question)
  const evidence =
    intent === 'supply' ? supplyEvidence(filters)
      : intent === 'transfer' ? transferEvidence(filters)
        : intent === 'anomaly' ? anomalyEvidence(filters)
          : intent === 'flow' ? flowEvidence(filters)
            : routeEvidence(filters)

  return {
    schema_version: '1.1',
    intent,
    question,
    applied_filters: {
      ...filters,
      human_summary: filterSummary(filters),
      logic: 'OR within each filter dimension; AND across different dimensions.',
    },
    filter_limitations: filterLimitations(intent, filters),
    sample: {
      validations: meta.validations,
      entries: meta.entries,
      anonymous_cards: meta.cards,
      transfer_events: overview.meta.transfers,
      slot_minutes: meta.slotMinutes,
      coverage_windows: meta.windows,
    },
    evidence,
    evidence_rules: {
      observed: 'Metro entry and exit recorded for the same anonymous card.',
      strongly_inferred: 'The same anonymous card boards a different line within 60 minutes.',
      route_opportunity: 'Recurring flow on at least three sampled days with no one-seat trip in the applicable GTFS.',
      demand_pressure: 'Validations per scheduled departure divided by nominal mode capacity; not measured occupancy.',
    },
    caveats: [
      'The sample contains about 48 covered hours across five weekdays and has gaps.',
      'Bus and ferry exits are not recorded, so some destinations are inferred.',
      'A route suggestion requires operational, cost, infrastructure and longer-period validation.',
    ],
    allowed_charts: CHART_TYPES,
  }
}
