import { DEFAULT_MIN_LOOKBACK, runBacktest } from './backtester.js';

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function buildComparableMetrics(result) {
  return {
    tradeCount: result?.actionableTradeCount ?? 0,
    closedTradeCount: result?.actionableClosedTradeCount ?? 0,
    winRate: result?.actionableWinRate ?? 0,
    expectancy: result?.actionableExpectancy ?? 0,
    avgR: result?.actionableAvgR ?? 0,
    maxDrawdown: result?.actionableMaxDrawdown ?? 0,
    profitFactor: result?.actionableProfitFactor ?? 0,
    netR: result?.actionableNetR ?? 0,
  };
}

function compareMetrics(inSample, outOfSample) {
  const train = buildComparableMetrics(inSample);
  const test = buildComparableMetrics(outOfSample);
  const winRateDrop = train.winRate - test.winRate;
  const expectancyDrop = train.expectancy - test.expectancy;
  const avgRDrop = train.avgR - test.avgR;
  const profitFactorDrop = (Number.isFinite(train.profitFactor) ? train.profitFactor : 0) - (Number.isFinite(test.profitFactor) ? test.profitFactor : 0);
  const oosDegradation = Math.max(0, winRateDrop / 100, expectancyDrop > 0 ? expectancyDrop / Math.max(Math.abs(train.expectancy), 1) : 0);

  return {
    winRateDrop: round(winRateDrop, 2),
    expectancyDrop: round(expectancyDrop),
    avgRDrop: round(avgRDrop),
    profitFactorDrop: round(profitFactorDrop),
    tradeCountDrop: train.closedTradeCount - test.closedTradeCount,
    oosDegradation: round(oosDegradation),
  };
}

export function evaluateSplitValidation(inSample, outOfSample) {
  const comparison = compareMetrics(inSample, outOfSample);
  const flags = [];

  if (comparison.winRateDrop > 15) {
    flags.push('OOS_WIN_RATE_DROP_GT_15');
  }

  if (inSample.actionableClosedTradeCount > 0 && outOfSample.actionableClosedTradeCount === 0) {
    flags.push('NO_OOS_TRADES');
  }

  if (inSample.actionableExpectancy > 0 && outOfSample.actionableExpectancy < 0) {
    flags.push('OOS_EXPECTANCY_NEGATIVE');
  }

  if (outOfSample.actionableExpectancy < 0) {
    flags.push('OOS_NEGATIVE');
  }

  return {
    comparison,
    flags,
    pass: flags.length === 0,
  };
}

function buildWalkForwardWindows(candles, pair, timeframe, options = {}) {
  const minLookback = Math.max(DEFAULT_MIN_LOOKBACK, options.minLookback ?? DEFAULT_MIN_LOOKBACK);
  const total = candles.length;
  const trainRatio = options.walkForwardTrainRatio ?? 0.7;
  const testRatio = options.walkForwardTestRatio ?? 0.3;
  const minimumWindow = minLookback + Math.max(minLookback, Math.floor(total * testRatio));
  const windows = [];

  if (total < minimumWindow) {
    return {
      windows,
      flags: ['WALK_FORWARD_INSUFFICIENT_DATA'],
      pass: false,
      summary: {
        positiveOosWindows: 0,
        totalWindows: 0,
        profitConcentration: 0,
      },
    };
  }

  const segmentLength = Math.max(minimumWindow, Math.floor(total * (trainRatio + testRatio)));
  const step = Math.max(Math.floor(total * testRatio * 0.5), minLookback);

  for (let start = 0; start + segmentLength <= total; start += step) {
    const segment = candles.slice(start, start + segmentLength);
    const trainLength = Math.max(minLookback, Math.floor(segment.length * trainRatio));
    const inSample = runBacktest(segment, pair, timeframe, {
      ...options,
      startIndex: minLookback - 1,
      endIndex: trainLength - 1,
    });
    const outOfSample = runBacktest(segment, pair, timeframe, {
      ...options,
      startIndex: trainLength,
      endIndex: segment.length - 1,
    });
    const verdict = evaluateSplitValidation(inSample, outOfSample);

    windows.push({
      index: windows.length + 1,
      startTimestamp: segment[0]?.time ? segment[0].time * 1000 : null,
      endTimestamp: segment.at(-1)?.time ? segment.at(-1).time * 1000 : null,
      trainCandleCount: trainLength,
      testCandleCount: segment.length - trainLength,
      inSample: buildComparableMetrics(inSample),
      outOfSample: buildComparableMetrics(outOfSample),
      comparison: verdict.comparison,
      flags: verdict.flags,
      pass: verdict.pass,
    });
  }

  const oosNetR = windows.map((window) => window.outOfSample.netR);
  const totalPositiveNetR = oosNetR.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const topPositiveWindow = oosNetR.reduce((max, value) => (value > max ? value : max), 0);
  const profitConcentration = totalPositiveNetR > 0 ? topPositiveWindow / totalPositiveNetR : 0;
  const flags = [];

  if (windows.some((window) => window.inSample.expectancy > 0 && window.outOfSample.expectancy < 0)) {
    flags.push('WALK_FORWARD_OOS_EXPECTANCY_NEGATIVE');
  }

  if (windows.some((window) => window.comparison.winRateDrop > 15)) {
    flags.push('WALK_FORWARD_WIN_RATE_DROP_GT_15');
  }

  if (windows.some((window) => window.outOfSample.expectancy < 0)) {
    flags.push('WALK_FORWARD_NEGATIVE_OOS_WINDOW');
  }

  if (profitConcentration > 0.6) {
    flags.push('WALK_FORWARD_PROFIT_CONCENTRATION');
  }

  return {
    windows,
    flags,
    pass: flags.length === 0 && windows.length > 0,
    summary: {
      positiveOosWindows: windows.filter((window) => window.outOfSample.expectancy > 0).length,
      totalWindows: windows.length,
      profitConcentration: round(profitConcentration),
    },
  };
}

export function validateBacktest(candles, pair, timeframe, options = {}) {
  const splitRatio = options.splitRatio ?? 0.7;
  const splitIndex = Math.floor(candles.length * splitRatio);
  const minLookback = Math.max(DEFAULT_MIN_LOOKBACK, options.minLookback ?? DEFAULT_MIN_LOOKBACK);
  const inSample = runBacktest(candles, pair, timeframe, {
    ...options,
    startIndex: minLookback - 1,
    endIndex: splitIndex - 1,
  });
  const outOfSample = runBacktest(candles, pair, timeframe, {
    ...options,
    startIndex: splitIndex,
    endIndex: candles.length - 1,
  });
  const splitValidation = evaluateSplitValidation(inSample, outOfSample);
  const walkForward = buildWalkForwardWindows(candles, pair, timeframe, options);
  const flags = [...new Set([...splitValidation.flags, ...walkForward.flags])];

  return {
    splitIndex,
    splitRatio,
    inSample,
    outOfSample,
    comparison: splitValidation.comparison,
    walkForward,
    overfittingDetected: flags.length > 0,
    flags,
  };
}
