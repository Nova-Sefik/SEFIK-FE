import 'leaflet/dist/leaflet.css'
import { cellToBoundary } from 'h3-js'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { liveApi } from './api'
import { useLiveData } from './LiveDataContext'
import useLiveQuery from './useLiveQuery'
import { anomalyColor, applyWhatIf, curve, demandColor, hourLabel, integer, loadColor, pct, waitColor } from './utils'

const CENTER = [38.72, -9.14]

function Camera({ target, fitLines }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], target.zoom ?? 13, { duration: 0.8 })
  }, [map, target])
  useEffect(() => {
    if (!fitLines?.length) return
    const coordinates = fitLines.flatMap((line) => line.shape.map(([lon, lat]) => [lat, lon]))
    if (coordinates.length) map.fitBounds(coordinates, { padding: [70, 70], maxZoom: 13 })
  }, [map, fitLines])
  return null
}

function Legend({ mode, layer }) {
  const items = mode === 'load'
    ? [['#fdd663', 'under 70%'], ['#f9ab00', '70–85%'], ['#e8710a', '85–100%'], ['#d93025', 'over capacity']]
    : mode === 'transfers'
      ? [['#188038', 'up to 7 min'], ['#b06000', '8–11 min'], ['#d93025', '12+ min']]
      : mode === 'anomalies'
        ? [['#2a78d6', '40%+ below'], ['#dadce0', 'near expected'], ['#d93025', '40%+ above']]
        : [['#d2e3fc', 'lower demand'], ['#4285f4', 'high demand'], ['#174ea6', 'highest demand']]
  const note = mode === 'load'
    ? 'Line colour = estimated peak load ÷ places offered.'
    : mode === 'transfers'
      ? 'Ring colour = worst median wait. Arc width = journeys.'
      : mode === 'anomalies'
        ? `${layer === 'hex' ? 'Area' : 'Stop'} colour = observed ÷ expected.`
        : `${layer === 'hex' ? 'Area colour' : 'Circle area'} = boardings at the selected hour.`
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[500] max-w-64 rounded-xl border border-line bg-surface/95 p-3 text-[11px] shadow-float">
      <p className="font-medium text-ink">{mode === 'load' ? 'Load vs capacity' : mode === 'transfers' ? 'Transfer quality' : mode === 'anomalies' ? 'Observed vs expected' : 'Live demand'}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
        {items.map(([color, label]) => <span key={label} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>)}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-ink-4">{note}</p>
    </div>
  )
}

export default function LiveMap() {
  const {
    meta, hex, stops, transfers, scales, mode, layer, hour, day, selectedStop, openStop,
    selectedLine, setSelectedLine, selectedTransfer, setSelectedTransfer,
    selectedAlert, anomalies, whatif,
  } = useLiveData()
  const lineIds = meta.data?.lines?.map((item) => item.line_id) ?? []
  const linesKey = `${day}|${lineIds.join(',')}`
  const profiles = useLiveQuery(
    `profiles|${linesKey}`,
    () => Promise.all(lineIds.map((id) => liveApi.line(id, day))),
    { enabled: mode === 'load' && lineIds.length > 0 },
  )

  const stopRows = useMemo(() => stops.data?.stops ?? [], [stops.data])
  const maxStop = scales?.stop_boardings_max || Math.max(1, ...stopRows.map((item) => item.boardings))
  const maxHex = scales?.hex_boardings_max || 1
  const activeLine = selectedLine ?? lineIds[0]
  const transferData = transfers.data
  const maxTransfer = Math.max(1, ...(transferData?.interchanges ?? []).map((item) => item.transfers))
  const maxFlow = Math.max(1, ...(transferData?.flows ?? []).map((item) => item.journeys))

  const cameraTarget = useMemo(() => {
    const alert = anomalies.data?.alerts?.find((item) => item.alert_id === selectedAlert)
    if (alert) return { lat: alert.lat, lon: alert.lon, zoom: 13 }
    const stop = stopRows.find((item) => item.stop_id === selectedStop)
    return stop ? { lat: stop.lat, lon: stop.lon, zoom: 13 } : null
  }, [anomalies.data, selectedAlert, stopRows, selectedStop])

  const loading = hex.fetching || stops.fetching || transfers.fetching || profiles.fetching
  const showHex = (mode === 'demand' || mode === 'anomalies') && layer === 'hex'

  return (
    <div className="relative h-full min-h-[28rem] overflow-hidden bg-muted">
      <MapContainer center={CENTER} zoom={10.5} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <Camera target={cameraTarget} fitLines={mode === 'load' ? profiles.data : null} />

        {showHex && (hex.data?.cells ?? []).map((cell) => (
          <Polygon
            key={cell.h3}
            positions={cellToBoundary(cell.h3)}
            pathOptions={{
              color: '#ffffff', weight: 0.7, opacity: 0.7,
              fillColor: mode === 'anomalies' ? anomalyColor(cell.ratio) : demandColor(cell.boardings, maxHex),
              fillOpacity: mode === 'anomalies' ? 0.72 : 0.78,
            }}
          >
            <Tooltip sticky>
              <strong>{integer.format(cell.boardings)} boardings</strong> at {hourLabel(hour)}
              <br />{integer.format(cell.expected)} expected · {pct(cell.ratio)} of typical
            </Tooltip>
          </Polygon>
        ))}

        {!showHex && (mode === 'demand' || mode === 'anomalies') && [...stopRows].sort((a, b) => a.boardings - b.boardings).map((stop) => {
          const radius = 3 + 20 * Math.sqrt(Math.max(mode === 'anomalies' ? stop.expected : stop.boardings, 0) / Math.max(1, maxStop))
          const color = mode === 'anomalies' ? anomalyColor(stop.ratio) : demandColor(stop.boardings, maxStop)
          return (
            <CircleMarker
              key={stop.stop_id}
              center={[stop.lat, stop.lon]}
              radius={radius}
              pathOptions={{ color: selectedStop === stop.stop_id ? '#202124' : '#ffffff', weight: selectedStop === stop.stop_id ? 3 : 1.2, fillColor: color, fillOpacity: 0.88 }}
              eventHandlers={{ click: () => openStop(stop.stop_id) }}
            >
              <Tooltip direction="top"><strong>{stop.name}</strong><br />{integer.format(stop.boardings)} boardings · {pct(stop.ratio)} of expected</Tooltip>
            </CircleMarker>
          )
        })}

        {mode === 'load' && (profiles.data ?? []).map((profile) => {
          const adjusted = profile.line_id === activeLine ? applyWhatIf(profile, whatif) : profile.hours
          const load = adjusted.find((item) => item.hour === hour)?.load_factor ?? 0
          const active = profile.line_id === activeLine
          return (
            <Polyline
              key={profile.line_id}
              positions={profile.shape.map(([lon, lat]) => [lat, lon])}
              pathOptions={{ color: loadColor(load), weight: active ? 9 : 5, opacity: active ? 1 : 0.62, lineCap: 'round' }}
              eventHandlers={{ click: () => setSelectedLine(profile.line_id) }}
            >
              <Tooltip sticky><strong>{profile.label} · {profile.name}</strong><br />{pct(load)} of places at {hourLabel(hour)}</Tooltip>
            </Polyline>
          )
        })}

        {mode === 'transfers' && (transferData?.flows ?? []).map((flow) => (
          <Polyline
            key={`${flow.from_stop_id}-${flow.to_stop_id}`}
            positions={curve({ lat: flow.from_lat, lon: flow.from_lon }, { lat: flow.to_lat, lon: flow.to_lon })}
            pathOptions={{ color: '#4a3aa7', opacity: 0.62, weight: 1.5 + 8 * (flow.journeys / maxFlow), lineCap: 'round', className: 'flow-line' }}
          >
            <Tooltip sticky><strong>{flow.from_name} → {flow.to_name}</strong><br />{integer.format(flow.journeys)} journeys/day</Tooltip>
          </Polyline>
        ))}

        {mode === 'transfers' && (transferData?.interchanges ?? []).map((interchange) => (
          <CircleMarker
            key={interchange.stop_id}
            center={[interchange.lat, interchange.lon]}
            radius={7 + 13 * Math.sqrt(interchange.transfers / maxTransfer)}
            pathOptions={{ color: waitColor(interchange.worst_median_wait_min), weight: selectedTransfer === interchange.stop_id ? 6 : 4, fillColor: '#ffffff', fillOpacity: 0.95 }}
            eventHandlers={{ click: () => setSelectedTransfer(interchange.stop_id) }}
          >
            <Tooltip direction="top"><strong>{interchange.name}</strong><br />{integer.format(interchange.transfers)} transfers · worst median wait {interchange.worst_median_wait_min} min</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <Legend mode={mode} layer={layer} />
      {loading && <span className="absolute right-4 top-4 z-[500] rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-3 shadow-card">Updating live data…</span>}
    </div>
  )
}
