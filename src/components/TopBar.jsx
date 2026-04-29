import TickerScroll from './TickerScroll';
import { TIMEFRAME_OPTIONS } from '../lib/marketData';

export default function TopBar({ timeframe, onTimeframeChange, tickerItems, searchQuery, onSearchQueryChange, onOpenPanel }) {
  return (
    <header className="grid h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] px-3">
      <div className="flex items-center gap-2">
        {TIMEFRAME_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onTimeframeChange(option)}
            className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em] transition ${
              timeframe === option
                ? 'bg-[var(--accent-blue)] text-[var(--bg-primary)]'
                : 'border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <TickerScroll items={tickerItems} />

      <div className="flex items-center gap-2">
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search pairs..."
          className="h-9 w-44 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <button
          type="button"
          onClick={onOpenPanel}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] 2xl:hidden"
        >
          ≡
        </button>
        <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)]">
          ⚙
        </button>
      </div>
    </header>
  );
}
