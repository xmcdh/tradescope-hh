function statTone(value) {
  return value > 0 ? 'text-[var(--accent-green)]' : 'text-[var(--text-primary)]';
}

export default function StatsBar({ stats }) {
  const cards = [
    { label: 'Active Signals', value: stats.activeSignals, detail: `${stats.longCount} long / ${stats.shortCount} short`, change: stats.activeSignals },
    { label: 'Win Rate (session)', value: `${stats.sessionRate}%`, detail: 'Signal quality coverage', change: stats.sessionRate - 50 },
    { label: 'Pairs Monitored', value: stats.pairsMonitored, detail: 'Live watchlist symbols', change: stats.pairsMonitored },
    { label: 'Last Updated', value: stats.lastUpdated, detail: 'Auto refresh', change: 0 },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 md:gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.16)] md:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{card.label}</div>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[10px] text-[var(--text-muted)]">i</span>
          </div>
          <div className={`mt-2 truncate font-mono text-xl font-semibold md:text-2xl ${typeof card.value === 'number' ? statTone(card.value) : 'text-[var(--text-primary)]'}`}>
            {card.value}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="truncate text-[11px] text-[var(--text-secondary)] md:text-xs">{card.detail}</div>
            <span
              className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] ${
                card.change > 0
                  ? 'border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                  : card.change < 0
                    ? 'border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
                    : 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
              }`}
            >
              {card.change > 0 ? '+' : card.change < 0 ? '-' : ''}{Math.abs(card.change)}%
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
