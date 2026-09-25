import HourVsTypical from '../journeys/HourVsTypical'
import JourneyFilters from '../journeys/JourneyFilters'
import PathList from '../journeys/PathList'
import { useLiveData } from './LiveDataContext'
import { compact, hourLabel, integer } from './utils'

function Kpi({ value, label }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-[10px] leading-4 text-ink-3">{label}</p>
    </div>
  )
}

export default function JourneyPanel() {
  const { journey, journeyTraffic, showMorePaths, selectedPath, setSelectedPath, hour } = useLiveData()
  const data = journeyTraffic.data

  return (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Journey paths · {journey.wholeDay ? 'whole day' : hourLabel(hour)}</p>
        <h2 className="mt-1 text-lg font-medium text-ink">Traffic along a path</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">Every journey counts by default. Add places to follow a directed path, or set a minimum volume.</p>
      </header>

      <JourneyFilters />

      {journeyTraffic.error && <p className="rounded-xl border border-danger/25 bg-danger-soft p-3 text-sm text-danger">{journeyTraffic.error.message}</p>}
      {!data && !journeyTraffic.error && <p className="rounded-xl bg-subtle px-3 py-6 text-center text-sm text-ink-3">Loading journey paths…</p>}

      {data && (
        <>
          <p className="text-[11px] text-ink-3">{data.applied_filters.human_summary}</p>
          {!data.coverage.complete && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-4 text-warn">This period is not fully covered by the source validation files, so counts are incomplete. Fully covered hours today: {data.coverage.complete_hours.length ? data.coverage.complete_hours.map(hourLabel).join(', ') : 'none'}.</p>}
          <section className="grid grid-cols-2 gap-2">
            <Kpi value={integer.format(data.totals.shown_volume)} label={`journeys on ${integer.format(data.totals.shown_paths)} listed paths`} />
            <Kpi value={data.totals.matched_volume == null ? `< ${data.privacy_min}` : integer.format(data.totals.matched_volume)} label="journeys match the filters" />
            <Kpi value={compact.format(data.totals.below_min_volume)} label={journey.minVolume ? `in paths under your minimum of ${integer.format(journey.minVolume)}` : 'no minimum volume set'} />
            <Kpi value={compact.format(data.totals.below_privacy_threshold)} label={`in paths under ${data.privacy_min} (privacy: counted, never listed)`} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{journey.wholeDay ? 'Covered hours vs typical' : 'This hour vs typical'}</h3>
            <HourVsTypical comparison={data.comparison} hour={hour} compact />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Paths · busiest first</h3>
            <PathList paths={data.paths} selectedKey={selectedPath} onSelect={setSelectedPath} />
            {data.totals.shown_paths > data.paths.length && (
              <button type="button" onClick={showMorePaths} disabled={journeyTraffic.fetching} className="mt-2 w-full rounded-full border border-line py-1.5 text-xs text-ink-2 hover:bg-subtle disabled:opacity-50">
                Show more · {integer.format(data.paths.length)} of {integer.format(data.totals.shown_paths)}
              </button>
            )}
          </section>

          <ul className="list-disc space-y-1 pl-4 text-[10px] leading-4 text-ink-4">
            {data.limitations.map((item) => <li key={item}>{item}</li>)}
            <li>{data.method}</li>
            <li>{data.coverage.source}</li>
          </ul>
        </>
      )}
    </div>
  )
}
