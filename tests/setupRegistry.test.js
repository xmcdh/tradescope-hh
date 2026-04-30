import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupRegistry,
  classifySignalForPaper,
  mapProofStatusToSetupStatus,
  SETUP_STATUS,
  PAPER_CATEGORY,
} from '../src/lib/setupRegistry.js';
import { createPaperTradeRecord, validatePaperTradeRecord } from '../src/lib/paperTrader.js';
import { activeStrategy, strategyVersion } from '../src/config/strategyVersion.js';

function summaryWithSetups(setups) {
  return {
    generatedAt: '2026-04-29T00:00:00.000Z',
    metadata: {
      ...activeStrategy,
    },
    proof: {
      ...activeStrategy,
      status: 'FAILED_OOS',
      setups,
    },
    results: setups.map((setup) => ({
      pair: setup.metrics.pair,
      timeframe: setup.metrics.timeframe,
      validation: {
        flags: setup.status === 'FAILED_OOS' ? ['OOS_EXPECTANCY_NEGATIVE'] : [],
      },
    })),
  };
}

function makeProofSetup({ pair, timeframe, status, expectancy = 0.4, winRate = 52, maxDrawdown = 0.08, oosDegradation = 0.1 }) {
  return {
    status,
    failedCriteria: status === 'FAILED_OOS' ? ['OOS_DEGRADATION (0.2 > 0.15)'] : status === 'INSUFFICIENT_SAMPLE' ? ['MIN_CLOSED_TRADES (12/50)'] : [],
    metrics: {
      pair,
      timeframe,
      closedTrades: status === 'INSUFFICIENT_SAMPLE' ? 12 : 60,
      expectancy,
      winRate,
      maxDrawdown,
      oosDegradation,
      walkForwardPass: status !== 'FAILED_OOS',
    },
  };
}

test('setupRegistry maps proof status to setup status', () => {
  assert.equal(mapProofStatusToSetupStatus('PROVEN_READY_FOR_PAPER'), SETUP_STATUS.APPROVED_FOR_PAPER);
  assert.equal(mapProofStatusToSetupStatus('INSUFFICIENT_SAMPLE'), SETUP_STATUS.COLLECT_MORE_DATA);
  assert.equal(mapProofStatusToSetupStatus('FAILED_OOS'), SETUP_STATUS.REJECTED_OOS_FAILURE);
  assert.equal(mapProofStatusToSetupStatus('FAILED_EXPECTANCY'), SETUP_STATUS.REJECTED_EXPECTANCY);
});

test('setupRegistry classifies approved, collecting, and rejected setups independently', () => {
  const registry = buildSetupRegistry(
    summaryWithSetups([
      makeProofSetup({ pair: 'BTC/USDT', timeframe: '1h', status: 'PROVEN_READY_FOR_PAPER' }),
      makeProofSetup({ pair: 'ETH/USDT', timeframe: '1h', status: 'INSUFFICIENT_SAMPLE' }),
      makeProofSetup({ pair: 'SOL/USDT', timeframe: '15m', status: 'FAILED_OOS', oosDegradation: 0.2 }),
    ]),
  );

  assert.equal(registry.bySymbolKey['BTCUSDT:1h'].setupStatus, SETUP_STATUS.APPROVED_FOR_PAPER);
  assert.equal(registry.bySymbolKey['ETHUSDT:1h'].setupStatus, SETUP_STATUS.COLLECT_MORE_DATA);
  assert.equal(registry.bySymbolKey['SOLUSDT:15m'].setupStatus, SETUP_STATUS.REJECTED_OOS_FAILURE);
});

test('setupRegistry freezes the official paper universe when no backtest summary exists', () => {
  const registry = buildSetupRegistry(null);

  assert.equal(registry.entries.length, 3);
  assert.equal(registry.bySymbolKey['BTCUSDT:1h'].setupStatus, SETUP_STATUS.COLLECT_MORE_DATA);
  assert.equal(registry.bySymbolKey['ETHUSDT:1h'].setupStatus, SETUP_STATUS.COLLECT_MORE_DATA);
  assert.equal(registry.bySymbolKey['SOLUSDT:15m'].setupStatus, SETUP_STATUS.REJECTED_OOS_FAILURE);
});

test('rejected OOS setup cannot enter approved paper trading', () => {
  const approval = classifySignalForPaper({
    setupStatus: SETUP_STATUS.REJECTED_OOS_FAILURE,
    signalValidity: 'VALID',
    signal: 'LONG',
    proofStatus: 'FAILED_OOS',
    rejectionReason: 'OOS failed.',
  });

  assert.equal(approval.isApprovedPaperTrade, false);
  assert.equal(approval.paperCategory, PAPER_CATEGORY.REJECTED_SETUP);
});

test('insufficient sample setup becomes observation only', () => {
  const approval = classifySignalForPaper({
    setupStatus: SETUP_STATUS.COLLECT_MORE_DATA,
    signalValidity: 'VALID',
    signal: 'SHORT',
    proofStatus: 'INSUFFICIENT_SAMPLE',
  });

  assert.equal(approval.isApprovedPaperTrade, false);
  assert.equal(approval.paperCategory, PAPER_CATEGORY.OBSERVATION_ONLY);
  assert.equal(approval.shouldTrackOutcome, true);
});

test('blocked signal cannot enter paper trading even from approved setup', () => {
  const approval = classifySignalForPaper({
    setupStatus: SETUP_STATUS.APPROVED_FOR_PAPER,
    signalValidity: 'BLOCKED',
    signal: 'LONG',
    proofStatus: 'PROVEN_READY_FOR_PAPER',
  });

  assert.equal(approval.isApprovedPaperTrade, false);
  assert.equal(approval.paperCategory, PAPER_CATEGORY.BLOCKED_SIGNAL);
});

test('paper trade records include setup approval fields', () => {
  const record = createPaperTradeRecord({
    pair: 'BTCUSDT',
    timeframe: '1h',
    setup: {
      signal: 'LONG',
      selectedDirection: 'LONG',
      signalValidity: 'VALID',
      confidenceScore: 8,
      sl: 98,
      tp1: 104,
      rr: 2,
    },
    candles: [{ time: 1_700_000_000, close: 100, high: 101, low: 99 }],
    registryEntry: {
      setupStatus: SETUP_STATUS.APPROVED_FOR_PAPER,
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      rejectionReason: '',
    },
  });

  assert.equal(record.setupStatus, SETUP_STATUS.APPROVED_FOR_PAPER);
  assert.equal(record.proofStatus, 'PROVEN_READY_FOR_PAPER');
  assert.equal(record.isApprovedPaperTrade, true);
  assert.equal(record.paperCategory, PAPER_CATEGORY.PAPER_ELIGIBLE);
  assert.equal(record.recordQuality, 'VALID');
  assert.equal(record.strategyVersion, strategyVersion);
  assert.equal(record.riskModel, 'ATR-based TP/SL');
});

test('invalid paper trade cannot remain approved', () => {
  const record = createPaperTradeRecord({
    pair: 'BTCUSDT',
    timeframe: '1h',
    setup: {
      signal: 'LONG',
      selectedDirection: 'LONG',
      signalValidity: 'VALID',
      confidenceScore: 8,
      sl: null,
      tp1: null,
      rr: 2,
    },
    candles: [{ time: 1_700_000_000, close: 100, high: 101, low: 99 }],
    registryEntry: {
      setupStatus: SETUP_STATUS.APPROVED_FOR_PAPER,
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      rejectionReason: '',
    },
  });

  assert.equal(record.isApprovedPaperTrade, false);
  assert.equal(record.recordQuality, 'INVALID');
  assert.ok(record.recordIssues.includes('MISSING_stopLoss'));
  assert.ok(record.recordIssues.includes('MISSING_takeProfit'));
});

test('paper trade validation rejects approved blocked or rejected setup records', () => {
  const result = validatePaperTradeRecord({
    pair: 'SOLUSDT',
    timeframe: '15m',
    direction: 'LONG',
    signalValidity: 'BLOCKED',
    setupStatus: SETUP_STATUS.REJECTED_OOS_FAILURE,
    proofStatus: 'FAILED_OOS',
    ...activeStrategy,
    paperCategory: PAPER_CATEGORY.PAPER_ELIGIBLE,
    isApprovedPaperTrade: true,
    openedAt: '2026-04-30T00:00:00.000Z',
    entry: 100,
    stopLoss: 98,
    takeProfit: 104,
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('BLOCKED_APPROVED'));
  assert.ok(result.issues.includes('REJECTED_SETUP_APPROVED'));
});
