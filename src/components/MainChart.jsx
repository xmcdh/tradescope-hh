import { buildTradingViewSymbol } from '../lib/marketData';

const timeframeOptions = ['15m', '1h', '4h', '1d'];

function tradingViewInterval(timeframe) {
  if (timeframe === '1h') {
    return '60';
  }

  if (timeframe === '4h') {
    return '240';
  }

  if (timeframe === '1d') {
    return 'D';
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
    <section className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={symbol}
            onChange={(event) => onSelectSymbol(event.target.value)}
            className="h-10 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none"
          >
            {symbols.map((item) => (
              <option key={item} value={item}>
                {item.replace(/USDT$/i, '')}/USDT
              </option>
            ))}
          </select>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
            {snapshot?.exchange ?? 'Binance'} chart embed
          </div>
        </div>

        <div className="flex items-center gap-2">
          {timeframeOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onTimeframeChange(option)}
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
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
          style={{ width: '100%', maxWidth: '100%', height: '420px', border: 'none', display: 'block' }}
          allowTransparency="true"
          frameBorder="0"
        />
      </div>
    </section>
  );
}
