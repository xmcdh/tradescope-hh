import TickerScroll from './TickerScroll';
import { SIGNAL_MODE_CONFIG } from '../lib/signalLogic';

export default function TopBar({
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
    <header className="grid max-w-full grid-cols-1 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.22)] md:h-12 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-3 md:px-3 md:py-0">
      <div className="relative">
        <select
          value={signalMode}
          onChange={(event) => onSignalModeChange?.(event.target.value)}
          className="h-9 min-w-[164px] appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 pr-8 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] outline-none transition hover:border-[var(--accent-purple)]"
          title="Signal aggressiveness mode"
        >
          {Object.entries(SIGNAL_MODE_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--accent-cyan)]">v</span>
      </div>

      <div className="min-w-0">
        <TickerScroll items={tickerItems} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 md:flex md:justify-end">
        {import.meta.env.DEV ? (
          <button
            type="button"
            onClick={() => onDebugModeChange?.(!debugMode)}
            className={`hidden h-9 rounded-md border px-3 text-[11px] uppercase tracking-[0.14em] transition md:block ${
              debugMode
                ? 'border-[var(--accent-yellow)] bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]'
                : 'border-[var(--border)] text-[var(--text-secondary)]'
            }`}
          >
            Debug
          </button>
        ) : null}
        <label className="relative min-w-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">⌕</span>
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search pairs..."
            className="h-10 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] transition focus:border-[var(--accent-purple)] md:h-9 md:w-44"
          />
        </label>
        <button
          type="button"
          onClick={onOpenPanel}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] transition hover:border-[var(--accent-purple)] hover:text-[var(--text-primary)] md:h-9 md:w-9 2xl:hidden"
        >
          ≡
        </button>
        <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] transition hover:border-[var(--accent-purple)] hover:text-[var(--text-primary)] md:inline-flex">
          ⚙
        </button>
        <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] transition hover:border-[var(--accent-purple)] hover:text-[var(--text-primary)] md:inline-flex">
          ◔
        </button>
        <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-purple),var(--accent-cyan))] text-[11px] font-bold text-white md:flex">
          TS
        </div>
      </div>
    </header>
  );
}
