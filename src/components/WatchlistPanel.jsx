import { useState } from 'react';

function sanitizeInput(value) {
  const clean = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

export default function WatchlistPanel({ symbols, onAdd, onRemove }) {
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
    <aside className="rounded-[28px] border border-line bg-panel/90 p-5 shadow-glow backdrop-blur">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">TradeScope</p>
        <h1 className="mt-2 text-2xl font-semibold text-text">Personal Signal Desk</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Pantau futures pair, cek konfluensi teknikal, lalu copy signal atau prompt AI tanpa API key.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs uppercase tracking-[0.22em] text-muted">Tambah Pair</label>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="UB, BAS, BTCUSDT"
          className="w-full rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
        />
        <button type="submit" className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-ink transition hover:brightness-110">
          Add to Watchlist
        </button>
      </form>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.22em] text-muted">Watchlist</h2>
          <span className="rounded-full border border-line px-2 py-1 font-mono text-[11px] text-text">{symbols.length}</span>
        </div>
        <div className="space-y-2">
          {symbols.map((symbol) => (
            <div key={symbol} className="flex items-center justify-between rounded-2xl border border-line bg-ink/70 px-3 py-3">
              <div>
                <div className="text-sm font-semibold text-text">{symbol.replace(/USDT$/i, '')}</div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted">USDT perpetual</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(symbol)}
                className="rounded-full border border-short/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-short transition hover:bg-short/10"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
