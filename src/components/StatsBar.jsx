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
    <section className="grid gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">{card.label}</div>
          <div className={`mt-2 font-mono text-xl ${typeof card.value === 'number' ? statTone(card.value) : 'text-[var(--text-primary)]'}`}>
            {card.value}
          </div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">{card.detail}</div>
        </div>
      ))}
    </section>
  );
}
