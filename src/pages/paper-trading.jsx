import { useEffect, useMemo, useState } from 'react';

function GateRow({ label, current, threshold, passed }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-sm last:border-b-0">
      <span className="text-[var(--text-primary)]">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[var(--text-secondary)]">{current}</span>
        <span className="font-mono text-[var(--text-muted)]">{threshold}</span>
        <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
          passed
            ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
            : 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
        }`}>
          {passed ? 'PASS' : 'FAIL'}
        </span>
      </div>
    </div>
  );
}

function TradeTable({ title, rows, emptyLabel }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full text-left text-xs">
          <thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <tr>
              {['Pair', 'TF', 'Direction', 'Signal', 'Setup Status', 'Proof', 'R:R', 'Status', 'Reason', 'Opened'].map((label) => (
                <th key={label} className="px-4 py-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((trade, index) => (
                <tr
                  key={trade.id}
                  className={`border-b border-[var(--border-subtle)] ${index % 2 ? 'bg-[rgba(255,255,255,0.015)]' : 'bg-transparent'}`}
                >
                  <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{trade.pair}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.timeframe}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.direction ?? '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.signal ?? '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.setupStatus ?? '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.proofStatus ?? '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.rr ?? '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.status}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{trade.rejectionReason || '--'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{new Date(trade.timestamp).toLocaleString('id-ID')}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="10" className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PaperTradingPage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/paper-trading');
        if (!response.ok) {
          throw new Error('Failed to load paper trading data.');
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

  const trades = payload?.trades ?? [];
  const approvedTrades = useMemo(() => trades.filter((trade) => trade.paperCategory === 'PAPER_ELIGIBLE'), [trades]);
  const observationTrades = useMemo(() => trades.filter((trade) => trade.paperCategory === 'OBSERVATION_ONLY'), [trades]);
  const rejectedTrades = useMemo(() => trades.filter((trade) => trade.paperCategory === 'REJECTED_SETUP'), [trades]);
  const blockedTrades = useMemo(() => trades.filter((trade) => trade.paperCategory === 'BLOCKED_SIGNAL'), [trades]);
  const openTrades = useMemo(() => approvedTrades.filter((trade) => trade.status === 'OPEN'), [approvedTrades]);
  const gate = payload?.gate;
  const paperHealth = payload?.paperHealth;
  const gateStats = gate?.stats ?? {};
  const thresholds = gate?.thresholds ?? {};

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)] md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">TradeScope</div>
            <h1 className="mt-1 text-2xl font-semibold">Paper Trading Gate</h1>
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

        <section className={`rounded-lg border px-4 py-4 ${
          gate?.paperGatePassed
            ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10'
            : 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10'
        }`}>
          <div className={`text-lg font-semibold ${gate?.paperGatePassed ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {gate?.paperGatePassed ? 'Paper Gate Passed' : 'Not ready for live trading'}
          </div>
          {!gate?.paperGatePassed && gate?.failedCriteria?.length ? (
            <div className="mt-2 text-sm text-[var(--text-secondary)]">
              {gate.failedCriteria.join(' | ')}
            </div>
          ) : null}
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            Collecting authoritative paper data. Only approved setups count toward the paper gate; observation-only signals are logged but not counted.
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Paper Tracking Health</div>
          <div className="grid gap-3 p-4 text-sm text-[var(--text-secondary)] md:grid-cols-2 xl:grid-cols-4">
            <div>Storage: {paperHealth?.storageAuthority ?? gate?.storage?.authority ?? 'LOCAL_ONLY'}</div>
            <div>Official Day 1: {paperHealth?.officialPaperTrackingStartDate ?? '2026-04-30'}</div>
            <div>Paper Duration: {paperHealth?.daysElapsed ?? gateStats.paperDurationElapsedDays ?? 0} / {paperHealth?.minimumDays ?? gateStats.paperDurationMinDays ?? 28} days</div>
            <div>Days Remaining: {paperHealth?.daysRemaining ?? gateStats.paperDurationRemainingDays ?? 28}</div>
            <div>Approved closed trades: {paperHealth?.approvedClosedTrades ?? gateStats.approvedPaperTradesClosed ?? 0}</div>
            <div>Approved open trades: {paperHealth?.approvedOpenTrades ?? gateStats.approvedPaperTradesOpen ?? 0}</div>
            <div>Observation-only signals: {paperHealth?.observationOnlyCount ?? observationTrades.length}</div>
            <div>Rejected/blocked signals: {(paperHealth?.rejectedSetupCount ?? rejectedTrades.length) + (paperHealth?.blockedSignalCount ?? blockedTrades.length)}</div>
            <div>Last approved paper trade: {paperHealth?.lastApprovedPaperTradeAt ? new Date(paperHealth.lastApprovedPaperTradeAt).toLocaleString('id-ID') : '--'}</div>
            <div>Last proof snapshot: {paperHealth?.lastSnapshotAt ? new Date(paperHealth.lastSnapshotAt).toLocaleString('id-ID') : '--'}</div>
            <div>Current verdict: {paperHealth?.globalVerdict ?? 'NOT READY'}</div>
            <div>Paper Tracking Source: {gate?.storage?.authoritative ? 'Durable Database' : 'Local JSON'}</div>
          </div>
          <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            Only approved BTC/USDT 1h trades count right now. Observation-only and rejected setups are not counted toward live readiness.
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Official Day 1</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{gateStats.officialPaperTrackingStartDate ?? '2026-04-30'}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Paper Duration</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {gateStats.paperDurationElapsedDays ?? 0} / {gateStats.paperDurationMinDays ?? 28} days
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Days Remaining</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">{gateStats.paperDurationRemainingDays ?? 28}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Approved Closed</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {gateStats.approvedPaperTradesClosed ?? 0} / {thresholds.minClosedTrades ?? 30}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Eligible Setup</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">BTC/USDT 1h only</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Gate Criteria</div>
          <GateRow
            label="Paper duration"
            current={`${gateStats.paperDurationElapsedDays ?? 0} days`}
            threshold={`>= ${thresholds.minPaperDurationDays ?? 28} days`}
            passed={(gateStats.paperDurationElapsedDays ?? 0) >= (thresholds.minPaperDurationDays ?? 28)}
          />
          <GateRow
            label="Closed approved paper trades"
            current={gateStats.approvedPaperTradesClosed ?? 0}
            threshold={`>= ${thresholds.minClosedTrades ?? 30}`}
            passed={(gateStats.approvedPaperTradesClosed ?? 0) >= (thresholds.minClosedTrades ?? 30)}
          />
          <GateRow
            label="Win rate"
            current={gateStats.winRate != null ? `${(gateStats.winRate * 100).toFixed(2)}%` : '--'}
            threshold={`>= ${((thresholds.winRate ?? 0.45) * 100).toFixed(0)}%`}
            passed={(gateStats.winRate ?? 0) >= (thresholds.winRate ?? 0.45)}
          />
          <GateRow
            label="Expectancy"
            current={gateStats.expectancy?.toFixed?.(4) ?? gateStats.expectancy ?? '--'}
            threshold={`>= ${thresholds.expectancy ?? 0.3}`}
            passed={(gateStats.expectancy ?? 0) >= (thresholds.expectancy ?? 0.3)}
          />
          <GateRow
            label="Max drawdown"
            current={gateStats.maxDrawdown != null ? `${(gateStats.maxDrawdown * 100).toFixed(2)}%` : '--'}
            threshold={`<= ${((thresholds.maxDrawdown ?? 0.15) * 100).toFixed(0)}%`}
            passed={(gateStats.maxDrawdown ?? 1) <= (thresholds.maxDrawdown ?? 0.15)}
          />
          <GateRow
            label="OOS degradation"
            current={gateStats.oosDegradation != null ? `${(gateStats.oosDegradation * 100).toFixed(2)}%` : 'Unavailable'}
            threshold={`<= ${((thresholds.oosDegradation ?? 0.15) * 100).toFixed(0)}%`}
            passed={gateStats.oosDegradation != null && gateStats.oosDegradation <= (thresholds.oosDegradation ?? 0.15)}
          />
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Backtest vs Paper</div>
          <div className="grid gap-3 p-4 text-sm text-[var(--text-secondary)] md:grid-cols-2 xl:grid-cols-4">
            <div>Backtest expectancy: {gate?.backtestComparison?.backtestExpectancy ?? '--'}</div>
            <div>Paper expectancy: {gate?.backtestComparison?.paperExpectancy ?? '--'}</div>
            <div>Backtest win rate: {gate?.backtestComparison?.backtestWinRate != null ? `${(gate.backtestComparison.backtestWinRate * 100).toFixed(2)}%` : '--'}</div>
            <div>Paper win rate: {gate?.backtestComparison?.paperWinRate != null ? `${(gate.backtestComparison.paperWinRate * 100).toFixed(2)}%` : '--'}</div>
            <div>Backtest max DD: {gate?.backtestComparison?.backtestMaxDrawdown != null ? `${(gate.backtestComparison.backtestMaxDrawdown * 100).toFixed(2)}%` : '--'}</div>
            <div>Paper max DD: {gate?.backtestComparison?.paperMaxDrawdown != null ? `${(gate.backtestComparison.paperMaxDrawdown * 100).toFixed(2)}%` : '--'}</div>
            <div>Proof status: {gate?.backtestComparison?.proofStatus ?? '--'}</div>
            <div>Storage: {gate?.storage?.mode ?? '--'} / {gate?.storage?.authoritative ? 'Authoritative' : 'Local Only'}</div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Storage Mode</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">{gate?.storage?.mode ?? '--'}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Provider</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">{gate?.storage?.provider ?? '--'}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Can Connect</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">{gate?.storage?.canConnect ? 'yes' : 'no'}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Paper Authority</div>
            <div className="mt-2 font-mono text-lg font-semibold text-[var(--text-primary)]">
              {gate?.storage?.authoritative ? 'Authoritative' : 'Local Only'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Durable Tracking Start</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {gateStats.authoritativeStartDate ? new Date(gateStats.authoritativeStartDate).toLocaleString('id-ID') : '--'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Duration Source</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {gate?.storage?.authoritative ? 'Durable Database' : 'Local JSON'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Paper Tracking Source</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {gate?.storage?.authoritative ? 'Durable Database' : 'Local JSON'}
            </div>
          </div>
        </section>

        {!gate?.storage?.durable ? (
          <section className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-4 py-4 text-sm text-[var(--text-secondary)]">
            {gate?.storage?.warning ||
              'Paper trading results are not authoritative because durable database storage is not configured. Configure a database before using paper results for live-readiness.'}
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Paper Eligible', approvedTrades.length],
            ['Observation Only', observationTrades.length],
            ['Rejected Setup', rejectedTrades.length],
            ['Blocked Signal', blockedTrades.length],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Open Paper Positions</div>
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <tr>
                  {['Pair', 'TF', 'Direction', 'Entry', 'SL', 'TP', 'R:R', 'Validity', 'Opened'].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openTrades.length ? (
                  openTrades.map((trade, index) => (
                    <tr
                      key={trade.id}
                      className={`border-b border-[var(--border-subtle)] ${
                        index % 2 ? 'bg-[rgba(255,255,255,0.015)]' : 'bg-transparent'
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{trade.pair}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.timeframe}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.direction}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.entry}</td>
                      <td className="px-4 py-3 font-mono text-[var(--accent-red)]">{trade.sl}</td>
                      <td className="px-4 py-3 font-mono text-[var(--accent-green)]">{trade.tp}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.rr}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{trade.signalValidity}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                        {new Date(trade.timestamp).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                      No open paper positions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <TradeTable title="Approved Paper Trades" rows={approvedTrades} emptyLabel="No approved paper trades yet." />
        <TradeTable title="Observation-Only Signals" rows={observationTrades} emptyLabel="No observation-only signals logged yet." />
        <TradeTable title="Rejected Setup Signals" rows={rejectedTrades} emptyLabel="No rejected setup signals logged yet." />
        <TradeTable title="Blocked Signals" rows={blockedTrades} emptyLabel="No blocked signals logged yet." />
      </div>
    </main>
  );
}
