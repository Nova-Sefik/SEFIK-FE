const OPERATORS = ['metro', 'carris', 'cm', 'rail', 'ferry', 'other']

const apiUrl = () => (process.env.PULSO_API_URL || process.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

const commonProperties = {
  day: { type: ['string', 'null'], description: 'ISO service date. Null keeps the current explorer day.' },
  hour: { type: ['integer', 'null'], minimum: 5, maximum: 24, description: 'Service hour. Null keeps the current explorer hour.' },
  ops: { type: 'array', items: { type: 'string', enum: OPERATORS }, description: 'Operators to include. Empty keeps the current explorer operators.' },
  segment: { type: ['string', 'null'], enum: ['all', 'sub23', 'senior', null], description: 'Passenger segment. Null keeps the current explorer segment.' },
  limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum evidence rows.' },
}

const commonParameters = {
  type: 'object', additionalProperties: false,
  required: Object.keys(commonProperties), properties: commonProperties,
}

export const LIVE_DATA_TOOLS = [
  {
    type: 'function', name: 'query_live_stop_demand', strict: true,
    description: 'Query the live mobility backend for stop boardings compared with the backend expected baseline at the current or requested day, hour, operators, and passenger segment.',
    parameters: commonParameters,
  },
  {
    type: 'function', name: 'query_live_line_capacity', strict: true,
    description: 'Query live backend line profiles for estimated peak on-board load and places offered. Use this for capacity, crowding, frequency, and line pressure questions.',
    parameters: {
      type: 'object', additionalProperties: false,
      required: [...Object.keys(commonProperties), 'line_id'],
      properties: { ...commonProperties, line_id: { type: ['string', 'null'], description: 'Backend line id or label. Null compares every line with capacity data.' } },
    },
  },
  {
    type: 'function', name: 'query_live_transfers', strict: true,
    description: 'Query live backend interchange volumes, operator pairs, and median/p90 transfer waits for a day.',
    parameters: commonParameters,
  },
  {
    type: 'function', name: 'query_live_anomalies', strict: true,
    description: 'Query backend-detected stop-hour anomalies with observed and expected boardings. Use this for unusual activity, spikes, drops, and alerts.',
    parameters: commonParameters,
  },
  {
    type: 'function', name: 'query_live_golden_routes', strict: true,
    description: 'Query backend-ranked direct-line opportunities where many weekday journeys currently need multiple vehicles. Use this for best route, golden route, direct-line, time-saving, projected ridership, and network-wide route opportunity questions.',
    parameters: {
      type: 'object', additionalProperties: false,
      required: ['origin', 'destination', 'verdict', 'limit'],
      properties: {
        origin: { type: ['string', 'null'], description: 'Optional origin place name. Null searches the whole ranked network.' },
        destination: { type: ['string', 'null'], description: 'Optional destination place name. Null searches the whole ranked network.' },
        verdict: { type: ['string', 'null'], enum: ['strong', 'viable', 'weak', null], description: 'Optional backend verdict filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum ranked routes to return.' },
      },
    },
  },
]

async function get(path, params = {}) {
  const url = new URL(`${apiUrl()}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.detail || `Mobility API returned ${response.status}.`), { status: response.status })
  }
  return response.json()
}

function resolved(args, base = {}) {
  return {
    day: args.day || base.day || '2026-09-01',
    hour: args.hour ?? base.hour ?? 8,
    ops: args.ops?.length ? args.ops : base.ops?.length ? base.ops : OPERATORS,
    segment: args.segment || base.segment || 'all',
    limit: args.limit || 16,
  }
}

function applied(filters) {
  return {
    day: filters.day, hour: filters.hour, ops: filters.ops, segment: filters.segment,
    human_summary: `${filters.day} · ${String(filters.hour).padStart(2, '0')}:00 · ${filters.ops.join(', ')} · ${filters.segment}`,
    logic: 'Operators use OR; day, hour, operator selection, and passenger segment use AND.',
  }
}

export async function executeLiveDataTool(name, args = {}, baseFilters = {}) {
  const filters = resolved(args, baseFilters)
  const shared = { day: filters.day, ops: filters.ops.join(','), segment: filters.segment }

  if (name === 'query_live_golden_routes') {
    const data = await get('/api/golden')
    const origin = args.origin?.trim().toLowerCase()
    const destination = args.destination?.trim().toLowerCase()
    const matches = (place, query) => !query || place.name.toLowerCase().includes(query) || place.stop_id.toLowerCase().includes(query)
    const matchesPair = (route) => {
      if (origin && destination) {
        return (matches(route.from, origin) && matches(route.to, destination))
          || (matches(route.from, destination) && matches(route.to, origin))
      }
      if (origin) return matches(route.from, origin) || matches(route.to, origin)
      if (destination) return matches(route.from, destination) || matches(route.to, destination)
      return true
    }
    const evidence = data.routes
      .filter(matchesPair)
      .filter((route) => !args.verdict || route.verdict === args.verdict)
      .slice(0, args.limit || 16)
      .map((route) => ({
          key: route.route_id,
          rank: route.rank,
          from: route.from.name,
          to: route.to.name,
          from_place: route.from,
          to_place: route.to,
          from_to: route.from_to_per_day,
          to_from: route.to_from_per_day,
          supported_journeys: route.multi_per_day,
          multi_vehicle_journeys_per_day: route.multi_per_day,
          existing_direct_journeys_per_day: route.direct_per_day,
          multi_vehicle_share: route.multi_share,
          average_legs: route.avg_legs,
          current_minutes: route.current_min,
          projected_minutes: route.projected_min,
          minutes_saved: route.saved_min,
          projected_riders_per_day: route.riders_per_day,
          person_hours_saved_per_day: route.person_hours_per_day,
          peak_hour: route.peak_hour,
          peak_riders: route.peak_riders,
          trips_needed_at_peak: route.trips_needed_peak,
          peak_headway_minutes: route.peak_headway_min,
          distance_km: route.distance_km,
          demand_spike_z: route.spike_z,
          demand_top_percent: route.demand_top_percent,
          verdict: route.verdict,
          flags: route.flags,
          hourly: route.hourly,
          current_paths: route.paths,
          shown_paths_share: route.shown_paths_share,
          affected_lines: route.replaced,
          transfer_hubs_removed: route.hubs,
          current_direct_lines: route.direct_lines,
          measure: 'backend_ranked_direct_line',
        }))
    return {
      schema_version: 'live-1.0', source: 'mobility_backend', analysis: 'route', intent: 'route', evidence,
      applied_filters: {
        origin: args.origin ?? null,
        destination: args.destination ?? null,
        verdict: args.verdict ?? null,
        human_summary: [args.origin && `from ${args.origin}`, args.destination && `to ${args.destination}`, args.verdict].filter(Boolean).join(' · ') || 'all ranked routes',
        logic: 'Named endpoints are matched as a bidirectional pair, then combined with verdict using AND. Ranking is supplied by the backend.',
      },
      allowed_charts: ['route_opportunities', 'mobility_map'],
      filter_limitations: [data.method, 'Golden routes describe a typical weekday and do not use the explorer day, hour, operator, or passenger-segment filters.'],
      assumptions: data.assumptions,
    }
  }

  if (name === 'query_live_stop_demand') {
    const data = await get('/api/stops', { ...shared, hour: filters.hour })
    const evidence = data.stops
      .sort((a, b) => b.boardings - a.boardings)
      .slice(0, filters.limit)
      .map((row) => ({
        key: row.stop_id, stop_id: row.stop_id, stop: row.name, lat: row.lat, lon: row.lon,
        mode: row.operators.join(', '), validations: row.boardings, departures: 1,
        validations_per_departure: row.boardings, nominal_capacity: row.expected,
        pressure_pct: Math.round(row.ratio * 100), boardings: row.boardings, expected: row.expected,
        measure: 'boardings_vs_expected', period: `${filters.day} ${String(filters.hour).padStart(2, '0')}:00`,
      }))
    return {
      schema_version: 'live-1.0', source: 'mobility_backend', analysis: 'supply', intent: 'supply', evidence,
      applied_filters: applied(filters), allowed_charts: ['demand_supply', 'mobility_map'],
      filter_limitations: ['Expected boardings are a same-time baseline, not vehicle capacity. Use the line-capacity tool for capacity claims.'],
    }
  }

  if (name === 'query_live_line_capacity') {
    const meta = await get('/api/meta')
    const requested = args.line_id?.toLowerCase()
    const lines = requested
      ? meta.lines.filter((line) => line.line_id.toLowerCase() === requested || line.label.toLowerCase() === requested)
      : meta.lines
    const profiles = await Promise.all(lines.map((line) => get(`/api/lines/${encodeURIComponent(line.line_id)}/profile`, { day: filters.day })))
    const evidence = profiles.map((profile) => {
      const at = profile.hours.find((item) => item.hour === filters.hour) ?? profile.hours.reduce((best, item) => item.load_factor > best.load_factor ? item : best)
      return {
        key: `${profile.line_id}-${at.hour}`, stop: `${profile.label} · ${profile.name}`, line_id: profile.line_id,
        mode: profile.mode, operator: profile.operator, period: `${filters.day} ${String(at.hour).padStart(2, '0')}:00`,
        validations: at.boardings, departures: at.trips, validations_per_departure: at.est_peak_load,
        nominal_capacity: at.places_offered, pressure_pct: Math.round(at.load_factor * 100),
        estimated_peak_load: at.est_peak_load, places_offered: at.places_offered, trips: at.trips,
        measure: 'estimated_load_vs_places', vehicle_places: profile.vehicle.places,
      }
    }).sort((a, b) => b.pressure_pct - a.pressure_pct).slice(0, filters.limit)
    return {
      schema_version: 'live-1.0', source: 'mobility_backend', analysis: 'supply', intent: 'supply', evidence,
      applied_filters: applied(filters), allowed_charts: ['demand_supply'],
      filter_limitations: ['On-board load is estimated from boardings and inferred alightings; it is not measured occupancy.'],
    }
  }

  if (name === 'query_live_transfers') {
    const data = await get('/api/transfers', { day: filters.day })
    const evidence = data.interchanges.slice(0, filters.limit).map((row) => ({
      key: row.stop_id, stop_id: row.stop_id, stop: row.name, lat: row.lat, lon: row.lon,
      observed: row.transfers, expected: 0, change_pct: row.worst_median_wait_min,
      transfers: row.transfers, worst_median_wait_min: row.worst_median_wait_min,
      fragile: row.fragile, pairs: row.pairs, period: filters.day,
    }))
    return {
      schema_version: 'live-1.0', source: 'mobility_backend', analysis: 'transfer', intent: 'transfer', evidence,
      applied_filters: applied(filters), allowed_charts: ['mobility_map'],
      filter_limitations: [data.method, 'The transfer aggregate is day-level; hour, operator, and passenger-segment filters do not apply.'],
    }
  }

  if (name === 'query_live_anomalies') {
    const data = await get('/api/anomalies', args.day ? { day: filters.day } : {})
    const evidence = data.alerts.slice(0, filters.limit).map((row) => ({
      key: row.alert_id, stop_id: row.stop_id, stop: row.name, lat: row.lat, lon: row.lon,
      period: `${row.date} ${String(row.hour).padStart(2, '0')}:00`, observed: row.observed,
      expected: row.expected, change_pct: row.deviation_pct, robust_z: row.robust_z, direction: row.direction,
    }))
    return {
      schema_version: 'live-1.0', source: 'mobility_backend', analysis: 'anomaly', intent: 'anomaly', evidence,
      applied_filters: applied(filters), allowed_charts: ['anomalies', 'mobility_map'],
      filter_limitations: [data.method, 'The week alert feed is not segmented by operator or passenger type.'],
    }
  }

  throw new Error(`Unknown live data tool: ${name}`)
}
