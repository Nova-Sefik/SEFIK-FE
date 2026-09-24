import { zones } from '../lib/model'
import { ABOVE, BELOW, GROUP_COLOR, GROUP_LABEL, OPPORTUNITY_COLOR, fmt, fmtPct } from './theme'

function Kpi({ label, value, detail }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink" title={typeof value === 'string' ? value : undefined}>
        {value}
      </p>
      {detail && <p className="truncate text-[11px] text-ink-3">{detail}</p>}
    </div>
  )
}

function Row({ onClick, swatch, title, detail, value, valueClass }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-subtle"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{title}</span>
          <span className="block truncate text-[11px] text-ink-3">{detail}</span>
        </span>
        <span className={`text-sm tabular-nums ${valueClass ?? 'text-ink-2'}`}>{value}</span>
      </button>
    </li>
  )
}

export default function OverviewPanel({ lens, mode, summary, opportunities, onSelect, onOpenFraming }) {
  const { boardings, typical, busiest, busiestLine, flows, anomalies, flowAnomalies, pressure } = summary
  const top = flows[0]
  const topOpportunity = opportunities[0]

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="rounded-xl bg-primary-soft p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-primary-ink">The problem</p>
        <p className="mt-1 text-sm text-ink">
          {mode === 'opportunity' ? (
            <><strong>Network gap:</strong> which recurring journeys could be simpler with a direct connection?</>
          ) : lens === 'typical' ? (
            <><strong>Recurring:</strong> where does passenger demand keep outgrowing the service scheduled for it?</>
          ) : (
            <><strong>Dynamic:</strong> when does passenger behaviour depart from its normal pattern?</>
          )}
        </p>
        <button type="button" onClick={onOpenFraming} className="mt-2 text-xs font-medium text-primary-ink hover:underline">
          Read the full framing →
        </button>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Kpi
          label="Boardings, this 30 min"
          value={fmt(boardings)}
          detail={typical !== null ? `${fmtPct((boardings - typical) / typical)} vs other days` : lens === 'typical' ? 'weekday average' : 'no other day sampled'}
        />
        <Kpi label="Busiest stop" value={busiest?.stop.name ?? '–'} detail={busiest ? `${fmt(busiest.v)} boardings` : ''} />
        <Kpi
          label="Busiest line"
          value={busiestLine ? busiestLine.line : '–'}
          detail={busiestLine ? `${GROUP_LABEL[busiestLine.group]} · ${fmt(busiestLine.v)}` : ''}
        />
        <Kpi
          label="Strongest flow"
          value={top ? `${zones[top.a].name} → ${zones[top.b].name}` : '–'}
          detail={top ? `${fmt(top.n)} passengers` : ''}
        />
        <Kpi
          label={mode === 'opportunity' ? 'Candidate links' : lens === 'replay' ? 'Demand alerts' : 'Pressure points'}
          value={mode === 'opportunity' ? opportunities.length : lens === 'replay' ? anomalies.length + flowAnomalies.length : pressure.length}
          detail={mode === 'opportunity' ? 'ranked for investigation' : lens === 'replay' ? 'stops and corridors off-pattern' : 'stops at 30%+ load proxy'}
        />
        <Kpi
          label={mode === 'opportunity' ? 'Top opportunity' : 'Flows shown'}
          value={mode === 'opportunity' && topOpportunity ? `${zones[topOpportunity.a].name} ↔ ${zones[topOpportunity.b].name}` : fmt(flows.length)}
          detail={mode === 'opportunity' && topOpportunity ? `${fmt(topOpportunity.n)} supported journeys` : 'zone-to-zone movements'}
        />
      </section>

      {mode === 'opportunity' ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink">Direct-link opportunities</h2>
          <p className="mb-2 text-[11px] text-ink-3">Recurring evidence, filtered against one-seat GTFS connections</p>
          <ul className="-mx-2">
            {opportunities.slice(0, 10).map((o) => (
              <Row
                key={o.key}
                onClick={() => onSelect({ type: 'opportunity', id: o.key })}
                swatch={OPPORTUNITY_COLOR}
                title={`${zones[o.a].name} ↔ ${zones[o.b].name}`}
                detail={`${o.days} sampled days · ${o.distanceKm} km straight-line`}
                value={fmt(o.n)}
              />
            ))}
          </ul>
        </section>
      ) : lens === 'replay' ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink">Alerts right now</h2>
          <p className="mb-2 text-[11px] text-ink-3">Compared with other sampled days at the same time</p>
          {anomalies.length + flowAnomalies.length === 0 ? (
            <p className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-3">Everything is within its normal range.</p>
          ) : (
            <ul className="-mx-2">
              {flowAnomalies.slice(0, 3).map((f) => (
                <Row
                  key={f.key}
                  onClick={() => onSelect({ type: 'flow', id: f.key })}
                  swatch={f.change > 0 ? ABOVE : BELOW}
                  title={`${zones[f.a].name} → ${zones[f.b].name}`}
                  detail={`Corridor · ${fmt(f.n)} vs ${fmt(f.typical)} usually`}
                  value={fmtPct(f.change)}
                  valueClass={f.change > 0 ? 'text-danger' : 'text-primary-ink'}
                />
              ))}
              {anomalies.slice(0, 8).map((a) => (
                <Row
                  key={a.stop.id}
                  onClick={() => onSelect({ type: 'stop', id: a.stop.id })}
                  swatch={a.change > 0 ? ABOVE : BELOW}
                  title={a.stop.name}
                  detail={`${GROUP_LABEL[a.stop.group]} · ${fmt(a.v)} vs ${fmt(a.typical)} usually`}
                  value={fmtPct(a.change)}
                  valueClass={a.change > 0 ? 'text-danger' : 'text-primary-ink'}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink">Recurring pressure points</h2>
          <p className="mb-2 text-[11px] text-ink-3">High boardings for the service scheduled at this time</p>
          {pressure.length === 0 ? (
            <p className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-3">No stop reaches a 30% load proxy now.</p>
          ) : (
            <ul className="-mx-2">
              {pressure.slice(0, 8).map((p) => (
                <Row
                  key={p.stop.id}
                  onClick={() => onSelect({ type: 'stop', id: p.stop.id })}
                  swatch={GROUP_COLOR[p.stop.group]}
                  title={p.stop.name}
                  detail={`${GROUP_LABEL[p.stop.group]} · ${fmt(p.v)} boardings, ${p.dep.toFixed(1)} departures`}
                  value={`${Math.round(p.load * 100)}%`}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
