export const ALL_OPERATORS = ['metro', 'carris', 'cm', 'rail', 'ferry', 'other']

export const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })
export const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
export const pct = (value) => `${Math.round(value * 100)}%`
export const signedPct = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value))}%`
export const hourLabel = (hour) => hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`

export const DEMAND_COLORS = ['#d2e3fc', '#aecbfa', '#8ab4f8', '#669df6', '#4285f4', '#1967d2', '#174ea6']
export const ANOMALY_COLORS = ['#2a78d6', '#9ec5f4', '#dadce0', '#f4a7a6', '#d93025']
export const LOAD_COLORS = ['#fef7e0', '#fdd663', '#f9ab00', '#e8710a', '#d93025']

const LOG_BREAKS = [0.3, 0.45, 0.57, 0.68, 0.78, 0.87, 0.94]
const RATIO_BREAKS = [0.6, 0.85, 1.15, 1.4]
const LOAD_BREAKS = [0.5, 0.7, 0.85, 1]
const classify = (value, breaks) => breaks.reduce((count, threshold) => count + Number(value >= threshold), 0)

export function demandColor(value, maximum) {
  const position = value <= 0 ? 0 : Math.log1p(value) / Math.log1p(Math.max(1, maximum))
  return DEMAND_COLORS[Math.max(0, classify(position, LOG_BREAKS) - 1)]
}

export const anomalyColor = (ratio) => ANOMALY_COLORS[classify(ratio, RATIO_BREAKS)]
export const loadColor = (ratio) => LOAD_COLORS[classify(ratio, LOAD_BREAKS)]
export const waitColor = (minutes) => minutes >= 12 ? '#d93025' : minutes >= 8 ? '#b06000' : '#188038'

export function applyWhatIf(profile, count) {
  const hours = profile.hours.map((item) => ({ ...item }))
  const at = (hour) => hours.find((item) => item.hour === hour)
  const moves = Math.min(count, profile.whatif.move_to_hours.length, profile.whatif.move_from_hours.length)
  for (let index = 0; index < moves; index += 1) {
    const to = at(profile.whatif.move_to_hours[index])
    const from = at(profile.whatif.move_from_hours[index])
    if (!to || !from || from.trips <= 0) continue
    to.trips += 1
    to.places_offered += profile.vehicle.places
    from.trips -= 1
    from.places_offered = Math.max(0, from.places_offered - profile.vehicle.places)
  }
  hours.forEach((item) => { item.load_factor = item.places_offered ? item.est_peak_load / item.places_offered : 0 })
  return hours
}

export function curve(from, to, bend = 0.2) {
  const middleLat = (from.lat + to.lat) / 2
  const middleLon = (from.lon + to.lon) / 2
  const controlLat = middleLat - (to.lon - from.lon) * bend
  const controlLon = middleLon + (to.lat - from.lat) * bend
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16
    const u = 1 - t
    return [
      u * u * from.lat + 2 * u * t * controlLat + t * t * to.lat,
      u * u * from.lon + 2 * u * t * controlLon + t * t * to.lon,
    ]
  })
}
