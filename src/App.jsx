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
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[auto_minmax(0,1fr)_280px]">
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

        <main className="min-w-0 overflow-x-hidden px-3 py-3 md:px-4 md:py-4 xl:px-5">
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
