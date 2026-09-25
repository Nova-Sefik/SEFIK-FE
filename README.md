# Lisbon Passenger Flow Explorer

Decision-support prototype for Hack the City 2026, Challenge #1: Passenger Demand and Mobility Patterns.

The app reads the Carrolinha FastAPI backend (`VITE_API_URL`) for every number it shows; the browser only formats and visualises backend values. The explorer provides six linked live views:

- **Demand** — hourly boardings by H3 area or stop.
- **Load vs capacity** — backend line profiles, capacity pressure, and a same-fleet trip re-timing what-if.
- **Anomalies** — unusually high or low demand relative to the same time on sampled days.
- **Transfers** — cross-operator flows, interchange volumes, and transfer-wait quality.
- **Best routes** — backend-ranked direct-line opportunities, with current transfer paths, projected riders and time savings, peak service need, and network impacts.
- **Journey paths** — journeys along a directed path (from, through, to, touching), a minimum-volume filter, and this hour versus typical, as a map, a flow diagram and a path list. A path is the sequence of tap locations, not the vehicle route.

Clicking a stop opens its observed-versus-expected day profile, seven-day hourly grid, passenger mix, accessibility facilities, grouped operator IDs, and transfer summary. The **Week overview** (`#/overview`) summarises all seven days and the selected day's hourly demand, busiest hour versus typical, operators, interchanges, common cross-operator journeys, and whole-day journey paths.

## AI planning workspace

Open `#/assistant` or select **Ask AI planner** in the explorer. The page is graph-first: preset tabs, suggested questions and the chat composer choose the evidence and the chart.

Preset tabs (Flow map, Journey paths, vs typical, Demand vs supply, Direct links, Transfers, Unusual activity) run one backend tool each through `POST /api/tools/{name}`: the same code and numbers as an AI answer, without calling the model. The filter drawer edits the live filters shared with the explorer — day, hour, operators, passenger segment and the journey path — and closing it re-runs the graph on screen. An AI answer writes its resolved day, hour and path back into those filters, so the drawer always describes what is shown.

The planner runs in the mobility backend (carrolinha-BE, `POST /api/planner`). Its read-only tools cover place search, stop demand, line capacity, transfers, anomalies, ranked best routes, journeys along a directed path, and this hour versus typical. OpenAI chooses and calls the tools and selects a compatible visualization. The browser renders the exact executed tool result; the model never generates graph values. The OpenAI key lives only in the backend's environment. While the planner works, the page shows a loading screen instead of a placeholder graph.

See [`docs/AI_ASSISTANT_CONTRACT.md`](docs/AI_ASSISTANT_CONTRACT.md) for the request, response and data-safety contract.

Direct-link opportunities are screening signals, not automatic service recommendations.

## Run locally

```bash
# Start carrolinha-BE on http://localhost:8000 first (it also serves the AI planner).
npm install
npm run dev
```

Use `npm run lint` and `npm run build` to verify a change. The frontend holds no data files: aggregates, journey paths and baselines are built and served by carrolinha-BE (see its README).

## Data limitations

The backend covers TML validations for 31 August–6 September 2026. Journey paths are currently built from part of that week's raw files; the backend flags hours that are not fully covered, and comparisons with typical use only fully covered hours. With one week of data, a weekend day has a single comparison day, so weekend comparisons are reported as insufficient. Transfers and journeys link taps by the same anonymous card, so groups under the backend's privacy threshold are counted in totals but never shown on their own. Capacity values should be replaced by operator-provided vehicle capacities before operational use.
