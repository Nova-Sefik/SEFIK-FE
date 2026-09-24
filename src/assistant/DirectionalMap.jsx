import 'leaflet/dist/leaflet.css'
import { Fragment, useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { zones } from '../lib/model'
import { ABOVE, BELOW, fmt, loadColor } from '../components/theme'

const TRAFFIC_BANDS = [
  { min: 0.65, label: 'Very high', color: '#d93025' },
  { min: 0.35, label: 'High', color: '#e8710a' },
  { min: 0.15, label: 'Medium', color: '#f9ab00' },
  { min: 0, label: 'Low', color: '#1a73e8' },
]

const PROPOSAL_STYLES = {
  investigate_direct_link: { color: '#7b1fa2', label: 'Direct-link pilot' },
  increase_frequency: { color: '#188038', label: 'Increase frequency' },
  rebalance_service: { color: '#00897b', label: 'Rebalance service' },
  improve_transfer: { color: '#c2185b', label: 'Improve transfer' },
  monitor: { color: '#5f6368', label: 'Monitor' },
}

function trafficBand(value, maximum) {
  const ratio = maximum ? value / maximum : 0
  return TRAFFIC_BANDS.find((band) => ratio >= band.min) ?? TRAFFIC_BANDS.at(-1)
}

function proposalStyle(action) {
  return PROPOSAL_STYLES[action] ?? PROPOSAL_STYLES.monitor
}

function curve(from, to, bend = 0.18) {
  const lat1 = from.lat
  const lon1 = from.lon
  const lat2 = to.lat
  const lon2 = to.lon
  const middleLat = (lat1 + lat2) / 2
  const middleLon = (lon1 + lon2) / 2
  const controlLat = middleLat - (lon2 - lon1) * bend
  const controlLon = middleLon + (lat2 - lat1) * bend
  const points = []
  for (let step = 0; step <= 12; step += 1) {
    const t = step / 12
    const u = 1 - t
    points.push([
      u * u * lat1 + 2 * u * t * controlLat + t * t * lat2,
      u * u * lon1 + 2 * u * t * controlLon + t * t * lon2,
    ])
  }
  return points
}

function arrowHead(points) {
  const tip = points[10]
  const before = points[9]
  const dLat = tip[0] - before[0]
  const dLon = tip[1] - before[1]
  const length = Math.hypot(dLat, dLon) || 1
  const unitLat = dLat / length
  const unitLon = dLon / length
  const size = Math.min(0.004, Math.max(0.0012, length * 0.75))
  const backLat = tip[0] - unitLat * size
  const backLon = tip[1] - unitLon * size
  return [
    tip,
    [backLat - unitLon * size * 0.5, backLon + unitLat * size * 0.5],
    [backLat + unitLon * size * 0.5, backLon - unitLat * size * 0.5],
  ]
}

function FitEvidence({ coordinates }) {
  const map = useMap()
  useEffect(() => {
    if (!coordinates.length) return
    if (coordinates.length === 1) map.setView(coordinates[0], 13)
    else map.fitBounds(coordinates, { padding: [45, 45], maxZoom: 13 })
  }, [coordinates, map])
  return null
}

function directionRows(evidence) {
  const rows = []
  for (const item of evidence.slice(0, 30)) {
    if (item.from_zone !== undefined && item.to_zone !== undefined) {
      if (item.from_to !== undefined) {
        if (item.from_to > 0) rows.push({ ...item, id: `${item.key}-forward`, a: Number(item.from_zone), b: Number(item.to_zone), value: item.from_to, direction: `${item.from} → ${item.to}` })
        if (item.to_from > 0) rows.push({ ...item, id: `${item.key}-reverse`, a: Number(item.to_zone), b: Number(item.from_zone), value: item.to_from, direction: `${item.to} → ${item.from}` })
      } else {
        rows.push({ ...item, id: item.key, a: Number(item.from_zone), b: Number(item.to_zone), value: item.journeys, direction: `${item.from} → ${item.to}` })
      }
    } else if (item.hub !== undefined && item.to !== undefined) {
      rows.push({ ...item, id: item.key, a: Number(item.hub), b: Number(item.to), value: item.n, direction: `${item.hubName} → ${item.toName}` })
    }
  }
  return rows.filter((row) => zones[row.a] && zones[row.b] && row.value > 0)
}

function pointRows(evidence) {
  return evidence
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .slice(0, 40)
    .map((item) => ({
      ...item,
      value: item.validations ?? item.observed ?? 0,
      color: item.pressure_pct !== undefined
        ? loadColor(item.pressure_pct / 100)
        : item.change_pct >= 0 ? ABOVE : BELOW,
    }))
}

export default function DirectionalMap({ evidence, intent, overlays = [] }) {
  const directions = useMemo(() => directionRows(evidence), [evidence])
  const points = useMemo(() => pointRows(evidence), [evidence])
  const corridorOverlays = useMemo(
    () => overlays.filter((item) => item.kind === 'corridor' && zones[Number(item.from_zone)] && zones[Number(item.to_zone)]),
    [overlays],
  )
  const stopOverlays = useMemo(
    () => overlays.filter((item) => item.kind === 'stop' && Number.isFinite(item.lat) && Number.isFinite(item.lon)),
    [overlays],
  )
  const maxDirection = Math.max(...directions.map((row) => row.value), 1)
  const maxPoint = Math.max(...points.map((row) => row.value), 1)
  const isSupply = intent === 'supply' || points.some((row) => row.pressure_pct !== undefined)
  const comparisonMaximum = Math.max(
    ...points.flatMap((row) => [row.validations_per_departure ?? 0, row.nominal_capacity ?? 0]),
    1,
  )
  const endpoints = useMemo(() => {
    const ids = new Set(directions.flatMap((row) => [row.a, row.b]))
    return [...ids].map((id) => ({ id, ...zones[id] }))
  }, [directions])
  const coordinates = useMemo(() => [
    ...endpoints.map((zone) => [zone.lat, zone.lon]),
    ...points.map((point) => [point.lat, point.lon]),
  ], [endpoints, points])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <MapContainer center={[38.72, -9.14]} zoom={11} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <FitEvidence coordinates={coordinates} />

        {directions.map((row) => {
          const positions = curve(zones[row.a], zones[row.b])
          const traffic = trafficBand(row.value, maxDirection)
          const weight = 2 + 13 * Math.sqrt(row.value / maxDirection)
          return (
            <Fragment key={row.id}>
              <Polyline
                positions={positions}
                pathOptions={{ color: traffic.color, opacity: 0.82, weight, lineCap: 'round', className: 'flow-line' }}
              >
                <Tooltip sticky>
                  <strong>{row.direction}</strong>
                  <br />
                  {traffic.label} traffic · {fmt(row.value)} supported journeys
                  {row.evidence && <><br />{row.evidence}</>}
                </Tooltip>
              </Polyline>
              <Polygon positions={arrowHead(positions)} pathOptions={{ color: traffic.color, weight: 0, fillColor: traffic.color, fillOpacity: 0.95 }} interactive={false} />
            </Fragment>
          )
        })}

        {corridorOverlays.map((proposal) => {
          const from = zones[Number(proposal.from_zone)]
          const to = zones[Number(proposal.to_zone)]
          const positions = curve(from, to, 0.32)
          const reversePositions = [...positions].reverse()
          const style = proposalStyle(proposal.action)
          return (
            <Fragment key={proposal.id}>
              <Polyline positions={positions} pathOptions={{ color: '#ffffff', opacity: 0.94, weight: 10, lineCap: 'round' }} interactive={false} />
              <Polyline
                positions={positions}
                pathOptions={{ color: style.color, opacity: 0.96, weight: 6, lineCap: 'round', dashArray: '2 8' }}
              >
                <Tooltip sticky>
                  <strong>AI suggestion · {proposal.title}</strong>
                  <br />
                  {proposal.from} ↔ {proposal.to}
                  <br />
                  {style.label} · {proposal.priority} priority
                  <br />
                  {proposal.rationale}
                  {proposal.supported_journeys > 0 && <><br />Evidence: {fmt(proposal.supported_journeys)} supported journeys</>}
                </Tooltip>
              </Polyline>
              <Polygon positions={arrowHead(positions)} pathOptions={{ color: style.color, weight: 0, fillColor: style.color, fillOpacity: 1 }} interactive={false} />
              <Polygon positions={arrowHead(reversePositions)} pathOptions={{ color: style.color, weight: 0, fillColor: style.color, fillOpacity: 1 }} interactive={false} />
            </Fragment>
          )
        })}

        {endpoints.map((zone) => (
          <CircleMarker key={zone.id} center={[zone.lat, zone.lon]} radius={5} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#3c4043', fillOpacity: 0.95 }}>
            <Tooltip permanent direction="right" offset={[7, 0]} className="zone-label">{zone.name}</Tooltip>
          </CircleMarker>
        ))}

        {points.map((point) => {
          if (isSupply) {
            const demand = point.validations_per_departure ?? 0
            const supply = point.nominal_capacity ?? 0
            const demandLabel = point.measure === 'boardings_vs_expected' ? 'Boardings' : point.measure === 'estimated_load_vs_places' ? 'Estimated peak load' : 'Demand'
            const supplyLabel = point.measure === 'boardings_vs_expected' ? 'Expected baseline' : point.measure === 'estimated_load_vs_places' ? 'Places offered' : 'Supply'
            const demandRadius = 3 + 17 * Math.sqrt(demand / comparisonMaximum)
            const supplyRadius = 3 + 17 * Math.sqrt(supply / comparisonMaximum)
            return (
              <Fragment key={point.key}>
                <CircleMarker
                  center={[point.lat, point.lon]}
                  radius={demandRadius}
                  pathOptions={{ color: point.color, weight: 1, fillColor: point.color, fillOpacity: 0.72 }}
                >
                  <Tooltip direction="top">
                    <strong>{point.stop}</strong>
                    <br />
                    {demandLabel}: {fmt(demand)}
                    <br />
                    {supplyLabel}: {fmt(supply)}
                    <br />
                    Pressure: {fmt(point.pressure_pct)}%
                    <br />
                    Sample: {fmt(point.validations)} validations · {fmt(point.departures)} departures
                  </Tooltip>
                </CircleMarker>
                <CircleMarker
                  center={[point.lat, point.lon]}
                  radius={supplyRadius}
                  pathOptions={{ color: '#1a73e8', weight: 3, fillOpacity: 0 }}
                  interactive={false}
                />
              </Fragment>
            )
          }
          return (
            <CircleMarker
              key={point.key}
              center={[point.lat, point.lon]}
              radius={4 + 13 * Math.sqrt(point.value / maxPoint)}
              pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: point.color, fillOpacity: 0.8 }}
            >
              <Tooltip direction="top">
                <strong>{point.stop}</strong>
                <br />
                {fmt(point.observed)} observed · {fmt(point.expected)} expected
              </Tooltip>
            </CircleMarker>
          )
        })}

        {stopOverlays.map((proposal) => {
          const style = proposalStyle(proposal.action)
          return (
            <CircleMarker
              key={proposal.id}
              center={[proposal.lat, proposal.lon]}
              radius={23}
              pathOptions={{ color: style.color, weight: 4, dashArray: '3 5', fillColor: style.color, fillOpacity: 0.08 }}
            >
              <Tooltip direction="top">
                <strong>AI suggestion · {proposal.title}</strong>
                <br />
                {proposal.stop} · {style.label} · {proposal.priority} priority
                <br />
                {proposal.rationale}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {directions.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 z-[500] w-56 rounded-xl border border-line bg-surface/95 p-3 shadow-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">Busiest visible directions</p>
          <div className="mt-2 space-y-2">
            {directions.slice().sort((a, b) => b.value - a.value).slice(0, 5).map((row) => {
              const traffic = trafficBand(row.value, maxDirection)
              return (
                <div key={`rank-${row.id}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate text-ink-2" title={row.direction}>{row.direction}</span>
                    <span className="shrink-0 tabular-nums text-ink">{fmt(row.value)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(6, (row.value / maxDirection) * 100)}%`, background: traffic.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-xs rounded-xl border border-line bg-surface/95 p-3 text-[11px] leading-4 text-ink-3 shadow-card">
        {directions.length > 0 ? (
          <>
            <p className="font-medium text-ink">Traffic level and direction</p>
            <p>Arrow = direction · thicker line = more supported journeys</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {TRAFFIC_BANDS.map((band) => (
                <span key={band.label} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: band.color }} />{band.label}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[9px] text-ink-4">Levels are relative to the busiest currently visible direction.</p>
            {corridorOverlays.length > 0 && (
              <p className="mt-2 border-t border-line pt-2 font-medium text-primary-ink">
                Dotted outlined line = AI-proposed investigation
              </p>
            )}
            {directions.some((row) => row.from_to !== undefined) && <p className="mt-1 text-warn">Both directions are drawn separately for candidate direct links.</p>}
          </>
        ) : isSupply ? (
          <>
            <p className="font-medium text-ink">Demand versus supply on the map</p>
            <p><span className="font-medium text-warn">Filled circle</span> = validations per departure</p>
            <p><span className="font-medium text-primary-ink">Blue outline</span> = nominal vehicle capacity</p>
            {stopOverlays.length > 0 && <p className="mt-1 font-medium text-primary-ink">Dashed halo = AI-proposed intervention</p>}
            <p className="mt-1 text-[9px] text-ink-4">Both use the same size scale. A fill reaching beyond its ring indicates demand pressure above capacity.</p>
          </>
        ) : (
          <>
            <p className="font-medium text-ink">Location activity map</p>
            <p>Circle area = activity · colour = demand pressure or anomaly direction</p>
            {stopOverlays.length > 0 && <p className="mt-1 font-medium text-primary-ink">Dashed halo = AI-proposed intervention</p>}
          </>
        )}
      </div>
    </div>
  )
}
