/* oxlint-disable react/only-export-components, react/set-state-in-effect */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { liveApi } from './api'
import useLiveQuery from './useLiveQuery'
import { ALL_OPERATORS } from './utils'

const STORAGE_KEY = 'sefik-live-filters'
const LiveDataContext = createContext(null)

// Places are {stop_id, name}; the backend resolves and filters, the browser only asks.
export const EMPTY_JOURNEY = { origin: null, through: [], destination: null, any: [], match: 'contains', minVolume: 0, wholeDay: false }
const PAGE = 50

function storedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      day: typeof saved.day === 'string' ? saved.day : '2026-09-01',
      hour: Number.isFinite(saved.hour) ? saved.hour : 8,
      ops: Array.isArray(saved.ops) && saved.ops.length ? saved.ops : ALL_OPERATORS,
      segment: typeof saved.segment === 'string' ? saved.segment : 'all',
    }
  } catch {
    return { day: '2026-09-01', hour: 8, ops: ALL_OPERATORS, segment: 'all' }
  }
}

export function LiveDataProvider({ children }) {
  const initial = useMemo(() => storedFilters(), [])
  const [day, setDay] = useState(initial.day)
  const [hour, setHour] = useState(initial.hour)
  const [ops, setOps] = useState(initial.ops)
  const [segment, setSegment] = useState(initial.segment)
  const [mode, setMode] = useState('demand')
  const [layer, setLayer] = useState('hex')
  const [selectedStop, setSelectedStop] = useState(null)
  const [selectedLine, setSelectedLine] = useState(null)
  const [selectedTransfer, setSelectedTransfer] = useState(null)
  const [selectedFlow, setSelectedFlow] = useState(null)
  const [selectedGolden, setSelectedGolden] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [whatif, setWhatif] = useState(0)
  const [journey, setJourneyState] = useState(EMPTY_JOURNEY)
  const [journeyLimit, setJourneyLimit] = useState(PAGE)
  const [journeyView, setJourneyView] = useState('map')
  const [selectedPath, setSelectedPath] = useState(null)
  const [playing, setPlaying] = useState(false)

  const meta = useLiveQuery('meta', () => liveApi.meta())

  useEffect(() => {
    const days = meta.data?.days
    if (days?.length && !days.some((item) => item.date === day)) {
      setDay((days.find((item) => !item.is_weekend) ?? days[0]).date)
    }
  }, [meta.data, day])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, hour, ops, segment }))
  }, [day, hour, ops, segment])

  useEffect(() => {
    if (!playing) return undefined
    const hours = meta.data?.hours?.map((item) => item.hour) ?? []
    if (!hours.length) return undefined
    const timer = setInterval(() => {
      setHour((current) => {
        const index = hours.indexOf(current)
        return hours[(index + 1) % hours.length]
      })
    }, 900)
    return () => clearInterval(timer)
  }, [playing, meta.data])

  const filters = useMemo(() => ({ day, ops, segment }), [day, ops, segment])
  const filterKey = `${day}|${ops.join(',')}|${segment}`
  const referenceDay = meta.data?.days?.find((item) => !item.is_weekend)?.date
  const scaleReference = useLiveQuery(
    `scales|${referenceDay}|${ops.join(',')}|${segment}`,
    async () => {
      const allFilters = { day: referenceDay, ops: ALL_OPERATORS, segment: 'all' }
      const currentFilters = { day: referenceDay, ops, segment }
      const [all, current] = await Promise.all([liveApi.overview(allFilters), liveApi.overview(currentFilters)])
      const peak = (value) => Math.max(1, ...value.network_hourly.map((item) => item.boardings))
      return Math.min(1, Math.max(0.02, peak(current) / peak(all)))
    },
    { enabled: Boolean(referenceDay) },
  )
  const scales = useMemo(() => {
    const source = meta.data?.scales
    if (!source) return null
    const ratio = scaleReference.data ?? 1
    return {
      stop_boardings_max: source.stop_boardings_max * ratio,
      hex_boardings_max: source.hex_boardings_max * ratio,
      network_hour_max: source.network_hour_max * ratio,
    }
  }, [meta.data, scaleReference.data])
  const overview = useLiveQuery(`overview|${filterKey}`, () => liveApi.overview(filters), { enabled: Boolean(meta.data) })
  const hex = useLiveQuery(`hex|${filterKey}|${hour}`, () => liveApi.hex(filters, hour), { enabled: Boolean(meta.data) })
  const stops = useLiveQuery(`stops|${filterKey}|${hour}`, () => liveApi.stops(filters, hour), { enabled: Boolean(meta.data) })
  const anomalies = useLiveQuery('anomalies|week', () => liveApi.anomalies(), { enabled: Boolean(meta.data) })
  const transfers = useLiveQuery(`transfers|${day}`, () => liveApi.transfers(day), { enabled: Boolean(meta.data) })
  const golden = useLiveQuery('golden', () => liveApi.golden(), { enabled: Boolean(meta.data) })
  const journeyParams = useMemo(() => ({
    day,
    hour: journey.wholeDay ? undefined : hour,
    origin: journey.origin?.stop_id,
    through: journey.through.map((place) => place.stop_id).join(','),
    destination: journey.destination?.stop_id,
    any: journey.any.map((place) => place.stop_id).join(','),
    match: journey.match,
    min_volume: journey.minVolume,
    limit: journeyLimit,
  }), [day, hour, journey, journeyLimit])
  const journeyTraffic = useLiveQuery(
    `journey|${JSON.stringify(journeyParams)}`,
    () => liveApi.journeyTraffic(journeyParams),
    { enabled: Boolean(meta.data) && mode === 'journeys' },
  )
  const setJourney = (update) => {
    setJourneyState((current) => ({ ...current, ...(typeof update === 'function' ? update(current) : update) }))
    setJourneyLimit(PAGE)
    setSelectedPath(null)
  }
  const showMorePaths = () => setJourneyLimit((current) => Math.min(500, current + PAGE))
  const stopDetail = useLiveQuery(
    `stop|${selectedStop}|${filterKey}|${hour}`,
    () => liveApi.stop(selectedStop, filters, hour),
    { enabled: Boolean(meta.data && selectedStop) },
  )

  useEffect(() => {
    if (window.location.hash.startsWith('#/assistant')) return undefined
    const hours = meta.data?.hours?.map((item) => item.hour) ?? []
    if (!hours.length) return undefined
    const prefetch = () => {
      for (const item of hours) {
        liveApi.hex(filters, item).catch(() => {})
        liveApi.stops(filters, item).catch(() => {})
      }
    }
    const id = 'requestIdleCallback' in window ? window.requestIdleCallback(prefetch, { timeout: 2000 }) : window.setTimeout(prefetch, 300)
    return () => {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(id)
      else window.clearTimeout(id)
    }
  }, [filterKey, filters, meta.data])

  const toggleOperator = (operator) => {
    setOps((current) => {
      if (current.includes(operator)) return current.length === 1 ? current : current.filter((item) => item !== operator)
      return ALL_OPERATORS.filter((item) => current.includes(item) || item === operator)
    })
  }

  const openStop = (id) => {
    setSelectedStop(id)
    setMode('demand')
  }

  const setDaySafe = (value) => {
    setPlaying(false)
    setDay(value)
  }

  const value = {
    meta, overview, hex, stops, anomalies, transfers, golden, stopDetail, scales,
    journey, setJourney, journeyTraffic, showMorePaths, journeyView, setJourneyView, selectedPath, setSelectedPath,
    filters, day, setDay: setDaySafe, hour, setHour, ops, setOps, toggleOperator, segment, setSegment,
    mode, setMode, layer, setLayer, selectedStop, setSelectedStop, openStop,
    selectedLine, setSelectedLine, selectedTransfer, setSelectedTransfer, selectedFlow, setSelectedFlow,
    selectedGolden, setSelectedGolden,
    selectedAlert, setSelectedAlert, whatif, setWhatif, playing, setPlaying,
  }

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>
}

export function useLiveData() {
  const value = useContext(LiveDataContext)
  if (!value) throw new Error('useLiveData must be used inside LiveDataProvider')
  return value
}
