import { useState } from 'react'
import { GROUP_COLOR, GROUP_LABEL, fmt, fmtCompact } from '../components/theme'
import Panel from './Panel'

const TABS = ['Lines', 'Stops']

export default function TopRanking({ lines, stops, groups }) {
  const [tab, setTab] = useState('Lines')

  const rows = (tab === 'Lines' ? lines : stops)
    .filter((r) => groups.includes(r.group))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((r) =>
      tab === 'Lines'
        ? { key: `${r.group}-${r.line}`, label: r.line, detail: r.group === 'metro' ? 'Metro' : r.name, ...r }
        : { key: r.id, label: r.name, detail: GROUP_LABEL[r.group], ...r },
    )
  const max = rows[0]?.n ?? 1

  return (
    <Panel
      title="Busiest lines and stops"
      subtitle="Boardings in the sample"
      actions={
        <div className="flex rounded-full border border-line p-0.5 text-sm">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 ${tab === t ? 'bg-primary-soft font-medium text-primary-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      <ol className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.key} title={`${r.label}: ${fmt(r.n)} boardings`} className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{r.label}</p>
              <p className="truncate text-xs text-ink-3">{r.detail}</p>
            </div>
            <div className="h-4">
              <div
                className="h-full rounded-r"
                style={{ width: `${(r.n / max) * 100}%`, background: GROUP_COLOR[r.group] }}
              />
            </div>
            <span className="text-right text-sm tabular-nums text-ink-2">{fmtCompact(r.n)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
