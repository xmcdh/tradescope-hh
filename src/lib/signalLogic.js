const SCORE_MAX = 10;
const ENTRY_ADVICE = {
  SAFE_ENTRY: 'Clean pullback setup. Enter at current zone with defined SL.',
  MOMENTUM_BREAKOUT: 'Breakout confirmed by volume. Entry valid but set tighter SL.',
  LATE_ENTRY: 'Setup valid but overextended. Wait for RSI to cool or price to pull back to EMA20.',
  WAIT_RETEST: 'Breakout occurred. Wait for retest of broken level before entering.',
  CHOPPY_MARKET: 'Market is ranging. No clear edge. Skip this pair today.',
};

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

function isWithinPercent(value, reference, percent) {
  return pctDistance(value, reference) <= percent;
}

function rewardRiskRatio({ direction, entry, support, resistance }) {
  if (!Number.isFinite(entry)) {
    return null;
  }

  const tp1 = direction === 'SHORT' ? entry * 0.975 : entry * 1.025;
  const fallbackStop = direction === 'SHORT' ? entry * 1.015 : entry * 0.985;
  const stopFromLevel = direction === 'SHORT' ? resistance * 1.015 : support * 0.985;
  const sl = Number.isFinite(stopFromLevel) && stopFromLevel > 0 ? stopFromLevel : fallbackStop;
  const reward = Math.abs(tp1 - entry);
  const risk = Math.abs(entry - sl);

  if (!Number.isFinite(reward) || !Number.isFinite(risk) || risk === 0) {
    return null;
  }

  return reward / risk;
}

function priceLevels({ direction, price, support, resistance }) {
  const entry1 = price;
  const fallbackEntry2 = direction === 'SHORT' ? price * 1.01 : price * 0.99;
  const entry2 = direction === 'SHORT' ? resistance : support;

  return {
    entry1,
    entry2: Number.isFinite(entry2) && entry2 > 0 ? entry2 : fallbackEntry2,
    tp1: direction === 'SHORT' ? entry1 * 0.975 : entry1 * 1.025,
    tp2: direction === 'SHORT' ? entry1 * 0.94 : entry1 * 1.06,
    sl:
      direction === 'SHORT'
        ? Number.isFinite(resistance) && resistance > 0
          ? resistance * 1.015
          : entry1 * 1.015
        : Number.isFinite(support) && support > 0
          ? support * 0.985
          : entry1 * 0.985,
  };
}

function candidateStatus(score, hardBlock, filtersPass, direction) {
  if (hardBlock) {
    return 'NO_TRADE';
  }

  if (score >= 8 && filtersPass) {
    return direction;
  }

  if (score >= 6) {
    return 'WAIT';
  }

  return 'NO_TRADE';
}

function buildHardBlock({ direction, rsi, price, support, resistance, rr }) {
  const resistanceDistance = pctDistance(price, resistance);
  const supportDistance = pctDistance(price, support);

  if (direction === 'LONG' && rsi >= 75) {
    return 'RSI >= 75 for LONG';
  }

  if (direction === 'SHORT' && rsi <= 25) {
    return 'RSI <= 25 for SHORT';
  }

  if (direction === 'LONG' && resistanceDistance <= 1) {
    return 'Price within 1% of major resistance';
  }

  if (direction === 'SHORT' && supportDistance <= 1) {
    return 'Price within 1% of major support';
  }

  if (Number.isFinite(rr) && rr < 1.2) {
    return 'R:R < 1.2';
  }

  return null;
}

function buildCandidate(direction, indicators, trendBullish, trendBearish) {
  const { price, ema20, ema50, ema200, rsi, macd, support, resistance, currentVolume, averageVolume, lastCandle } =
    indicators;

  const isLong = direction === 'LONG';
  const trendPass = isLong ? trendBullish : trendBearish;
  const rsiMomentumPass = isLong ? rsi >= 45 && rsi <= 65 : rsi >= 35 && rsi <= 55;
  const macdPass = isLong ? macd.macd > macd.signal : macd.macd < macd.signal;
  const volumePass = averageVolume > 0 && currentVolume > averageVolume * 1.3;
  const resistanceDistance = pctDistance(price, resistance);
  const supportDistance = pctDistance(price, support);
  const levelLongPass = isLong && resistanceDistance > 1.5;
  const levelShortPass = !isLong && supportDistance > 1.5;
  const rsiFilterPass = isLong ? rsi < 72 : rsi > 28;
  const rr = rewardRiskRatio({ direction, entry: price, support, resistance });
  const rrPass = Number.isFinite(rr) && rr >= 1.5;
  const candleStructurePass = isLong ? lastCandle?.close > lastCandle?.open : lastCandle?.close < lastCandle?.open;

  const breakdown = {
    trend: trendPass ? 2 : 0,
    rsiMomentum: rsiMomentumPass ? 1 : 0,
    macd: macdPass ? 1 : 0,
    volume: volumePass ? 1 : 0,
    levelLong: levelLongPass ? 1 : 0,
    levelShort: levelShortPass ? 1 : 0,
    rsiFilter: rsiFilterPass ? 1 : 0,
    rrRatio: rrPass ? 1 : 0,
    candleStructure: candleStructurePass ? 1 : 0,
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const hardBlock = buildHardBlock({ direction, rsi, price, support, resistance, rr });
  const filtersPass = rsiFilterPass && rrPass && (isLong ? levelLongPass : levelShortPass);
  const status = candidateStatus(total, hardBlock, filtersPass, direction);
  const levels = priceLevels({ direction, price, support, resistance });

  return {
    direction,
    total,
    max: SCORE_MAX,
    breakdown,
    status,
    hardBlock,
    rr,
    checks: {
      trendPass,
      rsiMomentumPass,
      macdPass,
      volumePass,
      levelLongPass,
      levelShortPass,
      rsiFilterPass,
      rrPass,
      candleStructurePass,
      filtersPass,
      resistanceDistance,
      supportDistance,
      ema20,
      ema50,
      ema200,
    },
    levels,
  };
}

function buildSignalWarnings(indicators) {
  const warnings = [];

  if (indicators?.valid === false && indicators?.reason === 'insufficient_data') {
    warnings.push('Insufficient candles for real EMA200. Trend score forced to 0.');
  }

  if (indicators?.ema200Valid === false) {
    warnings.push('EMA200 invalid. Waiting for at least 200 candles.');
  }

  if (indicators?.stale) {
    warnings.push('Latest candle is stale for the selected timeframe.');
  }

  return [...new Set(warnings)];
}

function pickCandidate(longCandidate, shortCandidate) {
  const statusRank = { LONG: 3, SHORT: 3, WAIT: 2, NO_TRADE: 1 };
  const longRank = statusRank[longCandidate.status] ?? 0;
  const shortRank = statusRank[shortCandidate.status] ?? 0;

  if (longRank !== shortRank) {
    return longRank > shortRank ? longCandidate : shortCandidate;
  }

  if (longCandidate.total !== shortCandidate.total) {
    return longCandidate.total > shortCandidate.total ? longCandidate : shortCandidate;
  }

  return longCandidate;
}

function brokeAboveLevel(candle, level) {
  return Number.isFinite(level) && candle?.open <= level && candle?.close > level;
}

function brokeBelowLevel(candle, level) {
  return Number.isFinite(level) && candle?.open >= level && candle?.close < level;
}

function hasBreakoutWithin(candles, direction, level, lookback) {
  return candles.slice(-lookback).some((candle) =>
    direction === 'LONG' ? brokeAboveLevel(candle, level) : brokeBelowLevel(candle, level),
  );
}

function hasRetestedLevelAfterBreak(candles, direction, level, lookback) {
  const window = candles.slice(-lookback);
  const breakIndex = window.findIndex((candle) =>
    direction === 'LONG' ? brokeAboveLevel(candle, level) : brokeBelowLevel(candle, level),
  );

  if (breakIndex === -1) {
    return false;
  }

  return window.slice(breakIndex + 1).some((candle) =>
    direction === 'LONG' ? candle.low <= level && candle.close >= level : candle.high >= level && candle.close <= level,
  );
}

export function classifyEntryContext(data) {
  const {
    score,
    direction,
    price,
    ema20,
    rsi,
    currentVolume,
    averageVolume,
    resistance,
    support,
    previousResistance,
    previousSupport,
    recentCandles = [],
    trendAligned,
    notNearResistance,
    notNearSupport,
  } = data;

  const candles = recentCandles.filter(Boolean);
  const lastFive = candles.slice(-5);
  const lastTwo = candles.slice(-2);
  const recentHigh = Math.max(...candles.map((candle) => candle.high).filter(Number.isFinite));
  const recentLow = Math.min(...candles.map((candle) => candle.low).filter(Number.isFinite));
  const priceVsEma20 = percentMove(ema20, price);
  const volumeAtLeastAverage = averageVolume > 0 && currentVolume >= averageVolume;
  const volumeBreakout = averageVolume > 0 && currentVolume >= averageVolume * 1.5;
  const level = direction === 'SHORT' ? previousSupport ?? support : previousResistance ?? resistance;
  const brokeWithinTwo = hasBreakoutWithin(lastTwo, direction, level, 2);
  const brokeWithinFive = hasBreakoutWithin(lastFive, direction, level, 5);
  const retested = hasRetestedLevelAfterBreak(lastFive, direction, level, 5);
  const choppy =
    lastFive.length === 5 &&
    lastFive.every((candle) => isWithinPercent(candle.close, ema20, 0.8)) &&
    rsi >= 45 &&
    rsi <= 55 &&
    averageVolume > 0 &&
    currentVolume < averageVolume;

  if (choppy) {
    return 'CHOPPY_MARKET';
  }

  if (score >= 6 && brokeWithinFive && !retested) {
    return 'WAIT_RETEST';
  }

  if (
    score >= 8 &&
    direction === 'LONG' &&
    brokeWithinTwo &&
    volumeBreakout &&
    rsi >= 55 &&
    rsi <= 70
  ) {
    return 'MOMENTUM_BREAKOUT';
  }

  if (
    score >= 8 &&
    direction === 'SHORT' &&
    brokeWithinTwo &&
    volumeBreakout &&
    rsi >= 30 &&
    rsi <= 45
  ) {
    return 'MOMENTUM_BREAKOUT';
  }

  if (
    score >= 6 &&
    score <= 8 &&
    trendAligned &&
    Number.isFinite(priceVsEma20) &&
    ((direction === 'LONG' && rsi >= 65 && priceVsEma20 > 2) ||
      (direction === 'SHORT' && rsi <= 35 && priceVsEma20 < -2))
  ) {
    return 'LATE_ENTRY';
  }

  const pulledBackFromHigh = Number.isFinite(recentHigh) && percentMove(recentHigh, price) <= -0.5;
  const bouncedFromLow = Number.isFinite(recentLow) && percentMove(recentLow, price) >= 0.5;

  if (
    score >= 8 &&
    trendAligned &&
    rsi >= 40 &&
    rsi <= 65 &&
    volumeAtLeastAverage &&
    ((direction === 'LONG' && pulledBackFromHigh && notNearResistance) ||
      (direction === 'SHORT' && bouncedFromLow && notNearSupport))
  ) {
    return 'SAFE_ENTRY';
  }

  return score >= 6 ? 'WAIT_RETEST' : 'CHOPPY_MARKET';
}

function basisFromCandidate(candidate, rsi, macd) {
  const { checks, breakdown, rr } = candidate;

  return [
    {
      key: 'trend',
      passed: breakdown.trend === 2,
      label: `${candidate.direction} EMA alignment (${breakdown.trend}/2)`,
    },
    {
      key: 'momentum',
      passed: breakdown.rsiMomentum + breakdown.macd === 2,
      label: `RSI ${rsi?.toFixed(1)} + MACD ${macd.macd > macd.signal ? 'Bullish' : 'Bearish'} (${breakdown.rsiMomentum + breakdown.macd}/2)`,
    },
    {
      key: 'level',
      passed: candidate.direction === 'LONG' ? checks.levelLongPass : checks.levelShortPass,
      label:
        candidate.direction === 'LONG'
          ? `Resistance distance ${checks.resistanceDistance.toFixed(2)}%`
          : `Support distance ${checks.supportDistance.toFixed(2)}%`,
    },
    {
      key: 'risk',
      passed: breakdown.rrRatio === 1,
      label: `R:R ${Number.isFinite(rr) ? rr.toFixed(2) : '--'} (${breakdown.rrRatio}/1)`,
    },
  ];
}

export function buildSignalSetup(indicators) {
  if (!indicators?.price || !indicators?.macd) {
    return null;
  }

  const { price, ema20, ema50, ema200, rsi, macd } = indicators;

  const ema200Valid = indicators.ema200Valid !== false && Number.isFinite(ema200);
  const trendBullish = ema200Valid && price > ema20 && ema20 > ema50 && ema50 > ema200;
  const trendBearish = ema200Valid && price < ema20 && ema20 < ema50 && ema50 < ema200;
  const trend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';

  const longCandidate = buildCandidate('LONG', indicators, trendBullish, trendBearish);
  const shortCandidate = buildCandidate('SHORT', indicators, trendBullish, trendBearish);
  const selected = pickCandidate(longCandidate, shortCandidate);
  const meta = confidenceMeta(selected.total);
  const warnings = buildSignalWarnings(indicators);
  const entryContext = classifyEntryContext({
    score: selected.total,
    direction: selected.direction,
    price,
    ema20,
    rsi,
    currentVolume: indicators.currentVolume,
    averageVolume: indicators.averageVolume,
    resistance: indicators.resistance,
    support: indicators.support,
    previousResistance: indicators.previousResistance,
    previousSupport: indicators.previousSupport,
    recentCandles: indicators.recentCandles,
    trendAligned: selected.checks.trendPass,
    notNearResistance: selected.checks.resistanceDistance > 1.5,
    notNearSupport: selected.checks.supportDistance > 1.5,
  });
  const entryAdvice = ENTRY_ADVICE[entryContext];

  return {
    signal: selected.status,
    trend,
    longScore: longCandidate.total,
    shortScore: shortCandidate.total,
    score: selected.total,
    scoreMax: SCORE_MAX,
    confidence: meta,
    scoreBreakdown: {
      total: selected.total,
      max: SCORE_MAX,
      breakdown: selected.breakdown,
      status: selected.status,
      hardBlock: selected.hardBlock,
      warnings,
    },
    candidates: {
      long: longCandidate,
      short: shortCandidate,
    },
    hardBlock: selected.hardBlock,
    warnings,
    stale: Boolean(indicators.stale),
    lastUpdate: indicators.lastUpdate ?? null,
    dataValid: indicators.valid !== false,
    invalidReason: indicators.reason ?? null,
    entryContext,
    entryAdvice,
    rr: round(selected.rr),
    layers: {
      trendBullish,
      trendBearish,
      momentumLong: longCandidate.checks.rsiMomentumPass && longCandidate.checks.macdPass,
      momentumShort: shortCandidate.checks.rsiMomentumPass && shortCandidate.checks.macdPass,
      levelLong: longCandidate.checks.levelLongPass,
      levelShort: shortCandidate.checks.levelShortPass,
    },
    basis: basisFromCandidate(selected, rsi, macd),
    entry1: round(selected.levels.entry1),
    entry2: round(selected.levels.entry2),
    tp1: round(selected.levels.tp1),
    tp2: round(selected.levels.tp2),
    sl: round(selected.levels.sl),
  };
}
