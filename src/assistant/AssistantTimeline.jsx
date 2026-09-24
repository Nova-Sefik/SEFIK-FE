import { useCallback, useEffect, useMemo, useState } from 'react'
import { TIMELINE_OPTIONS } from './filters'

function nearestIndex(minute) {
  if (minute === null) return Math.max(0, TIMELINE_OPTIONS.findIndex((option) => option.id === 8 * 60))
  let best = 0
  for (let index = 1; index < TIMELINE_OPTIONS.length; index += 1) {
    if (Math.abs(TIMELINE_OPTIONS[index].id - minute) < Math.abs(TIMELINE_OPTIONS[best].id - minute)) best = index
  }
  return best
}

function formatMinute(minute) {
  const wrapped = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

export default function AssistantTimeline({ filters, onChange }) {
  const [playing, setPlaying] = useState(false)
  const currentIndex = useMemo(() => nearestIndex(filters.fromTime), [filters.fromTime])
  const selected = filters.fromTime !== null && filters.toTime !== null

  const selectIndex = useCallback((index) => {
    const minute = TIMELINE_OPTIONS[index].id
    onChange({ ...filters, fromTime: minute, toTime: (minute + 30) % 1440 })
  }, [filters, onChange])

  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setTimeout(() => selectIndex((currentIndex + 1) % TIMELINE_OPTIONS.length), 900)
    return () => window.clearTimeout(timer)
  }, [playing, currentIndex, selectIndex])

  return (
    <div className="absolute bottom-3 left-3 right-3 z-[550] rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-float backdrop-blur sm:left-1/2 sm:max-w-2xl sm:-translate-x-1/2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-[10px] text-ink-2 hover:bg-subtle"
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-medium text-ink-2">30-minute timeline</span>
            <span className="tabular-nums text-primary-ink">
              {selected ? `${TIMELINE_OPTIONS[currentIndex].label}–${formatMinute(TIMELINE_OPTIONS[currentIndex].id + 30)}` : 'All sampled times'}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(0, TIMELINE_OPTIONS.length - 1)}
            value={currentIndex}
            onChange={(event) => selectIndex(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer accent-primary"
            aria-label="Select a sampled half-hour"
          />
          <div className="mt-1 flex justify-between text-[9px] text-ink-4">
            <span>04:00 service-day start</span>
            <span>Drag or press play to see movement change</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPlaying(false)
            onChange({ ...filters, fromTime: null, toTime: null })
          }}
          className="shrink-0 rounded-lg px-2 py-1 text-[10px] text-ink-3 hover:bg-subtle hover:text-ink"
        >
          All times
        </button>
      </div>
    </div>
  )
}
