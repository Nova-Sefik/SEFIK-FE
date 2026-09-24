# AI planning assistant contract

The graph-first assistant is available at `#/assistant`. It calls `POST /api/planner` on the mobility backend (carrolinha-BE, `app/planner.py`), which runs the OpenAI Responses API with function tools next to the data.

It does not generate local fallback recommendations. If OpenAI is unavailable, the UI shows a connection error. The OpenAI key lives only in the backend's git-ignored `.env` (or a Render secret). Never place an API key in a `VITE_*` variable because Vite exposes those values to the browser.

> The request/response sections below describe the original contract. The backend keeps the same response shape; its tool list is `find_places` and the `query_live_*` tools, including `query_live_journey_traffic` and `query_live_compare`, with the chart types `journey_path_traffic` and `hour_vs_average`.

## Request

The browser sends `POST application/json`:

```json
{
  "question": "Where should we test a direct route?",
  "conversation": [],
  "filters": {
    "locations": ["12", "18"],
    "modes": ["metro"],
    "lines": [],
    "days": ["2026-09-01"],
    "fromTime": 420,
    "toTime": 600,
    "evidence": []
  }
}
```

The browser does not choose and send one evidence table to OpenAI. The gateway owns read-only access to aggregate data and exposes these function tools:

| Tool | Evidence returned |
|---|---|
| `list_mobility_data_catalog` | Available locations, modes, lines, dates, evidence levels and visualizations |
| `query_route_opportunities` | Ranked unsupported direct-link opportunities |
| `query_route_feasibility` | Current GTFS transfer path and assumption-based direct-service time, demand and operating comparison |
| `query_demand_supply` | Highest demand-pressure stop/time combinations |
| `query_journey_layers` | Transfer chains: origin mode → transfer area → next mode → next detected destination (transfer windows, not complete journeys) |
| `query_anomalies` | Observed versus same-time baseline alerts |
| `query_passenger_flows` | Directional zone-to-zone flows |
| `query_live_stop_demand` | Backend stop boardings versus the same-time expected baseline |
| `query_live_line_capacity` | Backend estimated peak on-board load versus places offered |
| `query_live_transfers` | Backend interchange volumes and median/p90 transfer waits |
| `query_live_anomalies` | Backend-detected observed-versus-expected stop-hour alerts |
| `query_live_golden_routes` | Backend-ranked best direct routes, current transfer paths, projected riders, time savings, peak trips, affected lines, and relieved hubs |

The browser also sends `live_filters` containing the explorer's current `day`, `hour`, `ops`, and `segment`. Empty arguments in a `query_live_*` call retain those values. `PULSO_API_URL` configures the server-side backend URL; it should normally match the browser's `VITE_API_URL`.

The model must call at least one query tool before answering. It may call multiple tools for comparisons. `query_live_*` tools execute against the backend configured by `PULSO_API_URL`; the remaining aggregate tools use `src/data/demand.json` and `src/data/overview.json`. The gateway returns the selected tool result to the browser as the trusted graph context.

For “best route”, “golden route”, projected direct-line demand, time-saving, or network-wide direct-route questions, `query_live_golden_routes` is the authoritative primary analysis. Its ranking, directional volumes, percentile, headway, and estimates come directly from `/api/golden`; neither the gateway nor browser recalculates them. The model may explain or recommend an investigation but cannot replace those values.

`query_route_opportunities` accepts separate `origin` and `destination` arguments. A prompt such as “better route from Oriente to Pontinha” is restricted to that ordered pair rather than treating the two places as an unordered location filter. Both arguments are `null` for a network-wide opportunity search. If a between-place request supplies only one endpoint, the assistant asks for the missing endpoint and does not draw a proposal.

No raw validations, card hashes, or person-level sequences leave the data pipeline.

## Combined filters

The assistant UI and context builder share the same filter state. A request can combine multiple locations, operator modes, lines, sample dates, a time window, and journey-confidence levels. Values inside one dimension use OR; dimensions are joined with AND. For example:

```text
(Oriente OR Cais do Sodré) AND Metro AND Tuesday AND 07:00–10:00
```

Natural-language questions are resolved into filter state in the UI and again into query-tool arguments by the model. The executed tool returns `applied_filters`, a human-readable summary, and `filter_limitations`. If a source aggregate does not retain a requested dimension—for example mode on zone-to-zone flows—the limitation is returned explicitly rather than fabricating a filtered result.

## Response

```json
{
  "answer": "Short, evidence-grounded recommendation.",
  "analysis": "route",
  "findings": ["Supporting fact", "Important qualification"],
  "recommendations": [
    {
      "evidence_key": "12-18",
      "action": "investigate_direct_link",
      "priority": "high",
      "title": "Test a direct-link pilot",
      "rationale": "Interpretation grounded in the referenced tool row."
    }
  ],
  "chart": {
    "type": "mobility_map",
    "highlight": "12-18"
  },
  "followups": ["Suggested next question"],
  "context": { "evidence": [], "applied_filters": {} },
  "resolved_filters": {},
  "tools_used": ["query_route_opportunities"],
  "map_overlays": [
    {
      "kind": "corridor",
      "from_zone": "12",
      "to_zone": "18"
    }
  ]
}
```

Allowed chart types:

- `mobility_map`
- `route_opportunities`
- `route_feasibility`
- `demand_supply`
- `journey_layers`
- `anomalies`
- `passenger_flows`

The browser validates the response, ignores unsupported or evidence-incompatible chart types, and renders charts from its trusted aggregate context rather than model-generated numbers. `mobility_map` draws directional arrows for flow, route-opportunity, and interchange evidence, or activity circles for stop-based supply and anomaly evidence. An explicit request for a map always keeps the map renderer even if the model suggests another chart.

Structured recommendations may select an `evidence_key` from the primary tool result and describe an action, priority, title, and rationale. The server rejects missing or invented keys and constructs `map_overlays` itself from the matching trusted evidence row. The model therefore chooses which supported corridor or stop to investigate, while the data layer—not the model—supplies coordinates, endpoints, volumes, and map geometry. A drawable recommendation automatically opens the map; proposed corridors use a separate outlined colour and proposed stop interventions use a dashed halo.

For corridor recommendations, the server also produces a feasibility screening case. The existing transfer chain comes from a stop-level path built from the cached GTFS feeds active on 2 September 2026, nearby interchange walking, and an explicit transfer-wait assumption. Initial service wait is excluded. The walk from the origin area to the first station and from the last station to the destination area (`access_egress_walk_minutes`) is added to both the current and the proposed journey, so the estimated saving reflects riding and transfer time only; it is passenger time and is not counted in the vehicle cycle used for the fleet estimate. Proposed alignment distance, speed, demand capture, headway, service span, layover and cost per vehicle-kilometre are editable assumptions in the frontend. Likely demand is reported only for the sampled validation windows and operating cost excludes capital expenditure, deadheading, depot constraints and revenue.

## Server responsibilities

1. Hold the provider API key server-side.
2. Authenticate and rate-limit callers before production use.
3. Expose only read-only aggregate query tools to the model and execute tool calls server-side.
4. Require a data-query tool result before accepting a final answer.
5. Return the exact executed tool context, resolved filters, tool audit trail, and Structured Output response.
6. Log aggregate request metadata, not raw prompts, if governance requires minimal retention.
