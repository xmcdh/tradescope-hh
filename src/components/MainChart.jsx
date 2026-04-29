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
    <section className="relative max-w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 md:rounded-3xl md:p-4">
      <div className="mb-3 grid gap-3 md:mb-4 md:flex md:flex-wrap md:items-center md:justify-between">
        <div className="grid min-w-0 gap-2 min-[390px]:grid-cols-[auto_minmax(0,1fr)] min-[390px]:items-center md:flex md:items-center md:gap-3">
          <select
            value={symbol}
            onChange={(event) => onSelectSymbol(event.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none"
          >
            {symbols.map((item) => (
              <option key={item} value={item}>
                {item.replace(/USDT$/i, '')}/USDT
              </option>
            ))}
          </select>
          <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] md:text-[11px] md:tracking-[0.22em]">
            {snapshot?.exchange ?? 'Binance'} chart embed
          </div>
        </div>

        <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {TIMEFRAME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onTimeframeChange(option)}
              className={`h-9 shrink-0 rounded-full px-3 text-[11px] uppercase tracking-[0.16em] md:h-auto md:py-1 md:tracking-[0.2em] ${
                timeframe === option
                  ? 'bg-[var(--accent-blue)] text-[var(--bg-primary)]'
                  : 'border border-[var(--border)] text-[var(--text-secondary)]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
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
