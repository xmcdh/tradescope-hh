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


function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '--';
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--';
}

function gateTone(status) {
  if (status === 'pass') {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]';
  }

  if (status === 'warn') {
    return 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]';
  }

  return 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]';
}

function ReadinessGate({ gate }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{gate.label}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">{gate.detail}</div>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${gateTone(gate.status)}`}>
          {gate.badge}
        </span>
      </div>
    </div>
  );
}

function buildReadinessGates({ payload, liveGate, paperHealth, setupRegistry, proof }) {
  const stats = liveGate?.stats ?? {};
  const thresholds = liveGate?.thresholds ?? {};
  const security = payload?.securityStatus ?? {};
  const closedTrades = stats.approvedPaperTradesClosed ?? stats.totalClosedTrades ?? 0;
  const minClosedTrades = thresholds.minClosedTrades ?? 30;
  const durationDays = stats.paperDurationElapsedDays ?? paperHealth?.daysElapsed ?? 0;
  const minDurationDays = thresholds.minPaperDurationDays ?? paperHealth?.minimumDays ?? 28;
  const approvedSetups = setupRegistry?.counts?.approved ?? paperHealth?.approvedSetupCount ?? 0;
  const snapshotFresh = paperHealth?.snapshotFreshness === 'FRESH';
  const writeProtected = Boolean(security.writeProtectionConfigured);
  const liveStubbed = paperHealth?.liveExecutionStatus === 'STUBBED';
  const oosValue = liveGate?.backtestComparison?.oosDegradation ?? stats.oosDegradation;

  return [
    {
      label: 'Live execution state',
      detail: liveStubbed ? 'Execution remains disabled/stubbed. This is required before any live-readiness review.' : 'Execution state is unknown. Do not proceed.',
      status: liveStubbed ? 'pass' : 'fail',
      badge: liveStubbed ? 'STUBBED' : 'CHECK',
    },
    {
      label: 'Write endpoint protection',
      detail: writeProtected ? 'API_WRITE_TOKEN is configured server-side. No token value is exposed.' : 'API_WRITE_TOKEN is missing; POST endpoints should stay blocked.',
      status: writeProtected ? 'pass' : 'fail',
      badge: writeProtected ? 'PROTECTED' : 'MISSING',
    },
    {
      label: 'CORS allowlist',
      detail: security.allowedOriginsConfigured ? 'Production allowlist is configured.' : `Default allowed origin applies: ${security.defaultAllowedOrigin ?? 'TradeScope app URL'}.`,
      status: security.corsRestricted ? 'pass' : 'fail',
      badge: security.corsRestricted ? 'RESTRICTED' : 'OPEN',
    },
    {
      label: 'Durable storage',
      detail: liveGate?.storage?.durable ? 'Database storage is authoritative for paper proof.' : 'Paper proof cannot count until database storage is durable.',
      status: liveGate?.storage?.durable ? 'pass' : 'fail',
      badge: liveGate?.storage?.durable ? 'DURABLE' : 'LOCAL',
    },
    {
      label: 'Backtest proof',
      detail: proof?.status ? `Current proof status: ${proof.status}.` : 'Fresh active-strategy proof is missing.',
      status: proof?.status === 'PROVEN_READY_FOR_PAPER' ? 'pass' : 'fail',
      badge: proof?.status ?? 'MISSING',
    },
    {
      label: 'Approved setup universe',
      detail: approvedSetups > 0 ? `${approvedSetups} setup(s) approved for paper review.` : 'No setup is approved for paper/live gate yet.',
      status: approvedSetups > 0 ? 'pass' : 'fail',
      badge: String(approvedSetups),
    },
    {
      label: 'Official paper duration',
      detail: `${durationDays}/${minDurationDays} days completed.`,
      status: durationDays >= minDurationDays ? 'pass' : durationDays > 0 ? 'warn' : 'fail',
      badge: `${durationDays}d`,
    },
    {
      label: 'Closed approved paper trades',
      detail: `${closedTrades}/${minClosedTrades} closed approved trades collected.`,
      status: closedTrades >= minClosedTrades ? 'pass' : closedTrades > 0 ? 'warn' : 'fail',
      badge: String(closedTrades),
    },
    {
      label: 'Paper expectancy',
      detail: `Current expectancy ${formatNumber(stats.expectancy)}R; target ${thresholds.expectancy ?? 0.3}R or higher.`,
      status: (stats.expectancy ?? 0) >= (thresholds.expectancy ?? 0.3) ? 'pass' : 'fail',
      badge: `${formatNumber(stats.expectancy)}R`,
    },
    {
      label: 'Paper win rate',
      detail: `Current win rate ${formatPercent(stats.winRate)}; target ${formatPercent(thresholds.winRate ?? 0.45)} or higher.`,
      status: (stats.winRate ?? 0) >= (thresholds.winRate ?? 0.45) ? 'pass' : 'fail',
      badge: formatPercent(stats.winRate),
    },
    {
      label: 'Drawdown control',
      detail: `Current max drawdown ${formatPercent(stats.maxDrawdown)}; limit below ${formatPercent(thresholds.maxDrawdown ?? 0.15)}.`,
      status: (stats.maxDrawdown ?? 1) < (thresholds.maxDrawdown ?? 0.15) ? 'pass' : 'fail',
      badge: formatPercent(stats.maxDrawdown),
    },
    {
      label: 'OOS/backtest divergence',
      detail: Number.isFinite(Number(oosValue)) ? `OOS degradation ${formatPercent(oosValue)}.` : 'Fresh active-strategy OOS proof is unavailable.',
      status: Number.isFinite(Number(oosValue)) && Number(oosValue) <= (thresholds.oosDegradation ?? 0.15) ? 'pass' : 'fail',
      badge: Number.isFinite(Number(oosValue)) ? formatPercent(oosValue) : 'MISSING',
    },
    {
      label: 'Daily proof snapshot',
      detail: snapshotFresh ? 'Latest proof snapshot is fresh today.' : `Snapshot freshness is ${paperHealth?.snapshotFreshness ?? 'MISSING'}.`,
      status: snapshotFresh ? 'pass' : 'warn',
      badge: paperHealth?.snapshotFreshness ?? 'MISSING',
    },
  ];
}

function LiveReadinessDashboard({ payload, liveGate, paperHealth, setupRegistry, proof }) {
  const gates = buildReadinessGates({ payload, liveGate, paperHealth, setupRegistry, proof });
  const passCount = gates.filter((gate) => gate.status === 'pass').length;
  const failCount = gates.filter((gate) => gate.status === 'fail').length;
  const warnCount = gates.filter((gate) => gate.status === 'warn').length;
  const readiness = payload?.readyForLive ? 'READY FOR SMALL LIVE TEST' : failCount ? 'NOT READY' : 'REVIEW REQUIRED';

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Live Readiness Dashboard</div>
          <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{readiness}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">This gate is informational only. It does not enable exchange orders or approve live trading.</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md border border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 px-3 py-2 text-[var(--accent-green)]">
            <div className="font-mono text-lg font-semibold">{passCount}</div>
            <div>Pass</div>
          </div>
          <div className="rounded-md border border-[var(--accent-yellow)]/25 bg-[var(--accent-yellow)]/10 px-3 py-2 text-[var(--accent-yellow)]">
            <div className="font-mono text-lg font-semibold">{warnCount}</div>
            <div>Warn</div>
          </div>
          <div className="rounded-md border border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 px-3 py-2 text-[var(--accent-red)]">
            <div className="font-mono text-lg font-semibold">{failCount}</div>
            <div>Fail</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {gates.map((gate) => <ReadinessGate key={gate.label} gate={gate} />)}
      </div>
      <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
        Next safe action: keep live execution stubbed, collect durable paper evidence, and only review small-live readiness after every fail gate reaches pass.
      </div>
    </section>
  );
}

function OperatorNudge({ paperHealth }) {
  const nudges = [];

  if (paperHealth?.storageAuthority !== 'AUTHORITATIVE') {
    nudges.push('Paper data cannot count until storage is authoritative.');
  }
  if (paperHealth?.snapshotFreshness === 'MISSING' || paperHealth?.snapshotFreshness === 'STALE') {
    nudges.push('Run npm run proof:snapshot to capture today\'s durable proof snapshot.');
  }
  if ((paperHealth?.approvedOpenTrades ?? 0) === 0 && (paperHealth?.approvedClosedTrades ?? 0) === 0) {
    nudges.push('No approved paper trades yet. Continue monitoring BTC/USDT 1h only.');
  }

  if (!nudges.length) {
    return null;
  }

  return (
    <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--accent-yellow)]">
      {nudges.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </div>
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
  const paperHealth = payload?.paperHealth;
  const setupRegistry = payload?.setupRegistry;
  const stats = liveGate?.stats ?? {};
  const strategy = payload?.strategy ?? liveGate?.strategy ?? paperHealth ?? {};

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

        <LiveReadinessDashboard
          payload={payload}
          liveGate={liveGate}
          paperHealth={paperHealth}
          setupRegistry={setupRegistry}
          proof={proof}
        />

        <section className={`rounded-lg border px-4 py-4 ${toneClass(payload?.verdict)}`}>
          <div className="text-lg font-semibold">{payload?.verdict ?? 'NOT READY'}</div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            {payload?.readyForLive
              ? 'All proof gates currently pass.'
              : 'Not ready for live trading. Collecting authoritative paper data.'}
          </div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            ATR TP/SL changed the active risk model. Official proof is now versioned. Old records are historical and do not count toward the current ATR proof gate.
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10">
          <div className="border-b border-[var(--accent-yellow)]/20 px-4 py-3 text-sm font-semibold text-[var(--accent-yellow)]">Active Strategy Version</div>
          <div className="grid gap-3 p-4 text-sm text-[var(--text-secondary)] md:grid-cols-2 xl:grid-cols-4">
            <div>Version: {strategy.strategyVersion ?? stats.strategyVersion ?? '--'}</div>
            <div>Risk Model: {strategy.riskModel ?? stats.riskModel ?? '--'}</div>
            <div>Official Paper Day 1: {paperHealth?.officialPaperTrackingStartDate ?? stats.officialPaperTrackingStartDate ?? 'PENDING_SETUP_APPROVAL'}</div>
            <div>Paper Tracking Status: {paperHealth?.officialPaperTrackingStatus ?? stats.officialPaperTrackingStatus ?? 'PENDING_SETUP_APPROVAL'}</div>
            <div>Current verdict: NOT READY</div>
            <div>Previous history excluded: {paperHealth?.previousPaperHistoryExcluded || (stats.excludedHistoricalCount ?? 0) > 0 ? 'yes' : 'yes'}</div>
            <div>Historical excluded records: {paperHealth?.excludedHistoricalCount ?? stats.excludedHistoricalCount ?? 0}</div>
            <div>Activated At: {strategy.activatedAt ?? stats.activatedAt ?? '--'}</div>
            <div>Signal Logic: {strategy.signalLogicVersion ?? stats.signalLogicVersion ?? '--'}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-semibold">Paper Tracking Health</div>
          <div className="grid gap-3 p-4 text-sm text-[var(--text-secondary)] md:grid-cols-2 xl:grid-cols-4">
            <div>Storage: {paperHealth?.storageAuthority ?? liveGate?.storage?.authority ?? 'LOCAL_ONLY'}</div>
            <div>Active Strategy Version: {paperHealth?.strategyVersion ?? stats.strategyVersion ?? '--'}</div>
            <div>Risk Model: {paperHealth?.riskModel ?? stats.riskModel ?? '--'}</div>
            <div>Official Day 1: {paperHealth?.officialPaperTrackingStartDate ?? 'PENDING_SETUP_APPROVAL'}</div>
            <div>Paper Tracking Status: {paperHealth?.officialPaperTrackingStatus ?? stats.officialPaperTrackingStatus ?? 'PENDING_SETUP_APPROVAL'}</div>
            <div>Paper Duration: {paperHealth?.daysElapsed ?? stats.paperDurationElapsedDays ?? 0} / {paperHealth?.minimumDays ?? stats.paperDurationMinDays ?? 28} days</div>
            <div>Days Remaining: {paperHealth?.daysRemaining ?? stats.paperDurationRemainingDays ?? 28}</div>
            <div>Approved closed trades: {paperHealth?.approvedClosedTrades ?? stats.approvedPaperTradesClosed ?? 0}</div>
            <div>Approved open trades: {paperHealth?.approvedOpenTrades ?? stats.approvedPaperTradesOpen ?? 0}</div>
            <div>Observation-only signals: {paperHealth?.observationOnlyCount ?? stats.observationOnlyCount ?? 0}</div>
            <div>Rejected/blocked signals: {(paperHealth?.rejectedSetupCount ?? stats.rejectedSetupCount ?? 0) + (paperHealth?.blockedSignalCount ?? stats.blockedSignalCount ?? 0)}</div>
            <div>Last approved paper trade: {paperHealth?.lastApprovedPaperTradeAt ? new Date(paperHealth.lastApprovedPaperTradeAt).toLocaleString('id-ID') : '--'}</div>
            <div>Last proof snapshot: {paperHealth?.lastSnapshotAt ? new Date(paperHealth.lastSnapshotAt).toLocaleString('id-ID') : '--'}</div>
            <div>Snapshot freshness: {paperHealth?.snapshotFreshness ?? 'MISSING'}</div>
            <div>Live execution: {paperHealth?.liveExecutionStatus ?? 'UNKNOWN'}</div>
            <div>Current verdict: NOT READY</div>
            <div>Eligible setup: BTC/USDT 1h only</div>
          </div>
          <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            ATR TP/SL changed the active risk model. Official proof is now versioned. Old records are historical and do not count toward the current ATR proof gate.
          </div>
          <OperatorNudge paperHealth={paperHealth} />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Official Day 1</div>
            <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
              {stats.officialPaperTrackingStartDate ?? 'PENDING_SETUP_APPROVAL'}
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
