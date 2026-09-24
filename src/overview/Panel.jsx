export default function Panel({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`flex flex-col rounded-2xl border border-line bg-surface p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}
