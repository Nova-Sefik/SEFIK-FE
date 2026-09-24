# Lisbon Passenger Flow Explorer

Decision-support prototype for Hack the City 2026, Challenge #1: Passenger Demand and Mobility Patterns.

The app combines anonymised Navegante validations with the GTFS plan active on each date. The main explorer now reads the Carrolinha FastAPI backend directly and keeps Sefik's visual language. It provides five linked live views:

- **Demand** — hourly boardings by H3 area or stop.
- **Load vs capacity** — backend line profiles, capacity pressure, and a same-fleet trip re-timing what-if.
- **Anomalies** — unusually high or low demand relative to the same time on sampled days.
- **Transfers** — cross-operator flows, interchange volumes, and transfer-wait quality.
- **Best routes** — backend-ranked and backend-calculated direct-line opportunities, with current transfer paths, projected riders and time savings, peak service need, and network impacts. The browser only formats and visualises these values.

Clicking a stop opens its observed-versus-expected day profile, seven-day hourly grid, passenger mix, accessibility facilities, grouped operator IDs, and transfer summary.

The whole-sample overview also contains a four-layer transfer-chain graph:

**Origin mode → transfer area → next mode → next detected destination**

A chain is two boardings by the same card within 60 minutes plus the next detected destination; it is a transfer window, not a complete journey. Destinations confirmed by a Metro exit are kept distinct from those inferred from the next bus, rail, or ferry boarding. Every stored combination is drawn by default, and a location filter narrows the graph to chosen transfer areas or destinations.

## AI planning workspace

Open `#/assistant` or select **Ask AI planner** in the explorer. The page is graph-first: suggested questions and the chat composer choose the evidence, recommendation and visual response.

The default assistant view is a geographic movement map with directional arrows; demand-versus-supply bars, direct-link bars, journey Sankey, passenger-flow bars, and anomaly comparisons are available alongside it. The prompt chooses both the aggregate evidence and a compatible renderer, while explicit requests such as `show these flows on a map` always keep the requested visualization. The filter drawer combines multiple locations, modes, lines, sample dates, time windows, and evidence levels. Selections inside one category use OR; categories combine with AND. The same filters can be stated naturally in the chat, for example: `Compare Metro supply in Oriente and Cais do Sodré, Tuesday 07:00–10:00`.

The planner runs in the mobility backend (carrolinha-BE, `POST /api/planner`). Its read-only tools cover stop demand, line capacity, transfers, anomalies, ranked best routes, journeys along a directed path, and this hour versus typical. OpenAI chooses and calls the tools, receives the explorer's current day/hour/operator/segment filters, and selects a compatible visualization. The browser renders the exact executed tool result; the model never generates graph values. The OpenAI key lives only in the backend's environment. While the planner works, the page shows a loading screen instead of a placeholder graph.

See [`docs/AI_ASSISTANT_CONTRACT.md`](docs/AI_ASSISTANT_CONTRACT.md) for the request, response and data-safety contract.

Route opportunities are screening signals, not automatic service recommendations. The layer excludes weak same-day journey inferences and explains the directionality, recurrence, distance, and evidence behind every candidate.

## Run locally

```bash
# Start carrolinha-BE on http://localhost:8000 first (it also serves the AI planner).
npm install
npm run dev
```

Use `npm run lint` and `npm run build` to verify a change.

## Rebuild the aggregate

The live explorer and the AI planner read the backend selected by `VITE_API_URL`. The committed aggregate data in `src/data/demand.json` and `src/data/overview.json` is still used by the Research overview page and the assistant's preset graphs until they move to the backend. If the restricted validation CSVs are available locally, regenerate those aggregates with:

```bash
python3 scripts/build_demand_json.py /path/to/validations
```

The script reads the official TML plans API, caches the corresponding GTFS archives under `scripts/.gtfs_cache/`, and writes only aggregate, anonymous outputs. Raw card hashes are never written to the frontend data.

## Data limitations

The supplied sample covers approximately 48 hours across five weekdays between 31 August and 4 September 2026, with gaps. Results describe the sample, not a complete seasonal demand model. Capacity values are nominal proxies and should be replaced by operator-provided vehicle capacities before operational use.
