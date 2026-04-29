export function confidenceMeta(score) {
  if (score >= 3) {
    return { label: 'HIGH', emoji: '🔥' };
  }

  if (score === 2) {
    return { label: 'MEDIUM', emoji: '⚡' };
  }

  return { label: 'LOW', emoji: '⚠️' };
}

function round(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

export function buildSignalSetup(indicators) {
  if (!indicators?.price || !indicators?.macd) {
    return null;
  }

  const { price, ema20, ema50, ema200, rsi, macd, support, resistance } = indicators;

  const trendBullish = price > ema20 && ema20 > ema50 && ema50 > ema200;
  const trendBearish = price < ema20 && ema20 < ema50 && ema50 < ema200;
  const trend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';

  const momentumLong = rsi >= 45 && rsi <= 65 && macd.macd > macd.signal && macd.histogram > 0;
  const momentumShort = rsi >= 35 && rsi <= 55 && macd.macd < macd.signal && macd.histogram < 0;

  const longDistance = support > 0 ? ((price - support) / support) * 100 : Infinity;
  const shortDistance = resistance > 0 ? ((resistance - price) / resistance) * 100 : Infinity;
  const levelLong = longDistance >= 0 && longDistance <= 1.5;
  const levelShort = shortDistance >= 0 && shortDistance <= 1.5;

  const longScore = Number(trendBullish) + Number(momentumLong) + Number(levelLong);
  const shortScore = Number(trendBearish) + Number(momentumShort) + Number(levelShort);
  const score = Math.max(longScore, shortScore);

  let signal = 'WAIT';
  if (trendBullish && longScore >= 2) {
    signal = 'LONG';
  } else if (trendBearish && shortScore >= 2) {
    signal = 'SHORT';
  }

  const meta = confidenceMeta(score);
  const entry1 = price;
  const entry2 = signal === 'SHORT' ? resistance : support;
  const tp1 = signal === 'SHORT' ? entry1 * 0.975 : entry1 * 1.025;
  const tp2 = signal === 'SHORT' ? entry1 * 0.94 : entry1 * 1.06;
  const sl = signal === 'SHORT' ? resistance * 1.015 : support * 0.985;

  const momentumPassed = momentumLong || momentumShort;
  const levelPassed = levelLong || levelShort;

  const basis = [
    {
      key: 'trend',
      passed: trend !== 'NEUTRAL',
      label:
        trend === 'BULLISH'
          ? 'EMA Bullish Alignment'
          : trend === 'BEARISH'
            ? 'EMA Bearish Alignment'
            : 'EMA Mixed Alignment',
    },
    {
      key: 'momentum',
      passed: momentumPassed,
      label:
        momentumLong
          ? `RSI ${rsi?.toFixed(1)} + MACD Bullish`
          : momentumShort
          ? `RSI ${rsi?.toFixed(1)} + MACD Bearish`
          : `RSI ${rsi?.toFixed(1)} + MACD Mixed`,
    },
    {
      key: 'level',
      passed: levelPassed,
      label:
        levelLong
          ? `Price near support (${longDistance.toFixed(2)}%)`
          : levelShort
          ? `Price near resistance (${shortDistance.toFixed(2)}%)`
          : `Price away from key levels`,
    },
  ];

  return {
    signal,
    trend,
    longScore,
    shortScore,
    score,
    confidence: meta,
    layers: {
      trendBullish,
      trendBearish,
      momentumLong,
      momentumShort,
      levelLong,
      levelShort,
    },
    basis,
    entry1: round(entry1),
    entry2: round(entry2),
    tp1: round(tp1),
    tp2: round(tp2),
    sl: round(sl),
  };
}
