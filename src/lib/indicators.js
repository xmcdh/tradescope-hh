import { EMA, MACD, RSI } from 'technicalindicators';

const TIMEFRAME_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

export function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  if (value >= 1000) {
    return value.toFixed(2);
  }

  if (value >= 1) {
    return value.toFixed(4);
  }

  if (value >= 0.01) {
    return value.toFixed(5);
  }

  return value.toFixed(6);
}

function tailValue(values) {
  return values.length ? Number(values[values.length - 1]) : null;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mapAlignedSeries(candles, values, period) {
  return values.map((value, index) => ({
    time: candles[index + period - 1].time,
    value: Number(value),
  }));
}

function timeframeMs(timeframe) {
  return TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS['15m'];
}

function percentDiff(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) {
    return Infinity;
  }

  return Math.abs(((left - right) / right) * 100);
}

export function calculateChangePercent(candles, periodsBack = 96) {
  if (!candles?.length) {
    return null;
  }

  const current = candles[candles.length - 1]?.close;
  const anchorIndex = Math.max(0, candles.length - 1 - periodsBack);
  const anchor = candles[anchorIndex]?.close;

  if (!Number.isFinite(current) || !Number.isFinite(anchor) || anchor === 0) {
    return null;
  }

  return ((current - anchor) / anchor) * 100;
}

export function buildEmaLineSeries(candles, period) {
  if (!candles || candles.length < period) {
    return [];
  }

  const closes = candles.map((candle) => candle.close);
  const values = EMA.calculate({ period, values: closes });
  return mapAlignedSeries(candles, values, period);
}

export function buildMacdHistogram(candles, points = 10) {
  if (!candles || candles.length < 35) {
    return [];
  }

  const closes = candles.map((candle) => candle.close);
  const series = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  return series.slice(-points).map((entry, index) => ({
    index,
    histogram: Number(entry.histogram ?? 0),
    macd: Number(entry.macd ?? 0),
    signal: Number(entry.signal ?? 0),
  }));
}

export function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return null;
  }

  const trueRanges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index]?.close;
    const highLow = candle.high - candle.low;
    const highPreviousClose = Math.abs(candle.high - previousClose);
    const lowPreviousClose = Math.abs(candle.low - previousClose);

    return Math.max(highLow, highPreviousClose, lowPreviousClose);
  });

  if (trueRanges.length < period || trueRanges.some((value) => !Number.isFinite(value))) {
    return null;
  }

  let atr = average(trueRanges.slice(0, period));
  for (const trueRange of trueRanges.slice(period)) {
    atr = (atr * (period - 1) + trueRange) / period;
  }

  return Number.isFinite(atr) ? atr : null;
}

function emptyMarketStructure(summary = 'Insufficient candles for market structure analysis.') {
  return {
    structure: 'NEUTRAL',
    swingHighs: [],
    swingLows: [],
    bos: { detected: false, direction: null, level: null, candlesAgo: null },
    retest: { detected: false, complete: false, level: null },
    failedRetest: { detected: false, level: null },
    structureSummary: summary,
  };
}

function withinPercent(value, level, percent) {
  if (!Number.isFinite(value) || !Number.isFinite(level) || level === 0) {
    return false;
  }

  return Math.abs(((value - level) / level) * 100) <= percent;
}

function isStrictlyRising(values) {
  return values.length >= 3 && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function isStrictlyFalling(values) {
  return values.length >= 3 && values.every((value, index) => index === 0 || value < values[index - 1]);
}

function aggregateCandles(candles, bucketSeconds) {
  const buckets = new Map();

  candles.forEach((candle) => {
    const bucket = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const current = buckets.get(bucket);

    if (!current) {
      buckets.set(bucket, { ...candle, time: bucket });
      return;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  });

  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

function buildPivotLevels(candles, lookback = 50, thresholdPercent = 0.6) {
  const window = candles.slice(-lookback);
  if (window.length < 6) {
    return {
      support: null,
      resistance: null,
      swingHighs: [],
      swingLows: [],
    };
  }

  const pivots = [];
  let direction = 0;
  let extremeHigh = { price: window[0].high, time: window[0].time };
  let extremeLow = { price: window[0].low, time: window[0].time };

  for (const candle of window.slice(1)) {
    if (candle.high > extremeHigh.price) {
      extremeHigh = { price: candle.high, time: candle.time };
    }

    if (candle.low < extremeLow.price) {
      extremeLow = { price: candle.low, time: candle.time };
    }

    if (direction >= 0) {
      const drawdown = percentDiff(candle.low, extremeHigh.price);
      if (drawdown >= thresholdPercent) {
        pivots.push({ type: 'high', ...extremeHigh });
        direction = -1;
        extremeLow = { price: candle.low, time: candle.time };
      }
    }

    if (direction <= 0) {
      const rebound = percentDiff(candle.high, extremeLow.price);
      if (rebound >= thresholdPercent) {
        pivots.push({ type: 'low', ...extremeLow });
        direction = 1;
        extremeHigh = { price: candle.high, time: candle.time };
      }
    }
  }

  const swingHighs = pivots.filter((pivot) => pivot.type === 'high').map((pivot) => pivot.price);
  const swingLows = pivots.filter((pivot) => pivot.type === 'low').map((pivot) => pivot.price);

  return {
    support: swingLows.at(-1) ?? null,
    resistance: swingHighs.at(-1) ?? null,
    swingHighs,
    swingLows,
  };
}

function resolveSupportResistance(candles, timeframe) {
  const recentWindow = candles.slice(-20);
  const previousRecentWindow = recentWindow.slice(0, -1);
  const simpleSupport = Math.min(...recentWindow.map((candle) => candle.low));
  const simpleResistance = Math.max(...recentWindow.map((candle) => candle.high));
  const previousSupport = Math.min(...previousRecentWindow.map((candle) => candle.low));
  const previousResistance = Math.max(...previousRecentWindow.map((candle) => candle.high));
  const pivot = buildPivotLevels(candles, 50, 0.6);

  let support = Number.isFinite(pivot.support) ? pivot.support : simpleSupport;
  let resistance = Number.isFinite(pivot.resistance) ? pivot.resistance : simpleResistance;
  let supportStrength = Number.isFinite(pivot.support) ? 'pivot' : 'simple';
  let resistanceStrength = Number.isFinite(pivot.resistance) ? 'pivot' : 'simple';
  let htfConfluence = null;

  if (timeframe === '1h') {
    const fourHourCandles = aggregateCandles(candles, 4 * 60 * 60);
    const higherTimeframe = buildPivotLevels(fourHourCandles, 50, 0.6);

    if (Number.isFinite(higherTimeframe.support) && percentDiff(higherTimeframe.support, support) <= 0.3) {
      support = higherTimeframe.support;
      supportStrength = 'strong';
      htfConfluence = { ...(htfConfluence ?? {}), support: higherTimeframe.support };
    }

    if (Number.isFinite(higherTimeframe.resistance) && percentDiff(higherTimeframe.resistance, resistance) <= 0.3) {
      resistance = higherTimeframe.resistance;
      resistanceStrength = 'strong';
      htfConfluence = { ...(htfConfluence ?? {}), resistance: higherTimeframe.resistance };
    }
  }

  return {
    support,
    resistance,
    previousSupport,
    previousResistance,
    simpleSupport,
    simpleResistance,
    pivotSupport: pivot.support,
    pivotResistance: pivot.resistance,
    supportStrength,
    resistanceStrength,
    htfConfluence,
  };
}

function detectBos(candles, swingHighPoints, swingLowPoints) {
  const lastThree = candles.slice(-3);
  const startIndex = candles.length - lastThree.length;

  for (let index = lastThree.length - 1; index >= 0; index -= 1) {
    const candle = lastThree[index];
    const candleIndex = startIndex + index;
    const candlesAgo = lastThree.length - 1 - index;
    const previousSwingHigh = swingHighPoints.filter((point) => point.index < candleIndex).at(-1)?.price;
    const previousSwingLow = swingLowPoints.filter((point) => point.index < candleIndex).at(-1)?.price;

    if (Number.isFinite(previousSwingHigh) && candle.high > previousSwingHigh) {
      return { detected: true, direction: 'bullish', level: previousSwingHigh, candlesAgo };
    }

    if (Number.isFinite(previousSwingLow) && candle.low < previousSwingLow) {
      return { detected: true, direction: 'bearish', level: previousSwingLow, candlesAgo };
    }
  }

  return { detected: false, direction: null, level: null, candlesAgo: null };
}

function detectRetest(candles, bos) {
  if (!bos.detected || !Number.isFinite(bos.level) || !Number.isInteger(bos.candlesAgo)) {
    return {
      retest: { detected: false, complete: false, level: null },
      failedRetest: { detected: false, level: null },
    };
  }

  const breakIndex = candles.length - 1 - bos.candlesAgo;
  const afterBreak = candles.slice(breakIndex + 1);
  let touched = false;
  let complete = false;
  let failed = false;

  afterBreak.forEach((candle) => {
    const touchedLevel = candle.low <= bos.level && candle.high >= bos.level;
    const nearLevel = withinPercent(candle.low, bos.level, 0.5) || withinPercent(candle.high, bos.level, 0.5);

    if (!touchedLevel && !nearLevel) {
      return;
    }

    touched = true;

    if (bos.direction === 'bullish') {
      if (candle.close > bos.level) {
        complete = true;
      }
      if (candle.close < bos.level) {
        failed = true;
      }
      return;
    }

    if (candle.close < bos.level) {
      complete = true;
    }
    if (candle.close > bos.level) {
      failed = true;
    }
  });

  return {
    retest: { detected: touched, complete: complete && !failed, level: touched ? bos.level : null },
    failedRetest: { detected: failed, level: failed ? bos.level : null },
  };
}

export function analyzeMarketStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 5) {
    return emptyMarketStructure();
  }

  const swingHighPoints = [];
  const swingLowPoints = [];

  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const isSwingHigh =
      candle.high > candles[index - 1].high &&
      candle.high > candles[index - 2].high &&
      candle.high > candles[index + 1].high &&
      candle.high > candles[index + 2].high;
    const isSwingLow =
      candle.low < candles[index - 1].low &&
      candle.low < candles[index - 2].low &&
      candle.low < candles[index + 1].low &&
      candle.low < candles[index + 2].low;

    if (isSwingHigh) {
      swingHighPoints.push({ price: candle.high, index });
    }

    if (isSwingLow) {
      swingLowPoints.push({ price: candle.low, index });
    }
  }

  const lastSwingHighs = swingHighPoints.slice(-5);
  const lastSwingLows = swingLowPoints.slice(-5);
  const swingHighs = lastSwingHighs.map((point) => point.price);
  const swingLows = lastSwingLows.map((point) => point.price);
  const lastThreeHighs = swingHighs.slice(-3);
  const lastThreeLows = swingLows.slice(-3);
  const hasBullishStructure = isStrictlyRising(lastThreeHighs) && isStrictlyRising(lastThreeLows);
  const hasBearishStructure = isStrictlyFalling(lastThreeHighs) && isStrictlyFalling(lastThreeLows);
  const structure = hasBullishStructure ? 'BULLISH' : hasBearishStructure ? 'BEARISH' : 'NEUTRAL';
  const bos = detectBos(candles, swingHighPoints, swingLowPoints);
  const { retest, failedRetest } = detectRetest(candles, bos);
  const structureSummary = [
    `Structure ${structure}.`,
    swingHighs.length && swingLows.length
      ? `Last swings: highs ${swingHighs.slice(-3).join(', ')}, lows ${swingLows.slice(-3).join(', ')}.`
      : 'Not enough swing points for clean HH/HL or LL/LH sequence.',
    bos.detected ? `${bos.direction} BOS at ${bos.level} (${bos.candlesAgo} candles ago).` : 'No BOS in last 3 candles.',
    retest.detected ? `Retest ${retest.complete ? 'complete' : 'pending'} at ${retest.level}.` : 'No retest detected.',
    failedRetest.detected ? `Failed retest at ${failedRetest.level}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    structure,
    swingHighs,
    swingLows,
    bos,
    retest,
    failedRetest,
    structureSummary,
  };
}

export function calculateIndicators(candles, timeframe = '15m') {
  if (!candles || candles.length < 60) {
    return null;
  }

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);

  const ema20Series = buildEmaLineSeries(candles, 20);
  const ema50Series = buildEmaLineSeries(candles, 50);
  const ema200Valid = candles.length >= 200;
  const ema200Series = ema200Valid ? buildEmaLineSeries(candles, 200) : [];

  const ema20 = tailValue(ema20Series.map((item) => item.value));
  const ema50 = tailValue(ema50Series.map((item) => item.value));
  const ema200 = ema200Valid ? tailValue(ema200Series.map((item) => item.value)) : null;

  const rsi = tailValue(RSI.calculate({ period: 14, values: closes }));
  const atr = calculateAtr(candles, 14);
  const marketStructure = analyzeMarketStructure(candles);
  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macd = macdSeries.length ? macdSeries[macdSeries.length - 1] : null;

  const recentWindow = candles.slice(-20);
  const recentVolumes = recentWindow.map((candle) => candle.volume);
  const currentVolume = recentVolumes[recentVolumes.length - 1] ?? 0;
  const averageVolume = average(recentVolumes.slice(0, -1));
  const supportLevels = resolveSupportResistance(candles, timeframe);
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  const price = lastCandle?.close ?? null;
  const lastCandleRange =
    Number.isFinite(lastCandle?.high) && Number.isFinite(lastCandle?.low) ? lastCandle.high - lastCandle.low : null;
  const lastUpdate = Number.isFinite(lastCandle?.time) ? lastCandle.time * 1000 : null;
  const stale = Number.isFinite(lastUpdate) ? Date.now() - lastUpdate > timeframeMs(timeframe) * 2 : true;
  const dataStatus = ema200Valid
    ? { valid: true, reason: null }
    : { valid: false, reason: 'insufficient_data' };

  return {
    valid: dataStatus.valid,
    reason: dataStatus.reason,
    ema200Valid,
    stale,
    lastUpdate,
    timeframe,
    price,
    ema20,
    ema50,
    ema200,
    ema20Series,
    ema50Series,
    ema200Series,
    rsi,
    atr,
    marketStructure,
    macd,
    macdSeriesTail: buildMacdHistogram(candles, 10),
    volumeSpike: averageVolume > 0 ? currentVolume > averageVolume * 1.5 : false,
    currentVolume,
    averageVolume,
    support: supportLevels.support,
    resistance: supportLevels.resistance,
    previousSupport: supportLevels.previousSupport,
    previousResistance: supportLevels.previousResistance,
    simpleSupport: supportLevels.simpleSupport,
    simpleResistance: supportLevels.simpleResistance,
    pivotSupport: supportLevels.pivotSupport,
    pivotResistance: supportLevels.pivotResistance,
    supportStrength: supportLevels.supportStrength,
    resistanceStrength: supportLevels.resistanceStrength,
    htfConfluence: supportLevels.htfConfluence,
    recentCandles: candles.slice(-20),
    latestHigh: highs[highs.length - 1] ?? null,
    latestLow: lows[lows.length - 1] ?? null,
    lastCandle,
    previousCandle,
    lastCandleRange,
    shortPriceChange: calculateChangePercent(candles, 4),
    change24h: calculateChangePercent(candles),
  };
}
