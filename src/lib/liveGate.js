import fs from 'node:fs/promises';
import path from 'node:path';
import { readPaperTrades, getPaperTradeStorageStatus } from './paperTrader.js';
import {
  calculatePaperTrackingCountdown,
  officialPaperTrackingStartTimestamp,
  OFFICIAL_PAPER_TRACKING_MIN_DAYS,
} from '../config/paperTrackingConfig.js';

const MIN_CLOSED_TRADES = 30;
const MIN_PAPER_DURATION_DAYS = OFFICIAL_PAPER_TRACKING_MIN_DAYS;
const WIN_RATE_THRESHOLD = 0.45;
const EXPECTANCY_THRESHOLD = 0.3;
const MAX_DRAWDOWN_THRESHOLD = 0.15;
const OOS_DEGRADATION_THRESHOLD = 0.15;

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function equityDrawdownRatio(values) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  values.forEach((value) => {
    equity *= 1 + value * 0.01;
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
  });

  return maxDrawdown;
}

function closedTradesOnly(trades) {
  return trades.filter((trade) => ['WIN', 'LOSS', 'EXPIRED'].includes(trade.status));
}

function tradeTimestamp(trade) {
  const openedAt = Date.parse(trade.openedAt ?? trade.createdAt ?? '');
  if (Number.isFinite(openedAt)) {
    return openedAt;
  }

  return Number.isFinite(trade.timestamp) ? trade.timestamp : null;
}

function isApprovedOfficialTrade(trade, { storage }) {
  const timestamp = tradeTimestamp(trade);

  return (
    Boolean(storage?.durable) &&
    trade.isApprovedPaperTrade === true &&
    trade.paperCategory === 'PAPER_ELIGIBLE' &&
    trade.signalValidity === 'VALID' &&
    trade.setupStatus === 'APPROVED_FOR_PAPER' &&
    trade.recordQuality !== 'INVALID' &&
    ['LONG', 'SHORT'].includes(trade.direction) &&
    Number.isFinite(timestamp) &&
    timestamp >= officialPaperTrackingStartTimestamp()
  );
}

function computePaperStats(trades, options = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const countdown = calculatePaperTrackingCountdown(options.nowMs ?? Date.now());
  const approvedTrades = list.filter((trade) => isApprovedOfficialTrade(trade, options));
  const closed = closedTradesOnly(approvedTrades);
  const wins = closed.filter((trade) => trade.status === 'WIN').length;
  const returns = closed.map((trade) => Number(trade.realizedR ?? 0)).filter(Number.isFinite);
  const sortedByTime = [...approvedTrades].sort((left, right) => (tradeTimestamp(left) ?? 0) - (tradeTimestamp(right) ?? 0));
  const firstTimestamp = sortedByTime.length ? Math.max(tradeTimestamp(sortedByTime[0]) ?? countdown.startTimestamp, countdown.startTimestamp) : countdown.startTimestamp;
  const lastClosedTimestamp = closed
    .map((trade) => trade.exitTimestamp ?? tradeTimestamp(trade))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .at(-1) ?? null;
  const observationOnlyCount = list.filter((trade) => trade.paperCategory === 'OBSERVATION_ONLY').length;
  const rejectedSetupCount = list.filter((trade) => trade.paperCategory === 'REJECTED_SETUP').length;
  const blockedSignalCount = list.filter((trade) => trade.paperCategory === 'BLOCKED_SIGNAL').length;
  const marginalCount = list.filter((trade) => trade.signalValidity === 'MARGINAL').length;

  return {
    totalSignals: approvedTrades.length,
    totalClosedTrades: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    expectancy: mean(returns),
    avgR: mean(returns),
    maxDrawdown: equityDrawdownRatio(returns),
    openTrades: approvedTrades.filter((trade) => trade.status === 'OPEN').length,
    durationDays: countdown.elapsedDays,
    officialPaperTrackingStartDate: countdown.officialPaperTrackingStartDate,
    paperDurationElapsedDays: countdown.elapsedDays,
    paperDurationRemainingDays: countdown.remainingDays,
    paperDurationMinDays: countdown.minDays,
    startTimestamp: firstTimestamp,
    lastClosedTimestamp,
    approvedPaperTradesClosed: closed.length,
    approvedPaperTradesOpen: approvedTrades.filter((trade) => trade.status === 'OPEN').length,
    observationOnlyCount,
    rejectedSetupCount,
    blockedSignalCount,
    marginalCount,
    excludedCount: list.length - approvedTrades.length,
  };
}

function perSetupCounts(trades, options = {}) {
  const counts = new Map();

  closedTradesOnly(trades.filter((trade) => isApprovedOfficialTrade(trade, options))).forEach((trade) => {
    const key = `${trade.pair}:${trade.timeframe}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

async function readLatestBacktestSummary() {
  const directory = path.resolve(process.cwd(), 'backtest-results');

  try {
    const files = (await fs.readdir(directory))
      .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
      .map((file) => path.join(directory, file));

    if (!files.length) {
      return null;
    }

    const withStats = await Promise.all(
      files.map(async (file) => ({
        file,
        stat: await fs.stat(file),
      })),
    );

    const latest = withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    return JSON.parse(await fs.readFile(latest.file, 'utf8'));
  } catch {
    return null;
  }
}

function buildBacktestVsPaper(backtestSummary, paperStats) {
  const proof = backtestSummary?.proof;
  const setups = backtestSummary?.results ?? [];
  const backtestTrades = setups.reduce((sum, item) => sum + (item.backtest?.actionableClosedTradeCount ?? 0), 0);
  const weightedWinNumerator = setups.reduce(
    (sum, item) => sum + (item.backtest?.actionableWinRate ?? 0) * (item.backtest?.actionableClosedTradeCount ?? 0),
    0,
  );
  const weightedExpectancyNumerator = setups.reduce(
    (sum, item) => sum + (item.backtest?.actionableExpectancy ?? 0) * (item.backtest?.actionableClosedTradeCount ?? 0),
    0,
  );
  const weightedDrawdown = setups.length
    ? Math.max(...setups.map((item) => item.backtest?.actionableMaxDrawdown ?? 0))
    : 0;
  const backtestWinRate = backtestTrades ? weightedWinNumerator / backtestTrades / 100 : 0;
  const backtestExpectancy = backtestTrades ? weightedExpectancyNumerator / backtestTrades : 0;
  const oosDegradation = Math.max(
    0,
    ...setups.map((item) => item.validation?.comparison?.oosDegradation ?? 0).filter(Number.isFinite),
  );

  return {
    backtestClosedTrades: backtestTrades,
    backtestWinRate,
    backtestExpectancy,
    backtestMaxDrawdown: weightedDrawdown,
    proofStatus: proof?.status ?? 'UNKNOWN',
    oosDegradation,
    paperWinRate: paperStats.winRate,
    paperExpectancy: paperStats.expectancy,
    paperMaxDrawdown: paperStats.maxDrawdown,
    winRateDelta: paperStats.winRate - backtestWinRate,
    expectancyDelta: paperStats.expectancy - backtestExpectancy,
    maxDrawdownDelta: paperStats.maxDrawdown - weightedDrawdown,
    authoritative: false,
    divergenceWarning:
      paperStats.expectancy + 0.2 < backtestExpectancy || paperStats.winRate + 0.1 < backtestWinRate
        ? 'Paper performance is materially worse than the latest backtest proof.'
        : '',
  };
}

export function evaluateLiveGate({ trades, oosDegradation, backtestComparison = null, storage = null, slippageEstimate = null, nowMs = Date.now() }) {
  const baseStats = computePaperStats(trades ?? [], { storage, nowMs });
  const authoritativeDurationDays = storage?.durable ? baseStats.paperDurationElapsedDays : 0;
  const stats = {
    ...baseStats,
    oosDegradation: Number.isFinite(oosDegradation) ? oosDegradation : backtestComparison?.oosDegradation ?? null,
    authoritativeDurationDays,
    authoritativeStartDate: storage?.durable && Number.isFinite(baseStats.startTimestamp)
      ? new Date(baseStats.startTimestamp).toISOString()
      : null,
    slippageEstimate,
  };
  const failedCriteria = [];
  const durationPassed = authoritativeDurationDays >= MIN_PAPER_DURATION_DAYS;
  const setupSamples = perSetupCounts(trades ?? [], { storage });
  const suggestedSetupWarnings = Object.entries(setupSamples)
    .filter(([, count]) => count < 50)
    .map(([setup, count]) => `SETUP_SAMPLE_LOW (${setup} ${count}/50)`);

  if (stats.totalClosedTrades < MIN_CLOSED_TRADES) {
    failedCriteria.push(`MIN_CLOSED_TRADES (${stats.totalClosedTrades}/${MIN_CLOSED_TRADES})`);
  }

  if (!durationPassed) {
    failedCriteria.push(`PAPER_DURATION (${round(authoritativeDurationDays, 2)}/${MIN_PAPER_DURATION_DAYS} days)`);
  }

  if (stats.winRate < WIN_RATE_THRESHOLD) {
    failedCriteria.push(`WIN_RATE (${round(stats.winRate)} < ${WIN_RATE_THRESHOLD})`);
  }

  if (stats.expectancy < EXPECTANCY_THRESHOLD) {
    failedCriteria.push(`EXPECTANCY (${round(stats.expectancy)} < ${EXPECTANCY_THRESHOLD})`);
  }

  if (stats.maxDrawdown > MAX_DRAWDOWN_THRESHOLD) {
    failedCriteria.push(`MAX_DRAWDOWN (${round(stats.maxDrawdown)} > ${MAX_DRAWDOWN_THRESHOLD})`);
  }

  if (!Number.isFinite(stats.oosDegradation)) {
    failedCriteria.push('OOS_DEGRADATION unavailable');
  } else if (stats.oosDegradation > OOS_DEGRADATION_THRESHOLD) {
    failedCriteria.push(`OOS_DEGRADATION (${round(stats.oosDegradation)} > ${OOS_DEGRADATION_THRESHOLD})`);
  }

  if (backtestComparison?.proofStatus && backtestComparison.proofStatus !== 'PROVEN_READY_FOR_PAPER') {
    failedCriteria.push(`BACKTEST_PROOF (${backtestComparison.proofStatus})`);
  }

  if (backtestComparison?.divergenceWarning) {
    failedCriteria.push(`BACKTEST_PAPER_DIVERGENCE (${backtestComparison.divergenceWarning})`);
  }

  if (storage && !storage.durable) {
    failedCriteria.push('STORAGE_NOT_DURABLE');
  }

  return {
    ready: failedCriteria.length === 0,
    paperGatePassed: failedCriteria.length === 0,
    paperDurationPassed: durationPassed,
    failedCriteria,
    warnings: suggestedSetupWarnings,
    stats,
    backtestComparison: {
      ...backtestComparison,
      authoritative: Boolean(storage?.durable),
    },
    storage,
    thresholds: {
      minClosedTrades: MIN_CLOSED_TRADES,
      minPaperDurationDays: MIN_PAPER_DURATION_DAYS,
      winRate: WIN_RATE_THRESHOLD,
      expectancy: EXPECTANCY_THRESHOLD,
      maxDrawdown: MAX_DRAWDOWN_THRESHOLD,
      oosDegradation: OOS_DEGRADATION_THRESHOLD,
    },
    setupSamples,
  };
}

export async function loadLiveGate() {
  const trades = await readPaperTrades();
  const backtestSummary = await readLatestBacktestSummary();
  const storage = await getPaperTradeStorageStatus();
  const paperStats = computePaperStats(trades);
  const backtestComparison = buildBacktestVsPaper(backtestSummary, paperStats);

  return evaluateLiveGate({
    trades,
    oosDegradation: backtestComparison.oosDegradation,
    backtestComparison,
    storage,
    slippageEstimate: null,
  });
}
