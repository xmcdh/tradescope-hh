import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLiveGate } from '../src/lib/liveGate.js';

function makeTrades({
  count = 30,
  wins = 18,
  rWin = 1.4,
  rLoss = -0.6,
  validity = 'VALID',
  start = 1_700_000_000_000,
  spacingMs = 24 * 60 * 60 * 1000,
} = {}) {
  return Array.from({ length: count }).map((_, index) => {
    const isWin = index < wins;
    return {
      id: `trade-${index}`,
      pair: index % 2 ? 'BTCUSDT' : 'ETHUSDT',
      timeframe: index % 3 ? '15m' : '1h',
      signalValidity: validity,
      isApprovedPaperTrade: true,
      status: isWin ? 'WIN' : 'LOSS',
      realizedR: isWin ? rWin : rLoss,
      timestamp: start + index * spacingMs,
      exitTimestamp: start + index * spacingMs + 60_000,
    };
  });
}

function passingContext(overrides = {}) {
  return {
    trades: makeTrades({ count: 30, wins: 18, rWin: 1.3, rLoss: -0.3 }),
    oosDegradation: 0.1,
    storage: { durable: true, warning: '' },
    backtestComparison: {
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      oosDegradation: 0.1,
      divergenceWarning: '',
    },
    ...overrides,
  };
}

test('evaluateLiveGate passes when all criteria are met', () => {
  const result = evaluateLiveGate(passingContext());

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedCriteria, []);
});

test('evaluateLiveGate fails minimum trade count gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 20, wins: 12, rWin: 1.3, rLoss: -0.3 }),
  }));

  assert.equal(result.ready, false);
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
  assert.ok(result.failedCriteria.some((item) => item.startsWith('MAX_DRAWDOWN')));
});

test('evaluateLiveGate fails OOS degradation gate', () => {
  const result = evaluateLiveGate(passingContext({
    oosDegradation: 0.2,
    backtestComparison: {
      proofStatus: 'PROVEN_READY_FOR_PAPER',
      oosDegradation: 0.2,
      divergenceWarning: '',
    },
  }));

  assert.equal(result.ready, false);
  assert.ok(result.failedCriteria.some((item) => item.startsWith('OOS_DEGRADATION')));
});

test('evaluateLiveGate fails paper duration gate', () => {
  const result = evaluateLiveGate(passingContext({
    trades: makeTrades({ count: 30, wins: 18, spacingMs: 60_000 }),
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
