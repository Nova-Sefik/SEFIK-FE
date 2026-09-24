// Data colours for the light (Google-style) theme. Validated on #ffffff:
// operators all-pairs, anomaly pair and flow/opportunity pair all pass CVD
// and normal-vision separation. Carris Metropolitana's teal is under 3:1, so
// it always appears with a legend, label or tooltip.
export const GROUPS = ['metro', 'carris', 'cm', 'other']

export const GROUP_COLOR = {
  metro: '#2a78d6',
  carris: '#eb6834',
  cm: '#1baf7a',
  other: '#9aa0a6',
}

export const GROUP_LABEL = {
  metro: 'Metro',
  carris: 'Carris',
  cm: 'Carris Metropolitana',
  other: 'Other',
}

// Chart chrome (mirrors the Tailwind tokens in index.css)
export const INK = '#202124'
export const SURFACE = '#ffffff'
export const GRID = '#e8eaed'
export const MUTED = '#5f6368'
export const IDLE = '#bdc1c6'

// Flow mode: one hue, evidence level carried by opacity
export const FLOW_COLOR = '#4a3aa7'
export const FLOW_OPACITY = [0.85, 0.5, 0.22]
export const FLOW_TINTS = ['#4a3aa7', '#8b80d9', '#c5c0ec']
export const OPPORTUNITY_COLOR = '#c98500'
export const OPPORTUNITY_LIGHT = '#f2c14e'
export const SUPPLY_COLOR = '#f9ab00'

// Anomaly mode: diverging around "as usual"
export const ABOVE = '#e34948'
export const BELOW = '#2a78d6'

// Load proxy: stepped yellow → orange → red. Red is reserved for 55%+, and the
// steps are spread over the range where most stops actually sit, so mid values
// stay distinguishable. Lightness falls evenly, so the order still reads without hue.
export const LOAD_STEPS = [
  { from: 0, color: '#dcb013' },
  { from: 0.1, color: '#da8f08' },
  { from: 0.2, color: '#cf7210' },
  { from: 0.3, color: '#c0570c' },
  { from: 0.42, color: '#ae3d00' },
  { from: 0.55, color: '#a20519' },
]
export function loadColor(load) {
  if (load === null) return IDLE
  let color = LOAD_STEPS[0].color
  for (const step of LOAD_STEPS) if (load >= step.from) color = step.color
  return color
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

export const fmtCompact = (n) => compact.format(n)
export const fmt = (n) => full.format(n)
export const fmtPct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`
