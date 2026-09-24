import 'leaflet/dist/leaflet.css'
import { cellToBoundary } from 'h3-js'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { liveApi } from './api'
import { useLiveData } from './LiveDataContext'
import useLiveQuery from './useLiveQuery'
import { anomalyColor, applyWhatIf, chain, curve, demandColor, flowKey, hourLabel, integer, loadColor, pct, waitColor } from './utils'

const CENTER = [38.72, -9.14]

function Camera({ target, fitLines, fitPoints }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], target.zoom ?? 13, { duration: 0.8 })
  }, [map, target])
  useEffect(() => {
    if (!fitLines?.length) return
    const coordinates = fitLines.flatMap((line) => line.shape.map(([lon, lat]) => [lat, lon]))
    if (coordinates.length) map.fitBounds(coordinates, { padding: [70, 70], maxZoom: 13 })
  }, [map, fitLines])
  useEffect(() => {
    if (!fitPoints?.length) return
    const coordinates = fitPoints.map((point) => [point.lat, point.lon])
    if (coordinates.length === 1) map.flyTo(coordinates[0], 13, { duration: 0.8 })
    else map.fitBounds(coordinates, { padding: [70, 70], maxZoom: 13.5 })
  }, [map, fitPoints])
  return null
}

function Legend({ mode, layer }) {
  const items = mode === 'load'
    ? [['#fdd663', 'under 70%'], ['#f9ab00', '70–85%'], ['#e8710a', '85–100%'], ['#d93025', 'over capacity']]
    : mode === 'journeys'
      ? [['#4a3aa7', 'journey path'], ['#1a73e8', 'first tap'], ['#188038', 'last tap / destination']]
    : mode === 'golden'
      ? [['#c48c00', 'strong'], ['#e2aa1e', 'viable'], ['#e8c878', 'weak']]
      : mode === 'transfers'
      ? [['#188038', 'up to 7 min'], ['#b06000', '8–11 min'], ['#d93025', '12+ min']]
      : mode === 'anomalies'
        ? [['#2a78d6', '40%+ below'], ['#dadce0', 'near expected'], ['#d93025', '40%+ above']]
        : [['#d2e3fc', 'lower demand'], ['#4285f4', 'high demand'], ['#174ea6', 'highest demand']]
  const note = mode === 'load'
    ? 'Line colour = estimated peak load ÷ places offered.'
    : mode === 'journeys'
      ? 'Width = journeys. Lines join tap locations in order; they are not the vehicle route.'
    : mode === 'golden'
      ? 'Width = projected riders/day. Grey paths show how selected-route passengers travel today.'
      : mode === 'transfers'
      ? 'Ring colour = worst median wait. Arc width = journeys.'
      : mode === 'anomalies'
        ? `${layer === 'hex' ? 'Area' : 'Stop'} colour = observed ÷ expected.`
        : `${layer === 'hex' ? 'Area colour' : 'Circle area'} = boardings at the selected hour.`
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[500] max-w-64 rounded-xl border border-line bg-surface/95 p-3 text-[11px] shadow-float">
      <p className="font-medium text-ink">{mode === 'journeys' ? 'Journey paths' : mode === 'load' ? 'Load vs capacity' : mode === 'golden' ? 'Best direct routes' : mode === 'transfers' ? 'Transfer quality' : mode === 'anomalies' ? 'Observed vs expected' : 'Live demand'}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
        {items.map(([color, label]) => <span key={label} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>)}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-ink-4">{note}</p>
    </div>
  )
}

export default function LiveMap() {
  const {
    meta, hex, stops, transfers, golden, scales, mode, layer, hour, day, selectedStop, openStop,
    selectedLine, setSelectedLine, selectedTransfer, setSelectedTransfer,
    selectedFlow, setSelectedFlow, selectedGolden, setSelectedGolden,
    selectedAlert, anomalies, whatif, journeyTraffic, selectedPath, setSelectedPath,
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
  const goldenRoutes = useMemo(() => golden.data?.routes ?? [], [golden.data])
  const selectedGoldenRoute = goldenRoutes.find((item) => item.route_id === selectedGolden) ?? null
  const maxGoldenRiders = Math.max(1, ...goldenRoutes.map((item) => item.riders_per_day))
  const visibleFlows = useMemo(() => {
    const rows = transferData?.flows ?? []
    if (selectedFlow) return rows.filter((flow) => flowKey(flow) === selectedFlow)
    if (!selectedTransfer) return rows
    return rows.filter((flow) => flow.from_stop_id === selectedTransfer || flow.to_stop_id === selectedTransfer
      || (flow.via ?? []).some((place) => place.stop_id === selectedTransfer))
  }, [transferData, selectedFlow, selectedTransfer])
  const journeyPaths = useMemo(() => (mode === 'journeys' ? journeyTraffic.data?.paths ?? [] : []), [mode, journeyTraffic.data])
  const maxJourney = Math.max(1, ...journeyPaths.map((item) => item.journeys))
  const journeyFitKey = mode === 'journeys'
    ? (selectedPath ? journeyPaths.filter((item) => item.key === selectedPath) : journeyPaths).flatMap((item) => item.path.map((stop) => stop.stop_id)).join(',')
    : ''
  const journeyFitPoints = useMemo(() => {
    if (!journeyFitKey) return null
    const byId = new Map(journeyPaths.flatMap((item) => item.path.map((stop) => [stop.stop_id, stop])))
    return [...new Set(journeyFitKey.split(','))].map((id) => byId.get(id)).filter(Boolean)
    // Refit only when the set of places changes, not on every refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyFitKey])
  const goldenFitPoints = useMemo(() => {
    if (mode !== 'golden' || !goldenRoutes.length) return null
    if (!selectedGoldenRoute) return goldenRoutes.flatMap((route) => [route.from, route.to])
    return [selectedGoldenRoute.from, selectedGoldenRoute.to, ...selectedGoldenRoute.paths.flatMap((path) => path.via), ...selectedGoldenRoute.hubs]
  }, [mode, goldenRoutes, selectedGoldenRoute])

  const cameraTarget = useMemo(() => {
    const alert = anomalies.data?.alerts?.find((item) => item.alert_id === selectedAlert)
    if (alert) return { lat: alert.lat, lon: alert.lon, zoom: 13 }
    const stop = stopRows.find((item) => item.stop_id === selectedStop)
    return stop ? { lat: stop.lat, lon: stop.lon, zoom: 13 } : null
  }, [anomalies.data, selectedAlert, stopRows, selectedStop])

  const loading = hex.fetching || stops.fetching || transfers.fetching || golden.fetching || profiles.fetching || journeyTraffic.fetching
  const showHex = (mode === 'demand' || mode === 'anomalies') && layer === 'hex'

  return (
    <div className="relative h-full min-h-[28rem] overflow-hidden bg-muted">
      <MapContainer center={CENTER} zoom={10.5} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <Camera target={cameraTarget} fitLines={mode === 'load' ? profiles.data : null} fitPoints={goldenFitPoints ?? journeyFitPoints} />

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

        {mode === 'transfers' && visibleFlows.map((flow) => {
          const selected = flowKey(flow) === selectedFlow
          const points = [
            { lat: flow.from_lat, lon: flow.from_lon },
            ...(flow.via ?? []),
            { lat: flow.to_lat, lon: flow.to_lon },
          ]
          return (
          <Polyline
            key={flowKey(flow)}
            positions={chain(points)}
            pathOptions={{ color: '#4a3aa7', opacity: selectedFlow ? (selected ? 0.95 : 0.15) : 0.62, weight: (selected ? 3 : 1.5) + 8 * (flow.journeys / maxFlow), lineCap: 'round', className: 'flow-line' }}
            eventHandlers={{ click: () => setSelectedFlow(selected ? null : flowKey(flow)) }}
          >
            <Tooltip sticky><strong>{flow.from_name} → {flow.to_name}</strong>{flow.via?.length > 0 && <><br />via {flow.via.map((place) => place.name).join(' → ')}</>}<br />{integer.format(flow.journeys)} journeys/day{flow.modes?.length > 0 && <> · {flow.modes.join(' → ')}</>}</Tooltip>
          </Polyline>
          )
        })}

        {mode === 'transfers' && (transferData?.interchanges ?? []).map((interchange) => (
          <CircleMarker
            key={interchange.stop_id}
            center={[interchange.lat, interchange.lon]}
            radius={7 + 13 * Math.sqrt(interchange.transfers / maxTransfer)}
            pathOptions={{ color: waitColor(interchange.worst_median_wait_min), weight: selectedTransfer === interchange.stop_id ? 6 : 4, fillColor: '#ffffff', fillOpacity: 0.95 }}
            eventHandlers={{ click: () => { setSelectedTransfer(selectedTransfer === interchange.stop_id ? null : interchange.stop_id); setSelectedFlow(null) } }}
          >
            <Tooltip direction="top"><strong>{interchange.name}</strong><br />{integer.format(interchange.transfers)} transfers · worst median wait {interchange.worst_median_wait_min} min</Tooltip>
          </CircleMarker>
        ))}

        {mode === 'journeys' && [...journeyPaths].sort((a, b) => a.journeys - b.journeys).map((item) => {
          const selected = item.key === selectedPath
          const faded = selectedPath && !selected
          const tooltip = <Tooltip sticky><strong>{item.path.map((stop) => stop.name).join(' → ')}{item.destination === 'unknown' ? ' → ?' : ''}</strong><br />{integer.format(item.journeys)} journeys · #{item.rank}{item.difference_pct != null && <> · {item.difference_pct >= 0 ? '+' : '−'}{Math.abs(Math.round(item.difference_pct))}% vs typical</>}</Tooltip>
          if (item.path.length === 1) {
            const stop = item.path[0]
            return (
              <CircleMarker key={item.key} center={[stop.lat, stop.lon]} radius={4 + 12 * Math.sqrt(item.journeys / maxJourney)} pathOptions={{ color: '#4a3aa7', weight: selected ? 3 : 1.5, fillColor: '#4a3aa7', fillOpacity: faded ? 0.1 : 0.35, opacity: faded ? 0.2 : 0.9 }} eventHandlers={{ click: () => setSelectedPath(selected ? null : item.key) }}>
                {tooltip}
              </CircleMarker>
            )
          }
          return (
            <Polyline
              key={item.key}
              positions={chain(item.path, 0.14)}
              pathOptions={{ color: '#4a3aa7', opacity: faded ? 0.12 : selected ? 0.95 : 0.6, weight: (selected ? 3 : 1.5) + 9 * Math.sqrt(item.journeys / maxJourney), lineCap: 'round', className: 'flow-line' }}
              eventHandlers={{ click: () => setSelectedPath(selected ? null : item.key) }}
            >
              {tooltip}
            </Polyline>
          )
        })}

        {mode === 'journeys' && (selectedPath ? journeyPaths.filter((item) => item.key === selectedPath) : journeyPaths.slice(0, 12)).flatMap((item) => [
          { ...item.path[0], role: 'start', id: `${item.key}-start` },
          ...(item.path.length > 1 ? [{ ...item.path.at(-1), role: 'end', id: `${item.key}-end` }] : []),
        ]).map((stop) => (
          <CircleMarker key={stop.id} center={[stop.lat, stop.lon]} radius={4.5} pathOptions={{ color: stop.role === 'start' ? '#1a73e8' : '#188038', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1 }}>
            <Tooltip permanent={Boolean(selectedPath)} direction="top" offset={[0, -6]} className="zone-label">{stop.name}</Tooltip>
          </CircleMarker>
        ))}

        {mode === 'golden' && selectedGoldenRoute && selectedGoldenRoute.paths.map((path, index) => (
          <Polyline
            key={`current-${selectedGoldenRoute.route_id}-${index}`}
            positions={chain([selectedGoldenRoute.from, ...path.via, selectedGoldenRoute.to], 0.25)}
            pathOptions={{ color: '#5f6368', opacity: 0.58, weight: 2 + 10 * path.share, lineCap: 'round' }}
          >
            <Tooltip sticky><strong>How people travel today</strong><br />{path.legs.map((leg) => leg.label || leg.operator).join(' → ')} · {pct(path.share)} of these journeys</Tooltip>
          </Polyline>
        ))}

        {mode === 'golden' && goldenRoutes.map((route) => {
          const selected = route.route_id === selectedGolden
          const color = route.verdict === 'strong' ? '#c48c00' : route.verdict === 'viable' ? '#e2aa1e' : '#e8c878'
          return (
            <Polyline
              key={route.route_id}
              positions={curve(route.from, route.to, 0.12)}
              pathOptions={{ color, opacity: selectedGolden ? (selected ? 1 : 0.22) : 0.88, weight: (selected ? 4 : 2) + 9 * Math.sqrt(route.riders_per_day / maxGoldenRiders), lineCap: 'round' }}
              eventHandlers={{ click: () => setSelectedGolden(selected ? null : route.route_id) }}
            >
              <Tooltip sticky><strong>{route.from.name} ↔ {route.to.name}</strong><br />{integer.format(route.multi_per_day)}/day need 2+ vehicles · saves ~{Math.round(route.saved_min ?? 0)} min<br />{route.verdict} · {integer.format(route.riders_per_day)} projected riders/day</Tooltip>
            </Polyline>
          )
        })}

        {mode === 'golden' && (selectedGoldenRoute ? [selectedGoldenRoute] : goldenRoutes.slice(0, 6)).flatMap((route) => [route.from, route.to]).map((place, index) => (
          <CircleMarker key={`golden-end-${place.stop_id}-${index}`} center={[place.lat, place.lon]} radius={7} pathOptions={{ color: '#966900', weight: 3, fillColor: '#fff7df', fillOpacity: 1 }}>
            <Tooltip permanent={Boolean(selectedGoldenRoute)} direction="top" offset={[0, -8]} className="zone-label">{place.name}</Tooltip>
          </CircleMarker>
        ))}

        {mode === 'golden' && (selectedGoldenRoute?.hubs ?? []).map((hub) => (
          <CircleMarker key={`golden-hub-${hub.stop_id}`} center={[hub.lat, hub.lon]} radius={5} pathOptions={{ color: '#5f6368', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}>
            <Tooltip direction="top">{hub.name}<br />{integer.format(hub.transfers_removed_per_day)} transfers removed/day</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <Legend mode={mode} layer={layer} />
      {loading && <span className="absolute right-4 top-4 z-[500] rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-3 shadow-card">Updating live data…</span>}
    </div>
  )
}
