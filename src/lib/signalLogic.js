const SCORE_MAX = 10;

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

  const trendBullish = price > ema20 && ema20 > ema50 && ema50 > ema200;
  const trendBearish = price < ema20 && ema20 < ema50 && ema50 < ema200;
  const trend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';

  const longCandidate = buildCandidate('LONG', indicators, trendBullish, trendBearish);
  const shortCandidate = buildCandidate('SHORT', indicators, trendBullish, trendBearish);
  const selected = pickCandidate(longCandidate, shortCandidate);
  const meta = confidenceMeta(selected.total);

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
    },
    candidates: {
      long: longCandidate,
      short: shortCandidate,
    },
    hardBlock: selected.hardBlock,
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
