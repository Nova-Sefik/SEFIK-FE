import { hourLabel } from '../live/utils'

// "22:00–01:00" style ranges for a list of covered service hours (24 = 00:00–00:59)
export function formatHours(hours = []) {
  const runs = []
  for (const hour of [...hours].sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && hour === last[1] + 1) last[1] = hour
    else runs.push([hour, hour])
  }
  return runs.map(([start, end]) => `${hourLabel(start)}–${end === 24 ? '01:00' : hourLabel(end + 1)}`).join(', ')
}

// Periods that do have journey data: the selected day's covered hours nearest the requested
// hour first, then the nearest covered hour on each other day. Uses backend coverage only.
export function coverageSuggestions(coverage, day, hour, limit = 4) {
  const target = hour ?? 12
  const distance = (value) => Math.abs(value - target)
  const sameDay = (coverage?.covered_days?.find((item) => item.date === day)?.hours ?? [])
    .map((value) => ({ date: day, hour: value }))
    .sort((a, b) => distance(a.hour) - distance(b.hour))
  const otherDays = (coverage?.covered_days ?? [])
    .filter((item) => item.date !== day && item.hours.length)
    .map((item) => ({ date: item.date, hour: item.hours.reduce((best, value) => (distance(value) < distance(best) ? value : best)) }))
  return [...sameDay.slice(0, 2), ...otherDays].slice(0, limit)
}
