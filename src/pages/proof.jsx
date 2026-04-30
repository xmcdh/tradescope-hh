import { useEffect, useState } from 'react';

function toneClass(verdict) {
  if (verdict === 'READY FOR SMALL LIVE TEST' || verdict === 'READY FOR PAPER TRADING' || verdict === 'PAPER GATE PASSED') {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]';
  }

  if (verdict === 'COLLECTING DATA') {
    return 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]';
  }

  return 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]';
}

function GateBadge({ passed, label }) {
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
        passed
          ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
          : 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
      }`}
    >
      {label}
    </span>
  );
}

export default function ProofPage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/proof');
        if (!response.ok) {
          throw new Error('Failed to load proof status.');
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

  const summary = payload?.summary;
  const proof = payload?.proof;
  const liveGate = payload?.liveGate;
  const setupRegistry = payload?.setupRegistry;
  const stats = liveGate?.stats ?? {};

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)] md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">TradeScope</div>
            <h1 className="mt-1 text-2xl font-semibold">Strategy Proof</h1>
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

        <section className={`rounded-lg border px-4 py-4 ${toneClass(payload?.verdict)}`}>
          <div className="text-lg font-semibold">{payload?.verdict ?? 'NOT READY'}</div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            {payload?.readyForLive
              ? 'All proof gates currently pass.'
              : 'Not ready for live trading. Collecting authoritative paper data.'}
          </div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            Only approved setups count toward the paper gate. Observation-only signals are logged but not counted.
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Official Day 1</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {stats.officialPaperTrackingStartDate ?? '2026-04-30'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Paper Duration</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {stats.paperDurationElapsedDays ?? 0} / {stats.paperDurationMinDays ?? 28} days
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Days Remaining</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {stats.paperDurationRemainingDays ?? 28}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Approved Closed</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {stats.approvedPaperTradesClosed ?? 0} / {liveGate?.thresholds?.minClosedTrades ?? 30}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Approved Open</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {stats.approvedPaperTradesOpen ?? 0}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Durable Storage</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.durable ? 'Configured' : 'Not Configured'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Storage Mode</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.mode ?? '--'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Current Proof Authority</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.authoritative ? 'Authoritative' : 'Local Only'}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Provider</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.provider ?? '--'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Can Connect</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.canConnect ? 'yes' : 'no'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Paper Tracking Source</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {liveGate?.storage?.authoritative ? 'Durable Database' : 'Local JSON'}
            </div>
          </div>
        </section>

        {!liveGate?.storage?.durable ? (
          <section className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-4 py-4 text-sm text-[var(--text-secondary)]">
            {liveGate?.storage?.warning ||
              'Paper trading results are not authoritative because durable database storage is not configured. Configure database storage before using paper results for live-readiness.'}
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            ['Backtest', proof?.status ?? 'Missing'],
            ['OOS', proof?.setups?.length && proof.setups.every((item) => item.metrics.oosDegradation != null && item.metrics.oosDegradation <= 0.15) ? 'Pass' : 'Review'],
            ['Walk Forward', proof?.setups?.length && proof.setups.every((item) => item.metrics.walkForwardPass) ? 'Pass' : 'Review'],
            ['Paper', liveGate?.paperGatePassed ? 'Passed' : 'Collecting'],
            ['Storage', liveGate?.storage?.durable ? 'Durable' : 'Non-durable'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
              <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Observation Only</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">{stats.observationOnlyCount ?? 0}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Rejected / Blocked</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">
              {(stats.rejectedSetupCount ?? 0) + (stats.blockedSignalCount ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Eligible Universe</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">BTC/USDT 1h only</div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Approved Setups', setupRegistry?.counts?.approved ?? 0],
            ['Collecting Data', setupRegistry?.counts?.collectingData ?? 0],
            ['Rejected Setups', setupRegistry?.counts?.rejected ?? 0],
            ['Unknown Setups', setupRegistry?.counts?.unknown ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Gate Checklist</div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex items-center justify-between gap-3">
                <span>Backtest proof status</span>
                <GateBadge passed={proof?.status === 'PROVEN_READY_FOR_PAPER'} label={proof?.status ?? 'MISSING'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Paper duration &gt;= 4 weeks</span>
                <GateBadge passed={Boolean(liveGate?.paperDurationPassed)} label={`${stats.paperDurationElapsedDays ?? 0}/${stats.paperDurationMinDays ?? 28}`} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Closed approved paper trades &gt;= 30</span>
                <GateBadge passed={(stats.approvedPaperTradesClosed ?? 0) >= 30} label={`${stats.approvedPaperTradesClosed ?? 0}`} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Durable storage configured</span>
                <GateBadge passed={Boolean(liveGate?.storage?.durable)} label={liveGate?.storage?.durable ? 'PASS' : 'FAIL'} />
              </div>
            </div>
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex items-center justify-between gap-3">
                <span>Win rate &gt; 45%</span>
                <GateBadge passed={(liveGate?.stats?.winRate ?? 0) >= 0.45} label={liveGate?.stats?.winRate != null ? `${(liveGate.stats.winRate * 100).toFixed(1)}%` : '--'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Expectancy &gt; 0.3R</span>
                <GateBadge passed={(liveGate?.stats?.expectancy ?? 0) >= 0.3} label={liveGate?.stats?.expectancy ?? '--'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Max drawdown &lt; 15%</span>
                <GateBadge passed={(liveGate?.stats?.maxDrawdown ?? 1) < 0.15} label={liveGate?.stats?.maxDrawdown != null ? `${(liveGate.stats.maxDrawdown * 100).toFixed(1)}%` : '--'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>OOS degradation &lt;= 15%</span>
                <GateBadge passed={(liveGate?.stats?.oosDegradation ?? 1) <= 0.15} label={liveGate?.stats?.oosDegradation != null ? `${(liveGate.stats.oosDegradation * 100).toFixed(1)}%` : '--'} />
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Setup Approval Table</div>
          <div className="overflow-x-auto">
            <table className="min-w-[1220px] w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <tr>
                  {['Pair', 'TF', 'Proof Status', 'Setup Status', 'Actionable Trades', 'Win Rate', 'Expectancy', 'Max DD', 'OOS Status', 'Recommendation'].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setupRegistry?.entries?.length ? (
                  setupRegistry.entries.map((item, index) => (
                    <tr
                      key={item.symbolKey}
                      className={`border-b border-[var(--border-subtle)] ${index % 2 ? 'bg-[rgba(255,255,255,0.015)]' : 'bg-transparent'}`}
                    >
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{item.pair}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.timeframe}</td>
                      <td className="px-4 py-3"><GateBadge passed={item.proofStatus === 'PROVEN_READY_FOR_PAPER'} label={item.proofStatus} /></td>
                      <td className="px-4 py-3"><GateBadge passed={item.setupStatus === 'APPROVED_FOR_PAPER'} label={item.setupStatus} /></td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.actionableTrades}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.winRate.toFixed(2)}%</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.expectancy}</td>
                      <td className="px-4 py-3 font-mono text-[var(--accent-red)]">{(item.maxDrawdown * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{item.oosStatus}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{item.recommendation}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                      No backtest proof summary found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Why Not Ready Yet</div>
          <div className="space-y-2 px-4 py-4 text-sm text-[var(--text-secondary)]">
            {payload?.whyNotReady?.length ? (
              payload.whyNotReady.map((item) => <div key={item}>- {item}</div>)
            ) : (
              <div>- No blocking proof items reported.</div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Latest Batch Metadata</div>
          <div className="grid gap-3 p-4 text-sm text-[var(--text-secondary)] md:grid-cols-2 xl:grid-cols-4">
            <div>Range: {summary?.metadata?.from ?? '--'} to {summary?.metadata?.to ?? '--'}</div>
            <div>Pairs: {summary?.metadata?.pairs?.length ?? 0}</div>
            <div>Timeframes: {summary?.metadata?.timeframes?.length ?? 0}</div>
            <div>Runs: {summary?.metadata?.successCount ?? 0}/{summary?.metadata?.runCount ?? 0}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
