import { useState } from 'react'
import { GROUPS, GROUP_COLOR, GROUP_LABEL, IDLE, fmtCompact } from '../components/theme'
import overview from '../data/overview.json'
import { GROUP_NAMES } from '../lib/model'
import HourlyDemand from './HourlyDemand'
import JourneyLayers from './JourneyLayers'
import StopMap from './StopMap'
import TopRanking from './TopRanking'
import TransferFlows from './TransferFlows'

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 text-2xl text-ink">{value}</p>
    </div>
  )
}

// Whole-sample reference dashboard (the first version of the prototype)
export default function OverviewPage() {
  const [groups, setGroups] = useState(GROUPS)
  const { meta } = overview

  const toggle = (g) =>
    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : GROUPS.filter((x) => cur.includes(x) || x === g)))

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header>
          <div className="flex flex-wrap gap-4 text-sm">
            <a href="#/" className="text-primary-ink hover:underline">← Back to the explorer</a>
            <a href="#/assistant" className="text-primary-ink hover:underline">Ask AI planner →</a>
          </div>
          <p className="mt-3 text-sm font-medium text-primary-ink">Hack the City · Challenge #1 · Reference overview</p>
          <h1 className="mt-1 text-3xl text-ink">Passenger demand in the Lisbon Metropolitan Area</h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-3">
            Navegante pass validations, 31 Aug to 4 Sep 2026, summed over the whole sample (about 48 weekday hours).
            Mid-afternoon and the weekend are missing.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Boardings" value={fmtCompact(meta.entries)} />
          <Stat label="Unique cards" value={fmtCompact(meta.cards)} />
          <Stat label={`Transfers within ${meta.transferWindowMin} min`} value={fmtCompact(meta.transfers)} />
          <Stat label="Busiest stop" value={overview.stops[0].name} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-ink-3">Operators</span>
          {GROUPS.map((g) => {
            const on = groups.includes(g)
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggle(g)}
                aria-pressed={on}
                title={GROUP_NAMES[g]}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                  on ? 'border-transparent bg-primary-soft text-primary-ink' : 'border-line bg-surface text-ink-3 hover:bg-subtle'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? GROUP_COLOR[g] : IDLE }} />
                {GROUP_LABEL[g]}
              </button>
            )
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <StopMap stops={overview.stops} groups={groups} />
          <HourlyDemand hourly={overview.hourly} groups={groups} />
          <TopRanking lines={overview.lines} stops={overview.stops} groups={groups} />
          <JourneyLayers paths={overview.journeyLayers} />
          <TransferFlows flows={overview.flows} metroOD={overview.metroOD} windowMin={meta.transferWindowMin} />
        </div>
      </div>
    </main>
  )
}
