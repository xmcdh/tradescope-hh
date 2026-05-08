import { useState } from 'react';
import { getWatchlistMeta } from '../lib/marketData';

const navItems = [
  { icon: 'dashboard', label: 'Dashboard', active: true, badge: 'LIVE' },
  { icon: 'signal', label: 'ETH Conviction', href: '/eth-conviction', badge: 'LIVE' },
  { icon: 'signal', label: 'Live Signals', disabled: true, badge: 'SOON' },
  { icon: 'chart', label: 'Chart View', disabled: true, badge: 'SOON' },
  { icon: 'watchlist', label: 'Watchlist', disabled: true, badge: 'SOON' },
  { icon: 'history', label: 'History', disabled: true, badge: 'SOON' },
];

const otherItems = [
  { icon: 'settings', label: 'Settings' },
  { icon: 'support', label: 'Help / Docs' },
];

function NavIcon({ name }) {
  const common = {
    className: 'h-4 w-4 shrink-0',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'signal') {
    return (
      <svg {...common}>
        <path d="M4 16.5L9 11l4 4 7-8" />
        <path d="M4 20h16" />
      </svg>
    );
  }

  if (name === 'watchlist') {
    return (
      <svg {...common}>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    );
  }

  if (name === 'chart') {
    return (
      <svg {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 15l3-4 3 2 4-7" />
      </svg>
    );
  }

  if (name === 'history') {
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg {...common}>
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3-.2-.1a1.7 1.7 0 0 0-2 .1 1.7 1.7 0 0 0-.8 1.7V22h-3.6v-.3a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.2.1-2-3 .1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1.1H4v-3.6h.3A1.7 1.7 0 0 0 5.8 9.7a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3 .2.1a1.7 1.7 0 0 0 1.9-.3 1.7 1.7 0 0 0 1.1-1.6V2h3.6v.3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.9-.3l.2-.1 2 3-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1.1h.3v3.6h-.3A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    );
  }

  if (name === 'support') {
    return (
      <svg {...common}>
        <path d="M12 18h.01" />
        <path d="M9.1 9a3 3 0 1 1 5.5 1.7c-.8 1.2-2.6 1.5-2.6 3.3" />
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 5h7v7H4z" />
      <path d="M13 5h7v4h-7z" />
      <path d="M13 11h7v8h-7z" />
      <path d="M4 14h7v5H4z" />
    </svg>
  );
}

function sanitizeInput(value) {
  const clean = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

function SectionLabel({ children, collapsed }) {
  if (collapsed) {
    return null;
  }

  return (
    <div className="hidden px-3 pb-2 pt-1 text-[10px] uppercase leading-none tracking-[1.2px] text-[#555a6b] md:block">
      {children}
    </div>
  );
}

function NavBadge({ type }) {
  if (type === 'LIVE') {
    return (
      <span className="hidden shrink-0 rounded-[10px] bg-[#0d2318] px-[7px] py-[2px] text-[10px] font-bold leading-none text-[#00e676] md:inline-flex">
        LIVE
      </span>
    );
  }

  return (
    <span className="hidden shrink-0 rounded-[10px] bg-[#2a2310] px-[7px] py-[2px] text-[10px] font-bold leading-none text-[#ffd740] md:inline-flex">
      SOON
    </span>
  );
}

function NavItem({ item, collapsed }) {
  const label = collapsed ? null : item.label;
  const activeClass = item.active
    ? 'border-b-[#7c6af7] text-white md:border-l-[#7c6af7] md:bg-[#1e232d]'
    : 'border-b-transparent text-[var(--text-secondary)] hover:text-white md:border-l-transparent hover:bg-[#1e232d]';

  if (item.disabled) {
    return (
      <button
        key={item.label}
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        className="group relative flex h-14 w-full cursor-not-allowed flex-col items-center justify-center gap-1 rounded-md border-b-2 border-b-transparent px-1 text-center text-[10px] text-[#555a6b] opacity-[0.45] md:h-auto md:flex-row md:justify-start md:gap-3 md:border-b-0 md:border-l-2 md:border-l-transparent md:px-3 md:py-2.5 md:text-left md:text-sm"
      >
        <NavIcon name={item.icon} />
        <span className="hidden max-w-full min-w-0 flex-1 truncate md:inline">{label}</span>
        {!collapsed ? <NavBadge type={item.badge} /> : null}
        <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1e232d] px-[10px] py-1 text-[11px] font-medium text-[#8b90a0] opacity-0 shadow-[0_12px_24px_rgba(0,0,0,0.35)] transition md:left-full md:top-1/2 md:ml-3 md:mt-0 md:-translate-x-0 md:-translate-y-1/2 md:group-hover:block md:group-hover:opacity-100">
          This feature is coming soon
        </span>
      </button>
    );
  }

  return (
    <button
      key={item.label}
      type="button"
      onClick={() => {
        if (item.href) {
          window.history.pushState({}, '', item.href);
          window.dispatchEvent(new Event('popstate'));
        }
      }}
      className={`relative flex h-14 w-full flex-col items-center justify-center gap-1 rounded-md border-b-2 bg-transparent px-1 text-center text-[10px] font-semibold transition md:h-auto md:flex-row md:justify-start md:gap-3 md:border-b-0 md:border-l-2 md:px-3 md:py-2.5 md:text-left md:text-sm ${activeClass}`}
    >
      <NavIcon name={item.icon} />
      <span className="hidden max-w-full min-w-0 flex-1 truncate md:inline">{label}</span>
      {!collapsed ? <NavBadge type={item.badge} /> : null}
    </button>
  );
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
      className={`fixed inset-x-0 bottom-0 z-30 flex h-16 w-full max-w-full flex-col border-t border-[rgba(255,255,255,0.1)] bg-[#111318] transition-all duration-200 md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:h-screen md:border-r md:border-t-0 ${
        collapsed ? 'md:w-[76px]' : 'md:w-[220px]'
      }`}
    >
      <div className="hidden border-b border-[rgba(255,255,255,0.07)] px-3 py-3 md:block md:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-purple),var(--accent-cyan))] text-sm font-bold text-white shadow-[0_0_24px_rgba(124,106,247,0.28)]">
              TS
            </div>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">TradeScope</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Trading Terminal</div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="hidden rounded-md border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)] transition hover:border-[var(--accent-purple)] hover:text-[var(--text-primary)] md:block"
          >
            {collapsed ? '>>' : '<<'}
          </button>
        </div>
      </div>

      <div className="flex h-full flex-none overflow-hidden px-2 py-1 md:h-auto md:flex-1 md:flex-col md:overflow-y-auto md:px-3 md:py-4">
        <nav className="grid w-full grid-cols-6 gap-1 md:block md:space-y-1">
          <SectionLabel collapsed={collapsed}>Main Menu</SectionLabel>
          {navItems.map((item) => (
            <NavItem key={item.label} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="my-4 hidden h-px bg-[rgba(255,255,255,0.07)] md:block" />

        <div className="hidden md:block">
          <SectionLabel collapsed={collapsed}>Support</SectionLabel>
          <div className="space-y-1">
            {otherItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-full items-center gap-3 rounded-md border-l-2 border-l-transparent px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] transition hover:bg-[#1e232d] hover:text-white"
              >
                <NavIcon name={item.icon} />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="my-4 hidden h-px bg-[rgba(255,255,255,0.07)] md:block" />

        {!collapsed ? (
          <form onSubmit={handleSubmit} className="hidden space-y-2 md:block">
            <div className="px-3 text-[10px] uppercase leading-none tracking-[1.2px] text-[#555a6b]">Watchlist Pairs</div>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="UB, BTCUSDT"
                className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] transition focus:border-[var(--accent-purple)]"
              />
              <button
                type="submit"
                className="h-9 rounded-md border border-[var(--accent-purple)] bg-[var(--accent-purple)]/10 px-3 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--accent-purple)] hover:text-white"
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
              className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)] transition hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)]"
            >
              Add Momentum List
            </button>
            <button
              type="button"
              onClick={onResetDefault}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)] transition hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)]"
            >
              Reset Default Watchlist
            </button>
            <button
              type="button"
              onClick={onClearCustom}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)] transition hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
            >
              Clear Custom Watchlist
            </button>
          </div>
        ) : null}

        <div className="mt-4 hidden md:block md:space-y-2">
          {symbols.map((symbol) => {
            const active = selectedSymbol === symbol;
            const meta = getWatchlistMeta(symbol);
            const isTierTwo = meta.tier === 2;
            const isAvoid = meta.status === 'avoid';

            return (
              <div
                key={symbol}
                className={`rounded-md border px-3 py-2 transition ${isTierTwo ? 'opacity-75' : ''} ${
                  active
                    ? 'border-[var(--accent-purple)] bg-[var(--bg-card-hover)] shadow-[inset_2px_0_0_var(--accent-purple)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--border)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(symbol)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`truncate font-semibold text-[var(--text-primary)] ${isTierTwo ? 'text-sm' : ''}`}>
                        {symbol.replace(/USDT$/i, '')}
                      </span>
                      {!collapsed && isAvoid ? (
                        <span className="rounded-md border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-red)]">
                          AVOID
                        </span>
                      ) : null}
                    </div>
                    {!collapsed ? (
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        Tier {meta.tier} USDT perpetual
                      </div>
                    ) : null}
                  </button>
                  {!collapsed ? (
                    <button
                      type="button"
                      onClick={() => onRemove(symbol)}
                      className="hidden rounded-md border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--accent-red)] md:block"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto hidden md:block" />
      </div>

      <div className="hidden border-t border-[rgba(255,255,255,0.07)] px-4 py-3 md:block">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1e232d] text-[11px] font-bold text-white">
              TS
            </div>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white">TradeScope</div>
                <div className="truncate text-[10px] text-[#555a6b]">Dashboard user</div>
              </div>
            ) : null}
          </div>
          {!collapsed ? (
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[rgba(255,255,255,0.1)] text-[#8b90a0] transition hover:border-[#7c6af7] hover:text-white"
              aria-label="Profile settings"
            >
              <NavIcon name="settings" />
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
