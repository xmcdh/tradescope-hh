import { useEffect, useMemo, useState } from 'react';
import MainChart from './components/MainChart';
import RightPanel from './components/RightPanel';
import Sidebar from './components/Sidebar';
import SignalCard from './components/SignalCard';
import StatsBar from './components/StatsBar';
import TopBar from './components/TopBar';
import { useWatchlistMarketData } from './hooks/useWatchlistMarketData';
import { DEFAULT_SYMBOLS } from './lib/marketData';

const WATCHLIST_KEY = 'tradescope:watchlist';
const HISTORY_KEY = 'tradescope:history';

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

export default function App() {
  const [symbols, setSymbols] = useState(() => loadJson(WATCHLIST_KEY, DEFAULT_SYMBOLS));
  const [history, setHistory] = useState(() => loadJson(HISTORY_KEY, []));
  const [selectedSymbol, setSelectedSymbol] = useState(() => loadJson(WATCHLIST_KEY, DEFAULT_SYMBOLS)[0] ?? DEFAULT_SYMBOLS[0]);
  const [timeframe, setTimeframe] = useState('15m');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(displayClock());
  const marketSnapshots = useWatchlistMarketData(symbols, timeframe);

  useEffect(() => {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
  }, [symbols]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

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
    <div className="min-h-screen min-w-[1280px] bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="grid min-h-screen grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[auto_minmax(0,1fr)_280px]">
        <Sidebar
          symbols={symbols}
          selectedSymbol={selectedSymbol}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          onAdd={addSymbol}
          onRemove={removeSymbol}
          onSelect={(symbol) => {
            setSelectedSymbol(symbol);
            setPanelOpen(true);
          }}
        />

        <main className="overflow-x-hidden px-4 py-4 xl:px-5">
          <div className="space-y-4">
            <TopBar
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              tickerItems={tickerItems}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onOpenPanel={() => setPanelOpen(true)}
            />

            <StatsBar stats={stats} />

            <section className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {filteredSymbols.map((symbol) => (
                <SignalCard
                  key={symbol}
                  symbol={symbol}
                  snapshot={marketSnapshots[symbol]}
                  selected={selectedSymbol === symbol}
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
          onClose={() => setPanelOpen(false)}
          onCopyAction={handleCopyAction}
        />
      </div>
    </div>
  );
}
