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
  const previousRecentWindow = recentWindow.slice(0, -1);
  const recentVolumes = recentWindow.map((candle) => candle.volume);
  const currentVolume = recentVolumes[recentVolumes.length - 1] ?? 0;
  const averageVolume = average(recentVolumes.slice(0, -1));
  const support = Math.min(...recentWindow.map((candle) => candle.low));
  const resistance = Math.max(...recentWindow.map((candle) => candle.high));
  const previousSupport = Math.min(...previousRecentWindow.map((candle) => candle.low));
  const previousResistance = Math.max(...previousRecentWindow.map((candle) => candle.high));
  const lastCandle = candles[candles.length - 1];
  const price = lastCandle?.close ?? null;
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
    macd,
    macdSeriesTail: buildMacdHistogram(candles, 10),
    volumeSpike: averageVolume > 0 ? currentVolume > averageVolume * 1.5 : false,
    currentVolume,
    averageVolume,
    support,
    resistance,
    previousSupport,
    previousResistance,
    recentCandles: candles.slice(-20),
    latestHigh: highs[highs.length - 1] ?? null,
    latestLow: lows[lows.length - 1] ?? null,
    lastCandle,
    change24h: calculateChangePercent(candles),
  };
}
