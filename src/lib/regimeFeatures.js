import { calculateAtr } from './indicators.js';

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function percentileRank(values, value) {
  const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!clean.length || !Number.isFinite(value)) {
    return null;
  }

  return clean.filter((item) => item <= value).length / clean.length;
}

function classifyVolatility(percentile) {
  if (!Number.isFinite(percentile)) {
    return null;
  }
  if (percentile < 0.25) {
    return 'LOW';
  }
  if (percentile < 0.75) {
    return 'NORMAL';
  }
  if (percentile < 0.9) {
    return 'HIGH';
  }
  return 'EXTREME';
}

function classifyTrend({ price, emaFast, emaSlow, ema200, emaSlope }) {
  if ([price, emaFast, emaSlow].some((value) => !Number.isFinite(value))) {
    return null;
  }

  const bullishStack = price > emaFast && emaFast > emaSlow && (!Number.isFinite(ema200) || emaSlow > ema200);
  const bearishStack = price < emaFast && emaFast < emaSlow && (!Number.isFinite(ema200) || emaSlow < ema200);

  if (bullishStack && emaSlope > 0.02) {
    return 'BULLISH';
  }
  if (bearishStack && emaSlope < -0.02) {
    return 'BEARISH';
  }
  return 'SIDEWAYS';
}

function rollingAtrValues(candles, period = 14, lookback = 100) {
  const values = [];
  const start = Math.max(period + 1, candles.length - lookback);

  for (let end = start; end <= candles.length; end += 1) {
    const atr = calculateAtr(candles.slice(0, end), period);
    if (Number.isFinite(atr)) {
      values.push(atr);
    }
  }

  return values;
}

function impulseSizeAtr(candles, atr, lookback = 10) {
  if (!Number.isFinite(atr) || atr <= 0 || candles.length < lookback + 1) {
    return null;
  }

  const recent = candles.slice(-lookback - 1);
  const first = recent[0];
  const last = recent.at(-1);
  if (!Number.isFinite(first?.close) || !Number.isFinite(last?.close)) {
    return null;
  }

  return Math.abs(last.close - first.close) / atr;
}

function rangeCompressionScore(candles, atr, lookback = 20) {
  if (!Number.isFinite(atr) || atr <= 0 || candles.length < lookback) {
    return null;
  }

  const recent = candles.slice(-lookback);
  const high = Math.max(...recent.map((candle) => candle.high));
  const low = Math.min(...recent.map((candle) => candle.low));
  const rangeAtr = (high - low) / atr;
  if (!Number.isFinite(rangeAtr)) {
    return null;
  }

  return Math.max(0, Math.min(100, (1 - Math.min(rangeAtr, 4) / 4) * 100));
}

function pullbackDepthAtr({ candle, indicators, direction, atr }) {
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(candle?.close) || !Number.isFinite(indicators?.ema20)) {
    return null;
  }

  const reference = Number.isFinite(indicators.support) && direction === 'LONG'
    ? Math.max(indicators.support, indicators.ema20)
    : Number.isFinite(indicators.resistance) && direction === 'SHORT'
      ? Math.min(indicators.resistance, indicators.ema20)
      : indicators.ema20;

  return Math.abs(candle.close - reference) / atr;
}

export function extractRegimeFeatures({
  candles,
  indicators = {},
  setup = {},
  timeframe = null,
  atrLookback = 100,
  emaSlopeLookback = 8,
  impulseLookback = 10,
} = {}) {
  const window = Array.isArray(candles) ? candles : [];
  const candle = window.at(-1);
  const atr = Number(indicators?.atr);
  const atrSeries = rollingAtrValues(window, 14, atrLookback);
  const atrPercentile = percentileRank(atrSeries, atr);
  const emaFast = Number(indicators?.ema20);
  const emaSlow = Number(indicators?.ema50);
  const ema200 = Number(indicators?.ema200);
  const emaSeries = Array.isArray(indicators?.ema20Series) ? indicators.ema20Series : [];
  const emaNow = Number(emaSeries.at(-1)?.value ?? emaFast);
  const emaPast = Number(emaSeries.at(-1 - emaSlopeLookback)?.value);
  const emaSlope = Number.isFinite(emaNow) && Number.isFinite(emaPast) && emaPast !== 0
    ? ((emaNow - emaPast) / emaPast) * 100
    : null;
  const emaSeparationPercent = Number.isFinite(emaFast) && Number.isFinite(emaSlow) && emaSlow !== 0
    ? Math.abs(((emaFast - emaSlow) / emaSlow) * 100)
    : null;
  const trendStrengthScore = Number.isFinite(emaSlope) && Number.isFinite(emaSeparationPercent)
    ? Math.min(100, Math.abs(emaSlope) * 10 + emaSeparationPercent * 20)
    : null;
  const direction = setup?.selectedDirection ?? (['LONG', 'SHORT'].includes(setup?.signal) ? setup.signal : null);
  const support = Number(indicators?.support);
  const resistance = Number(indicators?.resistance);
  const distanceToSupportAtr = Number.isFinite(candle?.close) && Number.isFinite(support) && Number.isFinite(atr) && atr > 0
    ? (candle.close - support) / atr
    : null;
  const distanceToResistanceAtr = Number.isFinite(candle?.close) && Number.isFinite(resistance) && Number.isFinite(atr) && atr > 0
    ? (resistance - candle.close) / atr
    : null;
  const volatilityRegime = classifyVolatility(atrPercentile);
  const trendRegime = classifyTrend({
    price: Number(candle?.close),
    emaFast,
    emaSlow,
    ema200,
    emaSlope,
  });
  const missingReasons = [];

  if (!Number.isFinite(atr)) missingReasons.push('atr_unavailable');
  if (!Number.isFinite(atrPercentile)) missingReasons.push('atr_percentile_unavailable');
  if (!Number.isFinite(emaSlope)) missingReasons.push('ema_slope_unavailable');
  if (!Number.isFinite(support)) missingReasons.push('support_unavailable');
  if (!Number.isFinite(resistance)) missingReasons.push('resistance_unavailable');

  return {
    computedAt: Number.isFinite(candle?.time) ? candle.time * 1000 : null,
    timeframe,
    atr: round(atr),
    atrPercentile: round(atrPercentile),
    emaFast: round(emaFast),
    emaSlow: round(emaSlow),
    ema200: round(ema200),
    emaSlope: round(emaSlope),
    emaSeparationPercent: round(emaSeparationPercent),
    trendDirection: direction,
    trendStrengthScore: round(trendStrengthScore, 2),
    chopScore: round(rangeCompressionScore(window, atr), 2),
    rangeCompressionScore: round(rangeCompressionScore(window, atr), 2),
    impulseSizeAtr: round(impulseSizeAtr(window, atr, impulseLookback)),
    impulseSizeR: round(impulseSizeAtr(window, atr, impulseLookback)),
    pullbackDepthAtr: round(pullbackDepthAtr({ candle, indicators, direction, atr })),
    distanceToSupportAtr: round(distanceToSupportAtr),
    distanceToResistanceAtr: round(distanceToResistanceAtr),
    volatilityRegime,
    trendRegime,
    sessionHourUtc: Number.isFinite(candle?.time) ? new Date(candle.time * 1000).getUTCHours() : null,
    dayOfWeekUtc: Number.isFinite(candle?.time) ? new Date(candle.time * 1000).getUTCDay() : null,
    recentAtrMean: round(average(atrSeries)),
    missingReasons,
  };
}
