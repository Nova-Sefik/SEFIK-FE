import raw from '../data/demand.json'

// ---------------------------------------------------------------- constants

// Nominal passenger capacity per scheduled departure, used for the load proxy
export const CAPACITY = { metro: 600, bus: 80, ferry: 500, train: 1000 }
export const capacityOf = (stop) =>
  stop.group === 'metro'
    ? CAPACITY.metro
    : stop.id.startsWith('LTP61')
      ? CAPACITY.ferry
      : stop.id.startsWith('7NTB1')
        ? CAPACITY.train
        : CAPACITY.bus

export const LOAD_HIGH = 0.3
const MIN_PRESSURE_BOARDINGS = 20

// A stop is flagged when it departs from what other days show at the same time
const ANOMALY_MIN_BASE = 50
const ANOMALY_MIN_DIFF = 60
const ANOMALY_UP = 1.0
const ANOMALY_DOWN = -0.6
const FLOW_ANOMALY_MIN = 50

export const CONFIDENCE = [
  { id: 0, label: 'Observed', hint: 'Metro tap-in and tap-out by the same card' },
  { id: 1, label: 'Strongly inferred', hint: 'Same card boards again within 60 minutes' },
  { id: 2, label: 'Weakly inferred', hint: 'Same card boards again later the same day' },
]

export const { meta, groups: GROUP_NAMES, zones, stops, lines, totals, opportunities } = raw
const flowsBySlot = raw.flows

// ---------------------------------------------------------------- time

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const pad = (n) => String(n).padStart(2, '0')
export const clock = (tod) => `${pad(Math.floor(tod / 60) % 24)}:${pad(tod % 60)}`
export const slotRange = (tod) => `${clock(tod)}–${clock(tod + meta.slotMinutes)}`

export const slots = raw.slots.map((s, i) => {
  const [date, hm] = s.t.split('T')
  const [h, m] = hm.split(':').map(Number)
  return { i, date, w: s.w, tod: h * 60 + m, day: dayFmt.format(new Date(`${date}T12:00:00`)) }
})

const slotsByTod = new Map()
for (const s of slots) {
  if (!slotsByTod.has(s.tod)) slotsByTod.set(s.tod, [])
  slotsByTod.get(s.tod).push(s.i)
}

// A service day runs from 04:00 to 03:59
const serviceOrder = (tod) => (tod - 240 + 1440) % 1440

// Each lens is a list of positions on the time slider. A position averages one
// or more slots: one slot when replaying the week, all same-time slots for the
// typical weekday.
export const LENSES = {
  typical: [...slotsByTod.keys()]
    .sort((a, b) => serviceOrder(a) - serviceOrder(b))
    .map((tod, k, all) => ({
      key: `t${tod}`,
      tod,
      slots: slotsByTod.get(tod),
      title: 'Typical weekday',
      label: slotRange(tod),
      gapBefore: k > 0 && serviceOrder(tod) - serviceOrder(all[k - 1]) !== meta.slotMinutes,
    })),
  replay: slots.map((s, k) => ({
    key: `r${s.i}`,
    tod: s.tod,
    slots: [s.i],
    title: s.day,
    label: slotRange(s.tod),
    gapBefore: k > 0 && slots[k - 1].w !== s.w,
  })),
}

export const mean = (series, idx) => idx.reduce((sum, i) => sum + series[i], 0) / idx.length

// Other days at the same time of day; empty when the slot is the only sample
export function baselineSlots(pos) {
  if (pos.slots.length !== 1) return []
  const i = pos.slots[0]
  return slotsByTod.get(slots[i].tod).filter((j) => j !== i)
}

// ---------------------------------------------------------------- stops

export function stopState(stop, pos) {
  const v = mean(stop.in, pos.slots)
  const dep = stop.dep ? mean(stop.dep, pos.slots) : 0
  const base = baselineSlots(pos)
  const typical = base.length ? mean(stop.in, base) : null
  return {
    v,
    out: stop.out ? mean(stop.out, pos.slots) : null,
    dep,
    load: dep > 0 ? v / dep / capacityOf(stop) : null,
    typical,
    change: typical ? (v - typical) / typical : null,
  }
}

export function isAnomaly(s) {
  if (s.typical === null || s.typical < ANOMALY_MIN_BASE) return false
  if (Math.abs(s.v - s.typical) < ANOMALY_MIN_DIFF) return false
  return s.change >= ANOMALY_UP || s.change <= ANOMALY_DOWN
}

export const isPressure = (s) => s.load !== null && s.load >= LOAD_HIGH && s.v >= MIN_PRESSURE_BOARDINGS

// ---------------------------------------------------------------- flows

// Average zone-to-zone flows over a position's slots, split by evidence level
export function flowsAt(pos, conf = [0, 1, 2]) {
  const acc = new Map()
  for (const i of pos.slots) {
    for (const [a, b, n, c] of flowsBySlot[i]) {
      if (!conf.includes(c)) continue
      const key = `${a}-${b}`
      if (!acc.has(key)) acc.set(key, { key, a, b, n: 0, byConf: [0, 0, 0] })
      const f = acc.get(key)
      f.n += n / pos.slots.length
      f.byConf[c] += n / pos.slots.length
    }
  }
  return [...acc.values()].sort((x, y) => y.n - x.n)
}

export const dominantConfidence = (f) => f.byConf.indexOf(Math.max(...f.byConf))

export function flowSeries(a, b, positions) {
  return positions.map((pos) => flowsAt(pos).find((f) => f.a === a && f.b === b)?.n ?? 0)
}

export const opportunitySeries = (opportunity, positions) =>
  positions.map((pos) => mean(opportunity.series, pos.slots))

// ---------------------------------------------------------------- per-position summaries

export function summarise(pos, groups) {
  const visible = stops.filter((s) => groups.includes(s.group))
  const states = new Map(visible.map((s) => [s.id, stopState(s, pos)]))
  const base = baselineSlots(pos)
  const boardings = groups.reduce((sum, g) => sum + mean(totals[g], pos.slots), 0)
  const typical = base.length ? groups.reduce((sum, g) => sum + mean(totals[g], base), 0) : null

  const ranked = visible.map((s) => ({ stop: s, ...states.get(s.id) }))
  const busiest = ranked.reduce((best, r) => (r.v > (best?.v ?? -1) ? r : best), null)
  const busiestLine = lines
    .filter((l) => groups.includes(l.group))
    .map((l) => ({ ...l, v: mean(l.n, pos.slots) }))
    .sort((x, y) => y.v - x.v)[0]

  const anomalies = ranked
    .filter(isAnomaly)
    .sort((x, y) => Math.abs(y.v - y.typical) - Math.abs(x.v - x.typical))
  const pressure = ranked.filter(isPressure).sort((x, y) => y.load - x.load)

  const flows = flowsAt(pos)
  const flowAnomalies = []
  if (base.length) {
    const normal = new Map(flowsAt({ slots: base }).map((f) => [f.key, f.n]))
    for (const f of flows.slice(0, 60)) {
      const t = normal.get(f.key) ?? 0
      if (t >= FLOW_ANOMALY_MIN && Math.abs(f.n - t) >= FLOW_ANOMALY_MIN && Math.abs(f.n - t) / t >= ANOMALY_UP) {
        flowAnomalies.push({ ...f, typical: t, change: (f.n - t) / t })
      }
    }
  }

  return { states, boardings, typical, busiest, busiestLine, anomalies, pressure, flows, flowAnomalies }
}

// Alert counts for every replay slot, for the ticks on the timeline
export function alertCounts(groups) {
  return LENSES.replay.map((pos) => {
    let n = 0
    for (const s of stops) if (groups.includes(s.group) && isAnomaly(stopState(s, pos))) n++
    return n
  })
}

export const boardingSeries = (positions, groups) =>
  positions.map((pos) => groups.reduce((sum, g) => sum + mean(totals[g], pos.slots), 0))

// ---------------------------------------------------------------- insights

const zoneName = (id) => zones[id].name

export function buildInsights() {
  const typical = LENSES.typical
  const allGroups = ['metro', 'carris', 'cm', 'other']
  const series = boardingSeries(typical, allGroups)
  const peakK = series.indexOf(Math.max(...series))

  // Strongest morning corridor and how it reverses in the evening
  const am = typical.filter((p) => p.tod >= 420 && p.tod < 570)
  const pm = typical.filter((p) => p.tod >= 1050 && p.tod < 1200)
  const sumFlows = (positions) => {
    const acc = new Map()
    for (const pos of positions) for (const f of flowsAt(pos)) acc.set(f.key, (acc.get(f.key) ?? 0) + f.n)
    return acc
  }
  const amFlows = sumFlows(am)
  const pmFlows = sumFlows(pm)
  const [corridorKey, corridorN] = [...amFlows.entries()].sort((x, y) => y[1] - x[1])[0]
  const [ca, cb] = corridorKey.split('-').map(Number)
  const reverseAm = amFlows.get(`${cb}-${ca}`) ?? 0
  const reversePm = pmFlows.get(`${cb}-${ca}`) ?? 0

  // Most pressured stop at the typical peak
  const peakPos = typical[peakK]
  const pressure = stops
    .map((s) => ({ stop: s, ...stopState(s, peakPos) }))
    .filter(isPressure)
    .sort((x, y) => y.load - x.load)

  // Largest spike across the replay
  let spike = null
  for (const [k, pos] of LENSES.replay.entries()) {
    for (const s of stops) {
      const st = stopState(s, pos)
      if (isAnomaly(st) && st.change > 0 && (!spike || st.v - st.typical > spike.v - spike.typical)) {
        spike = { stop: s, k, ...st }
      }
    }
  }

  // Transfer hub: zone with most strongly inferred legs in the typical day
  const hub = new Map()
  for (const pos of typical) {
    for (const f of flowsAt(pos, [1])) {
      hub.set(f.a, (hub.get(f.a) ?? 0) + f.n)
      hub.set(f.b, (hub.get(f.b) ?? 0) + f.n)
    }
  }
  const [hubZone, hubN] = [...hub.entries()].sort((x, y) => y[1] - x[1])[0]

  const insights = [
    {
      kind: 'Peak half-hour',
      title: `${peakPos.label} on a typical weekday`,
      body: `${Math.round(series[peakK]).toLocaleString('en')} boardings across the network in 30 minutes.`,
      go: { lens: 'typical', k: peakK, mode: 'demand' },
    },
    {
      kind: 'Strongest morning corridor',
      title: `${zoneName(ca)} → ${zoneName(cb)}`,
      body: `${Math.round(corridorN).toLocaleString('en')} trips 07:00–09:30. The reverse direction carries ${Math.round(reverseAm).toLocaleString('en')} in the morning and ${Math.round(reversePm).toLocaleString('en')} in the evening peak.`,
      go: { lens: 'typical', k: typical.findIndex((p) => p.tod === 480), mode: 'flow', flow: corridorKey },
    },
  ]
  if (pressure[0]) {
    insights.push({
      kind: 'High demand, thin service',
      title: `${pressure[0].stop.name} at ${peakPos.label}`,
      body: `${Math.round(pressure[0].v)} boardings for ${pressure[0].dep.toFixed(0)} scheduled departures: about ${Math.round(pressure[0].load * 100)}% of a vehicle's capacity boards here alone.`,
      go: { lens: 'typical', k: peakK, mode: 'supply', stop: pressure[0].stop.id },
    })
  }
  if (spike) {
    const pos = LENSES.replay[spike.k]
    insights.push({
      kind: 'Largest demand spike',
      title: `${spike.stop.name}, ${pos.title} ${pos.label}`,
      body: `${Math.round(spike.v)} boardings against ${Math.round(spike.typical)} at the same time on other days (+${Math.round(spike.change * 100)}%).`,
      go: { lens: 'replay', k: spike.k, mode: 'anomaly', stop: spike.stop.id },
    })
  }
  insights.push({
    kind: 'Busiest transfer hub',
    title: zoneName(hubZone),
    body: `${Math.round(hubN).toLocaleString('en')} strongly inferred transfer legs start or end here on a typical weekday.`,
    go: { lens: 'typical', k: peakK, mode: 'flow' },
  })
  return insights
}
