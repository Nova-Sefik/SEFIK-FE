import { useMemo, useState } from 'react'
import {
  DAY_OPTIONS,
  EMPTY_FILTERS,
  EVIDENCE_OPTIONS,
  LINE_OPTIONS,
  LOCATION_OPTIONS,
  MODE_OPTIONS,
  TIME_OPTIONS,
  activeFilterCount,
  toggleFilter,
} from './filters'

function Choice({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-left text-xs transition ${
        active
          ? 'border-transparent bg-primary-soft font-medium text-primary-ink'
          : 'border-line bg-surface text-ink-2 hover:bg-subtle'
      }`}
    >
      {children}
    </button>
  )
}

function SearchChoices({ options, selected, onToggle, placeholder }) {
  const [search, setSearch] = useState('')
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(query))
  }, [options, search])

  return (
    <div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder}
        className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-4 focus:border-primary"
      />
      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
        {visible.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition ${
              selected.includes(option.id) ? 'bg-primary-soft text-primary-ink' : 'text-ink-2 hover:bg-subtle'
            }`}
          >
            <span>
              <span className="block">{option.label}</span>
              {option.detail && <span className="mt-0.5 block text-[10px] text-ink-4">{option.detail}</span>}
            </span>
            <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border ${selected.includes(option.id) ? 'border-primary bg-primary' : 'border-ink-4'}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

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

export default function FilterPanel({ filters, onChange, onClose }) {
  const toggle = (key, value) => onChange(toggleFilter(filters, key, value))
  const count = activeFilterCount(filters)

  return (
    <aside className="fixed inset-y-0 right-0 z-[70] w-[min(27rem,100vw)] overflow-y-auto border-l border-line bg-surface p-5 shadow-float ">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary-ink">Graph filters</p>
          <h2 className="mt-1 text-lg text-ink">Build a precise slice</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">Choices inside a section use OR. Different sections combine with AND.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close filters" className="rounded-lg p-2 text-ink-3 hover:bg-subtle hover:text-ink">✕</button>
      </div>

      <Section title="Locations" hint="One or more demand zones">
        <SearchChoices
          options={LOCATION_OPTIONS}
          selected={filters.locations}
          onToggle={(value) => toggle('locations', value)}
          placeholder="Search locations…"
        />
      </Section>

      <Section title="Modes" hint="Any selected operator group">
        <div className="flex flex-wrap gap-1.5">
          {MODE_OPTIONS.map((option) => (
            <Choice key={option.id} active={filters.modes.includes(option.id)} onClick={() => toggle('modes', option.id)}>
              {option.label}
            </Choice>
          ))}
        </div>
      </Section>

      <Section title="Lines" hint="Stops served by any selected line">
        <SearchChoices
          options={LINE_OPTIONS}
          selected={filters.lines}
          onToggle={(value) => toggle('lines', value)}
          placeholder="Search lines…"
        />
      </Section>

      <Section title="Sample dates">
        <div className="flex flex-wrap gap-1.5">
          {DAY_OPTIONS.map((option) => (
            <Choice key={option.id} active={filters.days.includes(option.id)} onClick={() => toggle('days', option.id)}>
              {option.label}
            </Choice>
          ))}
        </div>
      </Section>

      <Section title="Time window" hint="Supports windows that cross midnight">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] uppercase tracking-wide text-ink-4">
            From
            <select
              value={filters.fromTime ?? ''}
              onChange={(event) => onChange({ ...filters, fromTime: event.target.value === '' ? null : Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-primary/40"
            >
              <option value="">Any time</option>
              {TIME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-ink-4">
            To
            <select
              value={filters.toTime ?? ''}
              onChange={(event) => onChange({ ...filters, toTime: event.target.value === '' ? null : Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-xs normal-case tracking-normal text-ink outline-none focus:border-primary/40"
            >
              <option value="">Any time</option>
              {TIME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Journey evidence" hint="Applies to flow and journey-layer diagrams">
        <div className="flex flex-wrap gap-1.5">
          {EVIDENCE_OPTIONS.map((option) => (
            <Choice key={option.id} active={filters.evidence.includes(option.id)} onClick={() => toggle('evidence', option.id)}>
              {option.label}
            </Choice>
          ))}
        </div>
      </Section>

      <div className="sticky -bottom-5 -mx-5 -mb-5 flex items-center justify-between border-t border-line bg-surface px-5 py-4 ">
        <span className="text-xs text-ink-3">{count || 'No'} active filter{count === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className="rounded-lg px-3 py-2 text-xs text-ink-3 hover:bg-subtle hover:text-ink">Clear all</button>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover">Show graph</button>
        </div>
      </div>
    </aside>
  )
}
