import { useEffect, useRef } from 'react'
import { CAPACITY, meta } from '../lib/model'
import { fmtCompact } from './theme'

export default function FramingModal({ open, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[88vh] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border-0 bg-surface p-0 text-ink shadow-float backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary-ink">Challenge #1 · Passenger demand and mobility patterns</p>
            <h2 className="mt-1 text-2xl text-ink">Where does demand fail to match supply, and when does it break pattern?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink">
            ✕
          </button>
        </header>

        <section>
          <h3 className="text-sm font-semibold text-ink">The problem</h3>
          <p className="mt-1 text-sm text-ink-2">
            Across the Lisbon Metropolitan Area, pass holders tap in {fmtCompact(meta.entries)} times in the sampled hours alone. Planners
            see those taps as totals per operator, not as a picture of where people are, where they are going, and whether the
            timetable matches them. That makes it hard to tell a recurring overload that needs a timetable or fleet change from a
            one-off surge that needs a same-day response.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-ink">Recurring intelligence</p>
            <p className="mt-1 text-sm font-medium text-ink">Where does demand repeatedly outgrow supply?</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-3">
              <li>Peak-hour overload at the same stops every weekday</li>
              <li>Stops with high boardings but few scheduled departures</li>
              <li>Corridors that carry the same heavy flow every morning</li>
              <li>Direction imbalance: A→B in the morning, B→A in the evening</li>
              <li>Recurring transfer pressure at the same hubs</li>
            </ul>
            <p className="mt-2 text-xs text-ink-2">Use: timetable changes, fleet allocation, long-term planning.</p>
          </div>
          <div className="rounded-xl border border-line bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-danger">Dynamic intelligence</p>
            <p className="mt-1 text-sm font-medium text-ink">When does behaviour depart from normal?</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-3">
              <li>Sudden surges or drops at a stop</li>
              <li>A corridor carrying far more or less than usual</li>
              <li>Demand jumps while scheduled supply stays the same</li>
              <li>Unusual activity outside the normal peaks</li>
            </ul>
            <p className="mt-2 text-xs text-ink-2">Use: staffing, extra vehicles, same-day service adjustments.</p>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink">The product story</h3>
          <p className="mt-1 text-sm text-ink-2">
            <strong>Demand</strong>: where are people? → <strong>Flow</strong>: where are they moving? → <strong>Supply</strong>: is
            the service matching them? → <strong>Anomalies</strong>: where is something unusual happening? →{' '}
            <strong>Route opportunities</strong>: where could a direct link remove a transfer?
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink">Who it is for</h3>
          <p className="mt-1 text-sm text-ink-2">
            TML network planners and the operators' service-control teams (Metro, Carris, Carris Metropolitana, Transtejo, Fertagus,
            MobiCascais) who decide timetables, fleet allocation and staffing.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink">How we measure it</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink-2">
            <li><strong>Demand</strong>: tap-in validations per stop per 30 minutes.</li>
            <li>
              <strong>Supply</strong>: scheduled departures per stop from each operator's GTFS timetable. The{' '}
              <strong>load proxy</strong> is boardings per departure divided by a nominal capacity (Metro {CAPACITY.metro}, bus{' '}
              {CAPACITY.bus}, ferry {CAPACITY.ferry}). At 30% or more, almost a third of every vehicle fills from that stop alone.
            </li>
            <li>
              <strong>Normal</strong>: the same time of day on the other sampled weekdays. An alert fires when a stop is at least double, or under 40% of, its usual level, with at least 60 taps of difference.
            </li>
            <li>
              <strong>Flows</strong>: anonymous card sequences between 45 zones. <em>Observed</em> = Metro tap-in and tap-out.{' '}
              <em>Strongly inferred</em> = the next boarding within 60 minutes. <em>Weakly inferred</em> = the next boarding later
              the same day.
            </li>
            <li>
              <strong>Route opportunities</strong>: recurring observed or strongly inferred flows seen on at least three sampled
              days, after removing zone pairs already joined by a one-seat trip in the applicable GTFS. Weak inferences never
              influence this recommendation layer.
            </li>
          </ul>
        </section>

        <section className="rounded-xl bg-warn-soft p-4">
          <h3 className="text-sm font-semibold text-warn">Limits of this prototype</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-2">
            <li>
              The sample is {meta.files.length} files covering about 48 weekday hours between 31 Aug and 4 Sep 2026. 14:00–16:30 and the
              weekend are missing, so patterns are "recurring within the sample", not "every Monday all year".
            </li>
            <li>Pass (subscription) validations only. Occasional tickets aren't included.</li>
            <li>The live version would stream validations and raise alerts in real time. Here the week is replayed.</li>
          </ul>
        </section>
      </div>
    </dialog>
  )
}
