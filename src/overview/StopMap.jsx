import 'leaflet/dist/leaflet.css'
import { useMemo } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { GROUP_COLOR, GROUP_LABEL, SURFACE, fmt } from '../components/theme'
import Panel from './Panel'

export default function StopMap({ stops, groups }) {
  const visible = useMemo(() => stops.filter((s) => groups.includes(s.group)), [stops, groups])
  const max = stops[0]?.n ?? 1

  return (
    <Panel
      title="Where people board"
      subtitle={`Top ${visible.length} stops and stations by boardings. Circle area is proportional to volume.`}
      className="lg:col-span-2"
    >
      <div className="h-[460px] overflow-hidden rounded-lg">
        <MapContainer center={[38.72, -9.14]} zoom={11} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />
          {/* smallest first so big stations sit on top */}
          {[...visible].reverse().map((s) => (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={3 + 22 * Math.sqrt(s.n / max)}
              pathOptions={{ color: SURFACE, weight: 1, fillColor: GROUP_COLOR[s.group], fillOpacity: 0.75 }}
            >
              <Tooltip>
                <strong>{s.name}</strong>
                <br />
                {GROUP_LABEL[s.group]} · {fmt(s.n)} boardings
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </Panel>
  )
}
