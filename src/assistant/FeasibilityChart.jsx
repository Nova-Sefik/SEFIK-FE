import { useState } from 'react'

const euro = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

function Metric({ label, value, detail, tone = 'default' }) {
  const tones = {
    default: 'border-line bg-surface',
    current: 'border-primary/25 bg-primary-soft',
    good: 'border-good/25 bg-good-soft',
    warn: 'border-warn/25 bg-warn-soft',
  }
  return (
    <div className={`min-w-40 flex-1 rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-ink-3">{detail}</p>
    </div>
  )
}

function Assumption({ label, value, onChange, min, max, step = 1, suffix }) {
  return (
    <label className="rounded-xl border border-line bg-subtle p-2.5">
      <span className="block text-[9px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
      <span className="mt-1 flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums text-ink outline-none"
        />
        <span className="text-[10px] text-ink-4">{suffix}</span>
      </span>
    </label>
  )
}

export default function FeasibilityChart({ rows }) {
  const [selectedKey, setSelectedKey] = useState(rows[0]?.key ?? '')
  const selected = rows.find((row) => row.key === selectedKey) ?? rows[0]
  const [assumptionEdits, setAssumptionEdits] = useState({})
  const assumptions = selected ? { ...selected.assumptions, ...(assumptionEdits[selected.key] ?? {}) } : {}

  const result = (() => {
    if (!selected) return null
    const current = selected.current
    const currentMinutes = current.available
      ? current.baseline_without_transfer_wait + (current.transfers ?? 0) * assumptions.transfer_wait_minutes
      : null
    // Both options include the same walk to and from the stations; it is passenger
    // time, not vehicle time, so it stays out of the fleet calculation
    const accessEgress = current.available ? current.access_egress_walk_minutes ?? 0 : 0
    // Same rounding as server/feasibility.mjs, so the view and the AI answer quote identical numbers
    const directKm = Number((selected.evidence.straight_line_km * assumptions.route_distance_factor).toFixed(1))
    const directRide = Number((directKm / assumptions.average_speed_kmh * 60).toFixed(1))
    const directVehicleMinutes = directRide + assumptions.terminal_and_dwell_minutes
    const directMinutes = directVehicleMinutes + accessEgress
    const captured = Math.round(selected.evidence.supported_journeys / Math.max(1, selected.evidence.sampled_days)
      * assumptions.capture_rate_pct / 100)
    const departures = Math.ceil(assumptions.service_hours * 60 / assumptions.headway_minutes)
    const vehicleKm = directKm * departures * 2
    const cost = Math.round(vehicleKm * assumptions.cost_per_vehicle_km_eur)
    const vehicles = Math.ceil((directVehicleMinutes * 2 + assumptions.layover_minutes) / assumptions.headway_minutes)
    return {
      currentMinutes,
      accessEgress,
      directKm,
      directRide,
      directMinutes,
      saved: currentMinutes === null ? null : currentMinutes - directMinutes,
      captured,
      departures,
      vehicleKm,
      cost,
      vehicles,
    }
  })()

  if (!selected || !result) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-ink">No feasibility case has been calculated yet.</p>
          <p className="mt-2 text-xs text-ink-3">Ask the AI to suggest a direct-link candidate first, then return to this view.</p>
        </div>
      </div>
    )
  }

  const update = (key, value) => setAssumptionEdits((current) => ({
    ...current,
    [selected.key]: { ...(current[selected.key] ?? {}), [key]: value },
  }))
  const reset = () => setAssumptionEdits((current) => {
    const next = { ...current }
    delete next[selected.key]
    return next
  })
  const positiveSaving = result.saved !== null && result.saved > 0

  return (
    <div className="h-full overflow-y-auto px-1 pb-4 pt-2">
      {rows.length > 1 && (
        <div className="mb-3 flex gap-1 overflow-x-auto">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setSelectedKey(row.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] ${row.key === selected.key ? 'bg-primary text-white' : 'border border-line text-ink-3'}`}
            >
              {row.from} ↔ {row.to}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
        <Metric
          label="Current journey"
          value={result.currentMinutes === null ? 'Unavailable' : `${number.format(result.currentMinutes)} min`}
          detail={selected.current.available
            ? `${number.format(selected.current.scheduled_ride_minutes)} ride + ${number.format((selected.current.transfers ?? 0) * assumptions.transfer_wait_minutes)} transfer wait + ${number.format((selected.current.walking_minutes ?? 0) + result.accessEgress)} walk · ${selected.current.transfers ?? 0} transfer${selected.current.transfers === 1 ? '' : 's'}`
            : 'No GTFS path resolved'}
          tone="current"
        />
        <div className="flex items-center text-xl text-ink-4">→</div>
        <Metric
          label="Proposed direct"
          value={`${number.format(result.directMinutes)} min`}
          detail={`${number.format(result.directRide)} ride + ${number.format(assumptions.terminal_and_dwell_minutes)} dwell + ${number.format(result.accessEgress)} walk · ${number.format(result.directKm)} route km`}
        />
        <div className="flex items-center text-xl text-ink-4">→</div>
        <Metric
          label="Estimated time saved"
          value={result.saved === null ? 'Unknown' : `${result.saved > 0 ? '+' : ''}${number.format(result.saved)} min`}
          detail={positiveSaving ? 'Potential saving per journey' : 'No time advantage under these assumptions'}
          tone={positiveSaving ? 'good' : 'warn'}
        />
        <div className="flex items-center text-xl text-ink-4">→</div>
        <Metric label="Likely captured demand" value={number.format(result.captured)} detail="journeys per sampled day window—not a full-day forecast" tone="current" />
        <div className="flex items-center text-xl text-ink-4">→</div>
        <Metric label="Operating cost" value={euro.format(result.cost)} detail="per operating day under the assumptions below" tone="warn" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-line p-4">
          <p className="text-xs font-medium text-ink">Current GTFS transfer chain</p>
          {selected.current.available ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selected.current.segments.map((segment, index) => (
                <div key={`${segment.route_id}-${index}`} className="contents">
                  {index > 0 && <span className="rounded-full bg-warn-soft px-2 py-1 text-[9px] font-medium text-warn">transfer</span>}
                  <div className="rounded-xl bg-subtle px-3 py-2 text-[10px] text-ink-2">
                    <strong className="text-ink">{segment.label || segment.line}</strong> · {segment.from} → {segment.to}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-2 text-xs text-warn">{selected.current.source}</p>}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
            <div><p className="text-lg font-semibold text-ink">{result.departures}</p><p className="text-[9px] text-ink-4">departures each way</p></div>
            <div><p className="text-lg font-semibold text-ink">{number.format(result.vehicleKm)}</p><p className="text-[9px] text-ink-4">vehicle-km/day</p></div>
            <div><p className="text-lg font-semibold text-ink">{result.vehicles}</p><p className="text-[9px] text-ink-4">peak vehicles</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-ink">Editable planning assumptions</p>
            <button type="button" onClick={reset} className="text-[10px] text-primary-ink hover:underline">Reset</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Assumption label="Transfer wait" value={assumptions.transfer_wait_minutes} min={0} max={30} suffix="min" onChange={(value) => update('transfer_wait_minutes', value)} />
            <Assumption label="Direct speed" value={assumptions.average_speed_kmh} min={8} max={60} suffix="km/h" onChange={(value) => update('average_speed_kmh', value)} />
            <Assumption label="Route factor" value={assumptions.route_distance_factor} min={1} max={2.5} step={0.05} suffix="×" onChange={(value) => update('route_distance_factor', value)} />
            <Assumption label="Demand captured" value={assumptions.capture_rate_pct} min={0} max={100} suffix="%" onChange={(value) => update('capture_rate_pct', value)} />
            <Assumption label="Headway" value={assumptions.headway_minutes} min={3} max={60} suffix="min" onChange={(value) => update('headway_minutes', value)} />
            <Assumption label="Service span" value={assumptions.service_hours} min={1} max={24} suffix="h" onChange={(value) => update('service_hours', value)} />
            <Assumption label="Cost / vehicle-km" value={assumptions.cost_per_vehicle_km_eur} min={0.5} max={20} step={0.25} suffix="€" onChange={(value) => update('cost_per_vehicle_km_eur', value)} />
          </div>
        </section>
      </div>

      <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[10px] leading-4 text-warn">
        Screening estimate only. Current time excludes initial wait and detailed walking. Proposed alignment, speed, capture, service and cost are assumptions. Capital cost, deadheading, depot constraints and fare revenue are not included.
      </p>
    </div>
  )
}
