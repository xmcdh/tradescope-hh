const SCORE_MAX = 10;
const FUNDING_CROWDED = 0.0005;
const FUNDING_EXTREME = 0.001;
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
    ? macd.macd > macd.signal && macd.histogram > 0
    : macd.macd < macd.signal && macd.histogram < 0;
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

  const trendingUp = price > ema20 && ema20 > ema50 && ema50 > ema200 && rsi > 50 && macd.macd > macd.signal;
  const trendingDown = price < ema20 && ema20 < ema50 && ema50 < ema200 && rsi < 50 && macd.macd < macd.signal;

  if (trendingUp) {
    return 'TRENDING_UP';
  }

  if (trendingDown) {
    return 'TRENDING_DOWN';
  }

  const macdUnclear = Math.abs(macd.macd - macd.signal) <= Math.abs(price) * 0.00015;
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

function buildRiskLevels(direction, indicators) {
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
      slAtrMultiple: null,
    };
  }

  if (direction === 'LONG') {
    const belowLevels = levelCandidates([support, ema20, ema50, ...swingLows], (level) => level < price);
    const aboveLevels = levelCandidates([resistance, ...swingHighs], (level) => level > price);
    const baseSupport = belowLevels.at(-1);
    const entry2 = Number.isFinite(baseSupport) ? baseSupport : fallbackPullback;
    const sl = Number.isFinite(baseSupport) ? baseSupport - atr * 0.35 : null;
    const risk = Number.isFinite(sl) ? entry1 - sl : null;
    const tp1 = aboveLevels[0] ?? null;
    const minTwoR = Number.isFinite(risk) ? entry1 + risk * 2 : null;
    const tp2 = aboveLevels.find((level) => level > (tp1 ?? entry1)) ?? minTwoR;
    const rewardTp1 = Number.isFinite(tp1) ? tp1 - entry1 : null;
    const rewardTp2 = Number.isFinite(tp2) ? tp2 - entry1 : null;

    return {
      entry1,
      entry2,
      tp1,
      tp2,
      sl,
      risk,
      rewardTp1,
      rewardTp2,
      rrTp1: Number.isFinite(rewardTp1) && Number.isFinite(risk) && risk > 0 ? rewardTp1 / risk : null,
      rrTp2: Number.isFinite(rewardTp2) && Number.isFinite(risk) && risk > 0 ? rewardTp2 / risk : null,
      slAtrMultiple: Number.isFinite(risk) ? risk / atr : null,
    };
  }

  const aboveLevels = levelCandidates([resistance, ema20, ema50, ...swingHighs], (level) => level > price);
  const belowLevels = levelCandidates([support, ...swingLows], (level) => level < price);
  const baseResistance = aboveLevels[0];
  const entry2 = Number.isFinite(baseResistance) ? baseResistance : fallbackPullback;
  const sl = Number.isFinite(baseResistance) ? baseResistance + atr * 0.35 : null;
  const risk = Number.isFinite(sl) ? sl - entry1 : null;
  const tp1 = belowLevels.at(-1) ?? null;
  const minTwoR = Number.isFinite(risk) ? entry1 - risk * 2 : null;
  const tp2 = [...belowLevels].reverse().find((level) => level < (tp1 ?? entry1)) ?? minTwoR;
  const rewardTp1 = Number.isFinite(tp1) ? entry1 - tp1 : null;
  const rewardTp2 = Number.isFinite(tp2) ? entry1 - tp2 : null;

  return {
    entry1,
    entry2,
    tp1,
    tp2,
    sl,
    risk,
    rewardTp1,
    rewardTp2,
    rrTp1: Number.isFinite(rewardTp1) && Number.isFinite(risk) && risk > 0 ? rewardTp1 / risk : null,
    rrTp2: Number.isFinite(rewardTp2) && Number.isFinite(risk) && risk > 0 ? rewardTp2 / risk : null,
    slAtrMultiple: Number.isFinite(risk) ? risk / atr : null,
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
      passed: (nearSupport || nearEma20 || nearEma50 || retestComplete) && (!Number.isFinite(resistanceDistance) || resistanceDistance > 0.8),
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
    passed: (nearResistance || nearEma20 || nearEma50 || retestComplete) && (!Number.isFinite(supportDistance) || supportDistance > 0.8),
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

  if (direction === 'LONG' && Number.isFinite(checks.resistanceDistance) && checks.resistanceDistance <= 0.8) {
    reasons.push('Price too close to resistance for LONG.');
  }

  if (direction === 'SHORT' && Number.isFinite(checks.supportDistance) && checks.supportDistance <= 0.8) {
    reasons.push('Price too close to support for SHORT.');
  }

  if (!Number.isFinite(levels.rrTp1) || levels.rrTp1 < config.rrMin) {
    reasons.push(`RR to TP1 is below ${config.rrMin.toFixed(1)} or target is unavailable.`);
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
  const levels = buildRiskLevels(direction, indicators);
  const rrPass =
    Number.isFinite(levels.rrTp1) &&
    levels.rrTp1 >= config.rrMin &&
    Number.isFinite(levels.rrTp2) &&
    levels.rrTp2 >= 1.5;

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
      `RR TP1 ${Number.isFinite(levels.rrTp1) ? levels.rrTp1.toFixed(2) : '--'} (min ${config.rrMin.toFixed(1)}), TP2 ${Number.isFinite(levels.rrTp2) ? levels.rrTp2.toFixed(2) : '--'}.`,
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

  return {
    signal: 'NO_TRADE',
    trend: 'NEUTRAL',
    marketRegime: blocked ? 'MARKET_DATA_BLOCKED' : priceOnly ? 'DATA_UNAVAILABLE' : 'INSUFFICIENT_DATA',
    longScore: 0,
    shortScore: 0,
    score: 0,
    scoreMax: SCORE_MAX,
    confidence: confidenceMeta(0),
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
      warnings: [reason],
    },
    warnings: [reason, 'Signal generation disabled for safety.'],
    rejectionReasons: [reason, 'Signal generation disabled for safety.'],
    hardBlock: reason,
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
    atr: round(indicators?.atr),
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
  const marketRegime = detectMarketRegime(indicators);
  const trendBullish = alignTrend({ direction: 'LONG', price, ema20, ema50, ema200 });
  const trendBearish = alignTrend({ direction: 'SHORT', price, ema20, ema50, ema200 });
  const trend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';

  const longCandidate = buildCandidate('LONG', indicators, options, marketRegime, modeConfig);
  const shortCandidate = buildCandidate('SHORT', indicators, options, marketRegime, modeConfig);
  const selected = pickCandidate(longCandidate, shortCandidate);
  const finalSignal = selected.status;
  const finalScore = selected.total;
  const meta = confidenceMeta(finalScore);
  const warnings = unique([...buildSignalWarnings(indicators, selected), modeConfig.warning]);
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
    scoreMax: SCORE_MAX,
    confidence: meta,
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
    hardBlock: selected.hardBlock,
    rrWarning:
      Number.isFinite(selected.levels.rrTp1) && selected.levels.rrTp1 < 1.2
        ? `R:R to TP1 is only ${selected.levels.rrTp1.toFixed(2)}:1.`
        : null,
    levelWarning: selected.rejectionReasons.find((reason) => reason.includes('too close')) ?? null,
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
    tp1Price: executable ? round(selected.levels.tp1) : null,
    tp2Price: executable ? round(selected.levels.tp2) : null,
    slPrice: executable ? round(selected.levels.sl) : null,
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
