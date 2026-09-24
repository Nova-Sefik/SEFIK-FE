import { readFileSync } from 'node:fs'

const demand = JSON.parse(readFileSync(new URL('../src/data/demand.json', import.meta.url), 'utf8'))
const graph = JSON.parse(readFileSync(new URL('../src/data/transit-graph.json', import.meta.url), 'utf8'))
const baselines = JSON.parse(readFileSync(new URL('../src/data/feasibility-baselines.json', import.meta.url), 'utf8'))

export const DEFAULT_FEASIBILITY_ASSUMPTIONS = {
  transfer_wait_minutes: 8,
  route_distance_factor: 1.3,
  average_speed_kmh: 22,
  terminal_and_dwell_minutes: 4,
  capture_rate_pct: 35,
  headway_minutes: 15,
  service_hours: 16,
  cost_per_vehicle_km_eur: 4.5,
  layover_minutes: 10,
}

const adjacency = new Map()
for (const edge of graph.edges) {
  if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
  adjacency.get(edge.from).push(edge)
}

function stateKey(zone, routeId, transfers) {
  return `${zone}|${routeId ?? ''}|${transfers}`
}

function shortestScheduledPath(origin, destination, transferWait) {
  const distances = new Map()
  const previous = new Map()
  const queue = [{ zone: origin, routeId: null, transfers: 0, cost: 0 }]
  distances.set(stateKey(origin, null, 0), 0)
  let winner = null

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const current = queue.shift()
    const currentKey = stateKey(current.zone, current.routeId, current.transfers)
    if (current.cost !== distances.get(currentKey)) continue
    if (current.zone === destination && current.routeId !== null) {
      winner = current
      break
    }
    for (const edge of adjacency.get(current.zone) ?? []) {
      const switches = current.routeId !== null && current.routeId !== edge.route_id
      const transfers = current.transfers + Number(switches)
      if (transfers > 3) continue
      const cost = current.cost + edge.median_minutes + (switches ? transferWait : 0)
      const nextKey = stateKey(edge.to, edge.route_id, transfers)
      if (cost >= (distances.get(nextKey) ?? Infinity)) continue
      distances.set(nextKey, cost)
      previous.set(nextKey, { state: current, edge })
      queue.push({ zone: edge.to, routeId: edge.route_id, transfers, cost })
    }
  }

  if (!winner) return null
  const edges = []
  let cursor = winner
  while (cursor.routeId !== null) {
    const step = previous.get(stateKey(cursor.zone, cursor.routeId, cursor.transfers))
    if (!step) break
    edges.unshift(step.edge)
    cursor = step.state
  }
  const segments = []
  for (const edge of edges) {
    const last = segments.at(-1)
    if (last?.route_id === edge.route_id) {
      last.to_zone = String(edge.to)
      last.to = demand.zones[edge.to]?.name
      last.ride_minutes = Number((last.ride_minutes + edge.median_minutes).toFixed(1))
      last.scheduled_trips = Math.min(last.scheduled_trips, edge.scheduled_trips)
    } else {
      segments.push({
        route_id: edge.route_id,
        line: edge.line,
        label: edge.label,
        mode: edge.mode,
        operator: edge.operator,
        from_zone: String(edge.from),
        to_zone: String(edge.to),
        from: demand.zones[edge.from]?.name,
        to: demand.zones[edge.to]?.name,
        ride_minutes: edge.median_minutes,
        scheduled_trips: edge.scheduled_trips,
      })
    }
  }
  const rideMinutes = Number(segments.reduce((sum, segment) => sum + segment.ride_minutes, 0).toFixed(1))
  const transfers = Math.max(0, segments.length - 1)
  return {
    segments,
    transfers,
    scheduled_ride_minutes: rideMinutes,
    assumed_transfer_wait_minutes: transfers * transferWait,
    estimated_total_minutes: Number((rideMinutes + transfers * transferWait).toFixed(1)),
  }
}

export function calculateRouteFeasibility(row, supplied = {}) {
  const assumptions = { ...DEFAULT_FEASIBILITY_ASSUMPTIONS, ...supplied }
  const origin = Number(row.from_zone)
  const destination = Number(row.to_zone)
  const storedBaseline = baselines.routes[row.key]
  const current = storedBaseline
    ? structuredClone(storedBaseline)
    : shortestScheduledPath(origin, destination, assumptions.transfer_wait_minutes)
  if (current) {
    current.segments = current.segments.map((segment, index) => ({
      ...segment,
      from: index === 0 ? row.from : (segment.from_stop ?? segment.from),
      to: index === current.segments.length - 1 ? row.to : (segment.to_stop ?? segment.to),
    }))
    current.baseline_without_transfer_wait = Number((
      current.estimated_total_minutes - (current.assumed_transfer_wait_minutes ?? 0)
    ).toFixed(1))
    current.assumed_transfer_wait_minutes = current.transfers * assumptions.transfer_wait_minutes
    current.estimated_total_minutes = Number((
      current.baseline_without_transfer_wait + current.assumed_transfer_wait_minutes
    ).toFixed(1))
  }
  const directDistance = Number((row.straight_line_km * assumptions.route_distance_factor).toFixed(1))
  const directRideMinutes = Number((directDistance / assumptions.average_speed_kmh * 60).toFixed(1))
  // Riders walk to and from the same stations whichever service they use, so the
  // direct option carries the current path's access/egress walk too
  const accessEgressMinutes = current?.access_egress_walk_minutes ?? 0
  const directMinutes = Number((directRideMinutes + assumptions.terminal_and_dwell_minutes + accessEgressMinutes).toFixed(1))
  const sampleDays = Math.max(1, row.sampled_days)
  const supportedPerSampledDay = row.supported_journeys / sampleDays
  const captured = supportedPerSampledDay * assumptions.capture_rate_pct / 100
  const departuresPerDirection = Math.ceil(assumptions.service_hours * 60 / assumptions.headway_minutes)
  const vehicleKm = directDistance * departuresPerDirection * 2
  const dailyCost = vehicleKm * assumptions.cost_per_vehicle_km_eur
  const cycleMinutes = (directRideMinutes + assumptions.terminal_and_dwell_minutes) * 2 + assumptions.layover_minutes

  return {
    key: row.key,
    from: row.from,
    to: row.to,
    from_zone: String(row.from_zone),
    to_zone: String(row.to_zone),
    evidence: {
      supported_journeys: row.supported_journeys,
      sampled_days: row.sampled_days,
      observed: row.observed,
      strongly_inferred: row.strongly_inferred,
      straight_line_km: row.straight_line_km,
    },
    current: current ? {
      available: true,
      ...current,
      source: storedBaseline
        ? `Stop-level GTFS path active on ${baselines.service_date}; initial service wait excluded.`
        : `Compact GTFS fallback active on ${graph.service_date}.`,
    } : {
      available: false,
      segments: [],
      source: `No path resolved in the compact GTFS graph for ${graph.service_date}`,
    },
    proposed: {
      estimated_route_km: directDistance,
      estimated_ride_minutes: directRideMinutes,
      terminal_and_dwell_minutes: assumptions.terminal_and_dwell_minutes,
      access_egress_walk_minutes: accessEgressMinutes,
      estimated_minutes: directMinutes,
      estimated_time_saved_minutes: current ? Number((current.estimated_total_minutes - directMinutes).toFixed(1)) : null,
    },
    demand: {
      supported_per_sampled_day: Math.round(supportedPerSampledDay),
      captured_in_sampled_windows: Math.round(captured),
    },
    operations: {
      departures_per_direction: departuresPerDirection,
      daily_vehicle_km: Math.round(vehicleKm),
      estimated_daily_cost_eur: Math.round(dailyCost),
      estimated_peak_vehicles: Math.ceil(cycleMinutes / assumptions.headway_minutes),
    },
    assumptions,
    limitations: [
      'The current journey is an indicative stop-level GTFS path for one representative weekday. Initial service wait, fares, reliability and accessibility constraints are excluded.',
      'Both options include the same walk from the origin area to the first station and from the last station to the destination area, so the saving reflects riding and transfer time only.',
      'The proposed alignment, speed, demand capture, headway, service span and unit cost are editable planning assumptions, not observed values.',
      'Likely demand covers only the sampled validation windows and is not a full-day forecast.',
      'Operating cost excludes capital expenditure, deadheading, depot constraints and revenue.',
    ],
  }
}

export function recalculateFeasibility(feasibility, supplied = {}) {
  return calculateRouteFeasibility({
    key: feasibility.key,
    from: feasibility.from,
    to: feasibility.to,
    from_zone: feasibility.from_zone,
    to_zone: feasibility.to_zone,
    straight_line_km: feasibility.evidence.straight_line_km,
    supported_journeys: feasibility.evidence.supported_journeys,
    sampled_days: feasibility.evidence.sampled_days,
    observed: feasibility.evidence.observed,
    strongly_inferred: feasibility.evidence.strongly_inferred,
  }, supplied)
}
