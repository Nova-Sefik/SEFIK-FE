import { CONFIDENCE, GROUP_NAMES, lines, slots, zones } from '../lib/model'

export const EMPTY_FILTERS = {
  locations: [],
  modes: [],
  lines: [],
  days: [],
  fromTime: null,
  toTime: null,
  evidence: [],
}

export const LOCATION_OPTIONS = zones.map((zone) => ({
  id: String(zone.id),
  label: zone.name,
  detail: zone.area,
}))

export const MODE_OPTIONS = Object.entries(GROUP_NAMES).map(([id, label]) => ({ id, label }))

const seenLines = new Set()
export const LINE_OPTIONS = lines
  .map((line) => ({
    id: `${line.group}:${line.line}`,
    label: line.line,
    detail: [GROUP_NAMES[line.group], line.name].filter(Boolean).join(' · '),
  }))
  .filter((line) => !seenLines.has(line.id) && seenLines.add(line.id))

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
export const DAY_OPTIONS = [...new Set(slots.map((slot) => slot.date))].map((date) => ({
  id: date,
  label: dayFormat.format(new Date(`${date}T12:00:00`)),
}))

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const minute = index * 30
  const hour = Math.floor(minute / 60)
  const mins = minute % 60
  return { id: minute, label: `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}` }
})

const sampledTimes = new Set(slots.map((slot) => slot.tod))
export const TIMELINE_OPTIONS = TIME_OPTIONS
  .filter((option) => sampledTimes.has(option.id))
  .sort((a, b) => ((a.id - 240 + 1440) % 1440) - ((b.id - 240 + 1440) % 1440))

export const EVIDENCE_OPTIONS = CONFIDENCE.map((item) => ({ id: item.id, label: item.label }))

const normalise = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function toggleList(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function toggleFilter(filters, key, value) {
  return { ...filters, [key]: toggleList(filters[key], value) }
}

function parseMinute(hour, minute = '0') {
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) return null
  return (h % 24) * 60 + m
}

export function resolveNaturalLanguageFilters(question, current) {
  const q = normalise(question)
  const resetAll = /clear (all )?filters|reset (all )?filters|show all data|without filters|no filters/.test(q)
  const next = resetAll ? { ...EMPTY_FILTERS } : { ...current }

  if (/all locations|any location/.test(q)) next.locations = []
  if (/all modes|any mode/.test(q)) next.modes = []
  if (/all lines|any line/.test(q)) next.lines = []
  if (/all days|any day/.test(q)) next.days = []
  if (/all times|any time|whole day/.test(q)) {
    next.fromTime = null
    next.toTime = null
  }

  const locations = LOCATION_OPTIONS
    .filter((option) => q.includes(normalise(option.label)))
    .map((option) => option.id)
  if (locations.length) next.locations = locations

  const modes = []
  if (/\bmetro\b|subway/.test(q)) modes.push('metro')
  if (/carris metropolitana|\bcm\b/.test(q)) modes.push('cm')
  if (/\bcarris\b/.test(q) && !/carris metropolitana/.test(q)) modes.push('carris')
  if (/\bbus(es)?\b/.test(q)) modes.push('carris', 'cm')
  if (/ferry|boat|rail|train|fertagus|mobicascais|other (mode|operator)/.test(q)) modes.push('other')
  if (modes.length) next.modes = [...new Set(modes)]

  const selectedLines = LINE_OPTIONS
    .filter((option) => {
      const label = normalise(option.label)
      if (!label) return false
      if (/^\d{1,2}$/.test(label)) return new RegExp(`\\b(?:line|route)\\s+${escapeRegExp(label)}\\b`).test(q)
      return new RegExp(`\\b${escapeRegExp(label)}\\b`).test(q)
    })
    .map((option) => option.id)
  if (selectedLines.length) next.lines = selectedLines

  const days = DAY_OPTIONS.filter((option) => {
    const date = new Date(`${option.id}T12:00:00`)
    const longDay = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date).toLowerCase()
    const shortDay = longDay.slice(0, 3)
    return q.includes(option.id) || q.includes(longDay) || new RegExp(`\\b${shortDay}\\b`).test(q)
  }).map((option) => option.id)
  if (days.length) next.days = days

  const range = q.match(/(?:from|between)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:to|until|through|and|[-–])\s*(\d{1,2})(?::(\d{2}))?/)
  if (range) {
    next.fromTime = parseMinute(range[1], range[2])
    next.toTime = parseMinute(range[3], range[4])
  } else if (/morning peak|morning rush/.test(q)) {
    next.fromTime = 7 * 60
    next.toTime = 10 * 60
  } else if (/evening peak|evening rush/.test(q)) {
    next.fromTime = 16 * 60
    next.toTime = 20 * 60
  }

  const evidence = []
  if (/observed|confirmed|tap.?out/.test(q)) evidence.push(0)
  if (/strong|transfer|within 60/.test(q)) evidence.push(1)
  if (/weak|same day/.test(q)) evidence.push(2)
  if (evidence.length) next.evidence = evidence

  return next
}

export function activeFilterCount(filters) {
  return filters.locations.length + filters.modes.length + filters.lines.length + filters.days.length
    + filters.evidence.length + Number(filters.fromTime !== null) + Number(filters.toTime !== null)
}

export function filterSummary(filters) {
  const labels = []
  if (filters.locations.length) labels.push(filters.locations.map((id) => LOCATION_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean).join(' or '))
  if (filters.modes.length) labels.push(filters.modes.map((id) => GROUP_NAMES[id]).join(' or '))
  if (filters.lines.length) labels.push(filters.lines.map((id) => LINE_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean).join(' or '))
  if (filters.days.length) labels.push(filters.days.map((id) => DAY_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean).join(' or '))
  if (filters.fromTime !== null || filters.toTime !== null) {
    const label = (minute, fallback) => TIME_OPTIONS.find((o) => o.id === minute)?.label ?? fallback
    labels.push(`${label(filters.fromTime, 'start')}–${label(filters.toTime, 'end')}`)
  }
  if (filters.evidence.length) labels.push(filters.evidence.map((id) => EVIDENCE_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean).join(' or '))
  return labels.length ? labels.join(' · ') : 'All locations, modes and sampled times'
}
