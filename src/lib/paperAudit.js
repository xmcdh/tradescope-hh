import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL_PAPER_SETUPS,
  calculatePaperTrackingCountdown,
  officialPaperTrackingStartTimestamp,
} from '../config/paperTrackingConfig.js';
import { loadLiveGate } from './liveGate.js';
import { loadPaperHealth, summarizePaperHealth } from './paperHealth.js';
import { readPaperTrades, validatePaperTradeRecord } from './paperTrader.js';
import { getStorageStatus, readProofSnapshots } from './storageAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WEEKLY_OUTPUT_DIR = path.join(PROJECT_ROOT, 'paper-results');

function normalizePair(pair) {
  const text = String(pair ?? '').toUpperCase();
  if (text.includes('/')) {
    return text;
  }
  if (text.endsWith('USDT')) {
    return `${text.slice(0, -4)}/USDT`;
  }
  return text;
}

function normalizeTimeframe(timeframe) {
  return String(timeframe ?? '').toLowerCase();
}

function tradeTimestamp(trade) {
  const openedAt = Date.parse(trade?.openedAt ?? '');
  if (Number.isFinite(openedAt)) {
    return openedAt;
  }
  return Number.isFinite(trade?.timestamp) ? trade.timestamp : null;
}

function isApprovedLooking(trade) {
  return trade?.isApprovedPaperTrade === true || trade?.paperCategory === 'PAPER_ELIGIBLE';
}

function isApprovedOfficialPaperTrade(trade) {
  return (
    trade?.isApprovedPaperTrade === true &&
    trade?.paperCategory === 'PAPER_ELIGIBLE' &&
    trade?.signalValidity === 'VALID' &&
    trade?.setupStatus === 'APPROVED_FOR_PAPER' &&
    trade?.recordQuality !== 'INVALID' &&
    ['LONG', 'SHORT'].includes(trade?.direction) &&
    normalizePair(trade?.pair) === 'BTC/USDT' &&
    normalizeTimeframe(trade?.timeframe) === '1h' &&
    Number.isFinite(tradeTimestamp(trade)) &&
    tradeTimestamp(trade) >= officialPaperTrackingStartTimestamp()
  );
}

function addAnomaly(anomalies, code, message, trade = null) {
  anomalies.push({
    code,
    message,
    tradeId: trade?.id ?? null,
    pair: trade?.pair ?? null,
    timeframe: trade?.timeframe ?? null,
  });
}

export function detectPaperAuditAnomalies({
  trades = [],
  storage = null,
  paperHealth = null,
  liveExecutionStatus = 'STUBBED',
} = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const anomalies = [];

  if (!storage?.authoritative && !storage?.durable) {
    addAnomaly(anomalies, 'STORAGE_NOT_AUTHORITATIVE', 'Storage is not authoritative.');
  }

  list.filter(isApprovedLooking).forEach((trade) => {
    const validation = validatePaperTradeRecord(trade);
    if (!validation.valid) {
      addAnomaly(anomalies, 'INVALID_APPROVED_FIELDS', `Approved-looking trade has invalid fields: ${validation.issues.join(', ')}`, trade);
    }

    if (String(trade.setupStatus ?? '').startsWith('REJECTED') || trade.paperCategory === 'REJECTED_SETUP') {
      addAnomaly(anomalies, 'REJECTED_SETUP_COUNTED_APPROVED', 'Rejected setup is marked as approved-looking.', trade);
    }

    if (trade.signalValidity === 'BLOCKED' || trade.paperCategory === 'BLOCKED_SIGNAL') {
      addAnomaly(anomalies, 'BLOCKED_SIGNAL_COUNTED_APPROVED', 'Blocked signal is marked as approved-looking.', trade);
    }

    if (trade.signalValidity === 'MARGINAL') {
      addAnomaly(anomalies, 'MARGINAL_SIGNAL_COUNTED_APPROVED', 'Marginal signal is marked as approved-looking.', trade);
    }

    if (normalizePair(trade.pair) === 'ETH/USDT' && normalizeTimeframe(trade.timeframe) === '1h') {
      addAnomaly(anomalies, 'ETH_OBSERVATION_COUNTED_APPROVED', 'ETH/USDT 1h must remain observation-only.', trade);
    }

    if (normalizePair(trade.pair) === 'SOL/USDT' && normalizeTimeframe(trade.timeframe) === '15m') {
      addAnomaly(anomalies, 'SOL_REJECTED_COUNTED_APPROVED', 'SOL/USDT 15m must remain rejected.', trade);
    }

    const timestamp = tradeTimestamp(trade);
    if (!Number.isFinite(timestamp) || timestamp < officialPaperTrackingStartTimestamp()) {
      addAnomaly(anomalies, 'PRE_START_TRADE_COUNTED', 'Pre-start or undated trade is marked as approved-looking.', trade);
    }

    if (trade.storageMode === 'local-json' || trade.storageAuthority === 'LOCAL_ONLY' || trade.source === 'local-json') {
      addAnomaly(anomalies, 'LOCAL_JSON_RECORD_COUNTED', 'Local JSON record is marked as approved-looking.', trade);
    }

    if (!isApprovedOfficialPaperTrade(trade)) {
      addAnomaly(anomalies, 'NON_OFFICIAL_APPROVED_SHAPE', 'Approved-looking trade does not match official BTC/USDT 1h approved-only rules.', trade);
    }
  });

  if (paperHealth?.snapshotFreshness !== 'FRESH') {
    addAnomaly(
      anomalies,
      'SNAPSHOT_NOT_FRESH',
      paperHealth?.snapshotFreshness === 'STALE'
        ? 'Latest proof snapshot is older than today.'
        : 'No proof snapshot exists for the current day.',
    );
  }

  if (liveExecutionStatus !== 'STUBBED') {
    addAnomaly(anomalies, 'LIVE_EXECUTION_NOT_STUBBED', 'Live execution status is not STUBBED.');
  }

  return anomalies;
}

export function formatDailyPaperCheck(health) {
  const rejectedBlocked = (health.rejectedSetupCount ?? 0) + (health.blockedSignalCount ?? 0);
  const nextAction = !health.storageDurable
    ? 'Restore authoritative database storage before counting paper data.'
    : health.snapshotFreshness !== 'FRESH'
      ? 'Run npm run proof:snapshot to capture today\'s durable proof snapshot.'
      : 'Continue collecting approved BTC/USDT 1h paper trades.';

  return [
    `Storage: ${health.storageAuthority ?? 'LOCAL_ONLY'}`,
    `Paper Day: ${health.currentDay ?? 0} / ${health.minimumDays ?? 28}`,
    `Days Elapsed: ${health.daysElapsed ?? 0}`,
    `Days Remaining: ${health.daysRemaining ?? 28}`,
    `Approved Closed Trades: ${health.approvedClosedTrades ?? 0} / 30`,
    `Approved Open Trades: ${health.approvedOpenTrades ?? 0}`,
    `Observation Only: ${health.observationOnlyCount ?? 0}`,
    `Rejected/Blocked: ${rejectedBlocked}`,
    `Last Approved Paper Trade: ${health.lastApprovedPaperTradeAt ?? '--'}`,
    `Last Observation Signal: ${health.lastObservationSignalAt ?? '--'}`,
    `Last Proof Snapshot: ${health.lastSnapshotAt ?? '--'}`,
    `Snapshot Freshness: ${health.snapshotFreshness ?? 'MISSING'}`,
    `Live Execution: ${health.liveExecutionStatus ?? 'UNKNOWN'}`,
    `Verdict: ${health.globalVerdict ?? 'NOT READY'}`,
    `Next Action: ${nextAction}`,
  ].join('\n');
}

export async function buildDailyPaperCheck({ now = new Date() } = {}) {
  const health = await loadPaperHealth({ now });
  return {
    health,
    output: formatDailyPaperCheck(health),
  };
}

function markdownAudit(report) {
  const setupLines = report.approvedSetupList.map((setup) => `- ${setup.pair} ${setup.timeframe}: ${setup.setupStatus}`);
  const gateLines = report.gateChecklist.length ? report.gateChecklist.map((item) => `- ${item}`) : ['- No failed gate reported.'];
  const anomalyLines = report.anomalies.length
    ? report.anomalies.map((item) => `- ${item.code}: ${item.message}${item.tradeId ? ` (${item.tradeId})` : ''}`)
    : ['- None'];

  return `${[
    '# TradeScope Weekly Paper Audit',
    '',
    `Generated at: ${report.generatedAt}`,
    `Date range: ${report.dateRange.from} to ${report.dateRange.to}`,
    `Storage authority: ${report.storage.authority}`,
    `Official Paper Tracking Day 1: ${report.officialPaperTrackingStartDate}`,
    `Paper duration: ${report.daysElapsed} / ${report.minimumDays} days`,
    `Days remaining: ${report.daysRemaining}`,
    `Final verdict: ${report.globalVerdict}`,
    '',
    '## Approved Setup List',
    ...setupLines,
    '',
    '## Approved-Only Metrics',
    `- Open trades: ${report.approvedOnlyMetrics.open}`,
    `- Closed trades: ${report.approvedOnlyMetrics.closed}`,
    `- Win rate: ${(report.approvedOnlyMetrics.winRate * 100).toFixed(2)}%`,
    `- Expectancy: ${report.approvedOnlyMetrics.expectancy}R`,
    `- Max drawdown: ${(report.approvedOnlyMetrics.maxDrawdown * 100).toFixed(2)}%`,
    '',
    '## Non-Gate Counts',
    `- Observation-only: ${report.nonGateCounts.observationOnly}`,
    `- Rejected setup: ${report.nonGateCounts.rejectedSetup}`,
    `- Blocked signal: ${report.nonGateCounts.blockedSignal}`,
    '',
    '## Gate Checklist',
    ...gateLines,
    '',
    '## Anomalies',
    ...anomalyLines,
    '',
    `Next recommended action: ${report.nextRecommendedAction}`,
    '',
    'Live execution remains stubbed.',
  ].join('\n')}\n`;
}

export async function buildWeeklyPaperAudit({ now = new Date() } = {}) {
  const [trades, snapshots, storage, liveGate] = await Promise.all([
    readPaperTrades(),
    readProofSnapshots(),
    getStorageStatus(),
    loadLiveGate(),
  ]);
  const health = summarizePaperHealth({ trades, snapshots, liveGate, storage, now });
  const countdown = calculatePaperTrackingCountdown(now.getTime());
  const anomalies = detectPaperAuditAnomalies({
    trades,
    storage,
    paperHealth: health,
    liveExecutionStatus: health.liveExecutionStatus,
  });
  const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  return {
    generatedAt: now.toISOString(),
    dateRange: { from, to },
    storage: {
      authority: storage.authority,
      mode: storage.mode,
      provider: storage.provider,
      canConnect: storage.canConnect,
      durable: storage.durable,
    },
    officialPaperTrackingStartDate: countdown.officialPaperTrackingStartDate,
    daysElapsed: countdown.elapsedDays,
    daysRemaining: countdown.remainingDays,
    minimumDays: countdown.minDays,
    approvedSetupList: OFFICIAL_PAPER_SETUPS,
    approvedOnlyMetrics: {
      open: liveGate.stats.approvedPaperTradesOpen,
      closed: liveGate.stats.approvedPaperTradesClosed,
      winRate: liveGate.stats.winRate,
      expectancy: liveGate.stats.expectancy,
      maxDrawdown: liveGate.stats.maxDrawdown,
    },
    nonGateCounts: {
      observationOnly: health.observationOnlyCount,
      rejectedSetup: health.rejectedSetupCount,
      blockedSignal: health.blockedSignalCount,
    },
    gateChecklist: liveGate.failedCriteria,
    anomalies,
    paperHealth: health,
    globalVerdict: 'NOT READY',
    nextRecommendedAction:
      anomalies.length > 0
        ? 'Review anomalies before relying on paper data.'
        : 'Continue approved-only BTC/USDT 1h paper tracking.',
  };
}

export function weeklyPaperAuditMarkdown(report) {
  return markdownAudit(report);
}

export async function writeWeeklyPaperAudit({ now = new Date(), outputDir = WEEKLY_OUTPUT_DIR } = {}) {
  const report = await buildWeeklyPaperAudit({ now });
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'weekly-audit.json');
  const markdownPath = path.join(outputDir, 'weekly-audit.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, weeklyPaperAuditMarkdown(report));
  return { report, jsonPath, markdownPath };
}
