import { useEffect, useMemo, useState } from 'react';
import { useEthConvictionSignal } from '../hooks/useEthConvictionSignal.js';

function formatPrice(value) {
  if (!Number.isFinite(Number(value))) {
    return '--';
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number(value) >= 1000 ? 2 : 4,
    maximumFractionDigits: Number(value) >= 1000 ? 2 : 4,
  }).format(Number(value));
}

function formatTime(value) {
  if (!value) {
    return '--';
  }
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusClass(signal) {
  if (signal === 'LONG') return 'border-[rgba(0,230,118,0.35)] bg-[rgba(0,230,118,0.12)] text-[var(--accent-green)]';
  if (signal === 'SHORT') return 'border-[rgba(79,195,247,0.35)] bg-[rgba(79,195,247,0.12)] text-[var(--accent-cyan)]';
  return 'border-[var(--border)] bg-[var(--bg-card-hover)] text-[var(--text-secondary)]';
}

function Field({ label, value, accent = false }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-[rgba(79,195,247,0.35)] bg-[rgba(79,195,247,0.1)]' : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-sm text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

export default function EthConvictionMonitor() {
  const signal = useEthConvictionSignal();
  const [trades, setTrades] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingTrades, setLoadingTrades] = useState(true);
  const openTrade = useMemo(() => trades.find((trade) => trade.status === 'OPEN') ?? null, [trades]);
  const hasSignal = ['LONG', 'SHORT'].includes(signal.signal);

  async function loadTrades() {
    setLoadingTrades(true);
    try {
      const response = await fetch('/api/paper-trading/conviction');
      const payload = response.ok ? await response.json() : { trades: [] };
      setTrades(Array.isArray(payload.trades) ? payload.trades : []);
    } catch {
      setTrades([]);
    } finally {
      setLoadingTrades(false);
    }
  }

  useEffect(() => {
    loadTrades();
  }, []);

  async function recordTrade() {
    if (!hasSignal || openTrade) {
      return;
    }

    setMessage('');
    const response = await fetch('/api/paper-trading/conviction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy: signal.strategy,
        direction: signal.signal,
        entry: signal.entry,
        sl: signal.sl,
        tp1: signal.tp1,
        tp2: signal.tp2,
        score: signal.score,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error ?? 'Failed to record paper trade.');
      return;
    }
    setTrades(Array.isArray(payload.trades) ? payload.trades : []);
    setMessage('Paper trade recorded.');
  }

  async function closeTrade(status) {
    if (!openTrade) {
      return;
    }

    setMessage('');
    const response = await fetch('/api/paper-trading/conviction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', id: openTrade.id, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error ?? 'Failed to close paper trade.');
      return;
    }
    setTrades(Array.isArray(payload.trades) ? payload.trades : []);
    setMessage(`Trade closed as ${status}.`);
  }

  const recentTrades = [...trades]
    .sort((left, right) => Date.parse(right.date ?? right.createdAt ?? 0) - Date.parse(left.date ?? left.createdAt ?? 0))
    .slice(0, 10);

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
          <header className="border-b border-[var(--border-subtle)] p-5">
            <div className="text-xs uppercase tracking-[0.28em] text-[var(--accent-cyan)]">ETH Conviction Monitor</div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-semibold">ETH/USDT 1h</h1>
              <div className="text-xs text-[var(--text-secondary)]">Updated: {formatTime(signal.lastUpdated)}</div>
            </div>
          </header>

          <div className="space-y-4 p-5">
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Signal Status</div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className={`rounded-xl border px-4 py-2 font-mono text-lg font-bold ${statusClass(signal.signal)}`}>{signal.isLoading ? 'LOADING' : signal.signal}</span>
                <div className="text-sm text-[var(--text-secondary)]">
                  <div>Strategy: <span className="text-[var(--text-primary)]">{signal.strategy ?? '—'}</span></div>
                  <div>Score: <span className="font-mono text-[var(--text-primary)]">{signal.score ?? 0}/{signal.scoreMax || 4}</span></div>
                </div>
              </div>
              {signal.error ? <div className="mt-3 rounded-xl border border-[rgba(255,82,82,0.3)] bg-[rgba(255,82,82,0.08)] p-3 text-sm text-[var(--accent-red)]">{signal.error}</div> : null}
              {!hasSignal && !signal.error ? (
                <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-secondary)]">
                  No valid ETH conviction setup right now. This is the expected state.
                </div>
              ) : null}
            </section>

            {hasSignal ? (
              <section className="rounded-2xl border border-[rgba(79,195,247,0.28)] bg-[rgba(79,195,247,0.06)] p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent-cyan)]">Trade Plan</div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label="Entry" value={formatPrice(signal.entry)} accent />
                  <Field label="SL" value={formatPrice(signal.sl)} />
                  <Field label="TP1" value={formatPrice(signal.tp1)} />
                  <Field label="TP2" value={formatPrice(signal.tp2)} />
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Blockers</div>
                <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                  {(signal.blockers?.length ? signal.blockers.slice(0, 8) : ['Waiting for completed ETH 1h candle and funding context.']).map((blocker) => (
                    <div key={blocker}>• {blocker}</div>
                  ))}
                </div>
              </section>
            )}

            {hasSignal ? (
              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <button
                  type="button"
                  disabled={Boolean(openTrade)}
                  onClick={recordTrade}
                  className="w-full rounded-xl border border-[rgba(0,230,118,0.35)] bg-[rgba(0,230,118,0.14)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-green)] transition disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--bg-card-hover)] disabled:text-[var(--text-muted)]"
                >
                  Record Paper Trade
                </button>
                {openTrade ? <div className="mt-2 text-xs text-[var(--text-secondary)]">Disabled because one ETH conviction trade is already open.</div> : null}
              </section>
            ) : null}

            {message ? <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card-hover)] p-3 text-sm text-[var(--text-secondary)]">{message}</div> : null}

            {openTrade ? (
              <section className="rounded-2xl border border-[rgba(255,215,64,0.28)] bg-[rgba(255,215,64,0.08)] p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent-yellow)]">Open Trade</div>
                <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)] md:grid-cols-2">
                  <div>Opened: <span className="text-[var(--text-primary)]">{formatTime(openTrade.date)}</span></div>
                  <div>Strategy: <span className="text-[var(--text-primary)]">{openTrade.strategy}</span></div>
                  <div>Entry: <span className="font-mono text-[var(--text-primary)]">{formatPrice(openTrade.entry)}</span></div>
                  <div>SL: <span className="font-mono text-[var(--text-primary)]">{formatPrice(openTrade.sl)}</span></div>
                  <div>Status: <span className="font-mono text-[var(--text-primary)]">{openTrade.status}</span></div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {['TP1', 'TP2', 'SL'].map((status) => (
                    <button key={status} type="button" onClick={() => closeTrade(status)} className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-purple)]">
                      Close: {status}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Recent Paper Trades</div>
                <button type="button" onClick={loadTrades} className="text-xs text-[var(--accent-cyan)]">Refresh</button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="text-[var(--text-muted)]">
                    <tr>
                      <th className="py-2">Date</th>
                      <th>Strat</th>
                      <th>Dir</th>
                      <th>R</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-secondary)]">
                    {recentTrades.map((trade) => (
                      <tr key={trade.id} className="border-t border-[var(--border-subtle)]">
                        <td className="py-2">{formatTime(trade.date)}</td>
                        <td>{trade.strategy}</td>
                        <td>{trade.direction}</td>
                        <td className="font-mono">{trade.rOutcome ?? '--'}</td>
                        <td>{trade.status}</td>
                      </tr>
                    ))}
                    {!recentTrades.length ? (
                      <tr>
                        <td colSpan="5" className="py-4 text-center text-[var(--text-muted)]">{loadingTrades ? 'Loading trades...' : 'No conviction paper trades yet.'}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
