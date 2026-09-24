export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const cache = new Map()
const pending = new Map()

function cacheKey(path, params) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  return `${path}?${query}`
}

export async function get(path, params = {}, { maxAge = 30_000, signal } = {}) {
  const key = cacheKey(path, params)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.time < maxAge) return hit.data
  if (pending.has(key)) return pending.get(key)

  const request = (async () => {
    const url = new URL(`${API_URL}${path}`)
    Object.entries(params).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value))
    })
    let response
    try {
      response = await fetch(url, { signal })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new ApiError(0, `Cannot reach the mobility API at ${API_URL}`)
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(response.status, typeof body.detail === 'string' ? body.detail : `API returned ${response.status}`)
    }
    const data = await response.json()
    cache.set(key, { data, time: Date.now() })
    return data
  })().finally(() => pending.delete(key))

  pending.set(key, request)
  return request
}

const filterParams = ({ day, ops, segment }) => ({ day, ops: ops.join(','), segment })

export const liveApi = {
  health: () => get('/api/health', {}, { maxAge: 10_000 }),
  meta: () => get('/api/meta', {}, { maxAge: Infinity }),
  overview: (filters) => get('/api/overview', filterParams(filters)),
  hex: (filters, hour) => get('/api/hex', { ...filterParams(filters), hour }),
  stops: (filters, hour) => get('/api/stops', { ...filterParams(filters), hour }),
  stop: (id, filters, hour) => get(`/api/stops/${encodeURIComponent(id)}`, { ...filterParams(filters), hour }),
  line: (id, day) => get(`/api/lines/${encodeURIComponent(id)}/profile`, { day }, { maxAge: 120_000 }),
  transfers: (day) => get('/api/transfers', { day }, { maxAge: 120_000 }),
  anomalies: (day) => get('/api/anomalies', { day }, { maxAge: 120_000 }),
  golden: () => get('/api/golden', {}, { maxAge: Infinity }),
}

export function clearLiveCache() {
  cache.clear()
}
