import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import OpenAI from 'openai'
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems'
import { DATA_TOOLS, executeDataTool } from './data-tools.mjs'
import { LIVE_DATA_TOOLS, executeLiveDataTool } from './live-data-tools.mjs'
import { calculateRouteFeasibility } from './feasibility.mjs'
import { validateRecommendations } from './recommendations.mjs'

// Local development convenience. This file is git-ignored and never reaches the browser.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const PORT = Number(process.env.AI_PORT || 8787)
const MODEL = process.env.OPENAI_MODEL || 'gpt-6-astra'
const MAX_BODY_BYTES = 512 * 1024

function currentApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  if (!existsSync('.env.local')) return ''
  const match = readFileSync('.env.local', 'utf8').match(/^OPENAI_API_KEY\s*=\s*(.*)$/m)
  return (match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
}

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'analysis', 'findings', 'recommendations', 'chart', 'followups'],
  properties: {
    answer: { type: 'string' },
    analysis: { type: 'string', enum: ['route', 'supply', 'transfer', 'anomaly', 'flow'] },
    findings: { type: 'array', items: { type: 'string' } },
    recommendations: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['evidence_key', 'action', 'priority', 'title', 'rationale'],
        properties: {
          evidence_key: { type: 'string' },
          action: {
            type: 'string',
            enum: ['investigate_direct_link', 'increase_frequency', 'rebalance_service', 'improve_transfer', 'monitor'],
          },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
    chart: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'highlight'],
      properties: {
        type: {
          type: 'string',
          enum: ['mobility_map', 'route_opportunities', 'route_feasibility', 'demand_supply', 'journey_layers', 'anomalies', 'passenger_flows'],
        },
        highlight: { type: 'string' },
      },
    },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

const instructions = `You are Pulso, an urban-mobility planning assistant for Lisbon Metropolitan Area planners.

You have read-only tools for the mobility data. You MUST call at least one query tool before answering. Tools whose names begin query_live read the connected mobility backend and are authoritative for the current explorer day, hour, operators, passenger segment, stop demand, line capacity, transfer waits, and anomaly alerts. Prefer them whenever the question concerns the current dashboard or those measures. The other aggregate tools remain authoritative for route opportunities, inferred passenger flows, journey layers, and route-feasibility screening. Use the catalog tool first when a location, line, date, or visualization name is uncertain. Extract filters from the user's wording and pass them to the query tool; empty tool filter arrays retain the current UI filters. You may call more than one query tool when the question requires a comparison or supporting evidence.

Analyze only evidence returned by those tools. Never invent, extrapolate, or silently replace a number. If evidence is insufficient, say so directly. Apply the resolved filters exactly and mention any filter_limitations that affect the answer. Preserve the distinction between observed, strongly inferred, and weak evidence. Never describe a demand-pressure proxy as measured occupancy. Treat route opportunities as candidates for investigation or a pilot, not approved routes. For route-improvement questions, call query_route_opportunities and use it as the primary route analysis; you may also call demand/supply, flow, transfer, or anomaly tools for supporting evidence. You MUST call query_route_feasibility when the user asks about the current transfer path, proposed travel time, estimated time saved, likely captured demand, frequency, vehicles, vehicle-kilometres, operating cost, or feasibility/business case. Quote those estimates only from that tool and explicitly distinguish its editable assumptions from observed or scheduled facts. When the user gives “from X to Y”, pass X as origin and Y as destination so only that pair is evaluated. When the user asks for a personal/between-place route but supplies only one endpoint, use the catalog if needed and ask for the missing endpoint; do not guess it and return no structured recommendation. A network-wide planning request such as “where should we test a new direct link?” may use null for both endpoints and rank all corridors. For a named line whose efficiency is being investigated, demand/supply at its filtered stops is more defensible than pretending the route-opportunity aggregate retains line attribution.

Give a concise recommendation, name the primary analysis used, provide 2-5 evidence findings, choose one chart compatible with that query tool, and provide 2-4 useful follow-up questions. Also return zero to four structured recommendations. Every recommendation must use an evidence_key copied exactly from one row of the PRIMARY analysis result; never create a key, stop, corridor, coordinate, or value. Use investigate_direct_link for unsupported recurring corridors, increase_frequency or rebalance_service for stop-level demand/supply pressure, improve_transfer for transfer evidence, and monitor when the evidence is not strong enough for an intervention. Set route-improvement responses with drawable recommendations to mobility_map, or route_feasibility when the user explicitly asks about transfers, estimated time saved, likely captured demand, operating requirements, or cost. Choose journey_layers for a Sankey of mode changes when no map intervention is proposed. The frontend renders the visualization and recommendation geometry from verified tool rows, so select a chart but never generate chart values or geometry yourself. Use an evidence key for chart.highlight when relevant; otherwise return an empty string.`

function corsHeaders(origin) {
  const allowed = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:5174'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  }
}

function send(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(new Error('Request body must be valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/api/planner/health') {
    const apiKey = currentApiKey()
    send(res, apiKey ? 200 : 503, {
      ok: Boolean(apiKey),
      model: MODEL,
      configured: Boolean(apiKey),
    }, origin)
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/planner') {
    send(res, 404, { error: 'Not found.' }, origin)
    return
  }

  const apiKey = currentApiKey()
  if (!apiKey) {
    send(res, 503, { error: 'OpenAI is not configured. Put OPENAI_API_KEY in .env.local, save it, and ask again.' }, origin)
    return
  }

  try {
    const body = await readJson(req)
    if (typeof body.question !== 'string' || !body.question.trim()) {
      send(res, 400, { error: 'question is required.' }, origin)
      return
    }

    const client = new OpenAI({ apiKey })
    const input = [{
      role: 'user',
      content: JSON.stringify({
        question: body.question,
        recent_conversation: Array.isArray(body.conversation) ? body.conversation.slice(-8) : [],
        current_ui_filters: body.filters ?? {},
        current_backend_filters: body.live_filters ?? {},
        available_visualizations: ['mobility_map', 'route_opportunities', 'route_feasibility', 'demand_supply', 'journey_layers', 'anomalies', 'passenger_flows'],
      }),
    }]
    const queryRuns = []
    const toolNames = []
    let response

    for (let turn = 0; turn < 6; turn += 1) {
      response = await client.responses.create({
        model: MODEL,
        instructions,
        input,
        tools: [...DATA_TOOLS, ...LIVE_DATA_TOOLS],
        tool_choice: queryRuns.length ? 'auto' : 'required',
        parallel_tool_calls: true,
        safety_identifier: 'pulso_planner_demo',
        max_output_tokens: 1200,
        text: {
          format: {
            type: 'json_schema',
            name: 'pulso_planner_response',
            strict: true,
            schema: responseSchema,
          },
        },
      })

      const calls = response.output.filter((item) => item.type === 'function_call')
      if (!calls.length) break
      input.push(...toResponseInputItems(response.output))
      for (const call of calls) {
        const args = JSON.parse(call.arguments || '{}')
        const result = call.name.startsWith('query_live_')
          ? await executeLiveDataTool(call.name, args, body.live_filters)
          : executeDataTool(call.name, args, body.filters)
        toolNames.push(call.name)
        if (result.analysis) queryRuns.push({ name: call.name, context: result })
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
      }
    }

    const parsed = JSON.parse(response.output_text)
    const reversedRuns = [...queryRuns].reverse()
    const selectedRun = (parsed.chart.type === 'route_feasibility'
      ? reversedRuns.find((run) => run.context.evidence?.some((row) => row.feasibility))
      : null)
      ?? reversedRuns.find((run) => run.context.analysis === parsed.analysis)
      ?? queryRuns.at(-1)
    if (!selectedRun) throw new Error('The model answered without querying mobility data.')
    const context = { ...selectedRun.context, question: body.question }
    const validated = validateRecommendations(parsed.recommendations, context)
    // Feasibility cases come from the same tool rows the model quoted, so the written
    // answer and the comparison view show identical numbers. Recommended corridors that
    // were not run through the feasibility tool are calculated with the same function.
    const evidenceByKey = new Map(context.evidence.map((row) => [String(row.key), row]))
    const toolFeasibility = queryRuns.flatMap((run) => (run.context.evidence ?? [])
      .filter((row) => row.feasibility)
      .map((row) => row.feasibility))
    const overlayFeasibility = validated.overlays
      .filter((overlay) => overlay.kind === 'corridor')
      .map((overlay) => evidenceByKey.get(overlay.evidence_key))
      .filter(Boolean)
      .map((row) => row.feasibility ?? calculateRouteFeasibility(row))
    const feasibility = [...new Map([...toolFeasibility, ...overlayFeasibility].map((item) => [item.key, item])).values()]
      .slice(0, 4)
    send(res, 200, {
      ...parsed,
      recommendations: validated.recommendations,
      map_overlays: validated.overlays,
      feasibility,
      context,
      resolved_filters: context.applied_filters,
      tools_used: [...new Set(toolNames)],
    }, origin)
  } catch (error) {
    const status = error?.status >= 400 && error.status < 600 ? error.status : 500
    const message = status === 401
      ? 'OpenAI rejected the API key. Revoke the exposed key and configure a new server-side key.'
      : status === 429
        ? 'OpenAI rate or usage limit reached. Check the project limits and billing.'
        : 'The OpenAI planner request failed. Check the server console for details.'
    console.error('Planner request failed:', error?.message || error)
    send(res, status, { error: message }, origin)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pulso OpenAI planner listening on http://127.0.0.1:${PORT}`)
  console.log(process.env.OPENAI_API_KEY ? `Model: ${MODEL}` : 'OPENAI_API_KEY is not configured.')
})
