import 'leaflet/dist/leaflet.css'
import { useMemo } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet'
import { CONFIDENCE, dominantConfidence, isAnomaly, zones } from '../lib/model'
import {
  ABOVE,
  BELOW,
  FLOW_COLOR,
  FLOW_OPACITY,
  GROUP_COLOR,
  GROUP_LABEL,
  IDLE,
  INK,
  LOAD_STEPS,
  OPPORTUNITY_COLOR,
  SURFACE,
  fmt,
  fmtPct,
  loadColor,
} from './theme'

const MAX_FLOWS = 80
const MAX_OPPORTUNITIES = 12

// Quadratic curve between two zones, bowed to the right of travel so that
// A→B and B→A draw as two separate arcs
function arc(a, b) {
  const [lat1, lon1] = [a.lat, a.lon]
  const [lat2, lon2] = [b.lat, b.lon]
  const mx = (lat1 + lat2) / 2
  const my = (lon1 + lon2) / 2
  const dx = lat2 - lat1
  const dy = lon2 - lon1
  const cx = mx - dy * 0.18
  const cy = my + dx * 0.18
  const pts = []
  for (let t = 0; t <= 1.001; t += 0.1) {
    const u = 1 - t
    pts.push([u * u * lat1 + 2 * u * t * cx + t * t * lat2, u * u * lon1 + 2 * u * t * cy + t * t * lon2])
  }
  return pts
}

function stopStyle(mode, stop, s, max) {
  const r = 2.5 + 20 * Math.sqrt(s.v / max)
  switch (mode) {
    case 'flow':
      return { radius: Math.min(r, 6), color: SURFACE, weight: 0, fillColor: IDLE, fillOpacity: 0.5 }
    case 'supply':
      return { radius: r, color: SURFACE, weight: 1, fillColor: loadColor(s.load), fillOpacity: 0.85 }
    case 'anomaly': {
      const flagged = isAnomaly(s)
      return {
        radius: flagged ? Math.max(r, 7) : Math.min(r, 5),
        color: SURFACE,
        weight: 1,
        fillColor: flagged ? (s.change > 0 ? ABOVE : BELOW) : IDLE,
        fillOpacity: flagged ? 0.9 : 0.35,
      }
    }
    case 'opportunity':
      return { radius: 3, color: SURFACE, weight: 0, fillColor: IDLE, fillOpacity: 0 }
    default:
      return { radius: r, color: SURFACE, weight: 1, fillColor: GROUP_COLOR[stop.group], fillOpacity: 0.75 }
  }
}

function Legend({ mode, conf, onConf }) {
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-[400] max-w-[16rem] rounded-xl bg-surface p-3 text-xs text-ink-2 shadow-float">
      {mode === 'demand' && (
        <>
          <p className="mb-1.5 font-medium text-ink">Boardings per 30 min</p>
          <p className="text-ink-3">Circle area = volume, colour = operator</p>
        </>
      )}
      {mode === 'flow' && (
        <>
          <p className="mb-1.5 font-medium text-ink">Passenger movement between zones</p>
          <p className="mb-2 text-ink-3">Line width = passengers. Dashes move in the direction of travel.</p>
          {CONFIDENCE.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5" title={c.hint}>
              <input
                type="checkbox"
                checked={conf.includes(c.id)}
                onChange={() => onConf(c.id)}
                className="accent-primary"
              />
              <span className="h-1 w-5 rounded-full" style={{ background: FLOW_COLOR, opacity: FLOW_OPACITY[c.id] }} />
              {c.label}
            </label>
          ))}
        </>
      )}
      {mode === 'supply' && (
        <>
          <p className="mb-1.5 font-medium text-ink">Load proxy</p>
          <p className="mb-2 text-ink-3">Boardings per scheduled departure ÷ vehicle capacity</p>
          <div className="flex gap-0.5">
            {LOAD_STEPS.map((step, i) => (
              <div key={step.from} className="flex-1">
                <span className="block h-2.5 rounded-sm" style={{ background: step.color }} />
                <span className="mt-1 block text-[10px] tabular-nums text-ink-3">
                  {Math.round(step.from * 100)}%{i === LOAD_STEPS.length - 1 ? '+' : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {mode === 'anomaly' && (
        <>
          <p className="mb-1.5 font-medium text-ink">Compared with other days at this time</p>
          <p className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: ABOVE }} /> At least double the usual
          </p>
          <p className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: BELOW }} /> Under 40% of the usual
          </p>
          <p className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: IDLE }} /> As usual, or no baseline
          </p>
        </>
      )}
      {mode === 'opportunity' && (
        <>
          <p className="mb-1.5 font-medium text-ink">Candidate direct links</p>
          <p className="text-ink-3">
            Recurring observed or strongly inferred journeys with no one-seat connection in the applicable GTFS.
          </p>
          <p className="mt-2 flex items-center gap-2">
            <span className="w-7 border-t-2 border-dashed" style={{ borderColor: OPPORTUNITY_COLOR }} />
            Width = evidence score
          </p>
        </>
      )}
    </div>
  )
}

export default function MobilityMap({
  mode,
  visibleStops,
  states,
  flows,
  flowMax,
  stopMax,
  conf,
  onConf,
  selected,
  onSelect,
  opportunities,
}) {
  const drawnFlows = useMemo(() => flows.slice(0, MAX_FLOWS).reverse(), [flows])
  const drawnOpportunities = useMemo(() => opportunities.slice(0, MAX_OPPORTUNITIES).reverse(), [opportunities])
  const opportunityMax = opportunities[0]?.score || 1
  const opportunityZones = useMemo(
    () => new Set(opportunities.slice(0, MAX_OPPORTUNITIES).flatMap((o) => [o.a, o.b])),
    [opportunities],
  )
  const flowZones = useMemo(() => {
    const vol = new Map()
    for (const f of flows) {
      vol.set(f.a, (vol.get(f.a) ?? 0) + f.n)
      vol.set(f.b, (vol.get(f.b) ?? 0) + f.n)
    }
    return [...vol.entries()].sort((x, y) => y[1] - x[1])
  }, [flows])
  const labelled = new Set(flowZones.slice(0, 8).map(([z]) => z))

  // draw small first so large circles stay on top
  const ordered = useMemo(
    () => mode === 'opportunity' ? [] : [...visibleStops].sort((x, y) => states.get(x.id).v - states.get(y.id).v),
    [mode, visibleStops, states],
  )

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[38.72, -9.14]} zoom={11} scrollWheelZoom className="h-full w-full" preferCanvas={false}>
        <TileLayer
          attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />

        {ordered.map((stop) => {
          const s = states.get(stop.id)
          const isSel = selected?.type === 'stop' && selected.id === stop.id
          const style = stopStyle(mode, stop, s, stopMax)
          return (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lon]}
              radius={style.radius}
              pathOptions={isSel ? { ...style, color: INK, weight: 2.5 } : style}
              eventHandlers={{ click: () => onSelect({ type: 'stop', id: stop.id }) }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <strong>{stop.name}</strong>
                <br />
                {GROUP_LABEL[stop.group]} · {fmt(s.v)} boardings
                {mode === 'supply' && s.load !== null && <><br />Load proxy {Math.round(s.load * 100)}% · {s.dep.toFixed(1)} departures</>}
                {mode === 'anomaly' && s.change !== null && <><br />{fmtPct(s.change)} vs other days ({fmt(s.typical)})</>}
              </Tooltip>
            </CircleMarker>
          )
        })}

        {mode === 'flow' &&
          drawnFlows.map((f) => {
            const c = dominantConfidence(f)
            const isSel = selected?.type === 'flow' && selected.id === f.key
            return (
              <Polyline
                key={f.key}
                positions={arc(zones[f.a], zones[f.b])}
                pathOptions={{
                  color: isSel ? INK : FLOW_COLOR,
                  opacity: isSel ? 1 : FLOW_OPACITY[c],
                  weight: 0.75 + 11 * Math.sqrt(f.n / flowMax),
                  lineCap: 'round',
                  className: 'flow-line',
                }}
                eventHandlers={{ click: () => onSelect({ type: 'flow', id: f.key }) }}
              >
                <Tooltip sticky>
                  {zones[f.a].name} → {zones[f.b].name}
                  <br />
                  {fmt(f.n)} passengers · mostly {CONFIDENCE[c].label.toLowerCase()}
                </Tooltip>
              </Polyline>
            )
          })}

        {mode === 'opportunity' &&
          drawnOpportunities.map((o) => {
            const isSel = selected?.type === 'opportunity' && selected.id === o.key
            return (
              <Polyline
                key={`opportunity-${o.key}`}
                positions={arc(zones[o.a], zones[o.b])}
                pathOptions={{
                  color: isSel ? INK : OPPORTUNITY_COLOR,
                  opacity: isSel ? 1 : 0.78,
                  weight: 1.5 + 8 * Math.sqrt(o.score / opportunityMax),
                  lineCap: 'round',
                  dashArray: '5 9',
                }}
                eventHandlers={{ click: () => onSelect({ type: 'opportunity', id: o.key }) }}
              >
                <Tooltip sticky>
                  <strong>{zones[o.a].name} ↔ {zones[o.b].name}</strong>
                  <br />
                  {fmt(o.n)} supported journeys · {o.days} sampled days
                  <br />
                  No one-seat GTFS connection
                </Tooltip>
              </Polyline>
            )
          })}

        {mode === 'opportunity' &&
          [...opportunityZones].map((z) => (
            <CircleMarker
              key={`opportunity-zone-${z}`}
              center={[zones[z].lat, zones[z].lon]}
              radius={5}
              pathOptions={{ color: SURFACE, weight: 2, fillColor: OPPORTUNITY_COLOR, fillOpacity: 1 }}
            >
              <Tooltip permanent direction="right" offset={[7, 0]} className="zone-label">
                {zones[z].name}
              </Tooltip>
            </CircleMarker>
          ))}

        {mode === 'flow' &&
          flowZones.map(([z, n]) => (
            <CircleMarker
              key={`zone-${z}`}
              center={[zones[z].lat, zones[z].lon]}
              radius={3 + 6 * Math.sqrt(n / (flowZones[0]?.[1] || 1))}
              pathOptions={{ color: SURFACE, weight: 1.5, fillColor: '#3c4043', fillOpacity: 0.9 }}
            >
              <Tooltip permanent={labelled.has(z)} direction="right" offset={[6, 0]} className="zone-label">
                {zones[z].name}
              </Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>
      <Legend mode={mode} conf={conf} onConf={onConf} />
    </div>
  )
}
