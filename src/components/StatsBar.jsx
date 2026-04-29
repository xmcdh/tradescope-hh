function statTone(value) {
  return value > 0 ? 'text-[var(--accent-green)]' : 'text-[var(--text-primary)]';
}

export default function StatsBar({ stats }) {
  const cards = [
    { label: 'Active Signals', value: stats.activeSignals, detail: `${stats.longCount} long / ${stats.shortCount} short` },
    { label: 'Win Rate (session)', value: `${stats.sessionRate}%`, detail: 'Signal quality coverage' },
    { label: 'Pairs Monitored', value: stats.pairsMonitored, detail: 'Live watchlist symbols' },
    { label: 'Last Updated', value: stats.lastUpdated, detail: 'Auto refresh' },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 md:gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-3 md:px-4">
          <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] md:text-[11px] md:tracking-[0.22em]">{card.label}</div>
          <div className={`mt-2 truncate font-mono text-lg md:text-xl ${typeof card.value === 'number' ? statTone(card.value) : 'text-[var(--text-primary)]'}`}>
            {card.value}
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)] md:text-xs">{card.detail}</div>
        </div>
      ))}
    </section>
  );
}
