import { TIMEFRAME_OPTIONS, buildTradingViewSymbol } from '../lib/marketData';

function tradingViewInterval(timeframe) {
  if (timeframe === '1m') {
    return '1';
  }

  if (timeframe === '5m') {
    return '5';
  }

  if (timeframe === '1h') {
    return '60';
  }

  if (timeframe === '4h') {
    return '240';
  }

  return '15';
}

function tradingViewUrl(symbol, timeframe) {
  const params = new URLSearchParams({
    symbol: buildTradingViewSymbol(symbol),
    interval: tradingViewInterval(timeframe),
    theme: 'dark',
    style: '1',
    locale: 'en',
    hide_top_toolbar: '0',
    hide_legend: '0',
    saveimage: '0',
    toolbarsOfHideFirst: '0',
  });

  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

export default function MainChart({ symbol, symbols, timeframe, onTimeframeChange, snapshot, onSelectSymbol }) {
  return (
    <section className="relative max-w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-[0_22px_56px_rgba(0,0,0,0.2)] md:p-4">
      <div className="mb-3 grid gap-3 md:mb-4 md:flex md:flex-wrap md:items-center md:justify-between">
        <div className="grid min-w-0 gap-2 min-[390px]:grid-cols-[auto_minmax(0,1fr)] min-[390px]:items-center md:flex md:items-center md:gap-3">
          <select
            value={symbol}
            onChange={(event) => onSelectSymbol(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-purple)]"
          >
            {symbols.map((item) => (
              <option key={item} value={item}>
                {item.replace(/USDT$/i, '')}/USDT
              </option>
            ))}
          </select>
          <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {snapshot?.exchange ?? 'Binance'} chart embed
          </div>
        </div>

        <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {TIMEFRAME_OPTIONS.map((option) => (
            <button
              key={option}
            type="button"
            onClick={() => onTimeframeChange(option)}
              className={`h-8 shrink-0 rounded-md px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
                timeframe === option
                  ? 'bg-[var(--accent-purple)] text-white'
                  : 'border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-shell relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:80px_80px]" />
        <div className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-md bg-[var(--accent-red)] px-2 py-1 font-mono text-[11px] font-semibold text-white shadow-[0_8px_22px_rgba(255,77,109,0.28)]">
          {snapshot?.indicators?.price ? snapshot.indicators.price.toFixed(snapshot.indicators.price >= 1 ? 2 : 5) : '--'}
        </div>
        <iframe
          key={`${symbol}-${timeframe}`}
          src={tradingViewUrl(symbol, timeframe)}
          title={`${symbol} TradingView chart`}
          className="h-[360px] md:h-[420px]"
          style={{ width: '100%', maxWidth: '100%', border: 'none', display: 'block' }}
          allowTransparency="true"
          frameBorder="0"
        />
      </div>
    </section>
  );
}
