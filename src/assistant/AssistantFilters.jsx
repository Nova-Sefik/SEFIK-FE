import JourneyFilters from '../journeys/JourneyFilters'
import { useLiveData } from '../live/LiveDataContext'
import { hourLabel } from '../live/utils'

function Section({ title, hint, children }) {
  return (
    <section className="border-t border-line py-4 first:border-0 first:pt-0">
      <div className="mb-2">
        <h3 className="text-xs font-medium text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-[10px] leading-4 text-ink-4">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs transition ${active ? 'border-transparent bg-primary-soft font-medium text-primary-ink' : 'border-line bg-surface text-ink-2 hover:bg-subtle'}`}
    >
      {children}
    </button>
  )
}

// Live filters shared with the explorer. Closing the drawer re-runs the graph with them.
export default function AssistantFilters({ onClose }) {
  const { meta, day, setDay, hour, setHour, ops, toggleOperator, segment, setSegment } = useLiveData()
  return (
    <aside className="fixed inset-y-0 right-0 z-[70] flex w-[min(27rem,100vw)] flex-col border-l border-line bg-surface shadow-float">
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary-ink">Live filters</p>
            <h2 className="mt-1 text-lg text-ink">What the graph shows</h2>
            <p className="mt-1 text-xs leading-5 text-ink-3">Shared with the explorer. Every number comes from the live backend when you close this panel.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close filters" className="rounded-lg p-2 text-ink-3 hover:bg-subtle hover:text-ink">✕</button>
        </div>

        <Section title="Day">
          <div className="flex flex-wrap gap-1.5">
            {(meta.data?.days ?? []).map((item) => <Choice key={item.date} active={day === item.date} onClick={() => setDay(item.date)}>{item.label}</Choice>)}
          </div>
        </Section>

        <Section title="Hour" hint="Service hour; 00:00 is the hour after midnight">
          <select
            value={hour}
            onChange={(event) => setHour(Number(event.target.value))}
            className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-xs text-ink outline-none focus:border-primary/40"
          >
            {(meta.data?.hours ?? []).map((item) => <option key={item.hour} value={item.hour}>{hourLabel(item.hour)}</option>)}
          </select>
        </Section>

        <Section title="Operators" hint="Used by stop demand and comparisons; at least one stays selected">
          <div className="flex flex-wrap gap-1.5">
            {(meta.data?.operators ?? []).map((item) => <Choice key={item.id} active={ops.includes(item.id)} onClick={() => toggleOperator(item.id)}>{item.name}</Choice>)}
          </div>
        </Section>

        <Section title="Passengers">
          <div className="flex flex-wrap gap-1.5">
            {(meta.data?.segments ?? []).map((item) => <Choice key={item.id} active={segment === item.id} onClick={() => setSegment(item.id)}>{item.label}</Choice>)}
          </div>
        </Section>

        <Section title="Journey path" hint="Used by Flow map, Journey paths and AI path answers. Direction matters.">
          <JourneyFilters />
        </Section>
      </div>
      <div className="flex items-center justify-end border-t border-line px-5 py-4">
        <button type="button" onClick={onClose} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover">Show graph</button>
      </div>
    </aside>
  )
}
