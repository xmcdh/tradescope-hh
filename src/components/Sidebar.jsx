import { useState } from 'react';
import { getWatchlistMeta } from '../lib/marketData';

const navItems = [
  { icon: '📊', label: 'Dashboard', active: true },
  { icon: '🔴', label: 'Live Signals' },
  { icon: '📋', label: 'Watchlist' },
  { icon: '📈', label: 'Chart View' },
  { icon: '🕐', label: 'History' },
];

const otherItems = [
  { icon: '⚙️', label: 'Settings' },
  { icon: '❓', label: 'Support' },
];

function sanitizeInput(value) {
  const clean = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

export default function Sidebar({
  symbols,
  selectedSymbol,
  collapsed,
  onToggle,
  onAdd,
  onRemove,
  onSelect,
  onAddMomentum,
  onResetDefault,
  onClearCustom,
}) {
  const [draft, setDraft] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!draft.trim()) {
      return;
    }

    onAdd(sanitizeInput(draft));
    setDraft('');
  }

  return (
    <aside
      className={`relative z-20 flex w-full max-w-full flex-col border-b border-[var(--border)] bg-[var(--bg-card)] transition-all duration-200 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r ${
        collapsed ? 'md:w-[84px]' : 'md:w-[220px]'
      }`}
    >
      <div className="border-b border-[var(--border-subtle)] px-3 py-3 md:px-4 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-blue),var(--accent-green))] text-lg md:h-10 md:w-10">
              ⟁
            </div>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text-primary)]">TradeScope</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]">Trading Terminal</div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="hidden rounded-xl border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] md:block"
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
      </div>

      <div className="flex-none overflow-hidden px-3 py-3 md:flex-1 md:overflow-y-auto md:py-4">
        <nav className="hidden space-y-1 md:block">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition ${
                item.active
                  ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{item.icon}</span>
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </button>
          ))}
        </nav>

        <div className="my-4 hidden h-px bg-[var(--border-subtle)] md:block" />

        {!collapsed ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Watchlist</div>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="UB, BTCUSDT"
                className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="submit"
                className="h-10 rounded-xl border border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 px-3 text-xs font-medium text-[var(--text-primary)]"
              >
                Add
              </button>
            </div>
          </form>
        ) : null}

        {!collapsed ? (
          <div className="mt-3 hidden gap-2 md:grid">
            <button
              type="button"
              onClick={onAddMomentum}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)]"
            >
              Add Momentum List
            </button>
            <button
              type="button"
              onClick={onResetDefault}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)]"
            >
              Reset Default Watchlist
            </button>
            <button
              type="button"
              onClick={onClearCustom}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
            >
              Clear Custom Watchlist
            </button>
          </div>
        ) : null}

        <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 md:mt-4 md:block md:space-y-2 md:overflow-visible md:pb-0">
          {symbols.map((symbol) => {
            const active = selectedSymbol === symbol;
            const meta = getWatchlistMeta(symbol);
            const isTierTwo = meta.tier === 2;
            const isAvoid = meta.status === 'avoid';

            return (
              <div
                key={symbol}
                className={`min-w-[112px] shrink-0 rounded-2xl border px-3 py-2 transition md:min-w-0 ${isTierTwo ? 'opacity-75' : ''} ${
                  active
                    ? 'border-[var(--accent-blue)] bg-[var(--bg-card-hover)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(symbol)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`truncate font-medium text-[var(--text-primary)] ${isTierTwo ? 'text-sm' : ''}`}>
                        {symbol.replace(/USDT$/i, '')}
                      </span>
                      {!collapsed && isAvoid ? (
                        <span className="rounded-full border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-red)]">
                          AVOID
                        </span>
                      ) : null}
                    </div>
                    {!collapsed ? (
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        Tier {meta.tier} USDT perpetual
                      </div>
                    ) : null}
                  </button>
                  {!collapsed ? (
                    <button
                      type="button"
                      onClick={() => onRemove(symbol)}
                      className="hidden rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--accent-red)] md:block"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="my-4 hidden h-px bg-[var(--border-subtle)] md:block" />

        {!collapsed ? (
          <div className="mb-2 hidden text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)] md:block">Others</div>
        ) : null}
        <div className="hidden space-y-1 md:block">
          {otherItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            >
              <span>{item.icon}</span>
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden border-t border-[var(--border-subtle)] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)] md:block">
        {collapsed ? 'v1' : 'v1.0.0'}
      </div>
    </aside>
  );
}
