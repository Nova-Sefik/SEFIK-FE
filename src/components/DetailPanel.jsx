import { useMemo } from 'react'
import {
  CONFIDENCE,
  baselineSlots,
  capacityOf,
  clock,
  flowSeries,
  flowsAt,
  mean,
  opportunitySeries,
  stopState,
  stops,
  zones,
} from '../lib/model'
import Sparkline from './Sparkline'
import { FLOW_COLOR, FLOW_OPACITY, GROUP_COLOR, GROUP_LABEL, OPPORTUNITY_COLOR, fmt, fmtPct, loadColor } from './theme'

function Stat({ label, value, detail }) {
  return (
    <div>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      {detail && <p className="text-[11px] text-ink-3">{detail}</p>}
    </div>
  )
}

function Header({ eyebrow, title, subtitle, onClose }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{eyebrow}</p>
        <h2 className="text-lg font-medium leading-snug text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        className="rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink"
      >
        ✕
      </button>
    </header>
  )
}

function departureBuckets(stop, pos) {
  if (!stop.buckets) return []
  const byTime = new Map()
  for (const slot of pos.slots) {
    for (const [minute, departures, validations, headway] of stop.buckets[slot] ?? []) {
      if (validations === null) continue
      if (!byTime.has(minute)) byTime.set(minute, { minute, departures: 0, validations: 0, headway: 0, samples: 0 })
      const bucket = byTime.get(minute)
      bucket.departures += departures
      bucket.validations += validations
      bucket.headway += headway
      bucket.samples += 1
    }
  }
  const divisor = pos.slots.length
  return [...byTime.values()]
    .map((bucket) => ({
      ...bucket,
      departures: bucket.departures / divisor,
      validations: bucket.validations / divisor,
      headway: bucket.headway / bucket.samples,
    }))
    .sort((a, b) => a.minute - b.minute)
}

function DepartureBuckets({ stop, pos }) {
  const buckets = departureBuckets(stop, pos)
  const capacity = capacityOf(stop)

  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-ink">Demand accumulated between departures</h3>
      <p className="mb-2 text-[11px] text-ink-3">
        Each row assigns validations since the preceding scheduled departure to the next departure time.
      </p>
      {buckets.length === 0 ? (
        <p className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-3">
          {stop.buckets
            ? 'No complete departure interval is available in this window.'
            : 'Detailed departure buckets are retained for the 100 busiest stops; use the chart above for this stop’s 30-minute comparison.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {buckets.map((bucket) => {
            const pressure = bucket.validations / Math.max(1, bucket.departures * capacity)
            const colour = loadColor(pressure)
            return (
              <li key={bucket.minute} className="rounded-md border border-line bg-surface p-2.5">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="font-medium tabular-nums text-ink">{clock(bucket.minute)}</span>
                  <span className="text-xs tabular-nums text-ink-2">
                    {fmt(bucket.validations)} validations · {bucket.departures.toFixed(bucket.departures % 1 ? 1 : 0)} departure{bucket.departures === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" title={`${Math.round(pressure * 100)}% demand-pressure proxy`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(pressure, 1) * 100}%`, background: colour }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                  <span>{Math.round(bucket.validations / Math.max(bucket.departures, 1))} validations per departure</span>
                  <span>{Math.round(bucket.headway)} min since previous departure</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-ink-3">
        This is a demand-pressure proxy, not measured occupancy: validations are not assigned to a specific vehicle.
      </p>
    </section>
  )
}

function StopDetail({ stop, lens, positions, k, summary, onSelect, onClose }) {
  const s = summary.states.get(stop.id) ?? stopState(stop, positions[k])
  const series = useMemo(() => positions.map((p) => mean(stop.in, p.slots)), [stop, positions])
  const supply = useMemo(() => positions.map((p) => (stop.dep ? mean(stop.dep, p.slots) : 0)), [stop, positions])
  const baseline = useMemo(
    () =>
      lens === 'replay'
        ? positions.map((p) => {
            const b = baselineSlots(p)
            return b.length ? mean(stop.in, b) : null
          })
        : null,
    [stop, positions, lens],
  )
  const related = summary.flows.filter((f) => f.a === stop.zone || f.b === stop.zone).slice(0, 5)

  return (
    <div className="flex flex-col gap-4">
      <Header
        eyebrow={GROUP_LABEL[stop.group]}
        title={stop.name}
        subtitle={[stop.area, `zone ${zones[stop.zone].name}`].filter(Boolean).join(' · ')}
        onClose={onClose}
      />
      {stop.lines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stop.lines.map((l) => (
            <span key={l} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">
              {l}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Boardings, this 30 min"
          value={fmt(s.v)}
          detail={s.typical !== null ? `${fmtPct(s.change)} vs ${fmt(s.typical)} on other days` : undefined}
        />
        {s.out !== null ? (
          <Stat label="Exits (Metro gates)" value={fmt(s.out)} detail={`${s.out > s.v ? 'More leaving than entering' : 'More entering than leaving'}`} />
        ) : (
          <Stat label="Exits" value="–" detail="Tap-in only on this operator" />
        )}
        <Stat label="Scheduled departures" value={s.dep.toFixed(1)} detail="from the GTFS timetable" />
        <Stat
          label="Load proxy"
          value={s.load !== null ? `${Math.round(s.load * 100)}%` : '–'}
          detail={`per departure ÷ ${capacityOf(stop)} places`}
        />
      </div>

      <section>
        <h3 className="mb-1 text-sm font-medium text-ink">
          Boardings through the {lens === 'replay' ? 'sampled week' : 'typical weekday'}
        </h3>
        <Sparkline
          series={series}
          baseline={baseline}
          supply={supply}
          positions={positions}
          k={k}
          color={GROUP_COLOR[stop.group]}
          label={`Validations and scheduled departures at ${stop.name} over time`}
        />
      </section>

      <DepartureBuckets stop={stop} pos={positions[k]} />

      <section>
        <h3 className="mb-1 text-sm font-medium text-ink">Top flows touching {zones[stop.zone].name} now</h3>
        {related.length === 0 ? (
          <p className="text-sm text-ink-3">No zone-to-zone flows at this time.</p>
        ) : (
          <ul className="-mx-2">
            {related.map((f) => (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => onSelect({ type: 'flow', id: f.key })}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-subtle"
                >
                  <span className="truncate text-ink">
                    {zones[f.a].name} <span className="text-ink-3">→</span> {zones[f.b].name}
                  </span>
                  <span className="tabular-nums text-ink-3">{fmt(f.n)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function FlowDetail({ flowKey, lens, positions, k, summary, onClose }) {
  const [a, b] = flowKey.split('-').map(Number)
  const pos = positions[k]
  const now = summary.flows.find((f) => f.key === flowKey)
  const reverse = summary.flows.find((f) => f.a === b && f.b === a)
  const series = useMemo(() => flowSeries(a, b, positions), [a, b, positions])
  const baseline = useMemo(
    () =>
      lens === 'replay'
        ? positions.map((p) => {
            const base = baselineSlots(p)
            return base.length ? (flowsAt({ slots: base }).find((f) => f.a === a && f.b === b)?.n ?? 0) : null
          })
        : null,
    [a, b, positions, lens],
  )
  const n = now?.n ?? 0
  const total = now ? now.byConf.reduce((x, y) => x + y, 0) : 0

  return (
    <div className="flex flex-col gap-4">
      <Header
        eyebrow="Passenger flow"
        title={`${zones[a].name} → ${zones[b].name}`}
        subtitle={`${zones[a].area} to ${zones[b].area} · ${pos.title} ${pos.label}`}
        onClose={onClose}
      />
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Passengers, this 30 min"
          value={fmt(n)}
          detail={baseline?.[k] ? `${fmtPct((n - baseline[k]) / baseline[k])} vs other days` : undefined}
        />
        <Stat
          label="Reverse direction"
          value={fmt(reverse?.n ?? 0)}
          detail={reverse?.n ? `${(n / reverse.n).toFixed(1)}× imbalance` : 'no reverse flow now'}
        />
      </div>

      {total > 0 && (
        <section>
          <h3 className="mb-1.5 text-sm font-medium text-ink">How sure are we?</h3>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {now.byConf.map((v, c) =>
              v > 0 ? (
                <span key={c} style={{ width: `${(v / total) * 100}%`, background: FLOW_COLOR, opacity: FLOW_OPACITY[c] }} />
              ) : null,
            )}
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {CONFIDENCE.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-ink-2" title={c.hint}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FLOW_COLOR, opacity: FLOW_OPACITY[c.id] }} />
                <span className="flex-1">{c.label}</span>
                <span className="tabular-nums text-ink-3">{Math.round((now.byConf[c.id] / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-medium text-ink">
          This corridor through the {lens === 'replay' ? 'sampled week' : 'typical weekday'}
        </h3>
        <Sparkline series={series} baseline={baseline} positions={positions} k={k} color={FLOW_COLOR} label="Passengers on this corridor over time" />
      </section>
      <p className="text-[11px] text-ink-3">
        Journeys are inferred from anonymous card tap sequences. Only Metro records exits, so everything else is labelled as inferred.
      </p>
    </div>
  )
}

function OpportunityDetail({ opportunity, lens, positions, k, onClose }) {
  const series = useMemo(() => opportunitySeries(opportunity, positions), [opportunity, positions])
  const current = series[k]
  const evidenceTotal = opportunity.byConf.reduce((sum, n) => sum + n, 0)
  const dominantForward = opportunity.ab >= opportunity.ba
  const dominantFrom = dominantForward ? zones[opportunity.a] : zones[opportunity.b]
  const dominantTo = dominantForward ? zones[opportunity.b] : zones[opportunity.a]
  const dominantN = Math.max(opportunity.ab, opportunity.ba)

  return (
    <div className="flex flex-col gap-4">
      <Header
        eyebrow="Route opportunity"
        title={`${zones[opportunity.a].name} ↔ ${zones[opportunity.b].name}`}
        subtitle="Recurring movement without a one-seat GTFS connection"
        onClose={onClose}
      />

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Supported journeys" value={fmt(opportunity.n)} detail={`across ${opportunity.days} sampled days`} />
        <Stat label="Straight-line distance" value={`${opportunity.distanceKm} km`} detail="screening estimate, not route length" />
        <Stat
          label={`${zones[opportunity.a].name} → ${zones[opportunity.b].name}`}
          value={fmt(opportunity.ab)}
          detail={`${Math.round((opportunity.ab / opportunity.n) * 100)}% of evidence`}
        />
        <Stat
          label={`${zones[opportunity.b].name} → ${zones[opportunity.a].name}`}
          value={fmt(opportunity.ba)}
          detail={`${Math.round((opportunity.ba / opportunity.n) * 100)}% of evidence`}
        />
      </div>

      <section className="rounded-lg border border-warn/25 bg-warn-soft p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-warn">Suggested next action</p>
        <p className="mt-1 text-sm text-ink">
          Test a limited direct or express service from <strong>{dominantFrom.name}</strong> to <strong>{dominantTo.name}</strong> in
          the highest-demand windows. That direction accounts for {fmt(dominantN)} supported journeys in the sample.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-ink">
          Evidence through the {lens === 'replay' ? 'sampled week' : 'typical weekday'}
        </h3>
        <Sparkline
          series={series}
          positions={positions}
          k={k}
          color={OPPORTUNITY_COLOR}
          label={`Supported journeys between ${zones[opportunity.a].name} and ${zones[opportunity.b].name}`}
        />
        <p className="mt-1 text-[11px] text-ink-3">{fmt(current)} supported journeys in the selected 30-minute period.</p>
      </section>

      <section>
        <h3 className="mb-1.5 text-sm font-medium text-ink">Evidence quality</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-subtle p-2">
            <p className="text-ink-3">Observed Metro OD</p>
            <p className="mt-0.5 font-semibold text-ink">{fmt(opportunity.byConf[0])}</p>
          </div>
          <div className="rounded-md bg-subtle p-2">
            <p className="text-ink-3">Strongly inferred</p>
            <p className="mt-0.5 font-semibold text-ink">{fmt(opportunity.byConf[1])}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          Weak same-day inferences are excluded. {Math.round((opportunity.byConf[0] / evidenceTotal) * 100)}% of this evidence is an
          observed Metro entry-to-exit pair.
        </p>
      </section>

      <p className="text-[11px] text-ink-3">
        This is a screening signal, not an automatic route decision. A pilot still requires capacity, operating-cost, street or
        nautical feasibility, and a longer observation period.
      </p>
    </div>
  )
}

function Insights({ insights, onGo }) {
  return (
    <div className="flex flex-col gap-3">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Story mode</p>
        <h2 className="text-lg font-medium text-ink">What the data says</h2>
        <p className="text-xs text-ink-3">Click a finding to jump to it. Click any stop or flow on the map for details.</p>
      </header>
      <ol className="flex flex-col gap-2">
        {insights.map((ins) => (
          <li key={ins.kind}>
            <button
              type="button"
              onClick={() => onGo(ins.go)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:bg-subtle hover:shadow-card"
            >
              <p className="text-[11px] font-medium text-primary-ink">{ins.kind}</p>
              <p className="mt-0.5 text-sm font-medium text-ink">{ins.title}</p>
              <p className="mt-1 text-xs text-ink-3">{ins.body}</p>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function DetailPanel({ selected, insights, opportunities, onGo, onClose, ...rest }) {
  const stop = selected?.type === 'stop' ? stops.find((s) => s.id === selected.id) : null
  const opportunity = selected?.type === 'opportunity' ? opportunities.find((o) => o.key === selected.id) : null
  return (
    <div className="p-4">
      {stop ? (
        <StopDetail stop={stop} onClose={onClose} {...rest} />
      ) : opportunity ? (
        <OpportunityDetail opportunity={opportunity} onClose={onClose} {...rest} />
      ) : selected?.type === 'flow' ? (
        <FlowDetail flowKey={selected.id} onClose={onClose} {...rest} />
      ) : (
        <Insights insights={insights} onGo={onGo} />
      )}
    </div>
  )
}
