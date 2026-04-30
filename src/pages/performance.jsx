import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function StatCard({ label, value, detail }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-secondary)]">{detail}</div>
    </div>
  );
}

function MetricTable({ title, rows }) {
  const keys = Object.keys(rows ?? {});

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-left text-xs">
          <thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <tr>
              {['Group', 'Trades', 'Win Rate', 'Expectancy', 'Avg R', 'Max DD', 'False Pos'].map((label) => (
                <th key={label} className="px-4 py-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.length ? (
              keys.map((key, index) => {
                const item = rows[key];
                return (
                  <tr
                    key={key}
                    className={`border-b border-[var(--border-subtle)] ${
                      index % 2 ? 'bg-[rgba(255,255,255,0.015)]' : 'bg-transparent'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{key}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.totalTrades}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.winRate}%</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.expectancy}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.avgR}</td>
                    <td className="px-4 py-3 font-mono text-[var(--accent-red)]">{item.maxDrawdown}</td>
                    <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.falsePosRate}%</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="7" className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                  No signal data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PerformancePage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/performance');
        if (!response.ok) {
          throw new Error('Failed to load performance data.');
        }

        const data = await response.json();
        if (!cancelled) {
          setPayload(data);
          setError('');
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message);
        }
      }
    }

    load();
    const intervalId = window.setInterval(load, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const stats = payload?.stats;
  const overall = stats?.overall;

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)] md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">TradeScope</div>
            <h1 className="mt-1 text-2xl font-semibold">Signal Performance</h1>
          </div>
          <a
            href="/"
            className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Back to Scanner
          </a>
        </div>

        {error ? (
          <div className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-4 py-3 text-sm text-[var(--accent-red)]">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Win Rate" value={overall ? `${overall.winRate}%` : '--'} detail="Resolved signals" />
          <StatCard label="Expectancy" value={overall ? overall.expectancy : '--'} detail="Average edge per trade" />
          <StatCard label="Avg R" value={overall ? overall.avgR : '--'} detail="Mean realized R multiple" />
          <StatCard label="Total Trades" value={overall ? overall.totalTrades : '--'} detail="Closed signals only" />
          <StatCard label="False Pos" value={overall ? `${overall.falsePosRate}%` : '--'} detail="Loss + expired rate" />
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Equity Curve</div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.equityCurve ?? []}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="index" stroke="#5d6674" tickLine={false} axisLine={false} />
                <YAxis stroke="#5d6674" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#111318',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    color: '#f4f6fb',
                  }}
                />
                <Line type="monotone" dataKey="equity" stroke="#4fc3f7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <MetricTable title="Per Pair" rows={stats?.perPair} />
        <MetricTable title="Per Timeframe" rows={stats?.perTimeframe} />
        <MetricTable title="By Signal Validity" rows={stats?.perSignalValidity} />
      </div>
    </main>
  );
}
