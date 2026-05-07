const SCORE_MAX = 10;
const FUNDING_CROWDED = 0.0005;
const FUNDING_EXTREME = 0.001;
const SWEEP_STRONG_WICK_ATR = 0.8;
export const V2_BREAKOUT_BLOCK_REASONS = {
  NO_COMPRESSION: 'NO_COMPRESSION',
  NO_BREAKOUT: 'NO_BREAKOUT',
  WEAK_VOLUME_EXPANSION: 'WEAK_VOLUME_EXPANSION',
  WEAK_RANGE_EXPANSION: 'WEAK_RANGE_EXPANSION',
  BODY_TOO_SMALL: 'BODY_TOO_SMALL',
  REJECTION_WICK_TOO_LARGE: 'REJECTION_WICK_TOO_LARGE',
  OPPOSING_LEVEL_TOO_CLOSE: 'OPPOSING_LEVEL_TOO_CLOSE',
  RR_TOO_LOW: 'RR_TOO_LOW',
  ATR_MISSING: 'ATR_MISSING',
  LEVELS_INVALID: 'LEVELS_INVALID',
  OTHER: 'OTHER',
};

export const V2_LIQUIDITY_SWEEP_BLOCK_REASONS = {
  NO_SWEEP: 'NO_SWEEP',
  NO_RECLAIM: 'NO_RECLAIM',
  WEAK_SWEEP: 'WEAK_SWEEP',
  WEAK_RECLAIM: 'WEAK_RECLAIM',
  RANGE_TOO_LARGE: 'RANGE_TOO_LARGE',
  RR_TOO_LOW: 'RR_TOO_LOW',
  ATR_MISSING: 'ATR_MISSING',
  LEVELS_INVALID: 'LEVELS_INVALID',
  STOP_TOO_WIDE: 'STOP_TOO_WIDE',
  RSI_EXTREME: 'RSI_EXTREME',
  OTHER: 'OTHER',
};

export const SIGNAL_MODE_CONFIG = {
  conservative: {
    label: 'Conservative',
    entryScore: 8,
    rrMin: 1.5,
    warning: null,
  },
  balanced: {
    label: 'Balanced',
    entryScore: 7,
    rrMin: 1.3,
    warning: null,
  },
  aggressive: {
    label: 'Aggressive',
    entryScore: 6,
    rrMin: 1.2,
    warning: 'Aggressive mode: lower threshold. Do not use with stale/error data.',
  },
};

const ENTRY_ADVICE = {
  SAFE_ENTRY: 'Clean pullback/retest setup with defined invalidation.',
  MOMENTUM_BREAKOUT: 'Momentum breakout detected. Prefer retest before entry if candle is extended.',
  LATE_ENTRY: 'Move is extended. Wait for pullback toward EMA20/EMA50 or retest area.',
  WAIT_RETEST: 'Breakout/breakdown detected. Wait for retest confirmation before entry.',
  CHOPPY_MARKET: 'Market is ranging. No clean edge. Skip until trend or breakout is clearer.',
  WAIT_CONFIRMATION: 'Setup is forming, but confirmation is not strong enough for execution.',
  NO_TRADE: 'No entry recommended.',
};

function isBtcSymbol(symbol) {
  return String(symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === 'BTCUSDT';
}

export function confidenceMeta(score) {
  if (score >= 8) {
    return { label: 'HIGH', emoji: '🔥' };
  }

  if (score >= 6) {
    return { label: 'FORMING', emoji: '⚡' };
  }

  return { label: 'LOW', emoji: '⚠️' };
}

function round(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(SCORE_MAX, Math.round(value)));
}

function pctDistance(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to === 0) {
    return Infinity;
  }

  return Math.abs(((from - to) / to) * 100);
}

function percentMove(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) {
    return null;
  }

  return ((to - from) / from) * 100;
}

function distanceAbovePercent(entry, level) {
  if (!Number.isFinite(entry) || !Number.isFinite(level) || entry <= 0 || level <= entry) {
    return null;
  }

  return ((level - entry) / entry) * 100;
}

function distanceBelowPercent(entry, level) {
  if (!Number.isFinite(entry) || !Number.isFinite(level) || entry <= 0 || level >= entry) {
    return null;
  }

  return ((entry - level) / entry) * 100;
}

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function normalizeSignalMode(mode) {
  return SIGNAL_MODE_CONFIG[mode] ? mode : 'conservative';
}

export function getSignalModeConfig(mode) {
  return SIGNAL_MODE_CONFIG[normalizeSignalMode(mode)];
}

function classifySignalValidity(confidenceScore, blockedReason) {
  if (blockedReason.length) {
    return 'BLOCKED';
  }

  if (confidenceScore >= 7) {
    return 'VALID';
  }

  return 'MARGINAL';
}

function scoreItem(key, label, points, max, passed, reason = '') {
  return { key, label, points, max, passed: Boolean(passed), reason };
}

function adjustmentItem(key, label, points, reason = '') {
  return { key, label, points, max: points > 0 ? 1 : points < 0 ? 2 : 1, passed: points > 0, reason };
}

function alignTrend({ direction, price, ema20, ema50, ema200 }) {
  return direction === 'LONG'
    ? price > ema20 && ema20 > ema50 && ema50 > ema200
    : price < ema20 && ema20 < ema50 && ema50 < ema200;
}

function macdConfirmed(direction, macd) {
  if (!macd) {
    return false;
  }

  return direction === 'LONG'
    ? macd.MACD > macd.signal && macd.histogram > 0
    : macd.MACD < macd.signal && macd.histogram < 0;
}

function rsiValid(direction, rsi) {
  return direction === 'LONG' ? rsi >= 48 && rsi <= 68 : rsi >= 32 && rsi <= 52;
}

function directionStructure(direction, marketStructure) {
  if (!marketStructure) {
    return false;
  }

  const bullishRetest = marketStructure.bos?.direction === 'bullish' || marketStructure.retest?.complete;
  const bearishRetest = marketStructure.bos?.direction === 'bearish' || marketStructure.retest?.complete;
  const swingHighs = marketStructure.swingHighs ?? [];
  const swingLows = marketStructure.swingLows ?? [];
  const higherLow = swingLows.length >= 2 && swingLows.at(-1) > swingLows.at(-2);
  const lowerHigh = swingHighs.length >= 2 && swingHighs.at(-1) < swingHighs.at(-2);

  return direction === 'LONG'
    ? marketStructure.structure === 'BULLISH' || bullishRetest || higherLow
    : marketStructure.structure === 'BEARISH' || bearishRetest || lowerHigh;
}

function detectMarketRegime(indicators) {
  const {
    valid,
    price,
    ema20,
    ema50,
    ema200,
    rsi,
    macd,
    atr,
    currentVolume,
    averageVolume,
    lastCandleRange,
    marketStructure,
  } = indicators;

  const hasCoreData = valid !== false && [price, ema20, ema50, ema200, rsi, atr].every(Number.isFinite) && macd;
  if (!hasCoreData) {
    return 'INSUFFICIENT_DATA';
  }

  const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 0;
  if (Number.isFinite(lastCandleRange) && Number.isFinite(atr) && atr > 0 && lastCandleRange > atr * 1.8) {
    return 'VOLATILE_SPIKE';
  }

  if (volumeRatio > 1.8 && Number.isFinite(lastCandleRange) && Number.isFinite(atr) && lastCandleRange > atr * 1.3) {
    return 'VOLATILE_SPIKE';
  }

  if (averageVolume > 0 && currentVolume < averageVolume * 0.7) {
    return 'LOW_VOLUME';
  }

  const trendingUp = price > ema20 && ema20 > ema50 && ema50 > ema200 && rsi > 50 && macd.MACD > macd.signal;
  const trendingDown = price < ema20 && ema20 < ema50 && ema50 < ema200 && rsi < 50 && macd.MACD < macd.signal;

  if (trendingUp) {
    return 'TRENDING_UP';
  }

  if (trendingDown) {
    return 'TRENDING_DOWN';
  }

  const macdUnclear = Math.abs(macd.MACD - macd.signal) <= Math.abs(price) * 0.00015;
  const rsiNeutral = rsi >= 45 && rsi <= 55;
  const noBreakout = !marketStructure?.bos?.detected;

  if (rsiNeutral || macdUnclear || noBreakout) {
    return 'CHOPPY_MARKET';
  }

  return 'CHOPPY_MARKET';
}

function levelCandidates(values, predicate) {
  return unique(values.filter(Number.isFinite).filter(predicate)).sort((left, right) => left - right);
}

function buildRiskLevels(direction, indicators, config = {}) {
  const {
    price,
    support,
    resistance,
    ema20,
    ema50,
    atr,
    marketStructure,
  } = indicators;
  const entry1 = price;
  const fallbackPullback = direction === 'LONG' ? price - atr * 0.5 : price + atr * 0.5;
  const swingHighs = marketStructure?.swingHighs ?? [];
  const swingLows = marketStructure?.swingLows ?? [];
  const atrStopMultiplier = Number.isFinite(Number(config.atrStopMultiplier)) ? Number(config.atrStopMultiplier) : 1.5;
  const tp1RTarget = Number.isFinite(Number(config.tp1RTarget)) ? Number(config.tp1RTarget) : 1.5;
  const tp2RTarget = Number.isFinite(Number(config.tp2RTarget)) ? Number(config.tp2RTarget) : 2.5;

  if (!isFinitePositive(price) || !isFinitePositive(atr)) {
    return {
      entry1,
      entry2: null,
      tp1: null,
      tp2: null,
      sl: null,
      risk: null,
      rewardTp1: null,
      rewardTp2: null,
      rrTp1: null,
      rrTp2: null,
      rrRatio: null,
      slAtrMultiple: null,
      atr,
    };
  }

  if (direction === 'LONG') {
    const belowLevels = levelCandidates([support, ema20, ema50, ...swingLows], (level) => level < price);
    const baseSupport = belowLevels.at(-1);
    const entry2 = Number.isFinite(baseSupport) ? baseSupport : fallbackPullback;
    const atrStop = entry1 - atr * atrStopMultiplier;
    const sl = Number.isFinite(baseSupport) ? Math.min(atrStop, baseSupport) : atrStop;
    const risk = entry1 - sl;
    const tp1 = entry1 + risk * tp1RTarget;
    const tp2 = entry1 + risk * tp2RTarget;
    const rewardTp1 = tp1 - entry1;
    const rewardTp2 = tp2 - entry1;
    const rrTp1 = risk > 0 ? rewardTp1 / risk : null;
    const rrTp2 = risk > 0 ? rewardTp2 / risk : null;

    return {
      entry1,
      entry2,
      tp1,
      tp2,
      sl,
      risk,
      rewardTp1,
      rewardTp2,
      rrTp1,
      rrTp2,
      rrRatio: rrTp1,
      slAtrMultiple: Number.isFinite(risk) ? risk / atr : null,
      atr,
    };
  }

  const aboveLevels = levelCandidates([resistance, ema20, ema50, ...swingHighs], (level) => level > price);
  const baseResistance = aboveLevels[0];
  const entry2 = Number.isFinite(baseResistance) ? baseResistance : fallbackPullback;
  const atrStop = entry1 + atr * atrStopMultiplier;
  const sl = Number.isFinite(baseResistance) ? Math.max(atrStop, baseResistance) : atrStop;
  const risk = sl - entry1;
  const tp1 = entry1 - risk * tp1RTarget;
  const tp2 = entry1 - risk * tp2RTarget;
  const rewardTp1 = entry1 - tp1;
  const rewardTp2 = entry1 - tp2;
  const rrTp1 = risk > 0 ? rewardTp1 / risk : null;
  const rrTp2 = risk > 0 ? rewardTp2 / risk : null;

  return {
    entry1,
    entry2,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1,
    rewardTp2,
    rrTp1,
    rrTp2,
    rrRatio: rrTp1,
    slAtrMultiple: Number.isFinite(risk) ? risk / atr : null,
    atr,
  };
}

function levelQuality(direction, indicators) {
  const { price, support, resistance, ema20, ema50, marketStructure } = indicators;
  const nearSupport = pctDistance(price, support) <= 1.8;
  const nearResistance = pctDistance(price, resistance) <= 1.8;
  const nearEma20 = pctDistance(price, ema20) <= 1.2;
  const nearEma50 = pctDistance(price, ema50) <= 1.5;
  const retestComplete = Boolean(marketStructure?.retest?.complete);
  const resistanceDistance = distanceAbovePercent(price, resistance);
  const supportDistance = distanceBelowPercent(price, support);

  if (direction === 'LONG') {
    return {
      passed: (nearSupport || nearEma20 || nearEma50 || retestComplete) && (!Number.isFinite(resistanceDistance) || resistanceDistance > 1.5),
      resistanceDistance,
      supportDistance,
      reason: nearSupport
        ? 'Price near support/demand.'
        : nearEma20 || nearEma50
          ? 'Price near EMA pullback zone.'
          : retestComplete
            ? 'Retest completed.'
            : 'Price not close to a clean long level.',
    };
  }

  return {
    passed: (nearResistance || nearEma20 || nearEma50 || retestComplete) && (!Number.isFinite(supportDistance) || supportDistance > 1.5),
    resistanceDistance,
    supportDistance,
    reason: nearResistance
      ? 'Price near resistance/supply.'
      : nearEma20 || nearEma50
        ? 'Price near EMA pullback zone.'
        : retestComplete
          ? 'Retest completed.'
          : 'Price not close to a clean short level.',
  };
}

function volumeQuality(indicators) {
  const { currentVolume, averageVolume } = indicators;
  if (!(averageVolume > 0)) {
    return { passed: false, reason: 'Volume average unavailable.', ratio: null };
  }

  const ratio = currentVolume / averageVolume;
  return {
    passed: ratio >= 1,
    ratio,
    reason:
      ratio >= 1.5
        ? `Strong volume ${ratio.toFixed(2)}x average.`
        : ratio >= 1.2
          ? `Volume confirmation ${ratio.toFixed(2)}x average.`
          : ratio >= 1
            ? `Volume normal ${ratio.toFixed(2)}x average.`
            : `Volume weak ${ratio.toFixed(2)}x average.`,
    };
}

function lastMacdImproving(direction, macdSeriesTail) {
  if (!Array.isArray(macdSeriesTail) || macdSeriesTail.length < 2) {
    return false;
  }

  const previous = macdSeriesTail.at(-2)?.histogram;
  const current = macdSeriesTail.at(-1)?.histogram;
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return false;
  }

  return direction === 'LONG' ? current > previous : current < previous;
}

function candleDirectionPass(direction, lastCandle, previousCandle) {
  if (!lastCandle || !previousCandle) {
    return false;
  }

  if (direction === 'LONG') {
    return lastCandle.close > lastCandle.open && lastCandle.close > previousCandle.close;
  }

  return lastCandle.close < lastCandle.open && lastCandle.close < previousCandle.close;
}

function touchedLevelWithinPercent(candle, level, percent, direction) {
  if (!candle || !Number.isFinite(level) || level <= 0) {
    return false;
  }

  const tolerance = level * (percent / 100);
  return direction === 'LONG' ? candle.low <= level + tolerance : candle.high >= level - tolerance;
}

function trendPullbackQuality(direction, indicators, config) {
  const { price, ema20, ema50, support, resistance, recentCandles = [] } = indicators;
  const tolerance = Number.isFinite(Number(config.pullbackTolerancePercent))
    ? Number(config.pullbackTolerancePercent)
    : 0.85;
  const lookback = recentCandles.slice(-6);
  const touchedEma20 = lookback.some((candle) => touchedLevelWithinPercent(candle, ema20, tolerance, direction));
  const touchedEma50 = lookback.some((candle) => touchedLevelWithinPercent(candle, ema50, tolerance, direction));
  const touchedStructure =
    direction === 'LONG'
      ? lookback.some((candle) => touchedLevelWithinPercent(candle, support, tolerance, direction))
      : lookback.some((candle) => touchedLevelWithinPercent(candle, resistance, tolerance, direction));
  const nearEma20 = pctDistance(price, ema20) <= tolerance * 1.25;
  const nearEma50 = pctDistance(price, ema50) <= tolerance * 1.75;

  return {
    passed: touchedEma20 || touchedEma50 || touchedStructure || nearEma20 || nearEma50,
    touchedEma20,
    touchedEma50,
    touchedStructure,
    reason: touchedEma20
      ? 'Pullback touched EMA20 value zone.'
      : touchedEma50
        ? 'Pullback touched EMA50 value zone.'
        : touchedStructure
          ? 'Pullback touched structure value zone.'
          : nearEma20 || nearEma50
            ? 'Price remains near EMA pullback zone.'
            : 'No controlled pullback into value zone.',
  };
}

function trendPullbackRoom(direction, indicators, config) {
  const { price, support, resistance, ema20, ema50 } = indicators;
  const minRoomToLevelPercent = Number.isFinite(Number(config.minRoomToLevelPercent))
    ? Number(config.minRoomToLevelPercent)
    : 0.9;
  const resistanceDistance = distanceAbovePercent(price, resistance);
  const supportDistance = distanceBelowPercent(price, support);
  const nearEma20 = pctDistance(price, ema20) <= 1.2;
  const nearEma50 = pctDistance(price, ema50) <= 1.8;
  const hasRoom =
    direction === 'LONG'
      ? !Number.isFinite(resistanceDistance) || resistanceDistance >= minRoomToLevelPercent
      : !Number.isFinite(supportDistance) || supportDistance >= minRoomToLevelPercent;

  return {
    passed: hasRoom && (nearEma20 || nearEma50),
    resistanceDistance,
    supportDistance,
    reason: hasRoom
      ? 'Entry has room from nearby opposing level.'
      : direction === 'LONG'
        ? 'LONG would enter too close to resistance.'
        : 'SHORT would enter too close to support.',
  };
}

function seriesSlopePercent(series, lookback) {
  if (!Array.isArray(series) || series.length <= lookback) {
    return null;
  }

  const current = Number(series.at(-1)?.value);
  const previous = Number(series.at(-1 - lookback)?.value);
  return percentMove(previous, current);
}

function trendStrengthQuality(direction, indicators, config) {
  const filter = config.qualityFilters?.trendStrength;
  if (!filter?.enabled) {
    return null;
  }

  const lookback = Number.isFinite(Number(filter.ema20SlopeLookback)) ? Number(filter.ema20SlopeLookback) : 8;
  const minSlope = Number.isFinite(Number(filter.minEma20SlopePercent)) ? Number(filter.minEma20SlopePercent) : 0.12;
  const minSeparation = Number.isFinite(Number(filter.minEma20Ema50SeparationPercent))
    ? Number(filter.minEma20Ema50SeparationPercent)
    : 0.18;
  const slope = seriesSlopePercent(indicators.ema20Series, lookback);
  const separation = pctDistance(indicators.ema20, indicators.ema50);
  const slopePass = direction === 'LONG' ? Number.isFinite(slope) && slope >= minSlope : Number.isFinite(slope) && slope <= -minSlope;
  const separationPass = Number.isFinite(separation) && separation >= minSeparation;
  const passed = slopePass && separationPass;

  return {
    key: 'trendStrength',
    passed,
    reason: passed
      ? `Trend strength passed: EMA20 slope ${slope.toFixed(3)}%, EMA20/50 separation ${separation.toFixed(3)}%.`
      : `Trend strength failed: EMA20 slope ${Number.isFinite(slope) ? slope.toFixed(3) : '--'}%, EMA20/50 separation ${Number.isFinite(separation) ? separation.toFixed(3) : '--'}%.`,
  };
}

function htfAlignmentQuality(direction, indicators, config) {
  const filter = config.qualityFilters?.htfAlignment;
  if (!filter?.enabled) {
    return null;
  }

  const requiredTimeframe = filter.mapping?.[indicators.timeframe];
  if (!requiredTimeframe) {
    return {
      key: 'htfAlignment',
      passed: true,
      reason: `HTF alignment not required for ${indicators.timeframe}.`,
    };
  }

  const htf = indicators.higherTimeframeTrend;
  if (!htf || htf.timeframe !== requiredTimeframe) {
    return {
      key: 'htfAlignment',
      passed: false,
      reason: `HTF alignment unsupported: ${requiredTimeframe} context unavailable.`,
    };
  }

  const expected = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
  const passed = htf.trend === expected;
  return {
    key: 'htfAlignment',
    passed,
    reason: passed
      ? `HTF alignment passed: ${requiredTimeframe} trend is ${htf.trend}.`
      : `HTF alignment failed: ${requiredTimeframe} trend is ${htf.trend ?? 'UNKNOWN'}, expected ${expected}.`,
  };
}

function volatilityRegimeQuality(direction, indicators, config) {
  const filter = config.qualityFilters?.volatilityRegime;
  if (!filter?.enabled) {
    return null;
  }

  const atrPercent = Number.isFinite(indicators.atr) && Number.isFinite(indicators.price) && indicators.price > 0
    ? (indicators.atr / indicators.price) * 100
    : null;
  const minAtr = Number.isFinite(Number(filter.minAtrPercentOfPrice)) ? Number(filter.minAtrPercentOfPrice) : 0.18;
  const maxAtr = Number.isFinite(Number(filter.maxAtrPercentOfPrice)) ? Number(filter.maxAtrPercentOfPrice) : 4.5;
  const maxRangeAtr = Number.isFinite(Number(filter.maxLastRangeAtrMultiple)) ? Number(filter.maxLastRangeAtrMultiple) : 1.45;
  const rangeAtr = Number.isFinite(indicators.lastCandleRange) && Number.isFinite(indicators.atr) && indicators.atr > 0
    ? indicators.lastCandleRange / indicators.atr
    : null;
  const passed = Number.isFinite(atrPercent) && atrPercent >= minAtr && atrPercent <= maxAtr && (!Number.isFinite(rangeAtr) || rangeAtr <= maxRangeAtr);

  return {
    key: 'volatilityRegime',
    passed,
    reason: passed
      ? `Volatility regime passed: ATR ${atrPercent.toFixed(3)}% of price, last range ${Number.isFinite(rangeAtr) ? rangeAtr.toFixed(2) : '--'}x ATR.`
      : `Volatility regime failed: ATR ${Number.isFinite(atrPercent) ? atrPercent.toFixed(3) : '--'}% of price, last range ${Number.isFinite(rangeAtr) ? rangeAtr.toFixed(2) : '--'}x ATR.`,
  };
}

function chopAvoidanceQuality(direction, indicators, config) {
  const filter = config.qualityFilters?.chopAvoidance;
  if (!filter?.enabled) {
    return null;
  }

  const candles = indicators.recentCandles ?? [];
  const minSeparation = Number.isFinite(Number(filter.minEmaSeparationPercent)) ? Number(filter.minEmaSeparationPercent) : 0.2;
  const minRangeAtr = Number.isFinite(Number(filter.minRecentRangeAtrMultiple)) ? Number(filter.minRecentRangeAtrMultiple) : 3.2;
  const maxNeutral = Number.isFinite(Number(filter.maxRsiNeutralCandles)) ? Number(filter.maxRsiNeutralCandles) : 5;
  const separation = pctDistance(indicators.ema20, indicators.ema50);
  const highs = candles.map((candle) => candle.high).filter(Number.isFinite);
  const lows = candles.map((candle) => candle.low).filter(Number.isFinite);
  const recentRange = highs.length && lows.length ? Math.max(...highs) - Math.min(...lows) : null;
  const rangeAtr = Number.isFinite(recentRange) && Number.isFinite(indicators.atr) && indicators.atr > 0 ? recentRange / indicators.atr : null;
  const neutralRsiCount = Number.isFinite(indicators.rsi) && indicators.rsi >= 45 && indicators.rsi <= 55 ? maxNeutral + 1 : 0;
  const passed =
    Number.isFinite(separation) &&
    separation >= minSeparation &&
    Number.isFinite(rangeAtr) &&
    rangeAtr >= minRangeAtr &&
    neutralRsiCount <= maxNeutral;

  return {
    key: 'chopAvoidance',
    passed,
    reason: passed
      ? `Chop avoidance passed: EMA separation ${separation.toFixed(3)}%, 20-candle range ${rangeAtr.toFixed(2)}x ATR.`
      : `Chop avoidance failed: EMA separation ${Number.isFinite(separation) ? separation.toFixed(3) : '--'}%, 20-candle range ${Number.isFinite(rangeAtr) ? rangeAtr.toFixed(2) : '--'}x ATR.`,
  };
}

function impulseQuality(direction, indicators, config) {
  const filter = config.qualityFilters?.impulseQuality;
  if (!filter?.enabled) {
    return null;
  }

  const lookback = Number.isFinite(Number(filter.lookbackCandles)) ? Number(filter.lookbackCandles) : 10;
  const minImpulse = Number.isFinite(Number(filter.minImpulseAtrMultiple)) ? Number(filter.minImpulseAtrMultiple) : 1.8;
  const candles = (indicators.recentCandles ?? []).slice(-lookback - 1, -1);
  const highs = candles.map((candle) => candle.high).filter(Number.isFinite);
  const lows = candles.map((candle) => candle.low).filter(Number.isFinite);
  const impulse =
    direction === 'LONG'
      ? highs.length && lows.length ? Math.max(...highs) - Math.min(...lows) : null
      : highs.length && lows.length ? Math.max(...highs) - Math.min(...lows) : null;
  const impulseAtr = Number.isFinite(impulse) && Number.isFinite(indicators.atr) && indicators.atr > 0 ? impulse / indicators.atr : null;
  const directionalClose =
    candles.length >= 2
      ? direction === 'LONG'
        ? candles.at(-1).close > candles[0].close
        : candles.at(-1).close < candles[0].close
      : false;
  const passed = Number.isFinite(impulseAtr) && impulseAtr >= minImpulse && directionalClose;

  return {
    key: 'impulseQuality',
    passed,
    reason: passed
      ? `Impulse quality passed: prior move ${impulseAtr.toFixed(2)}x ATR.`
      : `Impulse quality failed: prior move ${Number.isFinite(impulseAtr) ? impulseAtr.toFixed(2) : '--'}x ATR.`,
  };
}

function trendPullbackQualityFilters(direction, indicators, config) {
  const checks = [
    trendStrengthQuality(direction, indicators, config),
    htfAlignmentQuality(direction, indicators, config),
    volatilityRegimeQuality(direction, indicators, config),
    chopAvoidanceQuality(direction, indicators, config),
    impulseQuality(direction, indicators, config),
  ].filter(Boolean);

  return {
    passed: checks.every((check) => check.passed),
    checks,
    failedReasons: checks.filter((check) => !check.passed).map((check) => check.reason),
  };
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) {
    return null;
  }

  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function candleBody(candle) {
  return candle ? Math.abs(candle.close - candle.open) : null;
}

function candleRange(candle) {
  return candle && Number.isFinite(candle.high) && Number.isFinite(candle.low) ? candle.high - candle.low : null;
}

function configNumber(config, key, fallback) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function breakoutRangeContext(indicators, config) {
  const lookback = Number.isFinite(Number(config.compressionLookback)) ? Number(config.compressionLookback) : 20;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const lastCandle = indicators.lastCandle ?? candles.at(-1);
  const prior = candles.slice(-lookback - 1, -1);
  const highs = prior.map((candle) => candle.high).filter(Number.isFinite);
  const lows = prior.map((candle) => candle.low).filter(Number.isFinite);
  const closes = prior.map((candle) => candle.close).filter(Number.isFinite);
  const rangeHigh = highs.length ? Math.max(...highs) : null;
  const rangeLow = lows.length ? Math.min(...lows) : null;
  const recentRange = Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) ? rangeHigh - rangeLow : null;
  const atr = Number(indicators.atr);
  const recentRangeAtr = Number.isFinite(recentRange) && atr > 0 ? recentRange / atr : null;
  const bodyMedian = median(prior.map(candleBody));
  const bodyMedianAtr = Number.isFinite(bodyMedian) && atr > 0 ? bodyMedian / atr : null;
  const previousClose = Number(indicators.previousCandle?.close ?? closes.at(-1));
  const contained =
    Number.isFinite(previousClose) &&
    Number.isFinite(rangeHigh) &&
    Number.isFinite(rangeLow) &&
    previousClose <= rangeHigh &&
    previousClose >= rangeLow;
  const lastRange = candleRange(lastCandle);
  const lastBody = candleBody(lastCandle);
  const bodyToRange = Number.isFinite(lastBody) && Number.isFinite(lastRange) && lastRange > 0 ? lastBody / lastRange : null;
  const upperWick = lastCandle ? lastCandle.high - Math.max(lastCandle.open, lastCandle.close) : null;
  const lowerWick = lastCandle ? Math.min(lastCandle.open, lastCandle.close) - lastCandle.low : null;
  const upperWickToRange = Number.isFinite(upperWick) && Number.isFinite(lastRange) && lastRange > 0 ? upperWick / lastRange : null;
  const lowerWickToRange = Number.isFinite(lowerWick) && Number.isFinite(lastRange) && lastRange > 0 ? lowerWick / lastRange : null;

  return {
    lookback,
    priorCount: prior.length,
    rangeHigh,
    rangeLow,
    recentRange,
    recentRangeAtr,
    bodyMedianAtr,
    contained,
    lastRange,
    lastBody,
    lastRangeAtr: Number.isFinite(lastRange) && atr > 0 ? lastRange / atr : null,
    lastBodyAtr: Number.isFinite(lastBody) && atr > 0 ? lastBody / atr : null,
    bodyToRange,
    upperWickToRange,
    lowerWickToRange,
    volumeRatio: indicators.averageVolume > 0 ? indicators.currentVolume / indicators.averageVolume : null,
  };
}

function buildBreakoutRiskLevels(direction, indicators, context, config) {
  const entry1 = indicators.price;
  const atr = Number(indicators.atr);
  const atrStopMultiplier = Number.isFinite(Number(config.atrStopMultiplier)) ? Number(config.atrStopMultiplier) : 1.25;
  const stopBuffer = Number.isFinite(Number(config.stopBufferAtrMultiple)) ? Number(config.stopBufferAtrMultiple) : 0.2;
  const tp1RTarget = Number.isFinite(Number(config.tp1RTarget)) ? Number(config.tp1RTarget) : 1.5;
  const tp2RTarget = Number.isFinite(Number(config.tp2RTarget)) ? Number(config.tp2RTarget) : 2.5;

  if (!isFinitePositive(entry1) || !isFinitePositive(atr)) {
    return {
      entry1,
      entry2: null,
      tp1: null,
      tp2: null,
      sl: null,
      risk: null,
      rrTp1: null,
      rrTp2: null,
      rrRatio: null,
      slAtrMultiple: null,
      atr,
    };
  }

  if (direction === 'LONG') {
    const structuralStop = Math.min(
      Number.isFinite(indicators.lastCandle?.low) ? indicators.lastCandle.low - atr * stopBuffer : entry1 - atr * atrStopMultiplier,
      Number.isFinite(context.rangeHigh) ? context.rangeHigh - atr * stopBuffer : entry1 - atr * atrStopMultiplier,
    );
    const atrStop = entry1 - atr * atrStopMultiplier;
    const sl = Math.min(atrStop, structuralStop);
    const risk = entry1 - sl;
    const tp1 = entry1 + risk * tp1RTarget;
    const tp2 = entry1 + risk * tp2RTarget;

    return {
      entry1,
      entry2: context.rangeHigh,
      tp1,
      tp2,
      sl,
      risk,
      rewardTp1: tp1 - entry1,
      rewardTp2: tp2 - entry1,
      rrTp1: risk > 0 ? (tp1 - entry1) / risk : null,
      rrTp2: risk > 0 ? (tp2 - entry1) / risk : null,
      rrRatio: risk > 0 ? (tp1 - entry1) / risk : null,
      slAtrMultiple: risk / atr,
      atr,
    };
  }

  const structuralStop = Math.max(
    Number.isFinite(indicators.lastCandle?.high) ? indicators.lastCandle.high + atr * stopBuffer : entry1 + atr * atrStopMultiplier,
    Number.isFinite(context.rangeLow) ? context.rangeLow + atr * stopBuffer : entry1 + atr * atrStopMultiplier,
  );
  const atrStop = entry1 + atr * atrStopMultiplier;
  const sl = Math.max(atrStop, structuralStop);
  const risk = sl - entry1;
  const tp1 = entry1 - risk * tp1RTarget;
  const tp2 = entry1 - risk * tp2RTarget;

  return {
    entry1,
    entry2: context.rangeLow,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: entry1 - tp1,
    rewardTp2: entry1 - tp2,
    rrTp1: risk > 0 ? (entry1 - tp1) / risk : null,
    rrTp2: risk > 0 ? (entry1 - tp2) / risk : null,
    rrRatio: risk > 0 ? (entry1 - tp1) / risk : null,
    slAtrMultiple: risk / atr,
    atr,
  };
}

function breakoutOpposingRoom(direction, indicators, context) {
  const price = indicators.price;
  const swingHighs = indicators.marketStructure?.swingHighs ?? [];
  const swingLows = indicators.marketStructure?.swingLows ?? [];
  const resistanceCandidates = levelCandidates(
    [indicators.pivotResistance, indicators.simpleResistance, indicators.resistance, ...swingHighs],
    (level) => level > price && (!Number.isFinite(context.rangeHigh) || pctDistance(level, context.rangeHigh) > 0.05),
  );
  const supportCandidates = levelCandidates(
    [indicators.pivotSupport, indicators.simpleSupport, indicators.support, ...swingLows],
    (level) => level < price && (!Number.isFinite(context.rangeLow) || pctDistance(level, context.rangeLow) > 0.05),
  );

  if (direction === 'LONG') {
    const nextResistance = resistanceCandidates[0] ?? null;
    return {
      opposingLevel: nextResistance,
      opposingDistance: Number.isFinite(nextResistance) ? distanceAbovePercent(price, nextResistance) : Infinity,
    };
  }

  const nextSupport = supportCandidates.at(-1) ?? null;
  return {
    opposingLevel: nextSupport,
    opposingDistance: Number.isFinite(nextSupport) ? distanceBelowPercent(price, nextSupport) : Infinity,
  };
}

function breakoutHardBlocks(direction, indicators, context, levels, checks, config) {
  const reasons = [];
  const waitReasons = [];
  const {
    valid,
    reason,
    stale,
    feedStale,
    dataError,
  } = indicators;
  const rrHardMin = 1.2;
  const maxSlAtrMultiple = Number.isFinite(Number(config.maxSlAtrMultiple)) ? Number(config.maxSlAtrMultiple) : 2.4;

  if (valid === false || reason === 'insufficient_data') {
    reasons.push('Insufficient candles for EMA200/RSI/MACD/ATR.');
  }

  if (stale || feedStale || dataError) {
    reasons.push(dataError ? `Data feed error: ${dataError}` : 'Stale data. Signal execution disabled.');
  }

  if (!checks.compressionPass) {
    waitReasons.push(checks.compressionReason);
  }

  if (!checks.breakoutPass) {
    waitReasons.push(checks.breakoutReason);
  }

  if (!checks.expansionPass) {
    waitReasons.push(checks.expansionReason);
  }

  if (!checks.bodyPass) {
    waitReasons.push(checks.bodyReason);
  }

  if (!checks.wickPass) {
    reasons.push(checks.wickReason);
  }

  if (!checks.roomPass) {
    reasons.push(checks.roomReason);
  }

  if (Number.isFinite(context.lastRangeAtr) && context.lastRangeAtr > Number(config.maxExhaustionRangeAtrMultiple ?? 2.35)) {
    reasons.push(`Breakout candle is exhaustion-sized at ${context.lastRangeAtr.toFixed(2)}x ATR.`);
  }

  if (!Number.isFinite(levels.rrTp1)) {
    reasons.push('RR to TP1 is unavailable.');
  } else if (levels.rrTp1 < rrHardMin) {
    reasons.push(`R:R is only ${levels.rrTp1.toFixed(2)}:1, below hard minimum ${rrHardMin}.`);
  }

  if (!Number.isFinite(levels.slAtrMultiple)) {
    reasons.push('Stop loss cannot be derived from breakout range/ATR.');
  } else if (levels.slAtrMultiple > maxSlAtrMultiple) {
    waitReasons.push(`SL distance is greater than ATR x ${maxSlAtrMultiple}.`);
  } else if (levels.slAtrMultiple < 0.35) {
    waitReasons.push('SL is too close and likely to be hit by noise.');
  }

  return { reasons: unique(reasons), waitReasons: unique(waitReasons) };
}

function classifyBreakoutBlockReasons(checks, context, levels) {
  const reasons = [];

  if (!checks.compressionPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.NO_COMPRESSION);
  }
  if (!checks.breakoutPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.NO_BREAKOUT);
  }
  if (!checks.volumeExpansionPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.WEAK_VOLUME_EXPANSION);
  }
  if (!checks.rangeExpansionPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.WEAK_RANGE_EXPANSION);
  }
  if (!checks.bodyPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.BODY_TOO_SMALL);
  }
  if (!checks.wickPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.REJECTION_WICK_TOO_LARGE);
  }
  if (!checks.roomPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.OPPOSING_LEVEL_TOO_CLOSE);
  }
  if (!checks.rrPass) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.RR_TOO_LOW);
  }
  if (!Number.isFinite(context.lastRangeAtr) || !Number.isFinite(context.recentRangeAtr)) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.ATR_MISSING);
  }
  if (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0) {
    reasons.push(V2_BREAKOUT_BLOCK_REASONS.LEVELS_INVALID);
  }

  return unique(reasons.length ? reasons : [V2_BREAKOUT_BLOCK_REASONS.OTHER]);
}

function buildBreakoutVolumeExpansionCandidate(direction, indicators, options, marketRegime, config) {
  const context = breakoutRangeContext(indicators, config);
  const { price, atr, lastCandle } = indicators;
  const breakoutBufferAtr = Number(config.minBreakoutCloseBeyondAtr ?? 0.08);
  const maxCompressionRangeAtr = Number(config.maxCompressionRangeAtrMultiple ?? 5.2);
  const maxBodyMedianAtr = Number(config.maxCompressionBodyMedianAtrMultiple ?? 0.75);
  const minBodyAtr = Number(config.minBreakoutBodyAtrMultiple ?? 0.45);
  const minBodyToRange = Number(config.minBreakoutBodyToRange ?? 0.5);
  const minVolumeRatio = Number(config.minVolumeRatio ?? 1.25);
  const minRangeExpansionAtr = Number(config.minRangeExpansionAtrMultiple ?? 1.05);
  const maxRejectionWick = Number(config.maxRejectionWickToRange ?? 0.42);
  const minRoom = Number(config.minRoomToOpposingLevelPercent ?? 0.8);
  const closeBeyond =
    direction === 'LONG'
      ? Number.isFinite(context.rangeHigh) && price > context.rangeHigh + atr * breakoutBufferAtr
      : Number.isFinite(context.rangeLow) && price < context.rangeLow - atr * breakoutBufferAtr;
  const directionalBody =
    direction === 'LONG'
      ? lastCandle?.close > lastCandle?.open
      : lastCandle?.close < lastCandle?.open;
  const compressionPass =
    context.priorCount >= Math.min(context.lookback, 12) &&
    context.contained &&
    Number.isFinite(context.recentRangeAtr) &&
    context.recentRangeAtr <= maxCompressionRangeAtr &&
    (!Number.isFinite(context.bodyMedianAtr) || context.bodyMedianAtr <= maxBodyMedianAtr);
  const breakoutPass = closeBeyond && directionalBody;
  const bodyPass =
    Number.isFinite(context.lastBodyAtr) &&
    context.lastBodyAtr >= minBodyAtr &&
    Number.isFinite(context.bodyToRange) &&
    context.bodyToRange >= minBodyToRange;
  const volumeExpansionPass = Number.isFinite(context.volumeRatio) && context.volumeRatio >= minVolumeRatio;
  const rangeExpansionPass = Number.isFinite(context.lastRangeAtr) && context.lastRangeAtr >= minRangeExpansionAtr;
  const expansionPass = volumeExpansionPass && rangeExpansionPass;
  const rejectionWick = direction === 'LONG' ? context.upperWickToRange : context.lowerWickToRange;
  const wickPass = Number.isFinite(rejectionWick) && rejectionWick <= maxRejectionWick;
  const room = breakoutOpposingRoom(direction, indicators, context);
  const roomPass = !Number.isFinite(room.opposingDistance) || room.opposingDistance === Infinity || room.opposingDistance >= minRoom;
  const levels = buildBreakoutRiskLevels(direction, indicators, context, config);
  const rrTp1Min = Number.isFinite(Number(config.rrTp1Min)) ? Number(config.rrTp1Min) : 1.5;
  const rrTp2Min = Number.isFinite(Number(config.rrTp2Min)) ? Number(config.rrTp2Min) : 2;
  const rrPass =
    Number.isFinite(levels.rrTp1) &&
    levels.rrTp1 >= rrTp1Min &&
    Number.isFinite(levels.rrTp2) &&
    levels.rrTp2 >= rrTp2Min;
  const checks = {
    trendPass: true,
    rsiPass: true,
    macdPass: true,
    structurePass: breakoutPass,
    levelPass: roomPass,
    volumePass: expansionPass,
    compressionPass,
    breakoutPass,
    volumeExpansionPass,
    rangeExpansionPass,
    expansionPass,
    bodyPass,
    wickPass,
    roomPass,
    rrPass,
    resistanceDistance: direction === 'LONG' ? room.opposingDistance : null,
    supportDistance: direction === 'SHORT' ? room.opposingDistance : null,
    filtersPass: compressionPass && breakoutPass && expansionPass && bodyPass && wickPass && roomPass && rrPass,
    compressionReason: compressionPass
      ? `Compression passed: prior range ${context.recentRangeAtr?.toFixed(2) ?? '--'}x ATR.`
      : `Compression not ready: prior range ${Number.isFinite(context.recentRangeAtr) ? context.recentRangeAtr.toFixed(2) : '--'}x ATR, contained=${context.contained}.`,
    breakoutReason: breakoutPass
      ? `Breakout close confirmed beyond ${direction === 'LONG' ? 'range high' : 'range low'}.`
      : `No executable ${direction} breakout close beyond compression range.`,
    expansionReason: expansionPass
      ? `Expansion passed: volume ${context.volumeRatio?.toFixed(2) ?? '--'}x, range ${context.lastRangeAtr?.toFixed(2) ?? '--'}x ATR.`
      : `Expansion weak: volume ${Number.isFinite(context.volumeRatio) ? context.volumeRatio.toFixed(2) : '--'}x, range ${Number.isFinite(context.lastRangeAtr) ? context.lastRangeAtr.toFixed(2) : '--'}x ATR.`,
    bodyReason: bodyPass
      ? `Breakout body passed: ${context.lastBodyAtr?.toFixed(2) ?? '--'}x ATR, ${(context.bodyToRange * 100).toFixed(1)}% of candle.`
      : `Breakout body weak: ${Number.isFinite(context.lastBodyAtr) ? context.lastBodyAtr.toFixed(2) : '--'}x ATR, ${Number.isFinite(context.bodyToRange) ? (context.bodyToRange * 100).toFixed(1) : '--'}% of candle.`,
    wickReason: wickPass
      ? `Rejection wick acceptable: ${(rejectionWick * 100).toFixed(1)}% of candle.`
      : `Breakout candle has rejection wick ${Number.isFinite(rejectionWick) ? (rejectionWick * 100).toFixed(1) : '--'}% of range.`,
    roomReason: roomPass
      ? 'Breakout has room from nearby opposing level.'
      : `${direction} breakout is too close to opposing level (${room.opposingDistance.toFixed(2)}%).`,
  };
  const items = [
    scoreItem('compression', 'Recent range compression', compressionPass ? 2 : 0, 2, compressionPass, checks.compressionReason),
    scoreItem('breakoutClose', 'Close breaks compression range', breakoutPass ? 2 : 0, 2, breakoutPass, checks.breakoutReason),
    scoreItem('expansion', 'Volume and true-range expansion', expansionPass ? 2 : 0, 2, expansionPass, checks.expansionReason),
    scoreItem('breakoutBody', 'Meaningful breakout body', bodyPass ? 1 : 0, 1, bodyPass, checks.bodyReason),
    scoreItem('rejectionWick', 'No major rejection wick', wickPass ? 1 : 0, 1, wickPass, checks.wickReason),
    scoreItem('opposingRoom', 'Room from opposing level', roomPass ? 1 : 0, 1, roomPass, checks.roomReason),
    scoreItem(
      'riskReward',
      'Risk/reward valid',
      rrPass ? 1 : 0,
      1,
      rrPass,
      `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${rrTp1Min}), TP2 ${Number.isFinite(levels.rrTp2) ? levels.rrTp2.toFixed(2) : '--'} (target ${rrTp2Min}).`,
    ),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const btcAdjustment = buildBtcAdjustment({ symbol: options.symbol, direction, btcContext: options.btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const adjustments = [
    adjustmentItem('btc', 'BTC Confirmation', btcAdjustment.points, btcAdjustment.note),
    adjustmentItem('fundingOi', 'Funding/OI', fundingOiAdjustment.points, fundingOiAdjustment.note),
  ];
  const adjustmentTotal = btcAdjustment.points + fundingOiAdjustment.points;
  const finalScore = clampScore(technicalTotal + adjustmentTotal);
  const blocks = breakoutHardBlocks(direction, indicators, context, levels, checks, config);
  const blockReasonCodes = classifyBreakoutBlockReasons(checks, context, levels);
  let status = 'NO_TRADE';

  if (!blocks.reasons.length) {
    if (blocks.waitReasons.length) {
      status = finalScore >= 5 ? 'WAIT' : 'NO_TRADE';
    } else if (finalScore >= config.entryScore && checks.filtersPass) {
      status = direction;
    } else if (finalScore >= 5) {
      status = 'WAIT';
    }
  }

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal,
    rawTotal: technicalTotal + adjustmentTotal,
    max: SCORE_MAX,
    items,
    adjustments,
    breakdown: {
      compression: items[0].points,
      breakoutClose: items[1].points,
      expansion: items[2].points,
      breakoutBody: items[3].points,
      rejectionWick: items[4].points,
      opposingRoom: items[5].points,
      rrRatio: items[6].points,
      volume: expansionPass ? 2 : 0,
      trend: 0,
    },
    hardBlock: blocks.reasons[0] ?? null,
    blockedReasons: blocks.reasons,
    rejectionReasons: unique([...blocks.reasons, ...blocks.waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    blockReasonCodes,
    waitReasons: blocks.waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'MOMENTUM_BREAKOUT' : finalScore >= 5 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.MOMENTUM_BREAKOUT : finalScore >= 5 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    diagnostics: {
      strategyType: 'breakoutVolumeExpansion',
      direction,
      compressionDetected: compressionPass,
      breakoutCandidate: breakoutPass,
      volumeExpansionPass,
      rangeExpansionPass,
      bodyQualityPass: bodyPass,
      rejectionWickFailure: !wickPass,
      opposingLevelRoomFailure: !roomPass,
      rrFailure: !rrPass,
      blockReasonCodes,
      primaryBlockReason: blockReasonCodes[0] ?? V2_BREAKOUT_BLOCK_REASONS.OTHER,
      context: {
        rangeHigh: round(context.rangeHigh),
        rangeLow: round(context.rangeLow),
        recentRangeAtr: round(context.recentRangeAtr),
        bodyMedianAtr: round(context.bodyMedianAtr),
        lastRangeAtr: round(context.lastRangeAtr),
        lastBodyAtr: round(context.lastBodyAtr),
        bodyToRange: round(context.bodyToRange),
        volumeRatio: round(context.volumeRatio),
        opposingLevel: round(room.opposingLevel),
        opposingDistance: round(room.opposingDistance),
        rrTp1: round(levels.rrTp1),
        rrTp2: round(levels.rrTp2),
        slAtrMultiple: round(levels.slAtrMultiple),
      },
    },
    levels,
  };
}

function sweepDetected(direction, candles, level, atr, config) {
  const lookback = Math.max(1, Math.floor(configNumber(config, 'sweepLookback', 20)));
  const minSweepWick = configNumber(config, 'minSweepWickAtrMultiple', 0.2) * atr;
  const maxSweepRange = configNumber(config, 'maxSweepRangeAtrMultiple', 2.5) * atr;
  const candleList = Array.isArray(candles) ? candles : [];
  const recentStart = Math.max(0, candleList.length - lookback);
  const recent = candleList.slice(recentStart);

  if (!Number.isFinite(level) || !isFinitePositive(atr) || !recent.length) {
    return { detected: false, sweepCandle: null, sweepCandleIndex: null, sweepLow: null, sweepHigh: null, wickSize: null, rangeAtr: null };
  }

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candle = recent[index];
    const candleIndex = recentStart + index;
    const range = candleRange(candle);
    if (!candle || !Number.isFinite(range) || range <= 0 || range > maxSweepRange) {
      continue;
    }

    if (
      direction === 'LONG' &&
      Number.isFinite(candle.low) &&
      candle.low < level &&
      Number.isFinite(candle.open) &&
      candle.open > level &&
      Number.isFinite(candle.close) &&
      candle.close > level
    ) {
      const wickSize = level - candle.low;
      if (wickSize >= minSweepWick) {
        return {
          detected: true,
          sweepCandle: candle,
          sweepCandleIndex: candleIndex,
          sweepLow: candle.low,
          sweepHigh: null,
          wickSize,
          wickAtr: wickSize / atr,
          rangeAtr: range / atr,
        };
      }
    }

    if (
      direction === 'SHORT' &&
      Number.isFinite(candle.high) &&
      candle.high > level &&
      Number.isFinite(candle.open) &&
      candle.open < level &&
      Number.isFinite(candle.close) &&
      candle.close < level
    ) {
      const wickSize = candle.high - level;
      if (wickSize >= minSweepWick) {
        return {
          detected: true,
          sweepCandle: candle,
          sweepCandleIndex: candleIndex,
          sweepLow: null,
          sweepHigh: candle.high,
          wickSize,
          wickAtr: wickSize / atr,
          rangeAtr: range / atr,
        };
      }
    }
  }

  return { detected: false, sweepCandle: null, sweepCandleIndex: null, sweepLow: null, sweepHigh: null, wickSize: null, rangeAtr: null };
}

function reclaimConfirmed(direction, candles, level, config, sweepCandleIndex = null) {
  const windowCandles = Math.max(1, Math.floor(configNumber(config, 'reclaimWindowCandles', 3)));
  const minBodyToRange = configNumber(config, 'minReclaimBodyToRange', 0.45);
  const candleList = Array.isArray(candles) ? candles : [];
  const start = Number.isInteger(sweepCandleIndex) ? sweepCandleIndex + 1 : Math.max(0, candleList.length - windowCandles);
  const end = Number.isInteger(sweepCandleIndex) ? Math.min(candleList.length, start + windowCandles) : candleList.length;
  const recent = candleList.slice(start, end);

  if (!Number.isFinite(level) || !recent.length) {
    return { confirmed: false, reclaimCandle: null, bodyToRange: null };
  }

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candle = recent[index];
    const candleIndex = start + index;
    const range = candleRange(candle);
    const body = candleBody(candle);
    const bodyToRange = Number.isFinite(body) && Number.isFinite(range) && range > 0 ? body / range : null;
    const closesThroughLevel =
      direction === 'LONG'
        ? Number.isFinite(candle?.close) && candle.close > level
        : Number.isFinite(candle?.close) && candle.close < level;

    if (closesThroughLevel && Number.isFinite(bodyToRange) && bodyToRange >= minBodyToRange) {
      return { confirmed: true, reclaimCandle: candle, reclaimCandleIndex: candleIndex, bodyToRange };
    }
  }

  return { confirmed: false, reclaimCandle: null, reclaimCandleIndex: null, bodyToRange: null };
}

function buildLiquiditySweepRiskLevels(direction, entry, sweepExtreme, atr, config) {
  const stopBuffer = configNumber(config, 'stopBufferAtrMultiple', 0.15);
  const tp1RTarget = configNumber(config, 'tp1RTarget', 2);
  const tp2RTarget = configNumber(config, 'tp2RTarget', 3.5);

  if (!isFinitePositive(entry) || !isFinitePositive(atr) || !Number.isFinite(sweepExtreme)) {
    return {
      entry1: entry,
      entry2: null,
      tp1: null,
      tp2: null,
      sl: null,
      risk: null,
      rewardTp1: null,
      rewardTp2: null,
      rrTp1: null,
      rrTp2: null,
      rrRatio: null,
      slAtrMultiple: null,
      atr,
    };
  }

  if (direction === 'LONG') {
    const sl = sweepExtreme - atr * stopBuffer;
    const risk = entry - sl;
    const tp1 = entry + risk * tp1RTarget;
    const tp2 = entry + risk * tp2RTarget;

    return {
      entry1: entry,
      entry2: null,
      tp1,
      tp2,
      sl,
      risk,
      rewardTp1: tp1 - entry,
      rewardTp2: tp2 - entry,
      rrTp1: risk > 0 ? (tp1 - entry) / risk : null,
      rrTp2: risk > 0 ? (tp2 - entry) / risk : null,
      rrRatio: risk > 0 ? (tp1 - entry) / risk : null,
      slAtrMultiple: risk > 0 ? risk / atr : null,
      atr,
    };
  }

  const sl = sweepExtreme + atr * stopBuffer;
  const risk = sl - entry;
  const tp1 = entry - risk * tp1RTarget;
  const tp2 = entry - risk * tp2RTarget;

  return {
    entry1: entry,
    entry2: null,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: entry - tp1,
    rewardTp2: entry - tp2,
    rrTp1: risk > 0 ? (entry - tp1) / risk : null,
    rrTp2: risk > 0 ? (entry - tp2) / risk : null,
    rrRatio: risk > 0 ? (entry - tp1) / risk : null,
    slAtrMultiple: risk > 0 ? risk / atr : null,
    atr,
  };
}

function classifyLiquiditySweepBlockReasons(sweep, reclaim, checks, levels) {
  const reasons = [];

  if (!sweep.detected) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.NO_SWEEP);
  }
  if (sweep.detected && !reclaim.confirmed) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.NO_RECLAIM);
  }
  if (sweep.detected && !checks.sweepRangePass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.RANGE_TOO_LARGE);
  }
  if (sweep.detected && !checks.sweepPass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.WEAK_SWEEP);
  }
  if (reclaim.reclaimCandle && !checks.reclaimPass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.WEAK_RECLAIM);
  }
  if (!checks.rsiPass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.RSI_EXTREME);
  }
  if (!checks.rrPass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.RR_TOO_LOW);
  }
  if (!Number.isFinite(levels.atr) || levels.atr <= 0) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.ATR_MISSING);
  }
  if (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.LEVELS_INVALID);
  }
  if (!checks.slPass) {
    reasons.push(V2_LIQUIDITY_SWEEP_BLOCK_REASONS.STOP_TOO_WIDE);
  }

  return unique(reasons.length ? reasons : [V2_LIQUIDITY_SWEEP_BLOCK_REASONS.OTHER]);
}

function liquiditySweepHardBlocks(indicators, levels, checks, config) {
  const reasons = [];
  const waitReasons = [];
  const { valid, reason, stale, feedStale, dataError } = indicators;
  const rrHardMin = 1.2;
  const maxSlAtrMultiple = configNumber(config, 'maxSlAtrMultiple', 2);

  if (valid === false || reason === 'insufficient_data') {
    reasons.push('Insufficient candles for EMA200/RSI/MACD/ATR.');
  }

  if (stale || feedStale || dataError) {
    reasons.push(dataError ? `Data feed error: ${dataError}` : 'Stale data. Signal execution disabled.');
  }

  if (!checks.sweepPass) {
    waitReasons.push(checks.sweepReason);
  }

  if (!checks.reclaimPass) {
    waitReasons.push(checks.reclaimReason);
  }

  if (!Number.isFinite(levels.rrTp1)) {
    reasons.push('RR to TP1 is unavailable.');
  } else if (levels.rrTp1 < rrHardMin) {
    reasons.push(`R:R is only ${levels.rrTp1.toFixed(2)}:1, below hard minimum ${rrHardMin}.`);
  }

  if (!Number.isFinite(levels.slAtrMultiple)) {
    reasons.push('Stop loss cannot be derived from sweep extreme/ATR.');
  } else if (levels.slAtrMultiple > maxSlAtrMultiple) {
    waitReasons.push(`SL distance is greater than ATR x ${maxSlAtrMultiple}.`);
  }

  if (!checks.rrPass) {
    reasons.push(checks.rrReason);
  }

  if (!checks.rsiPass) {
    waitReasons.push(checks.rsiReason);
  }

  if (!checks.trendPass) {
    waitReasons.push('EMA trend is not aligned for sweep reclaim.');
  }

  return { reasons: unique(reasons), waitReasons: unique(waitReasons) };
}

function timestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric > 1e12 ? numeric : numeric * 1000;
}

function utcDayStartMs(timestamp) {
  const ms = timestampMs(timestamp);
  if (!Number.isFinite(ms)) {
    return null;
  }

  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getSessionForCandle(candleTimestamp, sessions) {
  const ms = timestampMs(candleTimestamp);
  const list = Array.isArray(sessions) ? [...sessions] : [];

  if (!Number.isFinite(ms) || !list.length) {
    return null;
  }

  const dayStart = utcDayStartMs(ms);
  const hour = new Date(ms).getUTCHours();
  const sorted = list
    .filter((session) => Number.isFinite(Number(session.startHour)) && Number.isFinite(Number(session.endHour)))
    .sort((left, right) => Number(left.startHour) - Number(right.startHour));

  for (const session of sorted) {
    const startHour = Number(session.startHour);
    const endHour = Number(session.endHour);
    const next = sorted.find((item) => Number(item.startHour) > startHour);
    const nextStart = next ? Number(next.startHour) : 24;

    if (hour >= startHour && hour < endHour) {
      return null;
    }

    if (hour >= endHour && hour < nextStart) {
      return {
        ...session,
        startHour,
        endHour,
        sessionStartMs: dayStart + startHour * 60 * 60 * 1000,
        sessionEndMs: dayStart + endHour * 60 * 60 * 1000,
      };
    }
  }

  const last = sorted.at(-1);
  if (!last) {
    return null;
  }

  const startHour = Number(last.startHour);
  const endHour = Number(last.endHour);
  return {
    ...last,
    startHour,
    endHour,
    sessionStartMs: dayStart - 24 * 60 * 60 * 1000 + startHour * 60 * 60 * 1000,
    sessionEndMs: dayStart - 24 * 60 * 60 * 1000 + endHour * 60 * 60 * 1000,
  };
}

function buildOpeningRange(candles, session, config) {
  const candleList = Array.isArray(candles) ? candles : [];
  const orCandleCount = Math.max(1, Math.floor(configNumber(config, 'orCandleCount', 4)));
  const atr = Number(config?.atr);
  const minOrSizeAtr = configNumber(config, 'minOrSizeAtr', 0.3);
  const maxOrSizeAtr = configNumber(config, 'maxOrSizeAtr', 3);

  if (!session || !Number.isFinite(session.sessionStartMs) || !Number.isFinite(session.sessionEndMs)) {
    return { orHigh: null, orLow: null, orSize: null, orCandles: [], valid: false, reason: 'No completed session opening range.' };
  }

  const orCandles = candleList
    .filter((candle) => {
      const ms = timestampMs(candle?.time);
      return Number.isFinite(ms) && ms >= session.sessionStartMs && ms < session.sessionEndMs;
    })
    .slice(0, orCandleCount);
  const highs = orCandles.map((candle) => candle.high).filter(Number.isFinite);
  const lows = orCandles.map((candle) => candle.low).filter(Number.isFinite);
  const orHigh = highs.length ? Math.max(...highs) : null;
  const orLow = lows.length ? Math.min(...lows) : null;
  const orSize = Number.isFinite(orHigh) && Number.isFinite(orLow) ? orHigh - orLow : null;
  const minSize = Number.isFinite(atr) ? minOrSizeAtr * atr : null;
  const maxSize = Number.isFinite(atr) ? maxOrSizeAtr * atr : null;

  if (orCandles.length < orCandleCount) {
    return { orHigh, orLow, orSize, orCandles, valid: false, reason: `Opening range incomplete (${orCandles.length}/${orCandleCount}).` };
  }

  if (!Number.isFinite(orSize) || orSize <= 0 || !Number.isFinite(atr) || atr <= 0) {
    return { orHigh, orLow, orSize, orCandles, valid: false, reason: 'Opening range or ATR unavailable.' };
  }

  if (Number.isFinite(minSize) && orSize < minSize) {
    return { orHigh, orLow, orSize, orCandles, valid: false, reason: `Opening range too small (${(orSize / atr).toFixed(2)}x ATR).` };
  }

  if (Number.isFinite(maxSize) && orSize > maxSize) {
    return { orHigh, orLow, orSize, orCandles, valid: false, reason: `Opening range too large (${(orSize / atr).toFixed(2)}x ATR).` };
  }

  return { orHigh, orLow, orSize, orCandles, valid: true, reason: `Opening range valid (${(orSize / atr).toFixed(2)}x ATR).` };
}

function sessionBreakoutDetected(direction, currentCandle, or, indicators, config) {
  const buffer = Number.isFinite(or?.orSize) ? or.orSize * configNumber(config, 'breakoutBufferRatio', 0.1) : null;
  const range = candleRange(currentCandle);
  const body = candleBody(currentCandle);
  const bodyRatio = Number.isFinite(body) && Number.isFinite(range) && range > 0 ? body / range : null;
  const averageVolume = Number(indicators.averageVolume);
  const currentVolume = Number(currentCandle?.volume ?? indicators.currentVolume);
  const volumeRatio = averageVolume > 0 && Number.isFinite(currentVolume) ? currentVolume / averageVolume : null;
  const minBodyRatio = configNumber(config, 'minBodyRatio', 0.5);
  const minVolumeRatio = configNumber(config, 'effectiveMinVolumeRatio', configNumber(config, 'minVolumeRatio', 1.3));
  const close = Number(currentCandle?.close);
  const breakoutLine =
    direction === 'LONG'
      ? Number(or?.orHigh) + buffer
      : Number(or?.orLow) - buffer;
  const pricePass = direction === 'LONG'
    ? Number.isFinite(close) && Number.isFinite(breakoutLine) && close > breakoutLine
    : Number.isFinite(close) && Number.isFinite(breakoutLine) && close < breakoutLine;
  const bodyPass = Number.isFinite(bodyRatio) && bodyRatio >= minBodyRatio;
  const volumePass = Number.isFinite(volumeRatio) && volumeRatio >= minVolumeRatio;
  const detected = pricePass && bodyPass && volumePass;
  const breakoutStrength = Number.isFinite(volumeRatio) && volumeRatio > 1.5 ? 2 : volumePass ? 1 : 0;

  return {
    detected,
    breakoutStrength,
    pricePass,
    bodyPass,
    volumePass,
    bodyRatio,
    volumeRatio,
    buffer,
    breakoutLine,
    reason: detected
      ? `${direction} session breakout confirmed with volume ${volumeRatio.toFixed(2)}x.`
      : `${direction} session breakout not confirmed: close ${Number.isFinite(close) ? close : '--'}, line ${Number.isFinite(breakoutLine) ? breakoutLine.toFixed(6) : '--'}, volume ${Number.isFinite(volumeRatio) ? volumeRatio.toFixed(2) : '--'}x, body ${Number.isFinite(bodyRatio) ? (bodyRatio * 100).toFixed(1) : '--'}%.`,
  };
}

function buildSessionBreakoutRiskLevels(direction, entry, or, atr, config) {
  const stopBufferAtr = configNumber(config, 'stopBufferAtr', 0.2);
  const tp1RTarget = configNumber(config, 'tp1RTarget', 2);
  const tp2RTarget = configNumber(config, 'tp2RTarget', 3.5);
  const rrMin = configNumber(config, 'rrMin', 1.8);

  if (!isFinitePositive(entry) || !isFinitePositive(atr) || !Number.isFinite(or?.orHigh) || !Number.isFinite(or?.orLow)) {
    return {
      entry1: entry,
      entry2: null,
      tp1: null,
      tp2: null,
      sl: null,
      risk: null,
      rrTp1: null,
      rrTp2: null,
      rrRatio: null,
      slAtrMultiple: null,
      atr,
      rrPass: false,
    };
  }

  const sl = direction === 'LONG' ? or.orLow - atr * stopBufferAtr : or.orHigh + atr * stopBufferAtr;
  const risk = direction === 'LONG' ? entry - sl : sl - entry;
  const tp1 = direction === 'LONG' ? entry + risk * tp1RTarget : entry - risk * tp1RTarget;
  const tp2 = direction === 'LONG' ? entry + risk * tp2RTarget : entry - risk * tp2RTarget;
  const rrTp1 = risk > 0 ? tp1RTarget : null;
  const rrTp2 = risk > 0 ? tp2RTarget : null;

  return {
    entry1: entry,
    entry2: null,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: risk > 0 ? risk * tp1RTarget : null,
    rewardTp2: risk > 0 ? risk * tp2RTarget : null,
    rrTp1,
    rrTp2,
    rrRatio: rrTp1,
    slAtrMultiple: risk > 0 ? risk / atr : null,
    atr,
    rrPass: Number.isFinite(rrTp1) && rrTp1 >= rrMin,
  };
}

function sessionBreakoutHardBlocks(indicators, levels, checks) {
  const reasons = [];
  const waitReasons = [];
  const { valid, reason, stale, feedStale, dataError } = indicators;

  if (valid === false || reason === 'insufficient_data') {
    reasons.push('Insufficient candles for session breakout evaluation.');
  }

  if (stale || feedStale || dataError) {
    reasons.push(dataError ? `Data feed error: ${dataError}` : 'Stale data. Signal execution disabled.');
  }

  if (!checks.rrPass) {
    reasons.push(checks.rrReason);
  }

  if (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0) {
    reasons.push('Session breakout risk levels are invalid.');
  }

  if (!checks.sessionPass || !checks.orPass || !checks.breakoutPass) {
    waitReasons.push(checks.breakoutReason);
  }

  if (!checks.trendPass) {
    waitReasons.push('EMA20/EMA50 trend is not aligned for session breakout.');
  }

  if (!checks.rsiPass) {
    waitReasons.push(checks.rsiReason);
  }

  if (!checks.btcPass) {
    waitReasons.push('BTC bias is strongly opposed to this breakout.');
  }

  return { reasons: unique(reasons), waitReasons: unique(waitReasons) };
}

function sessionBreakoutModeConfig(signalMode, config) {
  if (signalMode === 'conservative') {
    return { effectiveMinVolumeRatio: 1.5, emaRequired: true };
  }

  if (signalMode === 'aggressive') {
    return { effectiveMinVolumeRatio: 1.1, emaRequired: false };
  }

  return {
    effectiveMinVolumeRatio: configNumber(config, 'minVolumeRatio', 1.3),
    emaRequired: true,
  };
}

function buildSessionBreakoutCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext, signalMode } = options;
  const { price, ema20, ema50, rsi, atr } = indicators;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const currentCandle = indicators.lastCandle ?? candles.at(-1);
  const mode = sessionBreakoutModeConfig(normalizeSignalMode(signalMode), config);
  const session = getSessionForCandle(currentCandle?.time, config.sessions);
  const or = buildOpeningRange(candles, session, { ...config, atr });
  const breakout = sessionBreakoutDetected(direction, currentCandle, or, indicators, { ...config, ...mode });
  const levels = buildSessionBreakoutRiskLevels(direction, price, or, atr, config);
  const trendAligned = direction === 'LONG' ? ema20 > ema50 : ema20 < ema50;
  const trendPass = mode.emaRequired ? trendAligned : true;
  const rsiPass = direction === 'LONG' ? Number.isFinite(rsi) && rsi < 72 : Number.isFinite(rsi) && rsi > 28;
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const btcPass = btcAdjustment.points > -2;
  const rrPass = levels.rrPass === true;
  const breakoutStrengthPoints = breakout.detected ? breakout.breakoutStrength : 0;
  const bodyPoints = breakout.bodyPass ? 1 : 0;
  const trendPoints = trendPass ? 1 : 0;
  const rsiPoints = rsiPass ? 1 : 0;
  const rrPoints = rrPass ? 1 : 0;
  const checks = {
    trendPass,
    rsiPass,
    macdPass: true,
    structurePass: or.valid && breakout.detected,
    levelPass: or.valid,
    volumePass: breakout.volumePass,
    sessionPass: Boolean(session),
    orPass: or.valid,
    breakoutPass: breakout.detected,
    bodyPass: breakout.bodyPass,
    btcPass,
    rrPass,
    resistanceDistance: null,
    supportDistance: null,
    filtersPass: Boolean(session) && or.valid && breakout.detected && trendPass && rsiPass && btcPass && rrPass,
    breakoutReason: breakout.detected ? breakout.reason : or.valid ? breakout.reason : or.reason,
    rsiReason: Number.isFinite(rsi)
      ? `RSI ${rsi.toFixed(1)} ${rsiPass ? 'not extreme' : 'is extreme'} for ${direction}.`
      : 'RSI unavailable.',
    rrReason: `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${configNumber(config, 'rrMin', 1.8)}).`,
  };
  const items = [
    scoreItem('breakoutStrength', 'Session breakout strength', breakoutStrengthPoints, 2, breakout.detected, checks.breakoutReason),
    scoreItem('bodyRatio', 'Breakout candle body', bodyPoints, 1, breakout.bodyPass, `Body ${Number.isFinite(breakout.bodyRatio) ? (breakout.bodyRatio * 100).toFixed(1) : '--'}% of candle range.`),
    scoreItem('ema', 'EMA20/EMA50 alignment', trendPoints, 1, trendPass, trendPass ? 'EMA alignment passed.' : 'EMA alignment failed.'),
    scoreItem('rsi', 'RSI not extreme', rsiPoints, 1, rsiPass, checks.rsiReason),
    scoreItem('riskReward', 'Risk/reward valid', rrPoints, 1, rrPass, checks.rrReason),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const adjustments = [
    adjustmentItem('btc', 'BTC Confirmation', btcAdjustment.points, btcAdjustment.note),
    adjustmentItem('fundingOi', 'Funding/OI', fundingOiAdjustment.points, fundingOiAdjustment.note),
  ];
  const adjustmentTotal = btcAdjustment.points + fundingOiAdjustment.points;
  const finalScore = clampScore(technicalTotal + adjustmentTotal);
  const blocks = sessionBreakoutHardBlocks(indicators, levels, checks);
  let status = 'NO_TRADE';

  if (!blocks.reasons.length) {
    if (finalScore >= config.entryScore && checks.filtersPass) {
      status = direction;
    } else if (finalScore >= 4) {
      status = 'WAIT';
    }
  }

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal,
    rawTotal: technicalTotal + adjustmentTotal,
    max: 6,
    items,
    adjustments,
    breakdown: {
      breakoutStrength: items[0].points,
      bodyRatio: items[1].points,
      ema: items[2].points,
      rsiMomentum: items[3].points,
      rrRatio: items[4].points,
      volume: breakout.volumePass ? breakout.breakoutStrength : 0,
      trend: items[2].points,
    },
    hardBlock: blocks.reasons[0] ?? null,
    blockedReasons: blocks.reasons,
    rejectionReasons: unique([...blocks.reasons, ...blocks.waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    blockReasonCodes: [],
    waitReasons: blocks.waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'MOMENTUM_BREAKOUT' : finalScore >= 4 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.MOMENTUM_BREAKOUT : finalScore >= 4 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    diagnostics: {
      strategyType: 'sessionBreakout',
      direction,
      sessionName: session?.name ?? null,
      sessionStartHour: session?.startHour ?? null,
      sessionEndHour: session?.endHour ?? null,
      openingRangeValid: or.valid,
      breakoutDetected: breakout.detected,
      volumeRatio: round(breakout.volumeRatio),
      bodyRatio: round(breakout.bodyRatio),
      trendPass,
      rsiPass,
      btcPass,
      rrPass,
      context: {
        orHigh: round(or.orHigh),
        orLow: round(or.orLow),
        orSize: round(or.orSize),
        orSizeAtr: Number.isFinite(or.orSize) && Number.isFinite(atr) && atr > 0 ? round(or.orSize / atr) : null,
        breakoutLine: round(breakout.breakoutLine),
        rrTp1: round(levels.rrTp1),
        rrTp2: round(levels.rrTp2),
        slAtrMultiple: round(levels.slAtrMultiple),
      },
    },
    levels,
  };
}

function averageVolumeForWindow(candles) {
  const volumes = (candles ?? []).map((candle) => Number(candle?.volume)).filter(Number.isFinite);
  return volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : null;
}

function detectFVG(direction, candles, atr, config) {
  const candleList = Array.isArray(candles) ? candles : [];
  const currentIndex = candleList.length - 1;
  const fvgLookback = Math.max(3, Math.floor(configNumber(config, 'fvgLookback', 50)));
  const minFvgSizeAtr = configNumber(config, 'minFvgSizeAtr', 0.3);
  const maxFvgSizeAtr = configNumber(config, 'maxFvgSizeAtr', 3);
  const minCreationBodyRatio = configNumber(config, 'minCreationBodyRatio', 0.6);
  const minCreationVolumeRatio = configNumber(config, 'minCreationVolumeRatio', 1.5);
  const maxFvgAgeCandles = Math.max(1, Math.floor(configNumber(config, 'maxFvgAgeCandles', configNumber(config, 'maxFvgAgCandles', 30))));
  const startIndex = Math.max(2, currentIndex - fvgLookback);

  if (!Number.isFinite(atr) || atr <= 0 || currentIndex < 3) {
    return { detected: false, reason: 'ATR or candle history unavailable for FVG detection.' };
  }

  for (let index = currentIndex - 1; index >= startIndex; index -= 1) {
    const first = candleList[index - 2];
    const creation = candleList[index - 1];
    const third = candleList[index];
    const creationRange = candleRange(creation);
    const creationBody = candleBody(creation);
    const creationBodyRatio = Number.isFinite(creationBody) && Number.isFinite(creationRange) && creationRange > 0
      ? creationBody / creationRange
      : null;
    const creationAverageVolume = averageVolumeForWindow(candleList.slice(Math.max(0, index - 21), index - 1));
    const creationVolume = Number(creation?.volume);
    const creationVolumeRatio = Number.isFinite(creationAverageVolume) && creationAverageVolume > 0 && Number.isFinite(creationVolume)
      ? creationVolume / creationAverageVolume
      : null;
    const bullishCreation = Number(creation?.close) > Number(creation?.open);
    const bearishCreation = Number(creation?.close) < Number(creation?.open);
    const fvgTop = direction === 'LONG' ? Number(third?.low) : Number(first?.low);
    const fvgBottom = direction === 'LONG' ? Number(first?.high) : Number(third?.high);
    const fvgSize = fvgTop - fvgBottom;
    const fvgSizeAtr = fvgSize / atr;
    const fvgAge = currentIndex - index;
    const shapePass = direction === 'LONG'
      ? Number(first?.high) < Number(third?.low) && bullishCreation
      : Number(first?.low) > Number(third?.high) && bearishCreation;
    const qualityPass =
      shapePass &&
      Number.isFinite(creationBodyRatio) && creationBodyRatio >= minCreationBodyRatio &&
      Number.isFinite(creationVolumeRatio) && creationVolumeRatio >= minCreationVolumeRatio &&
      Number.isFinite(fvgSizeAtr) && fvgSizeAtr >= minFvgSizeAtr && fvgSizeAtr <= maxFvgSizeAtr &&
      fvgAge <= maxFvgAgeCandles;

    if (!qualityPass) {
      continue;
    }

    const candlesAfterFormation = candleList.slice(index + 1, currentIndex);
    const filled = direction === 'LONG'
      ? candlesAfterFormation.some((candle) => Number(candle?.low) <= fvgBottom)
      : candlesAfterFormation.some((candle) => Number(candle?.high) >= fvgTop);

    if (filled) {
      continue;
    }

    return {
      detected: true,
      fvgTop,
      fvgBottom,
      fvgSize,
      fvgSizeAtr,
      fvgMid: (fvgTop + fvgBottom) / 2,
      fvgAge,
      creationVolume,
      creationVolumeRatio,
      creationBodyRatio,
      formationIndex: index,
      reason: `${direction} FVG detected at ${fvgSizeAtr.toFixed(2)}x ATR, age ${fvgAge} candles.`,
    };
  }

  return { detected: false, reason: 'No valid unfilled FVG found in lookback.' };
}

function fvgEntryTriggered(direction, currentCandle, fvg) {
  const close = Number(currentCandle?.close);
  const low = Number(currentCandle?.low);
  const high = Number(currentCandle?.high);

  if (!fvg?.detected || !Number.isFinite(close)) {
    return { triggered: false, entryPrice: close, reason: 'No detected FVG available for entry trigger.' };
  }

  const triggered = direction === 'LONG'
    ? Number.isFinite(low) && low <= fvg.fvgTop && close >= fvg.fvgBottom
    : Number.isFinite(high) && high >= fvg.fvgBottom && close <= fvg.fvgTop;

  return {
    triggered,
    entryPrice: close,
    reason: triggered
      ? `${direction} FVG fill entry triggered.`
      : `${direction} FVG fill entry not triggered.`
  };
}

function buildFVGRiskLevels(direction, entry, fvg, atr, config) {
  const stopBufferAtr = configNumber(config, 'stopBufferAtr', 0.2);
  const tp1RTarget = configNumber(config, 'tp1RTarget', 2);
  const tp2RTarget = configNumber(config, 'tp2RTarget', 3.5);
  const rrMin = configNumber(config, 'rrMin', 1.8);

  if (!isFinitePositive(entry) || !isFinitePositive(atr) || !Number.isFinite(fvg?.fvgTop) || !Number.isFinite(fvg?.fvgBottom)) {
    return { entry1: entry, entry2: null, tp1: null, tp2: null, sl: null, risk: null, rrTp1: null, rrTp2: null, rrRatio: null, atr, rrPass: false };
  }

  const sl = direction === 'LONG' ? fvg.fvgBottom - atr * stopBufferAtr : fvg.fvgTop + atr * stopBufferAtr;
  const risk = direction === 'LONG' ? entry - sl : sl - entry;
  const tp1 = direction === 'LONG' ? entry + risk * tp1RTarget : entry - risk * tp1RTarget;
  const tp2 = direction === 'LONG' ? entry + risk * tp2RTarget : entry - risk * tp2RTarget;
  const rrTp1 = risk > 0 ? tp1RTarget : null;
  const rrTp2 = risk > 0 ? tp2RTarget : null;

  return {
    entry1: entry,
    entry2: fvg.fvgMid,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: risk > 0 ? risk * tp1RTarget : null,
    rewardTp2: risk > 0 ? risk * tp2RTarget : null,
    rrTp1,
    rrTp2,
    rrRatio: rrTp1,
    slAtrMultiple: risk > 0 ? risk / atr : null,
    atr,
    rrPass: Number.isFinite(rrTp1) && rrTp1 >= rrMin,
  };
}

function buildFairValueGapCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext } = options;
  const { price, ema50, rsi, atr } = indicators;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const currentCandle = indicators.lastCandle ?? candles.at(-1);
  const fvg = detectFVG(direction, candles, atr, config);
  const entry = fvgEntryTriggered(direction, currentCandle, fvg);
  const levels = buildFVGRiskLevels(direction, entry.entryPrice, fvg, atr, config);
  const emaPass = config.emaFilter === false ? true : direction === 'LONG' ? price > ema50 : price < ema50;
  const rsiMin = configNumber(config, 'rsiMin', 35);
  const rsiMax = configNumber(config, 'rsiMax', 65);
  const rsiPass = Number.isFinite(rsi) && rsi >= rsiMin && rsi <= rsiMax;
  const rrPass = levels.rrPass === true;
  const fvgQualityPoints = fvg.detected && fvg.fvgSizeAtr > 1 ? 2 : fvg.detected ? 1 : 0;
  const fvgFreshPass = fvg.detected && fvg.fvgAge <= 10;
  const rsiCenteredPass = Number.isFinite(rsi) && rsi >= 45 && rsi <= 55;
  const rrAdequatePass = Number.isFinite(levels.rrTp1) && levels.rrTp1 >= 2;
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const items = [
    scoreItem('fvgQuality', 'FVG quality', fvgQualityPoints, 2, fvg.detected, fvg.reason),
    scoreItem('fvgFresh', 'FVG freshness', fvgFreshPass ? 1 : 0, 1, fvgFreshPass, fvgFreshPass ? 'FVG age <= 10 candles.' : 'FVG is stale or unavailable.'),
    scoreItem('emaAligned', 'EMA50 alignment', emaPass ? 1 : 0, 1, emaPass, emaPass ? 'EMA50 alignment passed.' : 'EMA50 alignment failed.'),
    scoreItem('rsiCentered', 'RSI centered', rsiCenteredPass ? 1 : 0, 1, rsiCenteredPass, Number.isFinite(rsi) ? `RSI ${rsi.toFixed(1)}.` : 'RSI unavailable.'),
    scoreItem('rrAdequate', 'Risk/reward adequate', rrAdequatePass ? 1 : 0, 1, rrAdequatePass, `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'}.`),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const finalScore = clampScore(technicalTotal);
  const blockedReasons = [];
  const waitReasons = [];

  if (!fvg.detected) waitReasons.push(fvg.reason);
  if (!entry.triggered) waitReasons.push(entry.reason);
  if (!rrPass) blockedReasons.push('FVG RR is below minimum or unavailable.');
  if (!emaPass) blockedReasons.push('FVG EMA50 trend filter failed.');
  if (!rsiPass) blockedReasons.push(`FVG RSI must be between ${rsiMin} and ${rsiMax}.`);
  if (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0) {
    blockedReasons.push('FVG risk levels are invalid.');
  }

  let status = 'NO_TRADE';
  if (!blockedReasons.length && fvg.detected && entry.triggered) {
    status = finalScore >= config.entryScore ? direction : finalScore >= 4 ? 'WAIT' : 'NO_TRADE';
  } else if (!blockedReasons.length && finalScore >= 4) {
    status = 'WAIT';
  }

  const checks = { fvgPass: fvg.detected, entryPass: entry.triggered, emaPass, rsiPass, rrPass };

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal: 0,
    rawTotal: technicalTotal,
    max: 6,
    items,
    adjustments: [],
    breakdown: {
      fvgQuality: items[0].points,
      fvgFresh: items[1].points,
      emaAligned: items[2].points,
      rsiCentered: items[3].points,
      rrAdequate: items[4].points,
    },
    hardBlock: blockedReasons[0] ?? null,
    blockedReasons,
    rejectionReasons: unique([...blockedReasons, ...waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'SAFE_ENTRY' : finalScore >= 4 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.SAFE_ENTRY : finalScore >= 4 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    diagnostics: {
      strategyType: 'fairValueGap',
      direction,
      fvgDetected: fvg.detected,
      entryTriggered: entry.triggered,
      fvgTop: round(fvg.fvgTop),
      fvgBottom: round(fvg.fvgBottom),
      fvgSize: round(fvg.fvgSize),
      fvgSizeAtr: round(fvg.fvgSizeAtr),
      fvgAge: fvg.fvgAge ?? null,
      creationVolumeRatio: round(fvg.creationVolumeRatio),
      emaPass,
      rsiPass,
      rrPass,
      context: {
        fvgTop: round(fvg.fvgTop),
        fvgBottom: round(fvg.fvgBottom),
        fvgMid: round(fvg.fvgMid),
        fvgSizeAtr: round(fvg.fvgSizeAtr),
        fvgAge: fvg.fvgAge ?? null,
        rrTp1: round(levels.rrTp1),
        rrTp2: round(levels.rrTp2),
        slAtrMultiple: round(levels.slAtrMultiple),
      },
    },
    levels,
  };
}

function detectOrderBlock(direction, candles, atr, config) {
  const candleList = Array.isArray(candles) ? candles : [];
  const currentIndex = candleList.length - 1;
  const obLookback = Math.max(3, Math.floor(configNumber(config, 'obLookback', 100)));
  const minObSizeAtr = configNumber(config, 'minObSizeAtr', 0.3);
  const maxObSizeAtr = configNumber(config, 'maxObSizeAtr', 2.5);
  const minObBodyRatio = configNumber(config, 'minObBodyRatio', 0.4);
  const minImpulseMoveAtr = configNumber(config, 'minImpulseMoveAtr', 1.5);
  const impulseWindowCandles = Math.max(1, Math.floor(configNumber(config, 'impulseWindowCandles', 3)));
  const maxObAgeCandles = Math.max(1, Math.floor(configNumber(config, 'maxObAgeCandles', 50)));
  const startIndex = Math.max(0, currentIndex - obLookback);

  if (!Number.isFinite(atr) || atr <= 0 || currentIndex < impulseWindowCandles + 1) {
    return { detected: false, reason: 'ATR or candle history unavailable for OB detection.', reasonCode: 'atrZeroOrNull', atr };
  }

  const rejectionCounts = {
    obViolated: 0,
    obTooOld: 0,
    obSizeTooSmall: 0,
    obSizeTooLarge: 0,
    noImpulseMove: 0,
  };

  for (let index = currentIndex - impulseWindowCandles - 1; index >= startIndex; index -= 1) {
    const orderBlockCandle = candleList[index];
    const range = candleRange(orderBlockCandle);
    const body = candleBody(orderBlockCandle);
    const bodyRatio = Number.isFinite(body) && Number.isFinite(range) && range > 0 ? body / range : null;
    const bearishCandle = Number(orderBlockCandle?.close) < Number(orderBlockCandle?.open);
    const bullishCandle = Number(orderBlockCandle?.close) > Number(orderBlockCandle?.open);
    const shapePass = direction === 'LONG' ? bearishCandle : bullishCandle;
    const obTop = direction === 'LONG' ? Number(orderBlockCandle?.open) : Number(orderBlockCandle?.close);
    const obBottom = direction === 'LONG' ? Number(orderBlockCandle?.close) : Number(orderBlockCandle?.open);
    const obSize = obTop - obBottom;
    const obSizeAtr = obSize / atr;
    const impulseCandles = candleList.slice(index + 1, index + 1 + impulseWindowCandles);
    const impulseClose = impulseCandles.at(-1)?.close;
    const netMove = direction === 'LONG'
      ? Number(impulseClose) - Number(orderBlockCandle?.close)
      : Number(orderBlockCandle?.close) - Number(impulseClose);
    const impulseStrength = netMove / atr;
    const nextCandle = candleList[index + 1];
    const engulfing = direction === 'LONG'
      ? Number(nextCandle?.close) > Number(orderBlockCandle?.open) && Number(nextCandle?.open) <= Number(orderBlockCandle?.close)
      : Number(nextCandle?.close) < Number(orderBlockCandle?.open) && Number(nextCandle?.open) >= Number(orderBlockCandle?.close);
    const impulsePass = Number.isFinite(impulseStrength) && impulseStrength >= minImpulseMoveAtr || engulfing;
    const obAge = currentIndex - index;
    const qualityPass =
      shapePass &&
      Number.isFinite(bodyRatio) && bodyRatio >= minObBodyRatio &&
      Number.isFinite(obSizeAtr) && obSizeAtr >= minObSizeAtr && obSizeAtr <= maxObSizeAtr &&
      impulsePass &&
      obAge <= maxObAgeCandles;

    if (!qualityPass) {
      if (shapePass) {
        if (Number.isFinite(obSizeAtr) && obSizeAtr < minObSizeAtr) rejectionCounts.obSizeTooSmall += 1;
        if (Number.isFinite(obSizeAtr) && obSizeAtr > maxObSizeAtr) rejectionCounts.obSizeTooLarge += 1;
        if (!impulsePass) rejectionCounts.noImpulseMove += 1;
        if (obAge > maxObAgeCandles) rejectionCounts.obTooOld += 1;
      }
      continue;
    }

    const afterImpulse = candleList.slice(index + 1 + impulseWindowCandles, currentIndex);
    const violated = direction === 'LONG'
      ? afterImpulse.some((candle) => Number(candle?.close) < obBottom)
      : afterImpulse.some((candle) => Number(candle?.close) > obTop);

    if (violated) {
      rejectionCounts.obViolated += 1;
      continue;
    }

    return {
      detected: true,
      obTop,
      obBottom,
      obSize,
      obSizeAtr,
      obMid: (obTop + obBottom) / 2,
      obAge,
      impulseStrength,
      bodyRatio,
      formationIndex: index,
      atr,
      rejectionCounts,
      reason: `${direction} OB detected with ${impulseStrength.toFixed(2)}x ATR impulse, age ${obAge} candles.`,
    };
  }

  const primaryReason = Object.entries(rejectionCounts).sort((left, right) => right[1] - left[1])[0];
  return {
    detected: false,
    reason: 'No valid unviolated OB found in lookback.',
    reasonCode: primaryReason?.[1] > 0 ? primaryReason[0] : 'obNotDetected',
    rejectionCounts,
    atr,
  };
}

function obEntryTriggered(direction, currentCandle, ob, indicators, config) {
  const close = Number(currentCandle?.close);
  const low = Number(currentCandle?.low);
  const high = Number(currentCandle?.high);
  const range = candleRange(currentCandle);
  const body = candleBody(currentCandle);
  const bodyRatio = Number.isFinite(body) && Number.isFinite(range) && range > 0 ? body / range : null;
  const averageVolume = Number(indicators?.averageVolume);
  const currentVolume = Number(currentCandle?.volume ?? indicators?.currentVolume);
  const volumeRatio = averageVolume > 0 && Number.isFinite(currentVolume) ? currentVolume / averageVolume : null;
  const minTriggerBodyRatio = configNumber(config, 'minTriggerBodyRatio', 0.4);
  const minTriggerVolumeRatio = configNumber(config, 'minTriggerVolumeRatio', 0.8);

  if (!ob?.detected || !Number.isFinite(close)) {
    return { triggered: false, entryPrice: close, bodyRatio, volumeRatio, reason: 'No detected OB available for entry trigger.' };
  }

  const zoneTouched = direction === 'LONG'
    ? Number.isFinite(low) && low <= ob.obTop && close >= ob.obBottom
    : Number.isFinite(high) && high >= ob.obBottom && close <= ob.obTop;
  const priceReturned = direction === 'LONG'
    ? Number.isFinite(low) && low <= ob.obTop
    : Number.isFinite(high) && high >= ob.obBottom;
  const closeRespected = direction === 'LONG'
    ? close >= ob.obBottom
    : close <= ob.obTop;
  const bodyPass = Number.isFinite(bodyRatio) && bodyRatio >= minTriggerBodyRatio;
  const volumePass = Number.isFinite(volumeRatio) && volumeRatio >= minTriggerVolumeRatio;
  const triggered = zoneTouched && bodyPass && volumePass;
  const reasonCodes = [];

  if (!priceReturned) reasonCodes.push('priceNotReturnedToOB');
  if (priceReturned && !closeRespected) reasonCodes.push('triggerClosedBelowOB');
  if (!bodyPass) reasonCodes.push('bodyRatioTooLow');
  if (!volumePass) reasonCodes.push('volumeTooLow');

  return {
    triggered,
    entryPrice: close,
    bodyRatio,
    volumeRatio,
    zoneTouched,
    priceReturned,
    closeRespected,
    bodyPass,
    volumePass,
    reasonCodes,
    reason: triggered ? `${direction} OB return entry triggered.` : `${direction} OB return entry not triggered.`,
  };
}

function buildOBRiskLevels(direction, entry, ob, atr, config) {
  const stopBufferAtr = configNumber(config, 'stopBufferAtr', 0.15);
  const tp1RTarget = configNumber(config, 'tp1RTarget', 2);
  const tp2RTarget = configNumber(config, 'tp2RTarget', 4);
  const rrMin = configNumber(config, 'rrMin', 1.8);

  if (!isFinitePositive(entry) || !isFinitePositive(atr) || !Number.isFinite(ob?.obTop) || !Number.isFinite(ob?.obBottom)) {
    return { entry1: entry, entry2: null, tp1: null, tp2: null, sl: null, risk: null, rrTp1: null, rrTp2: null, rrRatio: null, atr, rrPass: false };
  }

  const sl = direction === 'LONG' ? ob.obBottom - atr * stopBufferAtr : ob.obTop + atr * stopBufferAtr;
  const risk = direction === 'LONG' ? entry - sl : sl - entry;
  const tp1 = direction === 'LONG' ? entry + risk * tp1RTarget : entry - risk * tp1RTarget;
  const tp2 = direction === 'LONG' ? entry + risk * tp2RTarget : entry - risk * tp2RTarget;
  const rrTp1 = risk > 0 ? tp1RTarget : null;
  const rrTp2 = risk > 0 ? tp2RTarget : null;

  return {
    entry1: entry,
    entry2: ob.obMid,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: risk > 0 ? risk * tp1RTarget : null,
    rewardTp2: risk > 0 ? risk * tp2RTarget : null,
    rrTp1,
    rrTp2,
    rrRatio: rrTp1,
    slAtrMultiple: risk > 0 ? risk / atr : null,
    atr,
    rrPass: Number.isFinite(rrTp1) && rrTp1 >= rrMin,
  };
}

function emaSlopeAligned(direction, indicators) {
  const candles = Array.isArray(indicators?.recentCandles) ? indicators.recentCandles : [];
  if (candles.length < 10 || !Number.isFinite(indicators?.ema50)) {
    return false;
  }

  const older = candles.at(-6)?.close;
  const current = indicators.ema50;
  return direction === 'LONG' ? current > older : current < older;
}

function buildOrderBlockCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext } = options;
  const { rsi, atr } = indicators;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const currentCandle = indicators.lastCandle ?? candles.at(-1);
  const ob = detectOrderBlock(direction, candles, atr, config);
  const entry = obEntryTriggered(direction, currentCandle, ob, indicators, config);
  const levels = buildOBRiskLevels(direction, entry.entryPrice, ob, atr, config);
  const emaPass = emaSlopeAligned(direction, indicators);
  const rsiMin = configNumber(config, 'rsiMin', 35);
  const rsiMax = configNumber(config, 'rsiMax', 65);
  const rsiPass = Number.isFinite(rsi) && rsi >= rsiMin && rsi <= rsiMax;
  const rrPass = levels.rrPass === true;
  const obQualityPoints = ob.detected && ob.impulseStrength > 3 ? 2 : ob.detected ? 1 : 0;
  const obFreshPass = ob.detected && ob.obAge <= 20;
  const rsiCenteredPass = Number.isFinite(rsi) && rsi >= 45 && rsi <= 55;
  const rrAdequatePass = Number.isFinite(levels.rrTp1) && levels.rrTp1 >= 2.5;
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const items = [
    scoreItem('obQuality', 'OB impulse quality', obQualityPoints, 2, ob.detected, ob.reason),
    scoreItem('obFresh', 'OB freshness', obFreshPass ? 1 : 0, 1, obFreshPass, obFreshPass ? 'OB age <= 20 candles.' : 'OB is stale or unavailable.'),
    scoreItem('emaSlope', 'EMA50 slope alignment', emaPass ? 1 : 0, 1, emaPass, emaPass ? 'EMA50 slope aligned.' : 'EMA50 slope failed.'),
    scoreItem('rsiCentered', 'RSI centered', rsiCenteredPass ? 1 : 0, 1, rsiCenteredPass, Number.isFinite(rsi) ? `RSI ${rsi.toFixed(1)}.` : 'RSI unavailable.'),
    scoreItem('rrAdequate', 'Risk/reward adequate', rrAdequatePass ? 1 : 0, 1, rrAdequatePass, `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'}.`),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const finalScore = clampScore(technicalTotal);
  const blockedReasons = [];
  const waitReasons = [];
  const rejectionReasonCodes = [];

  if (!ob.detected) {
    waitReasons.push(ob.reason);
    rejectionReasonCodes.push(ob.reasonCode ?? 'obNotDetected');
  }
  if (!entry.triggered) {
    waitReasons.push(entry.reason);
    rejectionReasonCodes.push(...(entry.reasonCodes ?? []));
  }
  if (entry.triggered && !rrPass) {
    blockedReasons.push('OB RR is below minimum or unavailable.');
    rejectionReasonCodes.push('rrFailed');
  }
  if (!emaPass) {
    blockedReasons.push('OB EMA50 slope filter failed.');
    rejectionReasonCodes.push('emaSlopeWrong');
  }
  if (!rsiPass) {
    blockedReasons.push(`OB RSI must be between ${rsiMin} and ${rsiMax}.`);
    rejectionReasonCodes.push('rsiOutOfRange');
  }
  if (entry.triggered && (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0)) {
    blockedReasons.push('OB risk levels are invalid.');
  }

  let status = 'NO_TRADE';
  if (!blockedReasons.length && ob.detected && entry.triggered) {
    status = finalScore >= config.entryScore ? direction : finalScore >= 4 ? 'WAIT' : 'NO_TRADE';
  } else if (!blockedReasons.length && finalScore >= 4) {
    status = 'WAIT';
  }

  if (ob.detected && entry.triggered && finalScore < config.entryScore) {
    rejectionReasonCodes.push('scoreTooLow');
  }

  const checks = { obPass: ob.detected, entryPass: entry.triggered, emaPass, rsiPass, rrPass };

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal: 0,
    rawTotal: technicalTotal,
    max: 6,
    items,
    adjustments: [],
    breakdown: {
      obQuality: items[0].points,
      obFresh: items[1].points,
      emaSlope: items[2].points,
      rsiCentered: items[3].points,
      rrAdequate: items[4].points,
    },
    hardBlock: blockedReasons[0] ?? null,
    blockedReasons,
    rejectionReasons: unique([...blockedReasons, ...waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'SAFE_ENTRY' : finalScore >= 4 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.SAFE_ENTRY : finalScore >= 4 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    diagnostics: {
      strategyType: 'orderBlock',
      direction,
      obDetected: ob.detected,
      entryTriggered: entry.triggered,
      zoneTouched: entry.zoneTouched,
      priceReturned: entry.priceReturned,
      obTop: round(ob.obTop),
      obBottom: round(ob.obBottom),
      obSize: round(ob.obSize),
      obSizeAtr: round(ob.obSizeAtr),
      obAge: ob.obAge ?? null,
      atr: round(atr),
      impulseStrength: round(ob.impulseStrength),
      triggerBodyRatio: round(entry.bodyRatio),
      triggerVolumeRatio: round(entry.volumeRatio),
      emaPass,
      rsiPass,
      rrPass,
      score: finalScore,
      rejectionReasonCodes: unique(rejectionReasonCodes),
      context: {
        obTop: round(ob.obTop),
        obBottom: round(ob.obBottom),
        obMid: round(ob.obMid),
        obSizeAtr: round(ob.obSizeAtr),
        obAge: ob.obAge ?? null,
        impulseStrength: round(ob.impulseStrength),
        rrTp1: round(levels.rrTp1),
        rrTp2: round(levels.rrTp2),
        slAtrMultiple: round(levels.slAtrMultiple),
      },
    },
    levels,
  };
}


function detectCompressionRange(candles, atr, config) {
  const candleList = Array.isArray(candles) ? candles : [];
  const compressionLookback = Math.max(5, Math.floor(configNumber(config, 'compressionLookback', 20)));

  if (!isFinitePositive(atr) || candleList.length < compressionLookback + 1) {
    return { valid: false, reason: 'ATR or candle history unavailable for failed breakout compression.', candlesInside: 0 };
  }

  const priorWindowSize = Math.floor(compressionLookback / 2);
  const priorCandles = candleList.slice(
    -(compressionLookback + 1 + priorWindowSize),
    -(compressionLookback + 1),
  );
  const currentCandles = candleList.slice(-(compressionLookback + 1), -1);

  if (priorCandles.length < priorWindowSize || currentCandles.length < compressionLookback) {
    return { valid: false, reason: 'Insufficient history for prior compression range.', candlesInside: 0 };
  }

  const highs = priorCandles.map((candle) => Number(candle?.high)).filter(Number.isFinite);
  const lows = priorCandles.map((candle) => Number(candle?.low)).filter(Number.isFinite);

  if (highs.length < priorWindowSize || lows.length < priorWindowSize) {
    return { valid: false, reason: 'Compression range has incomplete prior candles.', candlesInside: 0 };
  }

  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangeSize = rangeHigh - rangeLow;
  const rangeSizeAtr = rangeSize / atr;
  const maxRangeSizeAtr = configNumber(config, 'maxRangeSizeAtr', 2);
  const minCandlesInsideRange = Math.max(1, Math.floor(configNumber(config, 'minCandlesInsideRange', 15)));
  const rangeBuffer = atr * 0.05;
  const candlesInside = currentCandles.filter((candle) => Number(candle?.high) <= rangeHigh + rangeBuffer && Number(candle?.low) >= rangeLow - rangeBuffer).length;
  const valid = Number.isFinite(rangeSizeAtr) && rangeSizeAtr <= maxRangeSizeAtr && candlesInside >= minCandlesInsideRange;

  return {
    valid,
    rangeHigh,
    rangeLow,
    rangeSize,
    rangeSizeAtr,
    candlesInside,
    lookback: compressionLookback,
    reason: valid ? 'Compression range detected.' : 'No valid compression range for failed breakout.',
  };
}

function detectFailedBreakout(direction, candles, range, config) {
  const candleList = Array.isArray(candles) ? candles : [];
  const currentIndex = candleList.length - 1;
  const failureWindowCandles = Math.max(1, Math.floor(configNumber(config, 'failureWindowCandles', 3)));
  const minBreakoutVolumeRatio = configNumber(config, 'minBreakoutVolumeRatio', 1.2);

  if (currentIndex < failureWindowCandles) {
    return { detected: false, range: range?.valid ? range : null, reason: 'Candle history unavailable for failed breakout detection.' };
  }

  const firstBreakoutIndex = Math.max(0, currentIndex - failureWindowCandles);
  for (let breakoutIndex = firstBreakoutIndex; breakoutIndex < currentIndex; breakoutIndex += 1) {
    const breakoutRange = detectCompressionRange(candleList.slice(0, breakoutIndex + 1), atrFromRange(range), config);
    const activeRange = breakoutRange.valid ? breakoutRange : range;

    if (!activeRange?.valid || !Number.isFinite(activeRange.rangeHigh) || !Number.isFinite(activeRange.rangeLow)) {
      continue;
    }

    const breakoutCandle = candleList[breakoutIndex];
    const failureCandle = candleList[currentIndex];
    const averageVolume = averageVolumeForWindow(candleList.slice(Math.max(0, breakoutIndex - 20), breakoutIndex));
    const breakoutVolume = Number(breakoutCandle?.volume);
    const breakoutVolumeRatio = averageVolume > 0 && Number.isFinite(breakoutVolume) ? breakoutVolume / averageVolume : null;
    const volumePass = Number.isFinite(breakoutVolumeRatio) && breakoutVolumeRatio >= minBreakoutVolumeRatio;
    const candlesToFailure = currentIndex - breakoutIndex;

    if (direction === 'LONG') {
      const brokeBelow = Number(breakoutCandle?.close) < activeRange.rangeLow;
      const reclaimed = Number(failureCandle?.close) >= activeRange.rangeLow;
      if (brokeBelow && reclaimed && volumePass && candlesToFailure >= 1 && candlesToFailure <= failureWindowCandles) {
        return {
          detected: true,
          range: activeRange,
          breakoutCandle,
          failureCandle,
          breakoutIndex,
          failureIndex: currentIndex,
          breakoutExtreme: Number(breakoutCandle?.low),
          breakoutVolumeRatio,
          candlesToFailure,
          reason: 'Failed downside breakout reclaimed range low.',
        };
      }
    } else {
      const brokeAbove = Number(breakoutCandle?.close) > activeRange.rangeHigh;
      const rejected = Number(failureCandle?.close) <= activeRange.rangeHigh;
      if (brokeAbove && rejected && volumePass && candlesToFailure >= 1 && candlesToFailure <= failureWindowCandles) {
        return {
          detected: true,
          range: activeRange,
          breakoutCandle,
          failureCandle,
          breakoutIndex,
          failureIndex: currentIndex,
          breakoutExtreme: Number(breakoutCandle?.high),
          breakoutVolumeRatio,
          candlesToFailure,
          reason: 'Failed upside breakout rejected below range high.',
        };
      }
    }
  }

  return { detected: false, range: range?.valid ? range : null, reason: 'No fresh failed breakout detected.' };
}

function atrFromRange(range) {
  return Number.isFinite(range?.atr) && range.atr > 0 ? range.atr : Number(range?.rangeSize) / Number(range?.rangeSizeAtr);
}

function buildFailedBreakoutRiskLevels(direction, entry, range, breakoutExtreme, atr, config) {
  const stopBufferAtr = configNumber(config, 'stopBufferAtr', 0.2);
  const tp1RTarget = configNumber(config, 'tp1RTarget', 1.5);
  const tp2RTarget = configNumber(config, 'tp2RTarget', 2.5);
  const rrMin = configNumber(config, 'rrMin', 1.3);

  if (!isFinitePositive(entry) || !isFinitePositive(atr) || !Number.isFinite(breakoutExtreme)) {
    return { entry1: entry, entry2: null, tp1: null, tp2: null, sl: null, risk: null, rrTp1: null, rrTp2: null, rrRatio: null, atr, rrPass: false };
  }

  const sl = direction === 'LONG' ? breakoutExtreme - atr * stopBufferAtr : breakoutExtreme + atr * stopBufferAtr;
  const risk = direction === 'LONG' ? entry - sl : sl - entry;
  const tp1 = direction === 'LONG' ? entry + risk * tp1RTarget : entry - risk * tp1RTarget;
  const tp2 = direction === 'LONG' ? entry + risk * tp2RTarget : entry - risk * tp2RTarget;
  const rrTp1 = risk > 0 ? tp1RTarget : null;
  const rrTp2 = risk > 0 ? tp2RTarget : null;

  return {
    entry1: entry,
    entry2: direction === 'LONG' ? range?.rangeLow : range?.rangeHigh,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1: risk > 0 ? risk * tp1RTarget : null,
    rewardTp2: risk > 0 ? risk * tp2RTarget : null,
    rrTp1,
    rrTp2,
    rrRatio: rrTp1,
    slAtrMultiple: risk > 0 ? risk / atr : null,
    atr,
    rrPass: Number.isFinite(rrTp1) && rrTp1 >= rrMin,
  };
}

function buildFailedBreakoutCandidate(direction, indicators, options, marketRegime, config) {
  const { rsi, atr } = indicators;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const currentCandle = indicators.lastCandle ?? candles.at(-1);
  const entry = Number(currentCandle?.close ?? indicators.price);
  const range = detectCompressionRange(candles, atr, config);
  const failure = detectFailedBreakout(direction, candles, range, config);
  const activeRange = failure.range ?? range;
  const levels = buildFailedBreakoutRiskLevels(direction, entry, activeRange, failure.breakoutExtreme, atr, config);
  const rsiMin = configNumber(config, 'rsiMin', 35);
  const rsiMax = configNumber(config, 'rsiMax', 65);
  const rsiPass = Number.isFinite(rsi) && rsi >= rsiMin && rsi <= rsiMax;
  const rrPass = levels.rrPass === true;
  const compressionQualityPoints = activeRange.candlesInside >= 18 ? 2 : activeRange.candlesInside >= 15 ? 1 : 0;
  const breakoutVolumePass = Number.isFinite(failure.breakoutVolumeRatio) && failure.breakoutVolumeRatio >= 1.5;
  const failureSpeedPass = failure.candlesToFailure === 1;
  const rrAdequatePass = Number.isFinite(levels.rrTp1) && levels.rrTp1 >= 1.8;
  const items = [
    scoreItem('compressionQuality', 'Compression quality', compressionQualityPoints, 2, activeRange.valid, `${activeRange.candlesInside ?? 0}/${activeRange.lookback ?? 0} candles inside range.`),
    scoreItem('breakoutVolume', 'Breakout volume', breakoutVolumePass ? 1 : 0, 1, breakoutVolumePass, `Breakout volume ratio ${Number.isFinite(failure.breakoutVolumeRatio) ? failure.breakoutVolumeRatio.toFixed(2) : '--'}.`),
    scoreItem('failureSpeed', 'Failure speed', failureSpeedPass ? 1 : 0, 1, failureSpeedPass, Number.isFinite(failure.candlesToFailure) ? `Failed in ${failure.candlesToFailure} candles.` : 'No failure speed.'),
    scoreItem('rrAdequate', 'Risk/reward adequate', rrAdequatePass ? 1 : 0, 1, rrAdequatePass, `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'}.`),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const finalScore = Math.min(5, technicalTotal);
  const blockedReasons = [];
  const waitReasons = [];

  if (!activeRange.valid) waitReasons.push(activeRange.reason);
  if (activeRange.valid && !failure.detected) waitReasons.push(failure.reason);
  if (failure.detected && !rrPass) blockedReasons.push('Failed breakout RR is below minimum or unavailable.');
  if (failure.detected && !rsiPass) blockedReasons.push(`Failed breakout RSI must be between ${rsiMin} and ${rsiMax}.`);
  if (failure.detected && (!Number.isFinite(levels.sl) || !Number.isFinite(levels.tp1) || !Number.isFinite(levels.risk) || levels.risk <= 0)) {
    blockedReasons.push('Failed breakout risk levels are invalid.');
  }

  let status = 'NO_TRADE';
  if (!blockedReasons.length && activeRange.valid && failure.detected) {
    status = finalScore >= config.entryScore ? direction : finalScore >= 3 ? 'WAIT' : 'NO_TRADE';
  } else if (!blockedReasons.length && activeRange.valid && finalScore >= 3) {
    status = 'WAIT';
  }

  const checks = { compressionPass: activeRange.valid, failurePass: failure.detected, rsiPass, rrPass };

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal: 0,
    rawTotal: technicalTotal,
    max: 5,
    items,
    adjustments: [],
    breakdown: {
      compressionQuality: items[0].points,
      breakoutVolume: items[1].points,
      failureSpeed: items[2].points,
      rrAdequate: items[3].points,
    },
    hardBlock: blockedReasons[0] ?? null,
    blockedReasons,
    rejectionReasons: unique([...blockedReasons, ...waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    waitReasons,
    warnings: [],
    entryContext: status === direction ? 'SAFE_ENTRY' : finalScore >= 3 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.SAFE_ENTRY : finalScore >= 3 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment: { points: 0, warning: null },
    fundingOiAdjustment: { points: 0, warnings: [] },
    checks,
    diagnostics: {
      strategyType: 'failedBreakoutReversion',
      direction,
      compressionDetected: activeRange.valid,
      failedBreakoutDetected: failure.detected,
      rangeHigh: round(activeRange.rangeHigh),
      rangeLow: round(activeRange.rangeLow),
      rangeSize: round(activeRange.rangeSize),
      rangeSizeAtr: round(activeRange.rangeSizeAtr),
      candlesInside: activeRange.candlesInside ?? 0,
      breakoutVolumeRatio: round(failure.breakoutVolumeRatio),
      candlesToFailure: failure.candlesToFailure ?? null,
      breakoutExtreme: round(failure.breakoutExtreme),
      rsiPass,
      rrPass,
      score: finalScore,
    },
    levels,
  };
}

function buildLiquiditySweepReclaimCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext } = options;
  const { price, ema20, ema50, ema200, rsi, atr } = indicators;
  const candles = Array.isArray(indicators.recentCandles) ? indicators.recentCandles : [];
  const level = direction === 'LONG' ? indicators.support : indicators.resistance;
  const sweep = sweepDetected(direction, candles, level, atr, config);
  const reclaim = reclaimConfirmed(direction, candles, level, config, sweep.sweepCandleIndex);
  const reclaimWindowCandles = Math.max(1, Math.floor(configNumber(config, 'reclaimWindowCandles', 3)));
  const currentCandleIndex = candles.length - 1;
  const candlesSinceSweep =
    sweep.detected && Number.isInteger(sweep.sweepCandleIndex) ? currentCandleIndex - sweep.sweepCandleIndex : null;
  const withinReclaimWindow =
    Number.isFinite(candlesSinceSweep) && candlesSinceSweep >= 1 && candlesSinceSweep <= reclaimWindowCandles;
  const reclaimIsCurrentCandle = reclaim.confirmed && reclaim.reclaimCandleIndex === currentCandleIndex;
  const sweepExtreme = direction === 'LONG' ? sweep.sweepLow : sweep.sweepHigh;
  const levels = buildLiquiditySweepRiskLevels(direction, price, sweepExtreme, atr, config);
  const rrTp1Min = configNumber(config, 'rrTp1Min', 1.5);
  const rrTp2Min = configNumber(config, 'rrTp2Min', 2.5);
  const maxSlAtrMultiple = configNumber(config, 'maxSlAtrMultiple', 2);
  const minSweepWickAtr = configNumber(config, 'minSweepWickAtrMultiple', 0.2);
  const minBodyToRange = configNumber(config, 'minReclaimBodyToRange', 0.45);
  const trendPass = alignTrend({ direction, price, ema20, ema50, ema200 });
  const rsiPass = direction === 'LONG' ? Number.isFinite(rsi) && rsi <= 72 : Number.isFinite(rsi) && rsi >= 28;
  const volume = volumeQuality(indicators);
  const volumePass = volume.passed;
  const sweepWickAtr = Number.isFinite(sweep.wickSize) && atr > 0 ? sweep.wickSize / atr : null;
  const sweepPass = sweep.detected && Number.isFinite(sweepWickAtr) && sweepWickAtr >= minSweepWickAtr;
  const sweepRangePass = sweep.detected && Number.isFinite(sweep.rangeAtr) && sweep.rangeAtr <= configNumber(config, 'maxSweepRangeAtrMultiple', 2.5);
  const reclaimPass =
    reclaim.confirmed &&
    withinReclaimWindow &&
    reclaimIsCurrentCandle &&
    Number.isFinite(reclaim.bodyToRange) &&
    reclaim.bodyToRange >= minBodyToRange;
  const rrPass =
    Number.isFinite(levels.rrTp1) &&
    levels.rrTp1 >= rrTp1Min &&
    Number.isFinite(levels.rrTp2) &&
    levels.rrTp2 >= rrTp2Min;
  const slPass = Number.isFinite(levels.slAtrMultiple) && levels.slAtrMultiple <= maxSlAtrMultiple;
  const sweepPoints = sweepPass ? (sweepWickAtr >= SWEEP_STRONG_WICK_ATR ? 2 : 1) : 0;
  const reclaimPoints = reclaimPass ? (reclaim.bodyToRange >= Math.min(0.9, minBodyToRange + 0.2) ? 2 : 1) : 0;
  const checks = {
    trendPass,
    rsiPass,
    macdPass: true,
    structurePass: sweepPass && reclaimPass,
    levelPass: sweepPass,
    volumePass,
    sweepPass,
    sweepRangePass,
    reclaimPass,
    withinReclaimWindow,
    reclaimIsCurrentCandle,
    rrPass,
    slPass,
    resistanceDistance: direction === 'SHORT' && Number.isFinite(level) ? pctDistance(price, level) : null,
    supportDistance: direction === 'LONG' && Number.isFinite(level) ? pctDistance(price, level) : null,
    filtersPass: sweepPass && reclaimPass && trendPass && rsiPass && rrPass && slPass,
    sweepReason: sweepPass
      ? `Sweep detected: wick ${sweepWickAtr?.toFixed(2) ?? '--'}x ATR through ${direction === 'LONG' ? 'support' : 'resistance'}.`
      : `No qualifying ${direction} sweep through ${direction === 'LONG' ? 'support' : 'resistance'}.`,
    reclaimReason: reclaimPass
      ? `Reclaim confirmed: body ${(reclaim.bodyToRange * 100).toFixed(1)}% of candle range.`
      : !withinReclaimWindow && sweep.detected
        ? `Current candle is outside reclaim window (${candlesSinceSweep ?? '--'} candles after sweep, max ${reclaimWindowCandles}).`
        : reclaim.confirmed && !reclaimIsCurrentCandle
          ? 'Reclaim already happened on an earlier candle; skip duplicate entry for this sweep.'
        : `No reclaim close with body >= ${(minBodyToRange * 100).toFixed(1)}% of candle range after sweep.`,
    rsiReason: Number.isFinite(rsi)
      ? `RSI ${rsi.toFixed(1)} ${rsiPass ? 'not extreme' : 'is extreme'} for ${direction}.`
      : 'RSI unavailable.',
    rrReason: `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${rrTp1Min}), TP2 ${Number.isFinite(levels.rrTp2) ? levels.rrTp2.toFixed(2) : '--'} (target ${rrTp2Min}).`,
  };
  const items = [
    scoreItem('sweepQuality', 'Sweep quality', sweepPoints, 2, sweepPass, checks.sweepReason),
    scoreItem('reclaimQuality', 'Reclaim candle quality', reclaimPoints, 2, reclaimPass, checks.reclaimReason),
    scoreItem('ema', 'EMA trend alignment', trendPass ? 1 : 0, 1, trendPass, trendPass ? 'EMA trend aligned.' : 'EMA trend not aligned.'),
    scoreItem('rsi', 'RSI not extreme', rsiPass ? 1 : 0, 1, rsiPass, checks.rsiReason),
    scoreItem('riskReward', 'Risk/reward valid', rrPass && slPass ? 1 : 0, 1, rrPass && slPass, checks.rrReason),
    scoreItem('volume', 'Volume on reclaim candle', volumePass ? 1 : 0, 1, volumePass, volume.reason),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const adjustments = [
    adjustmentItem('btc', 'BTC Confirmation', btcAdjustment.points, btcAdjustment.note),
    adjustmentItem('fundingOi', 'Funding/OI', fundingOiAdjustment.points, fundingOiAdjustment.note),
  ];
  const adjustmentTotal = btcAdjustment.points + fundingOiAdjustment.points;
  const finalScore = clampScore(technicalTotal + adjustmentTotal);
  const blocks = liquiditySweepHardBlocks(indicators, levels, checks, config);
  const blockReasonCodes = classifyLiquiditySweepBlockReasons(sweep, reclaim, checks, levels);
  let status = 'NO_TRADE';

  if (!blocks.reasons.length) {
    if (!sweep.detected) {
      status = 'NO_TRADE';
    } else if (!withinReclaimWindow && Number.isFinite(candlesSinceSweep) && candlesSinceSweep > reclaimWindowCandles) {
      status = 'NO_TRADE';
    } else if (reclaim.confirmed && !reclaimIsCurrentCandle) {
      status = 'NO_TRADE';
    } else if (!reclaim.confirmed || !withinReclaimWindow) {
      status = 'WAIT_RETEST';
    } else if (blocks.waitReasons.length) {
      status = finalScore >= 5 ? 'WAIT' : 'NO_TRADE';
    } else if (finalScore >= config.entryScore && checks.filtersPass) {
      status = direction;
    } else if (finalScore >= 5) {
      status = 'WAIT';
    }
  }

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal,
    rawTotal: technicalTotal + adjustmentTotal,
    max: SCORE_MAX,
    items,
    adjustments,
    breakdown: {
      sweepQuality: items[0].points,
      reclaimQuality: items[1].points,
      ema: items[2].points,
      rsiMomentum: items[3].points,
      rrRatio: items[4].points,
      volume: items[5].points,
      trend: items[2].points,
    },
    hardBlock: blocks.reasons[0] ?? null,
    blockedReasons: blocks.reasons,
    rejectionReasons: unique([...blocks.reasons, ...blocks.waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    blockReasonCodes,
    waitReasons: blocks.waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'SAFE_ENTRY' : status === 'WAIT_RETEST' ? 'WAIT_RETEST' : finalScore >= 5 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice:
      status === direction
        ? ENTRY_ADVICE.SAFE_ENTRY
        : status === 'WAIT_RETEST'
          ? ENTRY_ADVICE.WAIT_RETEST
          : finalScore >= 5
            ? ENTRY_ADVICE.WAIT_CONFIRMATION
            : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    diagnostics: {
      strategyType: 'liquiditySweepReclaim',
      direction,
      sweepDetected: sweep.detected,
      reclaimConfirmed: reclaim.confirmed,
      withinReclaimWindow,
      reclaimIsCurrentCandle,
      candlesSinceSweep,
      trendPass,
      rsiPass,
      volumePass,
      rrPass,
      slPass,
      blockReasonCodes,
      primaryBlockReason: blockReasonCodes[0] ?? V2_LIQUIDITY_SWEEP_BLOCK_REASONS.OTHER,
      context: {
        level: round(level),
        sweepLow: round(sweep.sweepLow),
        sweepHigh: round(sweep.sweepHigh),
        sweepWickAtr: round(sweepWickAtr),
        sweepRangeAtr: round(sweep.rangeAtr),
        candlesSinceSweep: round(candlesSinceSweep),
        reclaimBodyToRange: round(reclaim.bodyToRange),
        volumeRatio: round(volume.ratio),
        rrTp1: round(levels.rrTp1),
        rrTp2: round(levels.rrTp2),
        slAtrMultiple: round(levels.slAtrMultiple),
      },
    },
    levels,
  };
}

function trendPullbackHardBlocks(direction, indicators, levels, regime, btcAdjustment, fundingOiAdjustment, checks, config) {
  const reasons = [];
  const waitReasons = [];
  const {
    valid,
    reason,
    stale,
    feedStale,
    dataError,
    rsi,
    atr,
    lastCandleRange,
    fundingRate,
  } = indicators;
  const rrHardMin = 1.2;
  const maxSlAtrMultiple = Number.isFinite(Number(config.maxSlAtrMultiple)) ? Number(config.maxSlAtrMultiple) : 2.4;

  if (valid === false || reason === 'insufficient_data') {
    reasons.push('Insufficient candles for EMA200/RSI/MACD/ATR.');
  }

  if (stale || feedStale || dataError) {
    reasons.push(dataError ? `Data feed error: ${dataError}` : 'Stale data. Signal execution disabled.');
  }

  if (regime === 'VOLATILE_SPIKE') {
    reasons.push('Last candle is too long versus ATR. Avoid FOMO entry.');
  }

  if (direction === 'LONG' && rsi > 72) {
    reasons.push('RSI > 72 for LONG.');
  }

  if (direction === 'SHORT' && rsi < 28) {
    reasons.push('RSI < 28 for SHORT.');
  }

  if (!Number.isFinite(levels.rrTp1)) {
    reasons.push('RR to TP1 is unavailable.');
  } else if (levels.rrTp1 < rrHardMin) {
    reasons.push(`R:R is only ${levels.rrTp1.toFixed(2)}:1, below hard minimum ${rrHardMin}.`);
  }

  if (!Number.isFinite(levels.slAtrMultiple)) {
    reasons.push('Stop loss cannot be derived from support/resistance/ATR.');
  } else if (levels.slAtrMultiple > maxSlAtrMultiple) {
    waitReasons.push(`SL distance is greater than ATR x ${maxSlAtrMultiple}.`);
  } else if (levels.slAtrMultiple < 0.35) {
    waitReasons.push('SL is too close and likely to be hit by noise.');
  }

  if (Number.isFinite(lastCandleRange) && Number.isFinite(atr) && lastCandleRange > atr * 1.8) {
    reasons.push('Candle range > ATR x 1.8.');
  }

  if (Math.abs(btcAdjustment.points) === 2) {
    waitReasons.push('BTC confirmation is strongly against this altcoin setup.');
  }

  if (
    (direction === 'LONG' && Number.isFinite(fundingRate) && fundingRate > FUNDING_EXTREME) ||
    (direction === 'SHORT' && Number.isFinite(fundingRate) && fundingRate < -FUNDING_EXTREME)
  ) {
    waitReasons.push('Funding is extremely crowded against this setup.');
  }

  if (!checks.trendPass) {
    reasons.push('Trend structure is not aligned for trend-pullback continuation.');
  }

  if (!checks.pullbackPass) {
    waitReasons.push('Pullback has not reached a clean EMA/value zone.');
  }

  if (!checks.continuationPass) {
    waitReasons.push('Continuation candle has not confirmed trend direction.');
  }

  if (!checks.levelPass) {
    waitReasons.push(direction === 'LONG' ? 'LONG lacks room before resistance.' : 'SHORT lacks room before support.');
  }

  if (!checks.qualityFiltersPass) {
    waitReasons.push(...(checks.qualityFilterReasons ?? []));
  }

  return { reasons: unique(reasons), waitReasons: unique(waitReasons) };
}

function buildTrendPullbackCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext } = options;
  const { price, ema20, ema50, ema200, rsi, macd, currentVolume, averageVolume } = indicators;
  const trendPass =
    direction === 'LONG'
      ? price > ema50 && ema20 > ema50 && ema50 > ema200
      : price < ema50 && ema20 < ema50 && ema50 < ema200;
  const pullback = trendPullbackQuality(direction, indicators, config);
  const continuationPass = candleDirectionPass(direction, indicators.lastCandle, indicators.previousCandle);
  const rsiPass = direction === 'LONG' ? rsi >= 46 && rsi <= 68 : rsi >= 32 && rsi <= 54;
  const macdPass =
    direction === 'LONG'
      ? macd?.MACD > macd?.signal || macd?.histogram > 0 || lastMacdImproving(direction, indicators.macdSeriesTail)
      : macd?.MACD < macd?.signal || macd?.histogram < 0 || lastMacdImproving(direction, indicators.macdSeriesTail);
  const momentumPass = rsiPass && macdPass;
  const level = trendPullbackRoom(direction, indicators, config);
  const minVolumeRatio = Number.isFinite(Number(config.minVolumeRatio)) ? Number(config.minVolumeRatio) : 0.85;
  const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : null;
  const volumePass = Number.isFinite(volumeRatio) && volumeRatio >= minVolumeRatio;
  const volume = {
    passed: volumePass,
    ratio: volumeRatio,
    reason: Number.isFinite(volumeRatio)
      ? `Volume ${volumeRatio.toFixed(2)}x average (min ${minVolumeRatio}).`
      : 'Volume average unavailable.',
  };
  const qualityFilters = trendPullbackQualityFilters(direction, indicators, config);
  const levels = buildRiskLevels(direction, indicators, config);
  const rrTp1Min = Number.isFinite(Number(config.rrTp1Min)) ? Number(config.rrTp1Min) : 1.5;
  const rrTp2Min = Number.isFinite(Number(config.rrTp2Min)) ? Number(config.rrTp2Min) : 2;
  const rrPass =
    Number.isFinite(levels.rrTp1) &&
    levels.rrTp1 >= rrTp1Min &&
    Number.isFinite(levels.rrTp2) &&
    levels.rrTp2 >= rrTp2Min;

  const items = [
    scoreItem('ema', 'EMA trend alignment', trendPass ? 2 : 0, 2, trendPass, trendPass ? 'EMA trend aligned.' : 'EMA trend not aligned.'),
    scoreItem('pullback', 'Controlled pullback to value', pullback.passed ? 1 : 0, 1, pullback.passed, pullback.reason),
    scoreItem('continuation', 'Continuation candle confirmed', continuationPass ? 1 : 0, 1, continuationPass, continuationPass ? 'Continuation candle closed in trend direction.' : 'No continuation candle yet.'),
    scoreItem('momentum', 'Momentum confirms continuation', momentumPass ? 1 : 0, 1, momentumPass, momentumPass ? 'RSI/MACD support continuation.' : 'RSI/MACD continuation is not confirmed.'),
    scoreItem('keyLevel', 'Room from opposing level', level.passed ? 1 : 0, 1, level.passed, level.reason),
    scoreItem('volume', 'Volume is acceptable', volume.passed ? 1 : 0, 1, volume.passed, volume.reason),
    ...qualityFilters.checks.map((check) =>
      scoreItem(check.key, `Quality filter: ${check.key}`, 0, 0, check.passed, check.reason),
    ),
    scoreItem(
      'riskReward',
      'Risk/reward valid',
      rrPass ? 1 : 0,
      1,
      rrPass,
      `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${rrTp1Min}), TP2 ${Number.isFinite(levels.rrTp2) ? levels.rrTp2.toFixed(2) : '--'} (target ${rrTp2Min}).`,
    ),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const adjustments = [
    adjustmentItem('btc', 'BTC Confirmation', btcAdjustment.points, btcAdjustment.note),
    adjustmentItem('fundingOi', 'Funding/OI', fundingOiAdjustment.points, fundingOiAdjustment.note),
  ];
  const adjustmentTotal = btcAdjustment.points + fundingOiAdjustment.points;
  const finalScore = clampScore(technicalTotal + adjustmentTotal);
  const checks = {
    trendPass,
    pullbackPass: pullback.passed,
    continuationPass,
    rsiPass,
    macdPass,
    structurePass: pullback.passed,
    levelPass: level.passed,
    volumePass: volume.passed,
    qualityFiltersPass: qualityFilters.passed,
    qualityFilterReasons: qualityFilters.failedReasons,
    rrPass,
    resistanceDistance: level.resistanceDistance,
    supportDistance: level.supportDistance,
    filtersPass: trendPass && pullback.passed && continuationPass && momentumPass && level.passed && qualityFilters.passed && rrPass,
  };
  const blocks = trendPullbackHardBlocks(direction, indicators, levels, marketRegime, btcAdjustment, fundingOiAdjustment, checks, config);
  let status = 'NO_TRADE';

  if (!blocks.reasons.length) {
    if (blocks.waitReasons.length) {
      status = finalScore >= 6 ? 'WAIT' : 'NO_TRADE';
    } else if (finalScore >= config.entryScore && checks.filtersPass) {
      status = direction;
    } else if (finalScore >= 6) {
      status = 'WAIT';
    }
  }

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal,
    rawTotal: technicalTotal + adjustmentTotal,
    max: SCORE_MAX,
    items,
    adjustments,
    breakdown: {
      ema: items[0].points,
      pullback: items[1].points,
      continuation: items[2].points,
      momentum: items[3].points,
      keyLevel: items[4].points,
      volume: items[5].points,
      rrRatio: rrPass ? 1 : 0,
      trend: items[0].points,
    },
    hardBlock: blocks.reasons[0] ?? null,
    blockedReasons: blocks.reasons,
    rejectionReasons: unique([...blocks.reasons, ...blocks.waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    waitReasons: blocks.waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext: status === direction ? 'SAFE_ENTRY' : finalScore >= 6 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET',
    entryAdvice: status === direction ? ENTRY_ADVICE.SAFE_ENTRY : finalScore >= 6 ? ENTRY_ADVICE.WAIT_CONFIRMATION : ENTRY_ADVICE.CHOPPY_MARKET,
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    levels,
  };
}

function buildBtcAdjustment({ symbol, direction, btcContext }) {
  if (isBtcSymbol(symbol)) {
    return {
      points: 0,
      bias: 'SELF',
      rsi: null,
      confirmation: false,
      note: 'BTC context skipped for BTC itself.',
      warning: null,
    };
  }

  if (!btcContext?.btcBias) {
    return {
      points: 0,
      bias: 'NEUTRAL',
      rsi: null,
      confirmation: false,
      note: 'BTC context unavailable.',
      warning: 'BTC context unavailable.',
    };
  }

  const bias = btcContext.btcBias;
  const aligned = (direction === 'LONG' && bias === 'BULLISH') || (direction === 'SHORT' && bias === 'BEARISH');
  const opposed = (direction === 'LONG' && bias === 'BEARISH') || (direction === 'SHORT' && bias === 'BULLISH');

  if (aligned) {
    return {
      points: 1,
      bias,
      rsi: btcContext.btcRSI ?? null,
      confirmation: true,
      note: 'BTC confirmed.',
      warning: null,
    };
  }

  if (opposed) {
    return {
      points: -2,
      bias,
      rsi: btcContext.btcRSI ?? null,
      confirmation: false,
      note: `BTC ${bias.toLowerCase()} against ${direction} setup.`,
      warning: `BTC ${bias.toLowerCase()} against ${direction} setup.`,
    };
  }

  return {
    points: 0,
    bias,
    rsi: btcContext.btcRSI ?? null,
    confirmation: false,
    note: btcContext.btcNote ?? 'BTC context neutral.',
    warning: null,
  };
}

function buildFundingOiAdjustment(direction, indicators) {
  const { fundingRate, openInterestChange, shortPriceChange, derivativesWarning } = indicators;
  const warnings = derivativesWarning ? [derivativesWarning] : [];
  let points = 0;
  let note = 'Funding/OI neutral or unavailable.';

  if (Number.isFinite(fundingRate)) {
    if (direction === 'LONG' && fundingRate > FUNDING_CROWDED) {
      points = -1;
      note = `Funding crowded for LONG: ${(fundingRate * 100).toFixed(4)}%.`;
      warnings.push('Funding is highly positive. Avoid aggressive LONG.');
    }

    if (direction === 'SHORT' && fundingRate < -FUNDING_CROWDED) {
      points = -1;
      note = `Funding crowded for SHORT: ${(fundingRate * 100).toFixed(4)}%.`;
      warnings.push('Funding is highly negative. Avoid aggressive SHORT.');
    }
  }

  if (points === 0 && Number.isFinite(openInterestChange) && Number.isFinite(shortPriceChange)) {
    if (direction === 'LONG' && shortPriceChange > 0 && openInterestChange > 0) {
      points = 1;
      note = `Price up with OI up (${openInterestChange.toFixed(2)}%).`;
    } else if (direction === 'SHORT' && shortPriceChange < 0 && openInterestChange > 0) {
      points = 1;
      note = `Price down with OI up (${openInterestChange.toFixed(2)}%).`;
    } else if (direction === 'LONG' && shortPriceChange > 0 && openInterestChange < 0) {
      note = 'Price up while OI falls. Move may be short covering.';
      warnings.push(note);
    } else if (direction === 'SHORT' && shortPriceChange < 0 && openInterestChange < 0) {
      note = 'Price down while OI falls. Move may be liquidation-driven.';
      warnings.push(note);
    }
  }

  return { points, note, warnings };
}

function hardBlocks(direction, indicators, levels, regime, btcAdjustment, fundingOiAdjustment, checks, config) {
  const reasons = [];
  const waitReasons = [];
  const {
    valid,
    reason,
    stale,
    feedStale,
    dataError,
    rsi,
    atr,
    lastCandleRange,
    marketStructure,
    currentVolume,
    averageVolume,
    fundingRate,
  } = indicators;

  if (valid === false || reason === 'insufficient_data') {
    reasons.push('Insufficient candles for EMA200/RSI/MACD/ATR.');
  }

  if (stale || feedStale || dataError) {
    reasons.push(dataError ? `Data feed error: ${dataError}` : 'Stale data. Signal execution disabled.');
  }

  if (regime === 'VOLATILE_SPIKE') {
    reasons.push('Last candle is too long versus ATR. Avoid FOMO entry.');
  }

  if (direction === 'LONG' && rsi > 72) {
    reasons.push('RSI > 72 for LONG.');
  }

  if (direction === 'SHORT' && rsi < 28) {
    reasons.push('RSI < 28 for SHORT.');
  }

  // Proximity gate handled by levelQuality().
  // Hard block removed to avoid double-blocking.
  // See: resistanceDistance/supportDistance in levelQuality().

  if (!Number.isFinite(levels.rrTp1)) {
    reasons.push('RR to TP1 is unavailable.');
  } else if (levels.rrTp1 < 1.2) {
    reasons.push(`R:R is only ${levels.rrTp1.toFixed(2)}:1, below hard minimum 1.2.`);
  }

  if (!Number.isFinite(levels.slAtrMultiple)) {
    reasons.push('Stop loss cannot be derived from support/resistance/ATR.');
  } else if (levels.slAtrMultiple > 2.5) {
    waitReasons.push('SL distance is greater than ATR x 2.5.');
  } else if (levels.slAtrMultiple < 0.35) {
    waitReasons.push('SL is too close and likely to be hit by noise.');
  }

  if (Number.isFinite(lastCandleRange) && Number.isFinite(atr) && lastCandleRange > atr * 1.8) {
    reasons.push('Candle range > ATR x 1.8.');
  }

  if (Math.abs(btcAdjustment.points) === 2) {
    waitReasons.push('BTC confirmation is strongly against this altcoin setup.');
  }

  if (
    (direction === 'LONG' && Number.isFinite(fundingRate) && fundingRate > FUNDING_EXTREME) ||
    (direction === 'SHORT' && Number.isFinite(fundingRate) && fundingRate < -FUNDING_EXTREME)
  ) {
    waitReasons.push('Funding is extremely crowded against this setup.');
  }

  if (
    marketStructure?.bos?.detected &&
    averageVolume > 0 &&
    currentVolume < averageVolume &&
    ((direction === 'LONG' && marketStructure.bos.direction === 'bullish') ||
      (direction === 'SHORT' && marketStructure.bos.direction === 'bearish'))
  ) {
    waitReasons.push('Breakout volume is weak.');
  }

  if (regime === 'CHOPPY_MARKET' && !marketStructure?.bos?.detected) {
    reasons.push('CHOPPY_MARKET without valid breakout.');
  }

  if (marketStructure?.failedRetest?.detected) {
    reasons.push('Breakout/retest failed.');
  }

  return { reasons: unique(reasons), waitReasons: unique(waitReasons) };
}

function classifyCandidateEntryContext({ direction, score, indicators, checks, levels }) {
  const { rsi, ema20, price, currentVolume, averageVolume, marketStructure, lastCandleRange, atr } = indicators;
  const priceVsEma20 = percentMove(ema20, price);
  const volumeBreakout = averageVolume > 0 && currentVolume >= averageVolume * 1.5;
  const extendedCandle = Number.isFinite(lastCandleRange) && Number.isFinite(atr) && lastCandleRange > atr * 1.35;

  // WAIT_RETEST is intentionally non-executable. It means BOS exists on the current
  // candle window, but retest confirmation requires future candles to revisit the
  // breakout level and close back in the expected direction.
  if (marketStructure?.bos?.detected && !marketStructure?.retest?.complete) {
    return 'WAIT_RETEST';
  }

  if (
    score >= 8 &&
    marketStructure?.bos?.detected &&
    volumeBreakout &&
    !extendedCandle &&
    ((direction === 'LONG' && marketStructure.bos.direction === 'bullish') ||
      (direction === 'SHORT' && marketStructure.bos.direction === 'bearish'))
  ) {
    return 'MOMENTUM_BREAKOUT';
  }

  if (
    score >= 6 &&
    Number.isFinite(priceVsEma20) &&
    ((direction === 'LONG' && rsi >= 65 && priceVsEma20 > 2) ||
      (direction === 'SHORT' && rsi <= 35 && priceVsEma20 < -2))
  ) {
    return 'LATE_ENTRY';
  }

  if (score >= 8 && checks.trendPass && checks.levelPass && Number.isFinite(levels.rrTp1) && levels.rrTp1 >= 1.2) {
    return 'SAFE_ENTRY';
  }

  return score >= 6 ? 'WAIT_CONFIRMATION' : 'CHOPPY_MARKET';
}

function buildCandidate(direction, indicators, options, marketRegime, config) {
  const { symbol, btcContext } = options;
  const { price, ema20, ema50, ema200, rsi, macd, marketStructure } = indicators;
  const trendPass = alignTrend({ direction, price, ema20, ema50, ema200 });
  const rsiPass = rsiValid(direction, rsi);
  const macdPass = macdConfirmed(direction, macd);
  const structurePass = directionStructure(direction, marketStructure);
  const level = levelQuality(direction, indicators);
  const volume = volumeQuality(indicators);
  const levels = buildRiskLevels(direction, indicators, config);
  const rrTp1Min = Number.isFinite(Number(config.rrTp1Min)) ? Number(config.rrTp1Min) : 1.5;
  const rrTp2Min = Number.isFinite(Number(config.rrTp2Min)) ? Number(config.rrTp2Min) : 2.5;
  const rrPass =
    Number.isFinite(levels.rrTp1) &&
    levels.rrTp1 >= rrTp1Min &&
    Number.isFinite(levels.rrTp2) &&
    levels.rrTp2 >= rrTp2Min;

  const items = [
    scoreItem('ema', 'EMA trend alignment', trendPass ? 2 : 0, 2, trendPass, trendPass ? 'EMA trend aligned.' : 'EMA trend not aligned.'),
    scoreItem('rsi', 'RSI momentum valid', rsiPass ? 1 : 0, 1, rsiPass, Number.isFinite(rsi) ? `RSI ${rsi.toFixed(1)}.` : 'RSI unavailable.'),
    scoreItem('macd', 'MACD confirmation', macdPass ? 1 : 0, 1, macdPass, macdPass ? 'MACD confirmed.' : 'MACD not confirmed.'),
    scoreItem(
      'structure',
      'Market structure valid',
      structurePass ? 1 : 0,
      1,
      structurePass,
      marketStructure?.structureSummary ?? 'Market structure unavailable.',
    ),
    scoreItem('keyLevel', 'Near key level / good entry location', level.passed ? 1 : 0, 1, level.passed, level.reason),
    scoreItem('volume', 'Volume confirmation', volume.passed ? 1 : 0, 1, volume.passed, volume.reason),
    scoreItem(
      'riskReward',
      'Risk/reward valid',
      rrPass ? 1 : 0,
      1,
      rrPass,
      `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${rrTp1Min}), TP2 ${Number.isFinite(levels.rrTp2) ? levels.rrTp2.toFixed(2) : '--'} (target ${rrTp2Min}).`,
    ),
  ];
  const technicalTotal = items.reduce((sum, item) => sum + item.points, 0);
  const btcAdjustment = buildBtcAdjustment({ symbol, direction, btcContext });
  const fundingOiAdjustment = buildFundingOiAdjustment(direction, indicators);
  const adjustments = [
    adjustmentItem('btc', 'BTC Confirmation', btcAdjustment.points, btcAdjustment.note),
    adjustmentItem('fundingOi', 'Funding/OI', fundingOiAdjustment.points, fundingOiAdjustment.note),
  ];
  const adjustmentTotal = btcAdjustment.points + fundingOiAdjustment.points;
  const finalScore = clampScore(technicalTotal + adjustmentTotal);
  const checks = {
    trendPass,
    rsiPass,
    macdPass,
    structurePass,
    levelPass: level.passed,
    volumePass: volume.passed,
    rrPass,
    resistanceDistance: level.resistanceDistance,
    supportDistance: level.supportDistance,
    filtersPass: trendPass && rsiPass && macdPass && level.passed && rrPass,
  };
  const blocks = hardBlocks(direction, indicators, levels, marketRegime, btcAdjustment, fundingOiAdjustment, checks, config);
  const entryContext = classifyCandidateEntryContext({ direction, score: finalScore, indicators, checks, levels });
  let status = 'NO_TRADE';

  if (!blocks.reasons.length) {
    if (blocks.waitReasons.length) {
      status = finalScore >= 6 ? (entryContext === 'WAIT_RETEST' ? 'WAIT_RETEST' : 'WAIT') : 'NO_TRADE';
    } else if (finalScore >= config.entryScore && checks.filtersPass) {
      status = direction;
    } else if (finalScore >= 6) {
      status = entryContext === 'WAIT_RETEST' ? 'WAIT_RETEST' : 'WAIT';
    }
  }

  return {
    direction,
    status,
    total: finalScore,
    technicalTotal,
    adjustmentTotal,
    rawTotal: technicalTotal + adjustmentTotal,
    max: SCORE_MAX,
    items,
    adjustments,
    breakdown: {
      ema: items[0].points,
      rsiMomentum: items[1].points,
      macd: items[2].points,
      marketStructure: items[3].points,
      keyLevel: items[4].points,
      volume: items[5].points,
      rrRatio: items[6].points,
      trend: items[0].points,
    },
    hardBlock: blocks.reasons[0] ?? null,
    blockedReasons: blocks.reasons,
    rejectionReasons: unique([...blocks.reasons, ...blocks.waitReasons, ...items.filter((item) => !item.passed).map((item) => item.reason)]),
    waitReasons: blocks.waitReasons,
    warnings: unique([...fundingOiAdjustment.warnings, btcAdjustment.warning]),
    entryContext,
    entryAdvice: ENTRY_ADVICE[entryContext],
    btcAdjustment,
    fundingOiAdjustment,
    checks,
    levels,
  };
}

function pickCandidate(longCandidate, shortCandidate) {
  const statusRank = { LONG: 5, SHORT: 5, WAIT_RETEST: 4, WAIT: 3, NO_TRADE: 1 };
  const longRank = statusRank[longCandidate.status] ?? 0;
  const shortRank = statusRank[shortCandidate.status] ?? 0;

  if (longRank !== shortRank) {
    return longRank > shortRank ? longCandidate : shortCandidate;
  }

  if (longCandidate.total !== shortCandidate.total) {
    return longCandidate.total > shortCandidate.total ? longCandidate : shortCandidate;
  }

  return longCandidate.technicalTotal >= shortCandidate.technicalTotal ? longCandidate : shortCandidate;
}

function buildSignalWarnings(indicators, selected) {
  const warnings = [];

  if (indicators?.valid === false && indicators?.reason === 'insufficient_data') {
    warnings.push('Insufficient candles for real EMA200. Signal execution disabled.');
  }

  if (indicators?.ema200Valid === false) {
    warnings.push('EMA200 invalid. Waiting for at least 200 candles.');
  }

  if (indicators?.stale || indicators?.feedStale) {
    warnings.push('Latest market data is stale.');
  }

  if (indicators?.derivativesWarning) {
    warnings.push(indicators.derivativesWarning);
  }

  return unique([...warnings, ...(selected?.warnings ?? [])]);
}

function buildRrWarning(levels) {
  if (!Number.isFinite(levels?.rrTp1) || levels.rrTp1 >= 1.5) {
    return null;
  }

  return `R:R is only ${levels.rrTp1.toFixed(2)}:1, minimum required is 1.5. Consider skipping.`;
}

function buildLevelWarning(direction, indicators, checks) {
  if (
    direction === 'LONG' &&
    Number.isFinite(checks?.resistanceDistance) &&
    checks.resistanceDistance <= 1.5 &&
    Number.isFinite(indicators?.resistance)
  ) {
    return `Price within 1.5% of resistance at ${indicators.resistance}. LONG setup quality reduced.`;
  }

  if (
    direction === 'SHORT' &&
    Number.isFinite(checks?.supportDistance) &&
    checks.supportDistance <= 1.5 &&
    Number.isFinite(indicators?.support)
  ) {
    return `Price within 1.5% of support at ${indicators.support}. SHORT setup quality reduced.`;
  }

  return null;
}

function actionForStatus(status, entryContext, direction) {
  if (status === 'LONG' || status === 'SHORT') {
    return `Use only planned ${direction} levels. Move SL to breakeven after TP1.`;
  }

  if (status === 'WAIT_RETEST') {
    return 'Wait for retest and candle close confirmation before considering entry.';
  }

  if (status === 'WAIT') {
    return 'Wait for stronger trend, volume, and candle close confirmation.';
  }

  if (entryContext === 'CHOPPY_MARKET') {
    return 'Wait for 15m breakout + retest. No entry recommended.';
  }

  return 'No entry recommended.';
}

function buildWatchLevels(indicators, selected) {
  const { direction, levels } = selected;
  const breakoutLevel =
    direction === 'LONG'
      ? indicators.previousResistance ?? indicators.resistance
      : indicators.previousSupport ?? indicators.support;
  const retestArea = selected.levels.entry2;
  const invalidation = direction === 'LONG' ? indicators.support ?? levels.sl : indicators.resistance ?? levels.sl;

  return {
    direction,
    breakoutLevel: round(breakoutLevel),
    retestArea: round(retestArea),
    invalidation: round(invalidation),
  };
}

function basisFromCandidate(candidate) {
  return [
    ...candidate.items.map((item) => ({
      key: item.key,
      passed: item.passed,
      label: `${item.label} (${item.points}/${item.max})`,
      reason: item.reason,
    })),
    ...candidate.adjustments.map((item) => ({
      key: item.key,
      passed: item.points > 0,
      label: `${item.label}: ${item.points > 0 ? '+' : ''}${item.points}`,
      reason: item.reason,
    })),
  ];
}

function buildNoTradeSetupFromDataProblem(indicators, options = {}) {
  const blocked = indicators?.dataErrorType === 'NETWORK_BLOCKED' || indicators?.candleErrorType === 'NETWORK_BLOCKED';
  const priceOnly = indicators?.dataQuality === 'PRICE_ONLY';
  const reason = blocked
    ? 'Market data blocked by current network'
    : priceOnly
      ? 'Insufficient futures candle data. Price-only fallback cannot generate futures signals.'
      : indicators?.dataError || 'Insufficient futures candle data.';
  const blockedReason = [reason, 'Signal generation disabled for safety.'];

  return {
    signal: 'NO_TRADE',
    trend: 'NEUTRAL',
    marketRegime: blocked ? 'MARKET_DATA_BLOCKED' : priceOnly ? 'DATA_UNAVAILABLE' : 'INSUFFICIENT_DATA',
    longScore: 0,
    shortScore: 0,
    score: 0,
    confidenceScore: 0,
    scoreMax: SCORE_MAX,
    confidence: confidenceMeta(0),
    signalValidity: 'BLOCKED',
    signalMode: normalizeSignalMode(options.signalMode),
    scoreBreakdown: {
      total: 0,
      max: SCORE_MAX,
      technicalTotal: 0,
      adjustmentTotal: 0,
      breakdown: {},
      items: [],
      adjustments: [
        adjustmentItem('btc', 'BTC Confirmation', 0, 'Disabled without fresh futures candles.'),
        adjustmentItem('fundingOi', 'Funding/OI', 0, 'Disabled without fresh futures candles.'),
      ],
      rawTotal: 0,
      btcAdjustment: 0,
      fundingOiAdjustment: 0,
      status: 'NO_TRADE',
      hardBlock: reason,
      warnings: blockedReason,
    },
    warnings: blockedReason,
    rejectionReasons: blockedReason,
    hardBlock: reason,
    blockedReason,
    stale: true,
    dataValid: false,
    invalidReason: indicators?.dataErrorType ?? indicators?.candleErrorType ?? 'insufficient_data',
    entryContext: 'NO_TRADE',
    entryAdvice: 'No entry recommended.',
    action: blocked
      ? 'Try another network or deploy proxy to cloud. Do not trade from stale data.'
      : 'Wait until fresh futures candle data is restored.',
    rr: null,
    rrRatio: null,
    rrTp1: null,
    rrTp2: null,
    rrWarning: null,
    levelWarning: null,
    atr: round(indicators?.atr),
    slPrice: null,
    tp1Price: null,
    tp2Price: null,
    basis: [],
    tradeLevelsVisible: false,
    watchLevels: null,
    entry1: null,
    entry2: null,
    tp1: null,
    tp2: null,
    sl: null,
  };
}

export function classifyEntryContext(data) {
  return classifyCandidateEntryContext({
    direction: data.direction,
    score: data.score,
    indicators: data,
    checks: {
      trendPass: data.trendAligned,
      levelPass: data.notNearResistance || data.notNearSupport,
    },
    levels: { rrTp1: data.rrRatio ?? data.rr },
  });
}

export function buildSignalSetup(indicators, options = {}) {
  if (!indicators?.price || !indicators?.macd) {
    return indicators?.price || indicators?.dataError || indicators?.dataQuality === 'PRICE_ONLY'
      ? buildNoTradeSetupFromDataProblem(indicators, options)
      : null;
  }

  const { price, ema20, ema50, ema200, rsi, macd, atr } = indicators;
  const { symbol } = options;
  const signalMode = normalizeSignalMode(options.signalMode);
  const modeConfig = getSignalModeConfig(signalMode);
  const experimentSignalConfig = options.experimentConfig?.signalLogic ?? {};
  const candidateConfig = {
    ...modeConfig,
    ...experimentSignalConfig,
  };
  const marketRegime = detectMarketRegime(indicators);
  const trendBullish = alignTrend({ direction: 'LONG', price, ema20, ema50, ema200 });
  const trendBearish = alignTrend({ direction: 'SHORT', price, ema20, ema50, ema200 });
  const trend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';

  const candidateBuilder =
    experimentSignalConfig.strategyType === 'breakoutVolumeExpansion'
      ? buildBreakoutVolumeExpansionCandidate
      : experimentSignalConfig.strategyType === 'sessionBreakout'
      ? buildSessionBreakoutCandidate
      : experimentSignalConfig.strategyType === 'fairValueGap'
      ? buildFairValueGapCandidate
      : experimentSignalConfig.strategyType === 'orderBlock'
      ? buildOrderBlockCandidate
      : experimentSignalConfig.strategyType === 'failedBreakoutReversion'
      ? buildFailedBreakoutCandidate
      : experimentSignalConfig.strategyType === 'liquiditySweepReclaim'
      ? buildLiquiditySweepReclaimCandidate
      : experimentSignalConfig.strategyType === 'trendPullbackContinuation'
      ? buildTrendPullbackCandidate
      : buildCandidate;
  const longCandidate = candidateBuilder('LONG', indicators, options, marketRegime, candidateConfig);
  const shortCandidate = candidateBuilder('SHORT', indicators, options, marketRegime, candidateConfig);
  const selected = pickCandidate(longCandidate, shortCandidate);
  const finalSignal = selected.status;
  const finalScore = selected.total;
  const blockedReason = unique(selected.blockedReasons ?? []);
  const signalValidity =
    ['sessionBreakout', 'fairValueGap', 'orderBlock'].includes(experimentSignalConfig.strategyType) && ['LONG', 'SHORT'].includes(finalSignal) && finalScore >= candidateConfig.entryScore
      ? 'VALID'
      : classifySignalValidity(finalScore, blockedReason);
  const meta = confidenceMeta(finalScore);
  const rrWarning = buildRrWarning(selected.levels);
  const levelWarning = buildLevelWarning(selected.direction, indicators, selected.checks);
  const warnings = unique([...buildSignalWarnings(indicators, selected), rrWarning, levelWarning, modeConfig.warning]);
  const executable = ['LONG', 'SHORT'].includes(finalSignal);
  const waitLike = ['WAIT', 'WAIT_RETEST'].includes(finalSignal);
  const rejectionReasons = unique(
    finalSignal === 'NO_TRADE'
      ? selected.rejectionReasons
      : [...selected.waitReasons, ...selected.items.filter((item) => !item.passed).map((item) => item.reason)],
  );

  return {
    signal: finalSignal,
    trend,
    marketRegime,
    longScore: longCandidate.total,
    shortScore: shortCandidate.total,
    score: finalScore,
    confidenceScore: finalScore,
    scoreMax: SCORE_MAX,
    confidence: meta,
    signalValidity,
    signalMode,
    signalModeLabel: modeConfig.label,
    signalModeWarning: modeConfig.warning,
    scoreBreakdown: {
      total: finalScore,
      max: SCORE_MAX,
      technicalTotal: selected.technicalTotal,
      adjustmentTotal: selected.adjustmentTotal,
      breakdown: selected.breakdown,
      items: selected.items,
      adjustments: selected.adjustments,
      rawTotal: selected.rawTotal,
      btcAdjustment: selected.btcAdjustment.points,
      fundingOiAdjustment: selected.fundingOiAdjustment.points,
      status: finalSignal,
      hardBlock: selected.hardBlock,
      warnings,
    },
    candidates: {
      long: longCandidate,
      short: shortCandidate,
    },
    signalDiagnostics:
      ['breakoutVolumeExpansion', 'liquiditySweepReclaim', 'sessionBreakout', 'fairValueGap', 'orderBlock', 'failedBreakoutReversion'].includes(experimentSignalConfig.strategyType)
        ? {
            strategyType: experimentSignalConfig.strategyType,
            selected: selected.diagnostics ?? null,
          }
        : null,
    hardBlock: selected.hardBlock,
    blockedReason,
    rrWarning,
    levelWarning,
    warnings,
    rejectionReasons,
    stale: Boolean(indicators.stale || indicators.feedStale),
    lastUpdate: indicators.lastUpdate ?? null,
    dataValid: indicators.valid !== false,
    invalidReason: indicators.reason ?? null,
    btcBias: selected.btcAdjustment.bias,
    btcRSI: round(selected.btcAdjustment.rsi),
    btcConfirmation: selected.btcAdjustment.confirmation,
    btcNote: selected.btcAdjustment.note,
    btcAdjustment: selected.btcAdjustment.points,
    fundingRate: round(indicators.fundingRate),
    openInterest: round(indicators.openInterest),
    openInterestChange: round(indicators.openInterestChange),
    fundingOiAdjustment: selected.fundingOiAdjustment.points,
    fundingOiNote: selected.fundingOiAdjustment.note,
    marketStructure: indicators.marketStructure ?? null,
    entryContext: selected.entryContext,
    entryAdvice: selected.entryAdvice,
    action: actionForStatus(finalSignal, selected.entryContext, selected.direction),
    rr: round(selected.levels.rrTp1),
    rrRatio: round(selected.levels.rrTp1),
    rrTp1: round(selected.levels.rrTp1),
    rrTp2: round(selected.levels.rrTp2),
    atr: round(atr),
    slPrice: round(selected.levels.sl),
    tp1Price: round(selected.levels.tp1),
    tp2Price: round(selected.levels.tp2),
    layers: {
      trendBullish,
      trendBearish,
      momentumLong: longCandidate.checks.rsiPass && longCandidate.checks.macdPass,
      momentumShort: shortCandidate.checks.rsiPass && shortCandidate.checks.macdPass,
      levelLong: longCandidate.checks.levelPass,
      levelShort: shortCandidate.checks.levelPass,
    },
    basis: basisFromCandidate(selected),
    tradeLevelsVisible: executable,
    watchLevels: waitLike ? buildWatchLevels(indicators, selected) : null,
    entry1: executable ? round(selected.levels.entry1) : null,
    entry2: executable ? round(selected.levels.entry2) : null,
    tp1: executable ? round(selected.levels.tp1) : null,
    tp2: executable ? round(selected.levels.tp2) : null,
    sl: executable ? round(selected.levels.sl) : null,
    plannedLevels: {
      entry1: round(selected.levels.entry1),
      entry2: round(selected.levels.entry2),
      tp1: round(selected.levels.tp1),
      tp2: round(selected.levels.tp2),
      sl: round(selected.levels.sl),
    },
    selectedDirection: selected.direction,
  };
}
