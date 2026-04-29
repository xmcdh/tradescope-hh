import TickerScroll from './TickerScroll';
import { TIMEFRAME_OPTIONS } from '../lib/marketData';
import { SIGNAL_MODE_CONFIG } from '../lib/signalLogic';

export default function TopBar({
  timeframe,
  onTimeframeChange,
  tickerItems,
  searchQuery,
  onSearchQueryChange,
  onOpenPanel,
  signalMode,
  onSignalModeChange,
  debugMode,
  onDebugModeChange,
}) {
  return (
    <header className="grid max-w-full grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-2 md:h-12 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-3 md:px-3 md:py-0">
      <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 md:pb-0">
        {TIMEFRAME_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onTimeframeChange(option)}
            className={`h-9 shrink-0 rounded-full px-3 text-[11px] uppercase tracking-[0.18em] transition md:h-auto md:py-1 md:tracking-[0.22em] ${
              timeframe === option
                ? 'bg-[var(--accent-blue)] text-[var(--bg-primary)]'
                : 'border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="min-w-0">
        <TickerScroll items={tickerItems} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 md:flex md:justify-end">
        <select
          value={signalMode}
          onChange={(event) => onSignalModeChange?.(event.target.value)}
          className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-primary)] outline-none md:h-9 md:tracking-[0.12em]"
          title="Signal aggressiveness mode"
        >
          {Object.entries(SIGNAL_MODE_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>
        {import.meta.env.DEV ? (
          <button
            type="button"
            onClick={() => onDebugModeChange?.(!debugMode)}
            className={`hidden h-9 rounded-xl border px-3 text-[11px] uppercase tracking-[0.18em] transition md:block ${
              debugMode
                ? 'border-[var(--accent-yellow)] bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]'
                : 'border-[var(--border)] text-[var(--text-secondary)]'
            }`}
          >
            Debug
          </button>
        ) : null}
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search pairs..."
          className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] md:h-9 md:w-44"
        />
        <button
          type="button"
          onClick={onOpenPanel}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] md:h-9 md:w-9 2xl:hidden"
        >
          ≡
        </button>
        <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] md:inline-flex">
          ⚙
        </button>
      </div>
    </header>
  );
}
