function toneClass(change) {
  if (change > 0) {
    return 'text-[var(--accent-green)]';
  }

  if (change < 0) {
    return 'text-[var(--accent-red)]';
  }

  return 'text-[var(--accent-yellow)]';
}

function formatTickerPrice(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 5;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export default function TickerScroll({ items }) {
  const list = items.length ? [...items, ...items] : [];

  return (
    <div className="ticker-mask group relative h-9 max-w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] md:h-10">
      <div className="ticker-track group-hover:[animation-play-state:paused]">
        {list.length ? (
          list.map((item, index) => (
            <div key={`${item.symbol}-${index}`} className="flex shrink-0 items-center gap-2 px-3 text-[11px]">
              <span className="font-medium text-[var(--text-primary)]">{item.symbol.replace(/USDT$/i, '')}</span>
              <span className="font-mono text-[var(--text-primary)]">${formatTickerPrice(item.price)}</span>
              <span className={`font-mono ${toneClass(item.change24h ?? 0)}`}>
                {Number.isFinite(item.change24h) ? `${item.change24h >= 0 ? '+' : ''}${item.change24h.toFixed(2)}%` : '--'}
              </span>
              <span className="font-mono text-[var(--text-muted)]">|</span>
            </div>
          ))
        ) : (
          <div className="px-4 text-[11px] text-[var(--text-muted)]">Waiting for market snapshots...</div>
        )}
      </div>
    </div>
  );
}
