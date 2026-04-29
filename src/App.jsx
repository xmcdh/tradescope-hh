import { useEffect, useMemo, useState } from 'react';
import MainChart from './components/MainChart';
import MarketDataHealth from './components/MarketDataHealth';
import RightPanel from './components/RightPanel';
import Sidebar from './components/Sidebar';
import SignalCard from './components/SignalCard';
import StatsBar from './components/StatsBar';
import TopBar from './components/TopBar';
import { useWatchlistMarketData } from './hooks/useWatchlistMarketData';
import { useMarketDataHealth } from './hooks/useMarketDataHealth';
import {
  DEFAULT_SYMBOLS,
  WATCHLIST_STORAGE_KEY,
  WATCHLIST_STORAGE_VERSION,
  WATCHLIST_VERSION_KEY,
  MOMENTUM_SYMBOLS,
  normalizeSymbol,
} from './lib/marketData';
import { normalizeSignalMode } from './lib/signalLogic';

const LEGACY_WATCHLIST_KEY = 'tradescope:watchlist';
const HISTORY_KEY = 'tradescope:history';
const SIGNAL_MODE_KEY = 'tradescope_signal_mode';
const DEBUG_MODE_KEY = 'tradescope_debug_mode';

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function timeStamp() {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function displayClock() {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function formatDashboardPrice(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 5;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function PromoBanners({ selectedSymbol, snapshot, stats }) {
  const base = selectedSymbol?.replace(/USDT$/i, '') || 'BTC';
  const change = snapshot?.indicators?.change24h;
  const tone = change >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
  const cards = [
    {
      title: `${base} Market Pulse`,
      subtitle: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% over 24h` : 'Waiting for live feed',
      accent: 'from-[rgba(124,106,247,0.24)]',
      tone,
    },
    {
      title: 'Scanner Coverage',
      subtitle: `${stats.pairsMonitored} pairs monitored in real time`,
      accent: 'from-[rgba(79,195,247,0.22)]',
      tone: 'text-[var(--accent-cyan)]',
    },
    {
      title: 'Signal Balance',
      subtitle: `${stats.longCount} long / ${stats.shortCount} short setups`,
      accent: 'from-[rgba(0,230,118,0.16)]',
      tone: 'text-[var(--accent-green)]',
    },
  ];

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`group relative min-h-20 overflow-hidden rounded-lg border border-[var(--border)] bg-[linear-gradient(135deg,var(--bg-card-hover),var(--bg-card))] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.2)]`}
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} to-transparent opacity-70`} />
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{card.title}</div>
              <div className={`mt-1 truncate text-xs ${card.tone}`}>{card.subtitle}</div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] transition group-hover:border-[var(--accent-purple)]">
              -&gt;
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function confidenceTone(score) {
  if (score >= 8) {
    return ['High', 'border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]'];
  }

  if (score >= 5) {
    return ['Medium', 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]'];
  }

  return ['Low', 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'];
}

function PairsTable({ symbols, snapshots, selectedSymbol, onSelect }) {
  const tabs = ['All', 'Scanners', 'Top Traders', 'Holders', 'All pairs'];

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Exchange Pairs</div>
          <div className="mt-1 truncate text-xl font-bold text-[var(--text-primary)]">
            {selectedSymbol?.replace(/USDT$/i, '') || 'Pair'} / USDT
          </div>
        </div>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1 md:pb-0">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={`h-8 shrink-0 rounded-md border px-3 text-[11px] font-semibold ${
                index === 0
                  ? 'border-[var(--accent-purple)] bg-[var(--accent-purple)] text-white'
                  : 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[820px] w-full text-left text-xs">
          <thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <tr>
              {['#', 'Exchange', 'Pair', 'Price', '+2% Depth', 'Confidence', 'Volume %', 'Liquidity'].map((column) => (
                <th key={column} className="px-4 py-3 font-medium">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol, index) => {
              const snapshot = snapshots[symbol];
              const score = snapshot?.setup?.score ?? 0;
              const [label, tone] = confidenceTone(score);
              const change = snapshot?.indicators?.change24h;
              const active = selectedSymbol === symbol;

              return (
                <tr
                  key={symbol}
                  className={`border-b border-[var(--border-subtle)] transition hover:bg-[var(--bg-card-hover)] ${
                    active ? 'bg-[var(--bg-card-hover)]' : index % 2 ? 'bg-[rgba(255,255,255,0.015)]' : 'bg-transparent'
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-[var(--text-muted)]">{index + 1}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{snapshot?.exchange ?? 'Binance'}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onSelect(symbol)} className="font-semibold text-[var(--text-primary)]">
                      {symbol.replace(/USDT$/i, '')}/USDT
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">${formatDashboardPrice(snapshot?.indicators?.price)}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{score ? `${(score * 1.75).toFixed(1)}M` : '--'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md border px-2 py-1 font-semibold uppercase tracking-[0.08em] ${tone}`}>
                      {label}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-mono ${change >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '--'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{score ? `${(score * 8.4).toFixed(0)}%` : '--'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function normalizeSymbolList(items) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => normalizeSymbol(String(item))).filter(Boolean))];
}

function loadWatchlist() {
  const storedVersion = window.localStorage.getItem(WATCHLIST_VERSION_KEY);
  const current = normalizeSymbolList(loadJson(WATCHLIST_STORAGE_KEY, []));
  const legacy = normalizeSymbolList(loadJson(LEGACY_WATCHLIST_KEY, []));
  const base = current.length ? current : legacy;

  if (storedVersion !== WATCHLIST_STORAGE_VERSION) {
    const migrated = normalizeSymbolList([...base, ...DEFAULT_SYMBOLS]);
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(migrated));
    window.localStorage.setItem(WATCHLIST_VERSION_KEY, WATCHLIST_STORAGE_VERSION);
    return migrated;
  }

  return base.length ? base : DEFAULT_SYMBOLS;
}

export default function App() {
  const [symbols, setSymbols] = useState(loadWatchlist);
  const [history, setHistory] = useState(() => loadJson(HISTORY_KEY, []));
  const [selectedSymbol, setSelectedSymbol] = useState(() => loadWatchlist()[0] ?? DEFAULT_SYMBOLS[0]);
  const [timeframe, setTimeframe] = useState('15m');
  const [signalMode, setSignalMode] = useState(() => normalizeSignalMode(window.localStorage.getItem(SIGNAL_MODE_KEY)));
  const [debugMode, setDebugMode] = useState(() => window.localStorage.getItem(DEBUG_MODE_KEY) === 'true');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(displayClock());
  const marketSnapshots = useWatchlistMarketData(symbols, timeframe, signalMode);
  const marketDataHealth = useMarketDataHealth();

  useEffect(() => {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(symbols));
    window.localStorage.setItem(WATCHLIST_VERSION_KEY, WATCHLIST_STORAGE_VERSION);
  }, [symbols]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    window.localStorage.setItem(SIGNAL_MODE_KEY, signalMode);
  }, [signalMode]);

  useEffect(() => {
    window.localStorage.setItem(DEBUG_MODE_KEY, String(debugMode));
  }, [debugMode]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLastUpdated(displayClock());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!symbols.includes(selectedSymbol)) {
      setSelectedSymbol(symbols[0] ?? DEFAULT_SYMBOLS[0]);
    }
  }, [selectedSymbol, symbols]);

  function addSymbol(symbol) {
    setSymbols((current) => {
      if (!symbol || current.includes(symbol)) {
        return current;
      }

      return [symbol, ...current];
    });
    setSelectedSymbol(symbol);
  }

  function removeSymbol(symbol) {
    setSymbols((current) => current.filter((item) => item !== symbol));
  }

  function addMomentumList() {
    setSymbols((current) => normalizeSymbolList([...current, ...MOMENTUM_SYMBOLS]));
  }

  function resetDefaultWatchlist() {
    const confirmed = window.confirm('Reset watchlist to TradeScope default pairs? Custom pairs will be removed.');
    if (!confirmed) {
      return;
    }

    setSymbols(DEFAULT_SYMBOLS);
    setSelectedSymbol(DEFAULT_SYMBOLS[0]);
  }

  function clearCustomWatchlist() {
    const confirmed = window.confirm('Remove non-default custom pairs and keep the default watchlist?');
    if (!confirmed) {
      return;
    }

    setSymbols((current) => {
      const defaults = new Set(DEFAULT_SYMBOLS);
      const next = normalizeSymbolList(current.filter((symbol) => defaults.has(symbol)));
      return next.length ? next : DEFAULT_SYMBOLS;
    });
  }

  function handleCopyAction(entry) {
    setHistory((current) => [
      {
        id: crypto.randomUUID(),
        symbol: entry.symbol,
        action: entry.action,
        signal: entry.signal,
        payload: entry.payload,
        time: timeStamp(),
      },
      ...current,
    ].slice(0, 24));
  }

  const filteredSymbols = useMemo(() => {
    if (!searchQuery.trim()) {
      return symbols;
    }

    return symbols.filter((symbol) => symbol.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  }, [searchQuery, symbols]);

  const tickerItems = useMemo(
    () =>
      symbols
        .map((symbol) => {
          const snapshot = marketSnapshots[symbol];
          return {
            symbol,
            price: snapshot?.indicators?.price ?? null,
            change24h: snapshot?.indicators?.change24h ?? null,
          };
        })
        .filter((item) => item.price !== null),
    [marketSnapshots, symbols],
  );

  const stats = useMemo(() => {
    const snapshotList = Object.values(marketSnapshots);
    const longCount = snapshotList.filter((item) => item?.setup?.signal === 'LONG').length;
    const shortCount = snapshotList.filter((item) => item?.setup?.signal === 'SHORT').length;
    const activeSignals = longCount + shortCount;
    const sessionRate = snapshotList.length ? Math.round((activeSignals / snapshotList.length) * 100) : 0;

    return {
      activeSignals,
      longCount,
      shortCount,
      sessionRate,
      pairsMonitored: symbols.length,
      lastUpdated,
    };
  }, [lastUpdated, marketSnapshots, symbols.length]);

  const selectedSnapshot = marketSnapshots[selectedSymbol];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[auto_minmax(0,1fr)_240px]">
        <Sidebar
          symbols={symbols}
          selectedSymbol={selectedSymbol}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          onAdd={addSymbol}
          onRemove={removeSymbol}
          onAddMomentum={addMomentumList}
          onResetDefault={resetDefaultWatchlist}
          onClearCustom={clearCustomWatchlist}
          onSelect={(symbol) => {
            setSelectedSymbol(symbol);
            setPanelOpen(true);
          }}
        />

        <main className="min-w-0 overflow-x-hidden px-3 pb-20 pt-3 md:px-4 md:py-4 xl:px-5">
          <div className="space-y-3 md:space-y-4">
            <TopBar
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              tickerItems={tickerItems}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onOpenPanel={() => setPanelOpen(true)}
              signalMode={signalMode}
              onSignalModeChange={(mode) => setSignalMode(normalizeSignalMode(mode))}
              debugMode={debugMode}
              onDebugModeChange={setDebugMode}
            />

            <PromoBanners selectedSymbol={selectedSymbol} snapshot={selectedSnapshot} stats={stats} />

            <StatsBar stats={stats} />

            <MarketDataHealth health={marketDataHealth} />

            <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {filteredSymbols.map((symbol) => (
                <SignalCard
                  key={symbol}
                  symbol={symbol}
                  snapshot={marketSnapshots[symbol]}
                  selected={selectedSymbol === symbol}
                  debugMode={debugMode}
                  onSelect={(nextSymbol) => {
                    setSelectedSymbol(nextSymbol);
                    setPanelOpen(true);
                  }}
                  onCopyAction={handleCopyAction}
                />
              ))}
            </section>

            <MainChart
              symbol={selectedSymbol}
              symbols={symbols}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              snapshot={selectedSnapshot}
              onSelectSymbol={setSelectedSymbol}
            />

            <PairsTable
              symbols={filteredSymbols}
              snapshots={marketSnapshots}
              selectedSymbol={selectedSymbol}
              onSelect={(symbol) => {
                setSelectedSymbol(symbol);
                setPanelOpen(true);
              }}
            />
          </div>
        </main>

        <RightPanel
          open={panelOpen}
          selectedSymbol={selectedSymbol}
          snapshot={selectedSnapshot}
          history={history}
          debugMode={debugMode}
          onClose={() => setPanelOpen(false)}
          onCopyAction={handleCopyAction}
        />
      </div>
    </div>
  );
}
