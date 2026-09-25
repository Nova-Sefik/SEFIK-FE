import HourVsTypical from '../journeys/HourVsTypical'
import JourneyFilters from '../journeys/JourneyFilters'
import { coverageSuggestions, formatHours } from '../journeys/coverage'
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
  const { meta, journey, setJourney, journeyTraffic, selectedPath, setSelectedPath, day, setDay, hour, setHour } = useLiveData()
  const dayLabel = (date) => meta.data?.days?.find((item) => item.date === date)?.label ?? date
  const jumpTo = (period) => { setDay(period.date); setHour(period.hour); if (journey.wholeDay) setJourney({ wholeDay: false }) }
  const data = journeyTraffic.data

  return (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-ink">Journey paths · {journey.wholeDay ? 'whole day' : hourLabel(hour)}</p>
        <h2 className="mt-1 text-lg font-medium text-ink">Traffic along a path</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">Every privacy-safe path in the selected period is shown by default. Add places to follow a directed path, or set a minimum volume.</p>
      </header>

      <JourneyFilters />

      {journeyTraffic.error && <p className="rounded-xl border border-danger/25 bg-danger-soft p-3 text-sm text-danger">{journeyTraffic.error.message}</p>}
      {!data && !journeyTraffic.error && <p className="rounded-xl bg-subtle px-3 py-6 text-center text-sm text-ink-3">Loading journey paths…</p>}

      {data && (
        <>
          <p className="text-[11px] text-ink-3">{data.applied_filters.human_summary}</p>
          {!data.coverage.complete && (
            <div className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-4 text-warn">
              <p>Journey paths are built from part of this week’s raw files, and this period isn’t fully covered, so counts are incomplete or empty. {data.coverage.complete_hours.length ? `${dayLabel(day)} is covered ${formatHours(data.coverage.complete_hours)}.` : `${dayLabel(day)} has no fully covered hours.`}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {coverageSuggestions(data.coverage, day, journey.wholeDay ? null : hour).map((item) => (
                  <button key={`${item.date}-${item.hour}`} type="button" onClick={() => jumpTo(item)} className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-medium text-primary-ink hover:bg-primary-soft">
                    {dayLabel(item.date)} {hourLabel(item.hour)}
                  </button>
                ))}
              </div>
            </div>
          )}
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
              <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[11px] text-warn">
                The backend returned {integer.format(data.paths.length)} of {integer.format(data.totals.shown_paths)} paths. Narrow the period or add a location filter to inspect the remainder.
              </p>
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
