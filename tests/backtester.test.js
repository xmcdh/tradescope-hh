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
import { buildExperimentComparison } from '../src/lib/experimentComparison.js';
import { buildRetestAudit, RETEST_FAILURE_BUCKETS } from '../src/lib/retestAudit.js';
import { activeStrategy, strategyVersion } from '../src/config/strategyVersion.js';
import { getStrategyExperiment } from '../src/config/strategyExperiments.js';
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

test('simulateTradeOutcome can hold full position to tp2 for exit-geometry experiments', () => {
  const outcome = simulateTradeOutcome(
    {
      signal: 'LONG',
      entry: 100,
      sl: 98,
      tp: 103,
      tp1Price: 103,
      tp2Price: 104.8,
    },
    [
      { time: 1, open: 100, high: 102.9, low: 99.2, close: 102.5, volume: 1 },
      { time: 2, open: 102.5, high: 105, low: 102, close: 104.8, volume: 1 },
    ],
    {
      experimentConfig: {
        exitGeometry: {
          mode: 'full-target',
          target: 'tp2',
        },
      },
    },
  );

  assert.equal(outcome.outcome, 'WIN');
  assert.equal(outcome.exit, 104.8);
  assert.equal(outcome.r, 2.4);
});

test('simulateTradeOutcome supports partial tp runner geometry', () => {
  const outcome = simulateTradeOutcome(
    {
      signal: 'LONG',
      entry: 100,
      sl: 98,
      tp: 103,
      tp1Price: 103,
      tp2Price: 104.8,
      atr: 1,
    },
    [
      { time: 1, open: 100, high: 103.2, low: 99.8, close: 102.9, volume: 1 },
      { time: 2, open: 102.9, high: 104.9, low: 102.5, close: 104.6, volume: 1 },
    ],
    {
      experimentConfig: {
        exitGeometry: {
          mode: 'partial-runner',
          firstWeight: 0.5,
          moveStopToBreakevenAfterFirstTarget: true,
        },
      },
    },
  );

  assert.equal(outcome.outcome, 'WIN');
  assert.equal(outcome.r, 1.95);
  assert.equal(outcome.exitMode, 'partial-runner');
  assert.equal(outcome.exitEvents.length, 2);
});

test('simulateTradeOutcome supports breakeven-after-1r geometry', () => {
  const outcome = simulateTradeOutcome(
    {
      signal: 'LONG',
      entry: 100,
      sl: 98,
      tp: 103,
      tp1Price: 103,
      tp2Price: 104.8,
      atr: 1,
    },
    [
      { time: 1, open: 100, high: 102.1, low: 99.5, close: 101.9, volume: 1 },
      { time: 2, open: 101.9, high: 102, low: 99.8, close: 100.1, volume: 1 },
      { time: 3, open: 100.1, high: 100.5, low: 99.7, close: 100, volume: 1 },
    ],
    {
      experimentConfig: {
        exitGeometry: {
          mode: 'breakeven-after-1r',
          triggerR: 1,
          finalTarget: 'tp2',
        },
      },
    },
  );

  assert.equal(outcome.outcome, 'BREAKEVEN');
  assert.equal(outcome.r, 0);
  assert.equal(outcome.exit, 100);
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
  assert.ok(result.diagnostics && typeof result.diagnostics === 'object');
});

test('backtest-only experiment metadata does not change production active strategy', async () => {
  const experiment = getStrategyExperiment('v1.4-trend-strength-filter');
  assert.equal(strategyVersion, 'v1.1-atr-risk');
  assert.equal(activeStrategy.strategyVersion, 'v1.1-atr-risk');
  assert.equal(experiment.signalLogic.strategyType, 'trendPullbackContinuation');
  assert.equal(experiment.liveGateEligible, false);
  assert.equal(experiment.paperGateEligible, false);

  const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-experiment-'));
  const candlePath = path.join(tempDir, 'candles.json');
  await fs.writeFile(candlePath, JSON.stringify({ candles: makeCandles(260) }));

  const payload = await executeBacktestRun({
    pair: 'BTC/USDT',
    timeframe: '15m',
    from: '2024-01-01',
    to: '2024-02-01',
    dataSource: 'local-file',
    file: candlePath,
    writeFile: false,
    experimentId: 'v1.4-trend-strength-filter',
  });

  assert.equal(payload.metadata.experimentId, 'v1.4-trend-strength-filter');
  assert.equal(payload.metadata.strategyVersion, 'v1.4-trend-strength-filter');
  assert.equal(payload.metadata.experimentFamily, 'v1.4-quality-filter');
  assert.equal(payload.metadata.activeProductionStrategyVersion, 'v1.1-atr-risk');
  assert.equal(payload.metadata.candidateOnly, true);
  assert.equal(payload.metadata.liveGateEligible, false);
  assert.equal(payload.metadata.paperGateEligible, false);
  assert.equal(strategyVersion, 'v1.1-atr-risk');

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('experiment comparison includes all variants as candidate-only and does not auto-approve', async () => {
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-comparison-'));
  const baselineReportPath = path.join(tempDir, 'report.json');
  const baselineResult = {
    pair: 'BTC/USDT',
    timeframe: '1h',
    backtest: {
      actionableClosedTradeCount: 0,
      actionableWinRate: 0,
      actionableExpectancy: 0,
      actionableMaxDrawdown: 0,
      actionableProfitFactor: 0,
      actionableNetR: 0,
      diagnostics: {},
    },
    validation: {
      flags: [],
      comparison: { oosDegradation: 0 },
      walkForward: { pass: true, summary: { profitConcentration: 0 } },
    },
  };

  await fs.writeFile(
    baselineReportPath,
    JSON.stringify({
      summary: {
        metadata: activeStrategy,
        proof: { status: 'INSUFFICIENT_SAMPLE' },
        results: [baselineResult],
      },
    }),
  );

  const comparison = await buildExperimentComparison({
    resultsDir: tempDir,
    baselineReportPath,
  });

  assert.equal(comparison.variants.length, 26);
  assert.equal(comparison.safety.noAutoPromotion, true);
  assert.equal(comparison.safety.globalVerdict, 'NOT READY');
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v1.3-trend-pullback-continuation'));
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v1.4-htf-alignment-filter'));
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v1.5-partial-tp-runner'));
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v1.6-impulse-filter-soft'));
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v2-breakout-volume-expansion'));
  assert.ok(comparison.variants.some((variant) => variant.experimentId === 'v2.1-opposing-room-soft'));
  assert.ok(comparison.variants.every((variant) => variant.candidateOnly));
  assert.ok(comparison.variants.every((variant) => variant.anySetupAutoApproved === false));

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('v1.6 regime filter blocks executable trades using entry-time regime features only', () => {
  const candles = makeCandles(260);
  const targetTime = candles[220].time;
  candles[221] = {
    ...candles[221],
    high: candles[220].close + 5,
    low: candles[220].close - 0.2,
  };

  const result = runBacktest(candles, 'SOLUSDT', '1h', {
    experimentConfig: {
      regimeFilter: {
        enabled: true,
        filterId: 'unit-test-regime-filter',
        minImpulseSizeAtr: 999,
        requiredFeatures: ['impulseSizeAtr'],
      },
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        ema20: last.close - 0.5,
        ema50: last.close - 1,
        ema200: last.close - 2,
        ema20Series: window.map((candle) => ({ time: candle.time, value: candle.close - 0.5 })),
        atr: 1,
        support: last.close - 3,
        resistance: last.close + 5,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker !== targetTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 0,
          confidenceScore: 0,
          blockedReason: [],
          warnings: [],
        };
      }

      return {
        signal: 'LONG',
        signalValidity: 'VALID',
        score: 8,
        confidenceScore: 8,
        selectedDirection: 'LONG',
        blockedReason: [],
        warnings: [],
        entryPrice: candles[220].close,
        slPrice: candles[220].close - 1,
        tp1Price: candles[220].close + 2,
        atr: 1,
        rrRatio: 2,
      };
    },
  });

  const filtered = result.signals.find((signal) => signal.timestamp === targetTime * 1000);
  assert.equal(result.trades.length, 0);
  assert.equal(filtered.signal, 'WAIT');
  assert.equal(filtered.signalValidity, 'BLOCKED');
  assert.equal(filtered.regimeFilter.passed, false);
  assert.equal(filtered.regimeFilter.filterId, 'unit-test-regime-filter');
  assert.ok(filtered.regimeFilter.features.impulseSizeAtr !== null);
});

test('VALID ATR signal with entryPrice/slPrice/tp1Price opens and closes a simulated trade', () => {
  const candles = makeCandles(260);
  const targetTime = candles[220].time;
  candles[221] = {
    ...candles[221],
    high: candles[220].close + 3,
    low: candles[220].close - 0.2,
  };

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker !== targetTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 0,
          confidenceScore: 0,
          blockedReason: [],
          warnings: [],
        };
      }

      return {
        signal: 'LONG',
        signalValidity: 'VALID',
        score: 8,
        confidenceScore: 8,
        blockedReason: [],
        warnings: [],
        entryPrice: candles[220].close,
        slPrice: candles[220].close - 1,
        tp1Price: candles[220].close + 2,
        atr: 1,
        rrRatio: 2,
      };
    },
  });

  assert.equal(result.actionableTradeCount, 1);
  assert.equal(result.actionableClosedTradeCount, 1);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 1);
  assert.equal(result.diagnostics.simulatedTradeClosedCount, 1);
});

test('regime features are attached to simulated trades using entry history only', () => {
  const candlesA = makeCandles(260);
  const candlesB = makeCandles(260);
  const targetTime = candlesA[220].time;
  candlesA[221] = {
    ...candlesA[221],
    high: candlesA[220].close + 3,
    low: candlesA[220].close - 0.2,
  };
  candlesB[221] = {
    ...candlesB[221],
    high: candlesB[220].close + 30,
    low: candlesB[220].close - 20,
  };

  function run(candles) {
    return runBacktest(candles, 'BTCUSDT', '15m', {
      calculateIndicators(window) {
        const last = window.at(-1);
        return {
          price: last.close,
          ema20: last.close - 0.5,
          ema50: last.close - 1,
          ema200: last.close - 2,
          ema20Series: window.map((candle) => ({ time: candle.time, value: candle.close - 0.5 })),
          atr: 1,
          support: last.close - 3,
          resistance: last.close + 5,
          macd: { macd: 1, signal: 0, histogram: 1 },
          marker: last.time,
        };
      },
      buildSignalSetup(indicators) {
        if (indicators.marker !== targetTime) {
          return {
            signal: 'NO_TRADE',
            signalValidity: 'MARGINAL',
            score: 0,
            confidenceScore: 0,
            blockedReason: [],
            warnings: [],
          };
        }

        return {
          signal: 'LONG',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          entryPrice: candles[220].close,
          slPrice: candles[220].close - 1,
          tp1Price: candles[220].close + 2,
          atr: 1,
          rrRatio: 2,
        };
      },
    });
  }

  const first = run(candlesA).trades[0];
  const second = run(candlesB).trades[0];

  assert.ok(first.regimeFeatures);
  assert.equal(first.regimeFeatures.computedAt, first.timestamp);
  assert.deepEqual(first.regimeFeatures, second.regimeFeatures);
  assert.equal(first.result, first.outcome);
  assert.equal(first.rResult, first.r);
});

test('missing regime feature inputs do not crash backtest', () => {
  const candles = makeCandles(260);
  const targetTime = candles[220].time;

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        marker: last.time,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker !== targetTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 0,
          confidenceScore: 0,
          blockedReason: [],
          warnings: [],
        };
      }

      return {
        signal: 'LONG',
        signalValidity: 'VALID',
        score: 8,
        confidenceScore: 8,
        blockedReason: [],
        warnings: [],
        entryPrice: candles[220].close,
        slPrice: candles[220].close - 1,
        tp1Price: candles[220].close + 2,
        rrRatio: 2,
      };
    },
  });

  assert.equal(result.trades.length, 1);
  assert.ok(result.trades[0].regimeFeatures);
  assert.ok(result.trades[0].regimeFeatures.missingReasons.includes('atr_unavailable'));
});

test('missing TP/SL prevents actionable trade and is counted in diagnostics', () => {
  const candles = makeCandles(260);
  const targetTime = candles[220].time;

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker !== targetTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 0,
          confidenceScore: 0,
          blockedReason: [],
          warnings: [],
        };
      }

      return {
        signal: 'LONG',
        signalValidity: 'VALID',
        score: 8,
        confidenceScore: 8,
        blockedReason: [],
        warnings: [],
        entryPrice: candles[220].close,
        atr: 1,
        rrRatio: 2,
      };
    },
  });

  assert.equal(result.actionableTradeCount, 0);
  assert.equal(result.actionableClosedTradeCount, 0);
  assert.equal(result.diagnostics.missingTradeLevelCount, 1);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 0);
});

test('BLOCKED executable signals are counted but not traded', () => {
  const candles = makeCandles(260);
  const targetTime = candles[220].time;

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker !== targetTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 0,
          confidenceScore: 0,
          blockedReason: [],
          warnings: [],
        };
      }

      return {
        signal: 'LONG',
        signalValidity: 'BLOCKED',
        score: 8,
        confidenceScore: 8,
        blockedReason: ['R:R is only 1.10:1, below hard minimum 1.2.'],
        warnings: [],
        entryPrice: candles[220].close,
        slPrice: candles[220].close - 1,
        tp1Price: candles[220].close + 2,
        atr: 1,
        rrRatio: 2,
      };
    },
  });

  assert.equal(result.blockedSignalCount, 1);
  assert.equal(result.actionableTradeCount, 0);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 0);
  assert.equal(result.trades.length, 0);
});

test('WAIT_RETEST creates pending setup and opens trade only after confirmation', () => {
  const candles = makeCandles(260);
  const waitTime = candles[220].time;
  const confirmTime = candles[221].time;
  candles[221] = {
    ...candles[221],
    low: 99.8,
    high: 101.8,
    close: 101.2,
  };
  candles[222] = {
    ...candles[222],
    low: 100.9,
    high: 104.5,
    close: 104,
  };

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    retestConfig: {
      maxRetestWaitCandles: 3,
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker === waitTime) {
        return {
          signal: 'WAIT_RETEST',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          entryAdvice: 'Wait for retest confirmation before entry.',
          watchLevels: {
            breakoutLevel: 100,
            retestArea: 99.5,
            invalidation: 98.5,
          },
          plannedLevels: {
            entry1: 101,
            entry2: 99.5,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      if (indicators.marker === confirmTime) {
        return {
          signal: 'WAIT',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          plannedLevels: {
            entry1: candles[221].close,
            entry2: 100,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      return {
        signal: 'NO_TRADE',
        signalValidity: 'MARGINAL',
        score: 0,
        confidenceScore: 0,
        blockedReason: [],
        warnings: [],
        selectedDirection: 'LONG',
      };
    },
  });

  assert.equal(result.actionableTradeCount, 1);
  assert.equal(result.actionableClosedTradeCount, 1);
  assert.equal(result.diagnostics.pendingRetestCreatedCount, 1);
  assert.equal(result.diagnostics.pendingRetestConfirmedCount, 1);
  assert.equal(result.diagnostics.pendingRetestExpiredCount, 0);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 1);
  assert.equal(result.diagnostics.simulatedTradeClosedCount, 1);
  assert.equal(result.trades[0].signal, 'LONG');
  assert.equal(result.trades[0].signalSource, 'RETEST_CONFIRMATION');
});

test('WAIT_RETEST expires after configured max wait candles', () => {
  const candles = makeCandles(260);
  const waitTime = candles[220].time;

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    retestConfig: {
      maxRetestWaitCandles: 2,
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker === waitTime) {
        return {
          signal: 'WAIT_RETEST',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'SHORT',
          entryAdvice: 'Wait for retest confirmation before entry.',
          watchLevels: {
            breakoutLevel: 200,
            retestArea: 199.5,
            invalidation: 250,
          },
          plannedLevels: {
            entry1: 199.8,
            entry2: 199.5,
            sl: 202,
            tp1: 196,
            tp2: 194,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      return {
        signal: 'NO_TRADE',
        signalValidity: 'MARGINAL',
        score: 0,
        confidenceScore: 0,
        blockedReason: [],
        warnings: [],
        selectedDirection: 'SHORT',
      };
    },
  });

  assert.equal(result.actionableTradeCount, 0);
  assert.equal(result.diagnostics.pendingRetestCreatedCount, 1);
  assert.equal(result.diagnostics.pendingRetestConfirmedCount, 0);
  assert.equal(result.diagnostics.pendingRetestExpiredCount, 1);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 0);
});

test('MARGINAL WAIT_RETEST can confirm but still never becomes an approved trade', () => {
  const candles = makeCandles(260);
  const waitTime = candles[220].time;
  const confirmTime = candles[221].time;
  candles[221] = {
    ...candles[221],
    low: 99.8,
    high: 101.8,
    close: 101.2,
  };

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    retestConfig: {
      maxRetestWaitCandles: 3,
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker === waitTime) {
        return {
          signal: 'WAIT_RETEST',
          signalValidity: 'MARGINAL',
          score: 6,
          confidenceScore: 6,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          watchLevels: {
            breakoutLevel: 100,
            retestArea: 99.5,
            invalidation: 98.5,
          },
          plannedLevels: {
            entry1: 101,
            entry2: 99.5,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      if (indicators.marker === confirmTime) {
        return {
          signal: 'WAIT',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          plannedLevels: {
            entry1: candles[221].close,
            entry2: 100,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      return {
        signal: 'NO_TRADE',
        signalValidity: 'MARGINAL',
        score: 0,
        confidenceScore: 0,
        blockedReason: [],
        warnings: [],
      };
    },
  });

  assert.equal(result.diagnostics.pendingRetestCreatedCount, 1);
  assert.equal(result.diagnostics.pendingRetestConfirmedCount, 1);
  assert.equal(result.actionableTradeCount, 0);
  assert.equal(result.trades.length, 0);
});

test('confirmed retest with MARGINAL confirmation candle does not open a trade', () => {
  const candles = makeCandles(260);
  const waitTime = candles[220].time;
  const confirmTime = candles[221].time;
  candles[221] = {
    ...candles[221],
    low: 99.8,
    high: 101.8,
    close: 101.2,
  };

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    retestConfig: {
      maxRetestWaitCandles: 3,
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker === waitTime) {
        return {
          signal: 'WAIT_RETEST',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          watchLevels: {
            breakoutLevel: 100,
            retestArea: 99.5,
            invalidation: 98.5,
          },
          plannedLevels: {
            entry1: 101,
            entry2: 99.5,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      if (indicators.marker === confirmTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'MARGINAL',
          score: 6,
          confidenceScore: 6,
          blockedReason: [],
          warnings: ['R:R is only 1.50:1, minimum required is 1.5. Consider skipping.'],
          selectedDirection: 'LONG',
          plannedLevels: {
            entry1: candles[221].close,
            entry2: 100,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      return {
        signal: 'NO_TRADE',
        signalValidity: 'MARGINAL',
        score: 0,
        confidenceScore: 0,
        blockedReason: [],
        warnings: [],
      };
    },
  });

  assert.equal(result.diagnostics.pendingRetestCreatedCount, 1);
  assert.equal(result.diagnostics.pendingRetestConfirmedCount, 1);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 0);
  assert.equal(result.trades.length, 0);
  assert.match(result.retestDiagnostics[0].tradeActionabilityReason, /MARGINAL/);
});

test('confirmed retest with BLOCKED confirmation candle does not open a trade', () => {
  const candles = makeCandles(260);
  const waitTime = candles[220].time;
  const confirmTime = candles[221].time;
  candles[221] = {
    ...candles[221],
    low: 99.8,
    high: 101.8,
    close: 101.2,
  };

  const result = runBacktest(candles, 'BTCUSDT', '15m', {
    retestConfig: {
      maxRetestWaitCandles: 3,
    },
    calculateIndicators(window) {
      const last = window.at(-1);
      return {
        price: last.close,
        macd: { macd: 1, signal: 0, histogram: 1 },
        marker: last.time,
        atr: 1,
      };
    },
    buildSignalSetup(indicators) {
      if (indicators.marker === waitTime) {
        return {
          signal: 'WAIT_RETEST',
          signalValidity: 'VALID',
          score: 8,
          confidenceScore: 8,
          blockedReason: [],
          warnings: [],
          selectedDirection: 'LONG',
          watchLevels: {
            breakoutLevel: 100,
            retestArea: 99.5,
            invalidation: 98.5,
          },
          plannedLevels: {
            entry1: 101,
            entry2: 99.5,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      if (indicators.marker === confirmTime) {
        return {
          signal: 'NO_TRADE',
          signalValidity: 'BLOCKED',
          score: 5,
          confidenceScore: 5,
          blockedReason: ['Last candle is too long versus ATR. Avoid FOMO entry.'],
          warnings: [],
          hardBlock: 'Last candle is too long versus ATR. Avoid FOMO entry.',
          selectedDirection: 'LONG',
          plannedLevels: {
            entry1: candles[221].close,
            entry2: 100,
            sl: 99,
            tp1: 104,
            tp2: 106,
          },
          atr: 1,
          rrRatio: 1.5,
        };
      }

      return {
        signal: 'NO_TRADE',
        signalValidity: 'MARGINAL',
        score: 0,
        confidenceScore: 0,
        blockedReason: [],
        warnings: [],
      };
    },
  });

  assert.equal(result.diagnostics.pendingRetestCreatedCount, 1);
  assert.equal(result.diagnostics.pendingRetestConfirmedCount, 1);
  assert.equal(result.diagnostics.simulatedTradeOpenedCount, 0);
  assert.equal(result.trades.length, 0);
  assert.match(result.retestDiagnostics[0].tradeActionabilityReason, /BLOCKED/);
});

test('retest audit output includes classified failure reasons', () => {
  const audit = buildRetestAudit(
    {
      metadata: {
        pair: 'BTC/USDT',
        timeframe: '1h',
        strategyVersion: 'v1.1-atr-risk',
      },
      backtest: {
        signals: [
          {
            timestamp: 2,
            signal: 'WAIT_RETEST',
            signalValidity: 'MARGINAL',
            score: 6,
            confidenceScore: 6,
            blockedReason: [],
          },
        ],
        retestDiagnostics: [
          {
            id: 'pending-1',
            status: 'CONFIRMED',
            createdAt: 1,
            confirmationTimestamp: 2,
            direction: 'LONG',
            signalValidity: 'VALID',
            confidenceScore: 7,
            breakoutLevel: 100,
            retestArea: 99.5,
            entryCandidate: 101,
            atr: 1,
            slPrice: 99,
            tp1Price: 104,
            tp2Price: 106,
            rrRatio: 1.5,
            tradeActionabilityReason: 'Retest confirmed, but confirmation candle validity is MARGINAL.',
            becameActionableTrade: false,
          },
        ],
      },
    },
    {
      source: 'unit-test.json',
    },
  );

  assert.equal(audit.summary.confirmedRetestCount, 1);
  assert.equal(audit.summary.dominantFailureReason, RETEST_FAILURE_BUCKETS.MARGINAL_SCORE);
  assert.equal(audit.cases[0].failureBucket, RETEST_FAILURE_BUCKETS.MARGINAL_SCORE);
  assert.match(audit.cases[0].exactReasonTradeWasNotOpened, /MARGINAL/);
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
