import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLiveGate } from '../src/lib/liveGate.js';
import { activeStrategy, strategyVersion } from '../src/config/strategyVersion.js';

const OFFICIAL_START = Date.parse('2026-04-30T00:00:00.000Z');
const AFTER_28_DAYS = OFFICIAL_START + 29 * 24 * 60 * 60 * 1000;

function makeTrades({
  count = 30,
  wins = 18,
  rWin = 1.4,
  rLoss = -0.6,
  validity = 'VALID',
  start = OFFICIAL_START,
  spacingMs = 24 * 60 * 60 * 1000,
  approved = true,
  paperCategory = 'PAPER_ELIGIBLE',
  setupStatus = 'APPROVED_FOR_PAPER',
  direction = 'LONG',
} = {}) {
  return Array.from({ length: count }).map((_, index) => {
    const isWin = index < wins;
    return {
      id: `trade-${index}`,
      pair: index % 2 ? 'BTCUSDT' : 'ETHUSDT',
      timeframe: index % 3 ? '15m' : '1h',
      ...activeStrategy,
      signalValidity: validity,
      setupStatus,
      paperCategory,
      direction,
      isApprovedPaperTrade: approved,
      status: isWin ? 'WIN' : 'LOSS',
      realizedR: isWin ? rWin : rLoss,
      timestamp: start + index * spacingMs,
      openedAt: new Date(start + index * spacingMs).toISOString(),
      exitTimestamp: start + index * spacingMs + 60_000,
    };
  });
}

function passingContext(overrides = {}) {
  return {
    trades: makeTrades({ count: 30, wins: 18, rWin: 1.3, rLoss: -0.3 }),
    oosDegradation: 0.1,
    storage: { durable: true, warning: '' },
    nowMs: AFTER_28_DAYS,
    backtestComparison: {
      strategyVersion,
      summaryStrategyVersion: strategyVersion,
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      oosDegradation: 0.1,
      divergenceWarning: '',
    },
    ...overrides,
  };
}

test('evaluateLiveGate passes when all criteria are met', () => {
  const result = evaluateLiveGate(passingContext());

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.includes('PAPER_TRACKING_NOT_STARTED (PENDING_SETUP_APPROVAL)'));
});

test('evaluateLiveGate excludes pre-start-date paper trades', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({
      count: 30,
      wins: 18,
      rWin: 1.3,
      rLoss: -0.3,
      start: OFFICIAL_START - 40 * 24 * 60 * 60 * 1000,
    }),
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MIN_CLOSED_TRADES')));
});

test('evaluateLiveGate excludes observation-only trades', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({
      count: 30,
      wins: 18,
      approved: false,
      paperCategory: 'OBSERVATION_ONLY',
      setupStatus: 'COLLECT_MORE_DATA',
    }),
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.equal(result.stats.observationOnlyCount, 30);
});

test('evaluateLiveGate excludes rejected setup trades', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({
      count: 30,
      wins: 18,
      approved: false,
      paperCategory: 'REJECTED_SETUP',
      setupStatus: 'REJECTED_OOS_FAILURE',
    }),
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.equal(result.stats.rejectedSetupCount, 30);
});

test('evaluateLiveGate excludes blocked signals', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({
      count: 30,
      wins: 18,
      approved: false,
      validity: 'BLOCKED',
      paperCategory: 'BLOCKED_SIGNAL',
      setupStatus: 'APPROVED_FOR_PAPER',
    }),
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.equal(result.stats.blockedSignalCount, 30);
});

test('evaluateLiveGate excludes invalid approved-looking records', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 18 }).map((trade) => ({
      ...trade,
      recordQuality: 'INVALID',
    })),
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MIN_CLOSED_TRADES')));
});

test('evaluateLiveGate excludes approved-looking trades when storage is non-durable', () => {
  const result = evaluateLiveGate(passingContext({
    storage: { durable: false, warning: 'Storage is using /tmp fallback.' },
  }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.ok(result.failedCriteria.includes('STORAGE_NOT_DURABLE'));
});

test('evaluateLiveGate exposes countdown fields', () => {
  const result = evaluateLiveGate(passingContext({
    nowMs: OFFICIAL_START + 9 * 24 * 60 * 60 * 1000,
  }));

  assert.equal(result.stats.officialPaperTrackingStartDate, null);
  assert.equal(result.stats.officialPaperTrackingStatus, 'PENDING_SETUP_APPROVAL');
  assert.equal(result.stats.paperDurationElapsedDays, 0);
  assert.equal(result.stats.paperDurationRemainingDays, 28);
});

test('evaluateLiveGate fails minimum trade count gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 20, wins: 12, rWin: 1.3, rLoss: -0.3 }),
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MIN_CLOSED_TRADES')));
});

test('evaluateLiveGate fails with zero closed trades', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 18 }).map((trade) => ({
      ...trade,
      status: 'OPEN',
      realizedR: null,
      rResult: null,
      exitTimestamp: null,
    })),
  }));

  assert.equal(result.ready, false);
  assert.equal(result.stats.totalClosedTrades, 0);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MIN_CLOSED_TRADES')));
});

test('evaluateLiveGate fails win rate gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 10, rWin: 1.3, rLoss: -0.2 }),
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('WIN_RATE')));
});

test('evaluateLiveGate fails expectancy gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 16, rWin: 0.7, rLoss: -0.3 }),
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('EXPECTANCY')));
});

test('evaluateLiveGate fails max drawdown gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 18, rWin: 0.6, rLoss: -8 }),
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.includes('PAPER_TRACKING_NOT_STARTED (PENDING_SETUP_APPROVAL)'));
});

test('evaluateLiveGate fails OOS degradation gate', () => {
  const result = evaluateLiveGate(passingContext({
    oosDegradation: 0.2,
    backtestComparison: {
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      strategyVersion,
      summaryStrategyVersion: strategyVersion,
      oosDegradation: 0.2,
      divergenceWarning: '',
    },
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('OOS_DEGRADATION')));
});

test('evaluateLiveGate excludes old version trades from ATR proof', () => {
  const oldVersionTrades = makeTrades({ count: 30, wins: 18 }).map((trade) => ({
    ...trade,
    strategyVersion: 'v1.0',
    riskModel: 'Fixed percentage TP/SL',
  }));
  const result = evaluateLiveGate(passingContext({ trades: oldVersionTrades }));

  assert.equal(result.stats.totalClosedTrades, 0);
  assert.equal(result.stats.excludedHistoricalCount, 30);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MIN_CLOSED_TRADES')));
});

test('evaluateLiveGate does not mark ATR live ready without fresh backtest proof', () => {
  const result = evaluateLiveGate(passingContext({
    backtestComparison: {
      strategyVersion,
      summaryStrategyVersion: 'v1.0',
      proofStatus: 'STALE_STRATEGY_VERSION',
      oosDegradation: null,
      divergenceWarning: 'Latest proof is stale.',
    },
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.includes(`FRESH_ATR_BACKTEST_REQUIRED (${strategyVersion})`));
  assert.ok(result.failedCriteria.some((item) => item.startsWith('BACKTEST_PROOF')));
});

test('evaluateLiveGate fails paper duration gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 18, spacingMs: 60_000 }),
    nowMs: OFFICIAL_START + 60_000,
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('PAPER_DURATION')));
});

test('evaluateLiveGate fails when storage is non-durable', () => {
  const result = evaluateLiveGate(passingContext({
    storage: { durable: false, warning: 'Storage is using /tmp fallback.' },
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.includes('STORAGE_NOT_DURABLE'));
});
