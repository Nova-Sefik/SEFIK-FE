import { integer } from '../live/utils'

const MODE_COLOR = { metro: '#2a78d6', carris: '#eb6834', cm: '#1baf7a', rail: '#eda100', ferry: '#e87ba4', other: '#008300' }

function Change({ value }) {
  if (value == null) return <span className="text-ink-4">–</span>
  return <span className={value >= 0 ? 'text-danger' : 'text-primary-ink'}>{value >= 0 ? '+' : '−'}{Math.abs(Math.round(value))}%</span>
}

// One row per backend path; totals elsewhere are backend totals, never sums of this page.
export default function PathList({ paths, selectedKey, onSelect }) {
  if (!paths.length) return <p className="rounded-xl bg-subtle p-3 text-xs text-ink-3">No paths at or above the thresholds.</p>
  return (
    <div className="-mx-2">
      {paths.map((path) => {
        const selected = path.key === selectedKey
        const stops = path.path ?? path.stops ?? []
        return (
          <button
            key={path.key}
            type="button"
            onClick={() => onSelect?.(selected ? null : path.key)}
            className={`w-full rounded-lg px-2 py-2 text-left ${selected ? 'bg-primary-soft' : 'hover:bg-subtle'}`}
          >
            <span className="flex items-start gap-2 text-[11px]">
              <span className="w-6 shrink-0 tabular-nums text-ink-4">#{path.rank}</span>
              <span className="min-w-0 flex-1 text-ink-2">
                {stops.map((stop) => (typeof stop === 'string' ? stop : stop.name)).join(' → ')}
                {path.destination === 'unknown' && <span className="text-ink-4"> → ?</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink">{integer.format(path.journeys)}</span>
            </span>
            <span className="mt-1 flex items-center gap-2 pl-8 text-[9px] text-ink-4">
              <span className="flex items-center gap-0.5">
                {(path.modes ?? []).map((mode, index) => <span key={`${mode}-${index}`} className="h-1.5 w-3 rounded-full" style={{ background: MODE_COLOR[mode] ?? '#9aa0a6' }} title={mode} />)}
              </span>
              <span>{path.destination === 'known' ? `${Math.round((path.metro_exit_share ?? 0) * 100)}% Metro-exit confirmed` : 'destination unknown'}</span>
              <span className="ml-auto">vs typical <Change value={path.difference_pct} /></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
