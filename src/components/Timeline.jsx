import { ABOVE, fmt, fmtPct } from './theme'

// Break a series into runs at data gaps so no line is drawn across them
function segments(values, positions) {
  const runs = []
  values.forEach((v, k) => {
    if (k === 0 || positions[k].gapBefore) runs.push([])
    runs.at(-1).push([k, v])
  })
  return runs
}

export default function Timeline({ lens, positions, k, onChange, playing, onTogglePlay, series, alerts, now }) {
  const n = positions.length
  const max = Math.max(...series)
  const x = (i) => (n > 1 ? (i / (n - 1)) * 1000 : 500)
  const y = (v) => 56 - (v / max) * 52
  const pos = positions[k]

  const markers = []
  positions.forEach((p, i) => {
    const wanted = lens === 'replay' ? i === 0 || p.gapBefore || p.tod === 0 : p.tod % 120 === 0 || p.gapBefore
    const minGap = lens === 'replay' ? 0.12 : 0.05
    if (wanted && (!markers.length || (i - markers.at(-1).i) / (n - 1) >= minGap)) markers.push({ p, i })
  })

  return (
    <div className="border-t border-line bg-page px-4 pb-3 pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-card hover:bg-primary-hover"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="3.5" height="10" rx="1" /><rect x="7.5" y="1" width="3.5" height="10" rx="1" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L3.4.7a.6.6 0 0 0-.9.5Z" /></svg>
          )}
        </button>
        <p className="text-lg tabular-nums text-ink">
          {pos.title} <span className="text-primary-ink">{pos.label}</span>
        </p>
        <p className="text-sm text-ink-3">
          {fmt(now.boardings)} boardings
          {now.typical !== null && (
            <span className={now.boardings > now.typical ? 'text-danger' : 'text-primary-ink'}>
              {' '}({fmtPct((now.boardings - now.typical) / now.typical)} vs other days)
            </span>
          )}
          {lens === 'typical' && <span> · average of {pos.slots.length} day{pos.slots.length > 1 ? 's' : ''}</span>}
          {lens === 'replay' && now.typical === null && <span> · only day sampled at this time</span>}
        </p>
      </div>

      <div className="relative px-[7px]">
        <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="block h-14 w-full" aria-hidden="true">
          {positions.map((p, i) =>
            p.gapBefore ? (
              <rect key={p.key} x={x(i - 1)} y="0" width={x(i) - x(i - 1)} height="60" fill="#202124" fillOpacity="0.05" />
            ) : null,
          )}
          {segments(series, positions).map((run) => (
            <g key={run[0][0]}>
              <path
                d={`M${x(run[0][0])},58 ${run.map(([i, v]) => `L${x(i)},${y(v)}`).join(' ')} L${x(run.at(-1)[0])},58Z`}
                fill="#1a73e8"
                fillOpacity="0.1"
              />
              <path
                d={`M${run.map(([i, v]) => `${x(i)},${y(v)}`).join(' L')}`}
                fill="none"
                stroke="#1a73e8"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {alerts?.map((a, i) =>
            a > 0 ? <rect key={i} x={x(i) - 2} y="0" width="4" height={Math.min(3 + a, 10)} rx="1" fill={ABOVE} /> : null,
          )}
          <line x1={x(k)} x2={x(k)} y1="0" y2="60" stroke="#202124" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={k}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Time"
          aria-valuetext={`${pos.title} ${pos.label}`}
          className="timeline-range absolute inset-x-0 top-0 h-14 w-full"
        />
      </div>

      <div className="relative mx-[7px] mt-1 h-4 text-[11px] text-ink-3">
        {markers.map(({ p, i }) => (
          <span
            key={p.key}
            className={`absolute whitespace-nowrap ${i === 0 ? '' : i > n * 0.95 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: `${(i / (n - 1)) * 100}%` }}
          >
            {lens === 'replay' ? `${p.title} ${p.label.split('–')[0]}` : p.label.split('–')[0]}
          </span>
        ))}
      </div>
      {lens === 'replay' && (
        <p className="mt-1 text-[11px] text-ink-3">
          <span className="mr-1 inline-block h-2 w-1 rounded-sm align-middle" style={{ background: ABOVE }} />
          Red ticks: moments when the system would have raised an alert. Shaded gaps: hours missing from the sample.
        </p>
      )}
    </div>
  )
}
