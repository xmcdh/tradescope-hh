import { useState } from 'react';

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

export default function Sidebar({ symbols, selectedSymbol, collapsed, onToggle, onAdd, onRemove, onSelect }) {
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
      className={`sticky top-0 flex h-screen flex-col border-r border-[var(--border)] bg-[var(--bg-card)] transition-all duration-200 ${
        collapsed ? 'w-[84px]' : 'w-[220px]'
      }`}
    >
      <div className="border-b border-[var(--border-subtle)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-blue),var(--accent-green))] text-lg">
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
            className="rounded-xl border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]"
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav className="space-y-1">
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

        <div className="my-4 h-px bg-[var(--border-subtle)]" />

        {!collapsed ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Watchlist</div>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="UB, BTCUSDT"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="submit"
                className="rounded-xl border border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 px-3 text-xs font-medium text-[var(--text-primary)]"
              >
                Add
              </button>
            </div>
          </form>
        ) : null}

        <div className="mt-4 space-y-2">
          {symbols.map((symbol) => {
            const active = selectedSymbol === symbol;
            return (
              <div
                key={symbol}
                className={`rounded-2xl border px-3 py-2 transition ${
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
                    <div className="truncate font-medium text-[var(--text-primary)]">{symbol.replace(/USDT$/i, '')}</div>
                    {!collapsed ? (
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">USDT perpetual</div>
                    ) : null}
                  </button>
                  {!collapsed ? (
                    <button
                      type="button"
                      onClick={() => onRemove(symbol)}
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--accent-red)]"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="my-4 h-px bg-[var(--border-subtle)]" />

        {!collapsed ? (
          <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Others</div>
        ) : null}
        <div className="space-y-1">
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

      <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
        {collapsed ? 'v1' : 'v1.0.0'}
      </div>
    </aside>
  );
}
