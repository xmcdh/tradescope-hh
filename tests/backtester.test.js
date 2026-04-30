import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePerformance,
  runBacktest,
  simulateTradeOutcome,
  validateCandleIntegrity,
} from '../src/lib/backtester.js';
import { evaluateSplitValidation, validateBacktest } from '../src/lib/backtestValidator.js';

function makeCandles(count, start = 100) {
  const candles = [];
  let price = start;

  for (let index = 0; index < count; index += 1) {
    const trend = index * 0.08;
    const wave = Math.sin(index / 8) * 0.35;
    const close = start + trend + wave;
    const open = price;
    const high = Math.max(open, close) + 3.2;
    const low = Math.min(open, close) - 0.3;

    candles.push({
      time: 1_700_000_000 + index * 900,
      open,
      high,
      low,
      close,
      volume: 1000 + (index % 12) * 30,
    });
    price = close;
  }

  return candles;
}

test('simulateTradeOutcome resolves long TP before later SL', () => {
  const outcome = simulateTradeOutcome(
    {
      signal: 'LONG',
      entry: 100,
      sl: 98,
      tp: 104,
      rr: 2,
    },
    [
      { time: 1, open: 100, high: 103, low: 99, close: 102, volume: 1 },
      { time: 2, open: 102, high: 104.2, low: 101, close: 104, volume: 1 },
      { time: 3, open: 104, high: 105, low: 97, close: 98, volume: 1 },
    ],
  );

  assert.equal(outcome.outcome, 'WIN');
  assert.equal(outcome.exit, 104);
  assert.equal(outcome.r, 2);
});

test('simulateTradeOutcome uses conservative SL-first policy for same-candle ambiguity', () => {
  const outcome = simulateTradeOutcome(
    {
      signal: 'SHORT',
      entry: 100,
      sl: 102,
      tp: 96,
      rr: 2,
    },
    [{ time: 1, open: 100, high: 102.5, low: 95.5, close: 99, volume: 1 }],
  );

  assert.equal(outcome.outcome, 'LOSS');
  assert.equal(outcome.exit, 102);
  assert.equal(outcome.r, -1);
});

test('calculatePerformance returns core backtest metrics', () => {
  const result = calculatePerformance(
    [
      { outcome: 'WIN', r: 2, signalValidity: 'VALID' },
      { outcome: 'LOSS', r: -1, signalValidity: 'BLOCKED' },
      { outcome: 'WIN', r: 1.5, signalValidity: 'VALID' },
    ],
    { LONG: 2, SHORT: 1 },
    { VALID: 2, BLOCKED: 1 },
  );

  assert.equal(result.totalTrades, 3);
  assert.equal(Math.round(result.winRate), 67);
  assert.equal(result.signalBreakdown.LONG, 2);
  assert.equal(result.validSignalCount, 2);
  assert.equal(result.blockedSignalCount, 1);
  assert.equal(result.actionableTradeCount, 2);
  assert.equal(result.actionableClosedTradeCount, 2);
  assert.ok(result.expectancy > 0);
  assert.ok(result.maxDrawdown >= 0);
  assert.ok(Number.isFinite(result.sharpe));
});

test('runBacktest accepts synthetic OHLCV candles and returns summary shape', () => {
  const result = runBacktest(makeCandles(260), 'BTCUSDT', '15m');

  assert.equal(result.pair, 'BTCUSDT');
  assert.equal(result.timeframe, '15m');
  assert.equal(result.candleCount, 260);
  assert.ok(Array.isArray(result.signals));
  assert.ok(Array.isArray(result.trades));
  assert.ok(Number.isFinite(result.totalTrades));
  assert.ok(Number.isFinite(result.winRate));
  assert.ok(Number.isFinite(result.expectancy));
  assert.ok(Number.isFinite(result.actionableTradeCount));
  assert.ok(result.signalBreakdown && typeof result.signalBreakdown === 'object');
  assert.ok(result.signalValidityBreakdown && typeof result.signalValidityBreakdown === 'object');
});

test('validateBacktest splits data and flags large OOS win-rate deterioration', () => {
  const candles = makeCandles(260);
  const validation = validateBacktest(candles, 'BTCUSDT', '15m');

  assert.equal(validation.splitIndex, Math.floor(candles.length * 0.7));
  assert.ok(validation.inSample);
  assert.ok(validation.outOfSample);
  assert.ok(Array.isArray(validation.flags));
  assert.ok(validation.walkForward);
  assert.ok(Array.isArray(validation.walkForward.windows));
  assert.equal(typeof validation.overfittingDetected, 'boolean');
});

test('validateCandleIntegrity detects duplicate timestamps and missing gaps', () => {
  const candles = [
    { time: 1_700_000_000, open: 1, high: 2, low: 1, close: 2, volume: 1 },
    { time: 1_700_000_900, open: 2, high: 3, low: 2, close: 3, volume: 1 },
    { time: 1_700_000_900, open: 3, high: 4, low: 3, close: 4, volume: 1 },
    { time: 1_700_003_600, open: 4, high: 5, low: 4, close: 5, volume: 1 },
  ];

  const integrity = validateCandleIntegrity(candles, '15m');

  assert.equal(integrity.valid, false);
  assert.ok(integrity.issues.some((item) => item.startsWith('DUPLICATE_TIMESTAMPS')));
  assert.ok(integrity.issues.some((item) => item.startsWith('MISSING_CANDLES')));
});

test('evaluateSplitValidation flags negative OOS expectancy and excessive win-rate drop', () => {
  const result = evaluateSplitValidation(
    {
      actionableClosedTradeCount: 60,
      actionableWinRate: 58,
      actionableExpectancy: 0.6,
      actionableAvgR: 0.6,
      actionableProfitFactor: 1.8,
    },
    {
      actionableClosedTradeCount: 55,
      actionableWinRate: 38,
      actionableExpectancy: -0.1,
      actionableAvgR: -0.1,
      actionableProfitFactor: 0.8,
    },
  );

  assert.equal(result.pass, false);
  assert.ok(result.flags.includes('OOS_WIN_RATE_DROP_GT_15'));
  assert.ok(result.flags.includes('OOS_EXPECTANCY_NEGATIVE'));
});
