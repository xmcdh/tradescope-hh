import test from 'node:test';
import assert from 'node:assert/strict';
import { computePerformanceStats } from '../src/lib/performanceStats.js';

const mockLog = [
  {
    id: '1',
    timestamp: 1_700_000_000_000,
    pair: 'BTCUSDT',
    timeframe: '15m',
    direction: 'LONG',
    rr: 2,
    score: 8,
    signalValidity: 'VALID',
    status: 'WIN',
    realizedR: 2,
    exitTimestamp: 1_700_000_900_000,
  },
  {
    id: '2',
    timestamp: 1_700_001_000_000,
    pair: 'BTCUSDT',
    timeframe: '15m',
    direction: 'LONG',
    rr: 1.5,
    score: 6,
    signalValidity: 'MARGINAL',
    status: 'LOSS',
    realizedR: -1,
    exitTimestamp: 1_700_001_900_000,
  },
  {
    id: '3',
    timestamp: 1_700_002_000_000,
    pair: 'ETHUSDT',
    timeframe: '1h',
    direction: 'SHORT',
    rr: 2.4,
    score: 9,
    signalValidity: 'VALID',
    status: 'EXPIRED',
    realizedR: 0,
    exitTimestamp: 1_700_003_900_000,
  },
  {
    id: '4',
    timestamp: 1_700_004_000_000,
    pair: 'ETHUSDT',
    timeframe: '1h',
    direction: 'SHORT',
    rr: 2.1,
    score: 7,
    signalValidity: 'VALID',
    status: 'OPEN',
    realizedR: null,
    exitTimestamp: null,
  },
];

test('computePerformanceStats summarizes overall metrics', () => {
  const stats = computePerformanceStats(mockLog);

  assert.equal(stats.overall.totalSignals, 4);
  assert.equal(stats.overall.totalTrades, 3);
  assert.equal(stats.overall.openSignals, 1);
  assert.equal(stats.overall.winRate, 33.33);
  assert.equal(stats.overall.expectancy, 0.3333);
  assert.equal(stats.overall.avgR, 0.3333);
  assert.equal(stats.overall.falsePosRate, 66.67);
  assert.ok(Array.isArray(stats.equityCurve));
  assert.equal(stats.equityCurve.length, 3);
});

test('computePerformanceStats groups by pair, timeframe, and signal validity', () => {
  const stats = computePerformanceStats(mockLog);

  assert.equal(stats.perPair.BTCUSDT.totalTrades, 2);
  assert.equal(stats.perPair.ETHUSDT.totalTrades, 1);
  assert.equal(stats.perTimeframe['15m'].winRate, 50);
  assert.equal(stats.perTimeframe['1h'].falsePosRate, 100);
  assert.equal(stats.perSignalValidity.VALID.totalTrades, 2);
  assert.equal(stats.perSignalValidity.MARGINAL.totalTrades, 1);
});
