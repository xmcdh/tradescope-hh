import { EMA, MACD, RSI } from 'technicalindicators';

const TIMEFRAME_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

export function formatPrice(value) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toFixed(6);
}

function tailValue(values) {
  return values.length ? Number(values[values.length - 1]) : null;
}

function average(values) {
  if (!values.length) return 0;
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
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return Infinity;
  return Math.abs(((left - right) / right) * 100);
}

function withinPercent(value, level, percent) {
  return Number.isFinite(value) && Number.isFinite(level) && level !== 0 && Math.abs(((value - level) / level) * 100) <= percent;
}

function isStrictlyRising(values) {
  return values.length >= 3 && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function isStrictlyFalling(values) {
  return values.length >= 3 && values.every((value, index) => index === 0 || value < values[index - 1]);
}

export function calculateChangePercent(candles, periodsBack = 96) {
  if (!candles?.length) return null;
  const current = candles[candles.length - 1]?.close;
  const anchorIndex = Math.max(0, candles.length - 1 - periodsBack);
  const anchor = candles[anchorIndex]?.close;
  if (!Number.isFinite(current) || !Number.isFinite(anchor) || anchor === 0) return null;
  return ((current - anchor) / anchor) * 100;
}

export function buildEmaLineSeries(candles, period) {
  if (!candles || candles.length < period) return [];
  const values = EMA.calculate({ period, values: candles.map((candle) => candle.close) });
  return mapAlignedSeries(candles, values, period);
}

export function buildMacdHistogram(candles, points = 10) {
  if (!candles || candles.length < 35) return [];
  const series = MACD.calculate({
    values: candles.map((candle) => candle.close),
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  return series.slice(-points).map((entry, index) => ({
    index,
    histogram: Number(entry.histogram ?? 0),
    macd: Number(entry.MACD ?? entry.macd ?? 0),
    signal: Number(entry.signal ?? 0),
  }));
}

export function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trueRanges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index]?.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  if (trueRanges.length < period || trueRanges.some((value) => !Number.isFinite(value))) return null;
  let atr = average(trueRanges.slice(0, period));
  for (const trueRange of trueRanges.slice(period)) atr = (atr * (period - 1) + trueRange) / period;
  return Number.isFinite(atr) ? atr : null;
}

function emptyMarketStructure(summary = 'Insufficient candles for market structure analysis.') {
  return {
    structure: 'NEUTRAL',
    swingHighs: [],
    swingLows: [],
    bos: { detected: false, direction: null, level: null, candlesAgo: null, confirmation: null },
    retest: { detected: false, complete: false, level: null, candlesAgo: null },
    failedRetest: { detected: false, level: null, candlesAgo: null },
    liquiditySweep: { detected: false, direction: null, level: null, candlesAgo: null, reclaimed: false },
    structureSummary: summary,
  };
}

function buildPivotLevels(candles, lookback = 50, thresholdPercent = 0.6) {
  const window = candles.slice(-lookback);
  if (window.length < 6) return { support: null, resistance: null, swingHighs: [], swingLows: [] };
  const pivots = [];
  let direction = 0;
  let extremeHigh = { price: window[0].high, time: window[0].time };
  let extremeLow = { price: window[0].low, time: window[0].time };
  for (const candle of window.slice(1)) {
    if (candle.high > extremeHigh.price) extremeHigh = { price: candle.high, time: candle.time };
    if (candle.low < extremeLow.price) extremeLow = { price: candle.low, time: candle.time };
    if (direction >= 0 && percentDiff(candle.low, extremeHigh.price) >= thresholdPercent) {
      pivots.push({ type: 'high', ...extremeHigh });
      direction = -1;
      extremeLow = { price: candle.low, time: candle.time };
    }
    if (direction <= 0 && percentDiff(candle.high, extremeLow.price) >= thresholdPercent) {
      pivots.push({ type: 'low', ...extremeLow });
      direction = 1;
      extremeHigh = { price: candle.high, time: candle.time };
    }
  }
  const swingHighs = pivots.filter((pivot) => pivot.type === 'high').map((pivot) => pivot.price);
  const swingLows = pivots.filter((pivot) => pivot.type === 'low').map((pivot) => pivot.price);
  return { support: swingLows.at(-1) ?? null, resistance: swingHighs.at(-1) ?? null, swingHighs, swingLows };
}

function resolveSupportResistance(candles, timeframe) {
  const recentWindow = candles.slice(-20);
  const previousRecentWindow = recentWindow.slice(0, -1);
  const simpleSupport = recentWindow.length ? Math.min(...recentWindow.map((candle) => candle.low)) : null;
  const simpleResistance = recentWindow.length ? Math.max(...recentWindow.map((candle) => candle.high)) : null;
  const previousSupport = previousRecentWindow.length ? Math.min(...previousRecentWindow.map((candle) => candle.low)) : null;
  const previousResistance = previousRecentWindow.length ? Math.max(...previousRecentWindow.map((candle) => candle.high)) : null;
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
  return { support, resistance, previousSupport, previousResistance, simpleSupport, simpleResistance, pivotSupport: pivot.support, pivotResistance: pivot.resistance, supportStrength, resistanceStrength, htfConfluence };
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
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function detectBos(candles, swingHighPoints, swingLowPoints) {
  const scanStart = Math.max(0, candles.length - 12);
  for (let candleIndex = candles.length - 1; candleIndex >= scanStart; candleIndex -= 1) {
    const candle = candles[candleIndex];
    const previousSwingHigh = swingHighPoints.filter((point) => point.index < candleIndex).at(-1);
    const previousSwingLow = swingLowPoints.filter((point) => point.index < candleIndex).at(-1);
    const bullishBreak = previousSwingHigh && candle.close > previousSwingHigh.price;
    const bearishBreak = previousSwingLow && candle.close < previousSwingLow.price;
    if (bullishBreak && bearishBreak) continue;
    if (bullishBreak) return { detected: true, direction: 'bullish', level: previousSwingHigh.price, candlesAgo: candles.length - 1 - candleIndex, confirmation: 'close' };
    if (bearishBreak) return { detected: true, direction: 'bearish', level: previousSwingLow.price, candlesAgo: candles.length - 1 - candleIndex, confirmation: 'close' };
  }
  return { detected: false, direction: null, level: null, candlesAgo: null, confirmation: null };
}

function detectRetest(candles, bos) {
  if (!bos.detected || !Number.isFinite(bos.level) || !Number.isInteger(bos.candlesAgo)) return { retest: { detected: false, complete: false, level: null, candlesAgo: null }, failedRetest: { detected: false, level: null, candlesAgo: null } };
  const breakIndex = candles.length - 1 - bos.candlesAgo;
  const afterBreak = candles.slice(breakIndex + 1, breakIndex + 1 + 6);
  let touched = false;
  let complete = false;
  let failed = false;
  let touchIndex = null;
  for (let index = 0; index < afterBreak.length; index += 1) {
    const candle = afterBreak[index];
    const touches = candle.low <= bos.level && candle.high >= bos.level;
    const near = withinPercent(candle.low, bos.level, 0.35) || withinPercent(candle.high, bos.level, 0.35);
    if (!touches && !near) continue;
    touched = true;
    touchIndex = breakIndex + 1 + index;
    if (bos.direction === 'bullish') {
      if (candle.close < bos.level) failed = true;
      else if (candle.close > bos.level) complete = true;
    } else {
      if (candle.close > bos.level) failed = true;
      else if (candle.close < bos.level) complete = true;
    }
    if (failed) break;
  }
  const candlesAgo = touchIndex == null ? null : candles.length - 1 - touchIndex;
  return { retest: { detected: touched, complete: complete && !failed, level: touched ? bos.level : null, candlesAgo }, failedRetest: { detected: failed, level: failed ? bos.level : null, candlesAgo: failed ? candlesAgo : null } };
}

function detectLiquiditySweep(candles, swingHighPoints, swingLowPoints) {
  const scanStart = Math.max(0, candles.length - 8);
  for (let index = candles.length - 1; index >= scanStart; index -= 1) {
    const candle = candles[index];
    const priorHigh = swingHighPoints.filter((point) => point.index < index).at(-1);
    const priorLow = swingLowPoints.filter((point) => point.index < index).at(-1);
    if (priorLow && candle.low < priorLow.price && candle.close > priorLow.price) return { detected: true, direction: 'bullish', level: priorLow.price, candlesAgo: candles.length - 1 - index, reclaimed: true };
    if (priorHigh && candle.high > priorHigh.price && candle.close < priorHigh.price) return { detected: true, direction: 'bearish', level: priorHigh.price, candlesAgo: candles.length - 1 - index, reclaimed: true };
  }
  return { detected: false, direction: null, level: null, candlesAgo: null, reclaimed: false };
}

export function analyzeMarketStructure(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return emptyMarketStructure();

  // The final candle may still be forming. Structure signals must be based only on closed candles.
  const closedCandles = candles.length > 1 ? candles.slice(0, -1) : [];
  if (closedCandles.length < 5) return emptyMarketStructure('Insufficient closed candles for market structure analysis.');

  const swingHighPoints = [];
  const swingLowPoints = [];
  for (let index = 2; index < closedCandles.length - 2; index += 1) {
    const candle = closedCandles[index];
    const isSwingHigh = candle.high > closedCandles[index - 1].high && candle.high > closedCandles[index - 2].high && candle.high > closedCandles[index + 1].high && candle.high > closedCandles[index + 2].high;
    const isSwingLow = candle.low < closedCandles[index - 1].low && candle.low < closedCandles[index - 2].low && candle.low < closedCandles[index + 1].low && candle.low < closedCandles[index + 2].low;
    if (isSwingHigh) swingHighPoints.push({ price: candle.high, index });
    if (isSwingLow) swingLowPoints.push({ price: candle.low, index });
  }

  const swingHighs = swingHighPoints.slice(-5).map((point) => point.price);
  const swingLows = swingLowPoints.slice(-5).map((point) => point.price);
  const lastThreeHighs = swingHighs.slice(-3);
  const lastThreeLows = swingLows.slice(-3);
  const hasBullishStructure = isStrictlyRising(lastThreeHighs) && isStrictlyRising(lastThreeLows);
  const hasBearishStructure = isStrictlyFalling(lastThreeHighs) && isStrictlyFalling(lastThreeLows);
  const structure = hasBullishStructure ? 'BULLISH' : hasBearishStructure ? 'BEARISH' : 'NEUTRAL';
  const bos = detectBos(closedCandles, swingHighPoints, swingLowPoints);
  const { retest, failedRetest } = detectRetest(closedCandles, bos);
  const liquiditySweep = detectLiquiditySweep(closedCandles, swingHighPoints, swingLowPoints);

  const structureSummary = [
    `Structure ${structure}.`,
    swingHighs.length && swingLows.length ? `Last swings: highs ${swingHighs.slice(-3).join(', ')}, lows ${swingLows.slice(-3).join(', ')}.` : 'Not enough swing points for a clean HH/HL or LL/LH sequence.',
    bos.detected ? `${bos.direction} BOS by candle close at ${bos.level} (${bos.candlesAgo} candles ago).` : 'No confirmed BOS in the recent structure window.',
    retest.detected ? `Retest ${retest.complete ? 'complete' : 'not confirmed'} at ${retest.level}.` : 'No post-BOS retest detected.',
    failedRetest.detected ? `Failed retest at ${failedRetest.level}.` : '',
    liquiditySweep.detected ? `${liquiditySweep.direction} liquidity sweep reclaimed ${liquiditySweep.level}.` : 'No confirmed liquidity sweep.',
  ].filter(Boolean).join(' ');

  return { structure, swingHighs, swingLows, bos, retest, failedRetest, liquiditySweep, structureSummary };
}

export function calculateIndicators(candles, timeframe = '15m') {
  if (!Array.isArray(candles) || candles.length < 60) return null;
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
  const macdSeries = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const macd = macdSeries.length ? macdSeries.at(-1) : null;
  const recentWindow = candles.slice(-20);
  const recentVolumes = recentWindow.map((candle) => candle.volume);
  const currentVolume = recentVolumes.at(-1) ?? 0;
  const averageVolume = average(recentVolumes.slice(0, -1));
  const supportLevels = resolveSupportResistance(candles, timeframe);
  const lastCandle = candles.at(-1);
  const previousCandle = candles.at(-2);
  const price = lastCandle?.close ?? null;
  const lastCandleRange = Number.isFinite(lastCandle?.high) && Number.isFinite(lastCandle?.low) ? lastCandle.high - lastCandle.low : null;
  const timestampSource = Number.isFinite(lastCandle?.closeTime) ? lastCandle.closeTime : lastCandle?.time;
  const currentTimestamp = Number.isFinite(timestampSource) ? (timestampSource > 10_000_000_000 ? timestampSource : timestampSource * 1000) : null;
  const lastUpdate = currentTimestamp;
  const stale = Number.isFinite(lastUpdate) ? Date.now() - lastUpdate > timeframeMs(timeframe) * 2 : true;
  const coreValid = Boolean(ema20 != null && ema50 != null && rsi != null && atr != null && macd && Number.isFinite(price));
  const dataStatus = coreValid ? { valid: true, reason: null } : { valid: false, reason: 'indicator_calculation_incomplete' };
  return {
    valid: dataStatus.valid,
    reason: dataStatus.reason,
    ema200Valid,
    stale,
    lastUpdate,
    currentTimestamp,
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
    extendedCandles: candles.slice(-150),
    latestHigh: highs.at(-1) ?? null,
    latestLow: lows.at(-1) ?? null,
    lastCandle,
    previousCandle,
    lastCandleRange,
    shortPriceChange: calculateChangePercent(candles, 4),
    change24h: calculateChangePercent(candles),
  };
}
