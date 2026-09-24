// Small time-profile chart: the series, an optional dashed "other days" line,
// and a marker at the slider position. Gaps in the sample break the line.
export default function Sparkline({ series, baseline, supply, positions, k, color, label }) {
  const n = series.length
  const max = Math.max(1, ...series, ...(baseline ?? []).filter((v) => v !== null))
  const supplyMax = Math.max(1, ...(supply ?? []))
  const x = (i) => (n > 1 ? (i / (n - 1)) * 300 : 150)
  const y = (v) => 78 - (v / max) * 72
  const barWidth = Math.max(1, Math.min(5, 260 / n))

  const path = (values) => {
    let d = ''
    values.forEach((v, i) => {
      if (v === null) return
      const move = i === 0 || positions[i].gapBefore || values[i - 1] === null
      d += `${move ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
    })
    return d
  }

  return (
    <figure>
      <svg viewBox="0 0 300 80" className="block h-20 w-full" role="img" aria-label={label}>
        <line x1="0" x2="300" y1="78" y2="78" stroke="#dadce0" strokeWidth="1" />
        {supply?.map((v, i) =>
          v > 0 ? (
            <rect
              key={positions[i].key}
              x={x(i) - barWidth / 2}
              y={78 - (v / supplyMax) * 28}
              width={barWidth}
              height={(v / supplyMax) * 28}
              rx="0.8"
              fill="#f9ab00"
              fillOpacity="0.65"
            />
          ) : null,
        )}
        {baseline && (
          <path d={path(baseline)} fill="none" stroke="#80868b" strokeWidth="1.25" strokeDasharray="3 3" />
        )}
        <path d={path(series)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(k)} x2={x(k)} y1="0" y2="78" stroke="#202124" strokeOpacity="0.3" strokeWidth="1" />
        <circle cx={x(k)} cy={y(series[k])} r="4" fill={color} stroke="#ffffff" strokeWidth="2" />
      </svg>
      {(baseline || supply) && (
        <figcaption className="mt-1 flex gap-4 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} /> Validations
          </span>
          {supply && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#f9ab00]/70" /> Scheduled departures
            </span>
          )}
          {baseline && (
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t border-dashed border-ink-4" /> Other days, same time
            </span>
          )}
        </figcaption>
      )}
    </figure>
  )
}
