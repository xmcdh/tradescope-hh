import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  calculatePerformance,
  runBacktest,
  simulateTradeOutcome,
  validateCandleIntegrity,
} from '../src/lib/backtester.js';
import { evaluateSplitValidation, validateBacktest } from '../src/lib/backtestValidator.js';
import { strategyVersion } from '../src/config/strategyVersion.js';
import {
  cacheFilePath,
  fetchBacktestOhlcv,
  fetchVercelMarketDataOhlcv,
  readCachedOhlcv,
  writeOhlcvCache,
} from '../src/lib/backtestDataSource.js';
import { executeBacktestRun } from '../src/scripts/runBacktest.js';

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
  assert.equal(result.strategyVersion, strategyVersion);
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

test('backtest data source writes and reads local cache with strategy metadata', async () => {
  const cacheDir = path.join('/tmp', `tradescope-ohlcv-cache-${Date.now()}`);
  const candles = makeCandles(260);
  const cachePath = await writeOhlcvCache({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    source: 'unit-test',
    candles,
    cacheDir,
  });
  const cached = await readCachedOhlcv({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    cacheDir,
  });

  assert.equal(cachePath, cacheFilePath({ pair: 'BTC/USDT', timeframe: '15m', from: '2024-01-01', to: '2024-07-01', cacheDir }));
  assert.equal(cached.source, 'local-cache');
  assert.equal(cached.cachePayload.strategyVersion, strategyVersion);
  assert.equal(cached.candles.length, 260);
});

test('local cache rejects duplicate or missing candles', async () => {
  const cacheDir = path.join('/tmp', `tradescope-ohlcv-cache-bad-${Date.now()}`);
  const candles = makeCandles(260);
  candles[10] = { ...candles[9] };
  await writeOhlcvCache({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    source: 'unit-test',
    candles,
    cacheDir,
  });

  await assert.rejects(
    readCachedOhlcv({
      pair: 'BTC/USDT',
      timeframe: '15m',
      from: '2024-01-01',
      to: '2024-07-01',
      cacheDir,
    }),
    /candle integrity failed/,
  );
});

test('local-file data source can run a versioned backtest', async () => {
  const importDir = path.join('/tmp', `tradescope-import-${Date.now()}`);
  await fs.mkdir(importDir, { recursive: true });
  const file = path.join(importDir, 'BTCUSDT-15m.json');
  await fs.writeFile(file, `${JSON.stringify(makeCandles(260))}\n`);

  const payload = await executeBacktestRun({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    dataSource: 'local-file',
    file,
    writeFile: false,
  });

  assert.equal(payload.metadata.strategyVersion, strategyVersion);
  assert.equal(payload.metadata.dataSource, 'local-file');
  assert.equal(payload.metadata.candleCount, 260);
  assert.equal(payload.integrity.valid, true);
});

test('vercel market-data proxy normalizes paginated kline payloads', async () => {
  const rows = makeCandles(260, 100).map((candle, index) => ({
    ...candle,
    time: 1_704_067_200 + index * 900,
  })).map((candle) => [
    candle.time * 1000,
    String(candle.open),
    String(candle.high),
    String(candle.low),
    String(candle.close),
    String(candle.volume),
  ]);
  const calls = [];
  const result = await fetchVercelMarketDataOhlcv({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    fetcher: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(calls.length === 1 ? rows : []);
        },
      };
    },
  });

  assert.equal(result.source, 'vercel-market-data-proxy');
  assert.equal(result.candles.length, 260);
  assert.match(calls[0], /startTime=/);
  assert.match(calls[0], /endTime=/);
});

test('fetchBacktestOhlcv selects local-cache source', async () => {
  const cacheDir = path.join('/tmp', `tradescope-ohlcv-cache-select-${Date.now()}`);
  await writeOhlcvCache({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    source: 'unit-test',
    candles: makeCandles(260),
    cacheDir,
  });

  const result = await fetchBacktestOhlcv({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-07-01',
    dataSource: 'local-cache',
    cacheDir,
  });

  assert.equal(result.source, 'local-cache');
  assert.equal(result.integrity.valid, true);
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
