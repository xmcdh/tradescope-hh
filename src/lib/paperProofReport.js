import { OFFICIAL_PAPER_SETUPS, calculatePaperTrackingCountdown } from '../config/paperTrackingConfig.js';
import { loadLiveGate } from './liveGate.js';
import { summarizePaperHealth } from './paperHealth.js';
import { readPaperTrades } from './paperTrader.js';
import { readProofSnapshots, writeProofSnapshot } from './storageAdapter.js';

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function summarizeCategory(trades, predicate) {
  const list = trades.filter(predicate);
  const closed = list.filter((trade) => ['WIN', 'LOSS', 'EXPIRED'].includes(trade.status));
  const wins = closed.filter((trade) => trade.status === 'WIN').length;
  const returns = closed.map((trade) => Number(trade.realizedR ?? 0)).filter(Number.isFinite);
  const expectancy = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;

  return {
    total: list.length,
    open: list.filter((trade) => trade.status === 'OPEN').length,
    closed: closed.length,
    winRate: closed.length ? round(wins / closed.length) : 0,
    expectancy: round(expectancy),
  };
}

export async function buildPaperProofReport({ now = new Date() } = {}) {
  const trades = await readPaperTrades();
  const snapshots = await readProofSnapshots();
  const liveGate = await loadLiveGate();
  const countdown = calculatePaperTrackingCountdown(now.getTime());
  const snapshotDate = now.toISOString().slice(0, 10);
  const snapshotId = `daily-paper-proof:${snapshotDate}`;
  const approved = summarizeCategory(
    trades,
    (trade) =>
      trade.isApprovedPaperTrade === true &&
      trade.paperCategory === 'PAPER_ELIGIBLE' &&
      trade.signalValidity === 'VALID' &&
      trade.setupStatus === 'APPROVED_FOR_PAPER' &&
      trade.recordQuality !== 'INVALID',
  );
  const observationOnly = summarizeCategory(trades, (trade) => trade.paperCategory === 'OBSERVATION_ONLY');
  const rejected = summarizeCategory(trades, (trade) => trade.paperCategory === 'REJECTED_SETUP');
  const blocked = summarizeCategory(trades, (trade) => trade.paperCategory === 'BLOCKED_SIGNAL');

  return {
    snapshotId,
    snapshotDate,
    source: 'manual',
    generatedAt: now.toISOString(),
    currentDate: snapshotDate,
    officialPaperTrackingStartDate: countdown.officialPaperTrackingStartDate,
    countdown,
    paperHealth: summarizePaperHealth({
      trades,
      snapshots,
      liveGate,
      storage: liveGate.storage,
      now,
    }),
    storage: liveGate.storage,
    eligibleSetups: OFFICIAL_PAPER_SETUPS,
    approvedOnlyMetrics: {
      total: liveGate.stats.totalSignals,
      open: liveGate.stats.approvedPaperTradesOpen,
      closed: liveGate.stats.approvedPaperTradesClosed,
      winRate: round(liveGate.stats.winRate),
      expectancy: round(liveGate.stats.expectancy),
      maxDrawdown: round(liveGate.stats.maxDrawdown),
      durationDays: liveGate.stats.authoritativeDurationDays,
      remainingDays: liveGate.stats.paperDurationRemainingDays,
    },
    categoryBreakdown: {
      approved,
      observationOnly,
      rejected,
      blocked,
    },
    liveGate,
    finalVerdict: 'NOT READY',
    whyNotReady: liveGate.failedCriteria,
    nextRequiredMilestone:
      countdown.remainingDays > 0
        ? `Complete ${countdown.remainingDays} more day(s) of authoritative approved-only paper tracking.`
        : 'Meet minimum closed trades and performance gates with authoritative approved-only paper data.',
  };
}

export function paperProofReportMarkdown(report) {
  const setupLines = report.eligibleSetups.map(
    (setup) => `- ${setup.pair} ${setup.timeframe}: ${setup.setupStatus} (${setup.recommendation})`,
  );
  const failed = report.whyNotReady.length ? report.whyNotReady.map((item) => `- ${item}`) : ['- No failed gate reported.'];

  return `${[
    '# TradeScope Paper Trading Proof Report',
    '',
    `Generated at: ${report.generatedAt}`,
    `Current date: ${report.currentDate ?? report.generatedAt?.slice?.(0, 10) ?? '--'}`,
    `Snapshot ID: ${report.snapshotId ?? '--'}`,
    `Source: ${report.source ?? 'manual'}`,
    `Official Paper Tracking Day 1: ${report.officialPaperTrackingStartDate}`,
    `Final verdict: ${report.finalVerdict}`,
    `Next required milestone: ${report.nextRequiredMilestone ?? '--'}`,
    '',
    '## Storage Authority',
    `- Mode: ${report.storage?.mode ?? '--'}`,
    `- Provider: ${report.storage?.provider ?? '--'}`,
    `- Can connect: ${report.storage?.canConnect ? 'yes' : 'no'}`,
    `- Authority: ${report.storage?.authority ?? '--'}`,
    `- Durable: ${report.storage?.durable ? 'yes' : 'no'}`,
    '',
    '## Eligible Setup List',
    ...setupLines,
    '',
    '## Approved-Only Paper Metrics',
    `- Paper duration: ${report.approvedOnlyMetrics.durationDays} / ${report.countdown.minDays} days`,
    `- Days remaining: ${report.approvedOnlyMetrics.remainingDays}`,
    `- Approved open trades: ${report.approvedOnlyMetrics.open}`,
    `- Approved closed trades: ${report.approvedOnlyMetrics.closed}`,
    `- Win rate: ${(report.approvedOnlyMetrics.winRate * 100).toFixed(2)}%`,
    `- Expectancy: ${report.approvedOnlyMetrics.expectancy}R`,
    `- Max drawdown: ${(report.approvedOnlyMetrics.maxDrawdown * 100).toFixed(2)}%`,
    '',
    '## Separate Non-Gate Counts',
    `- Observation-only total: ${report.categoryBreakdown.observationOnly.total}`,
    `- Rejected setup total: ${report.categoryBreakdown.rejected.total}`,
    `- Blocked signal total: ${report.categoryBreakdown.blocked.total}`,
    `- Last approved paper trade: ${report.paperHealth?.lastApprovedPaperTradeAt ?? '--'}`,
    `- Last observation signal: ${report.paperHealth?.lastObservationSignalAt ?? '--'}`,
    `- Last proof snapshot: ${report.paperHealth?.lastSnapshotAt ?? '--'}`,
    '',
    '## Live Gate Checklist',
    ...failed,
    '',
    'Live execution remains stubbed.',
  ].join('\n')}\n`;
}

export async function writeDailyProofSnapshot() {
  const report = await buildPaperProofReport();
  await writeProofSnapshot({
    id: report.snapshotId,
    verdict: report.finalVerdict,
    generatedAt: report.generatedAt,
    approvedSetupCount: report.eligibleSetups.filter((setup) => setup.setupStatus === 'APPROVED_FOR_PAPER').length,
    collectingDataSetupCount: report.eligibleSetups.filter((setup) => setup.setupStatus === 'COLLECT_MORE_DATA').length,
    rejectedSetupCount: report.eligibleSetups.filter((setup) => setup.setupStatus.startsWith('REJECTED')).length,
    storageStatus: report.storage?.code ?? 'UNKNOWN',
    sourceBatchFilename: '',
    sourceReportFilename: 'paper-results/report.json',
    snapshotDate: report.snapshotDate,
    source: report.source,
    payloadJson: report,
    createdAt: report.generatedAt,
    updatedAt: report.generatedAt,
  });

  return report;
}
