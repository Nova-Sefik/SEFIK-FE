# API — contract for the frontend

Every response below exists **today** from the mock API, with the final shapes. When the real data lands, the backend switches one environment variable (`PULSO_PROVIDER=duckdb`) and the frontend changes nothing.

Full example bodies: `samples/*.json` (one file per endpoint) or `samples/ALL_SAMPLES.json` (everything in one file). Interactive docs with "Try it out": `/docs` on the running API.

## Running it

Base URL in the frontend: `VITE_API_URL` (e.g. `http://localhost:8000` locally, the Render URL in production). CORS is open, so the frontend can run on any origin.

## Conventions (read these once)

| Thing | Rule |
|---|---|
| `day` | ISO date, one of the 7 dates in `meta.days` (2026-08-31 … 2026-09-06). Default `2026-09-01`. |
| `hour` | Integer 5–24. **24 means 00:00–00:59 after midnight** (still the same service day). Use `meta.hours[].label` for display. Default `8`. |
| `ops` | Comma-separated operator ids: `metro,carris,cm,rail,ferry,other`. Default = all. |
| `segment` | `all` \| `sub23` \| `senior`. Default `all`. |
| Coordinates | Points are `lat`/`lon` fields. Paths (`shape`) are `[[lon, lat], …]` — deck.gl order. |
| Hexes | H3 resolution 8 cell ids as strings; feed straight into deck.gl `H3HexagonLayer` (`getHexagon: d => d.h3`). |
| `boardings` | People tapping IN (entry validations). Floats, already rounded to 0.1. |
| `expected` | What a normal day looks like for that stop/hour (median of the other weekdays). |
| `ratio` | `boardings / expected`. 1.0 = normal. Colour this for the "anomaly" view. |
| Colour scales | Use `meta.scales` maxima, fetched **once**. Do not rescale per hour, or the time slider will lie (every hour would look equally busy). Values can exceed the max on anomaly hours — clamp. |
| Operator colours | `meta.operators[].color`. |
| Mock flag | `meta.is_mock === true` → show a small "MOCK DATA" badge. |
| Errors | `404 {"detail": "unknown stop_id 'x'"}`, `422 {"detail": "..."}` for bad params. |

## Endpoints

### `GET /api/meta` — call once at startup
Everything static: `days[]` (date, label, weekday, is_weekend), `hours[]` (hour, label), `operators[]` (id, name, color, agency_codes), `segments[]`, `hex_resolution`, `scales` (stop_boardings_max, hex_boardings_max, network_hour_max), `lines[]` (line_id, label, name, mode, operator) for the line picker.

### `GET /api/overview?day&ops&segment` — top bar + side panel
`kpis` {boardings, busiest_hour, transfers, alerts}; `operator_share[]` {operator, boardings, share 0–1}; `network_hourly[]` {hour, boardings} (the sparkline; draw a cursor at the slider hour); `top_interchanges[]` {stop_id, name, transfers}.

### `GET /api/hex?day&hour&ops&segment` — the heat map
`cells[]` {h3, boardings, expected, ratio}. ~200 cells, ~14 KB. Refetch when the slider moves (debounce ~150 ms, or prefetch all 20 hours for a day and animate locally).

### `GET /api/stops?day&hour&ops&segment` — clickable points
`stops[]` {stop_id, name, lat, lon, operators[], boardings, expected, ratio}. Draw as a ScatterplotLayer on top of the hexes; radius ∝ √boardings; click → stop detail.

### `GET /api/stops/{stop_id}?day&hour&ops&segment` — stop drawer
`now` {boardings, expected, deviation_pct}; `hourly[]` {hour, boardings, expected} (line chart: actual vs normal); `week_grid[]` {date, weekday, hourly[20 numbers, hours 5→24]} (7×20 heat grid); `mix` {regular, sub23, senior} shares; `facilities` {shelter, step_free, realtime_display, wheelchair_boarding}; `operator_stop_ids` {operator: [ids]}; `transfers_here` {transfers, worst_median_wait_min} or `null`.

### `GET /api/lines/{line_id}/profile?day` — capacity view (bus + ferry)
`vehicle` {seats, standing, places, source}; `shape` [[lon,lat]…] (draw the route); `hours[]` {hour, boardings, est_peak_load, trips, places_offered, load_factor}; `peak` {hour, load_factor}; `whatif` {move_to_hours, move_from_hours, note}.

`load_factor` > 1.0 means more people than places at the busiest point → draw red. Line ids in the mock: `1709`, `3001`, `1733` (bus), `CA-CS` (ferry Cacilhas–Cais do Sodré).

**What-if slider (computed in the browser, no API call):**
```js
function applyWhatIf(profile, n) {           // n = trips moved, 0..move_to_hours.length
  const hours = profile.hours.map(h => ({ ...h }));
  const at = hr => hours.find(h => h.hour === hr);
  for (let i = 0; i < n; i++) {
    at(profile.whatif.move_to_hours[i]).trips += 1;
    at(profile.whatif.move_from_hours[i]).trips = Math.max(0, at(profile.whatif.move_from_hours[i]).trips - 1);
  }
  for (const h of hours) {
    h.places_offered = h.trips * profile.vehicle.places;
    h.load_factor = h.places_offered ? h.est_peak_load / h.places_offered : 0;
  }
  return hours;   // same fleet size, trips moved from quiet hours to the crush hour
}
```
Mock story: line 1709 on Tue 08:00 is at 104 %; moving 2 trips drops it to ~70 %.

### `GET /api/transfers?day` — journey tracking
`interchanges[]` {stop_id, name, lat, lon, transfers, worst_median_wait_min, fragile (wait ≥ 10 min), pairs[] {from_operator, to_operator, transfers, median_wait_min, p90_wait_min}, hourly[] {hour, transfers}}; `flows[]` {from_stop_id, from_name, from_lon, from_lat, to_stop_id, to_name, to_lon, to_lat, journeys, via[] places, modes[], via_share} → a connected path through the actual transfer chain. `method` = one sentence to show in a tooltip.

### `GET /api/golden` — ranked best direct routes
Returns a typical-weekday ranking that is independent of the day/hour explorer filters. `routes[]` includes the endpoint places, rank and verdict; current multi-vehicle demand and paths plus `shown_paths_share`; current and projected journey minutes; time saved; projected riders and person-hours saved; peak-hour trips needed and `peak_headway_min`; directional shares and volumes (`share_a_to_b`, `share_b_to_a`, `from_to_per_day`, `to_from_per_day`); `demand_top_percent`; hourly demand; affected existing lines with backend `frequency_review_recommended`; transfer hubs relieved; current direct services; and explanatory flags. `method` explains the selection method and `assumptions` contains the projection inputs. The frontend displays these as **Best routes** without recalculating planning metrics.

### `GET /api/anomalies[?day]` — alerts list
Omit `day` for the whole week. `alerts[]` sorted by |robust_z| desc: {alert_id, stop_id, name, lat, lon, date, hour, observed, expected, deviation_pct, robust_z, direction "above"|"below", hourly[] {hour, observed, expected}}. Click an alert → set day+hour on the slider and fly to lat/lon. Mock headline: Oriente, Tue 1 Sep 18:00, +151 %.

### `GET /api/journey-traffic` — directed journey paths
Accepts `day`, optional `hour`, `origin`, comma-separated ordered `through`, `destination`, comma-separated `any`, `match=contains|exact`, `min_volume`, `compare`, `limit` (maximum 10,000) and `offset`. Paths are ordered tap locations, not physical vehicle routes. The main explorer requests all privacy-safe paths for its selected period. Counts, Sankey layers, coverage, applied filters and the current-versus-typical comparison are backend values.

### `GET /api/compare` — selected hour versus typical
Accepts `measure=stop_boardings|network_boardings|transfers|line_boardings`, `subject` where required, plus the live filters. `comparison.typical` is the backend median of the same hour on other fully covered days of the same type, excluding the selected day. The response includes the selected values, baseline dates and the hourly series used by the grey-background comparison chart.

### `POST /api/planner` and `POST /api/tools/{name}`
The AI planner and model-free presets run read-only tools in `carrolinha-BE`. Both return the executed tool context, including `allowed_charts`; `hour_vs_average` renders the backend comparison without calculating values in the browser.

### `GET /api/health`
`{"ok": true, "provider": "mock"}` — use it to wake the Render instance.

## Suggested fetch pattern
1. On load: `meta` + `overview` + `hex` + `stops` + `anomalies` (week).
2. Slider/filters change → `hex`, `stops`, `overview` (overview only when day/ops/segment change).
3. Stop click → `stops/{id}`. Line picker → `lines/{id}/profile`. Transfers tab → `transfers`.
