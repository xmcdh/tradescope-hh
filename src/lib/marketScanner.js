import { calculateIndicators } from './indicators';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

function finite(value) {
  return Number.isFinite(Number(value));
}

function directionScore(direction, bullishPoints, bearishPoints) {
  if (direction === 'BULLISH') return { long: bullishPoints, short: 0 };
  if (direction === 'BEARISH') return { long: 0, short: bearishPoints };
  return { long: 0, short: 0 };
}

function trendDirection(indicators) {
  const { price, ema20, ema50, ema200 } = indicators ?? {};
  if ([price, ema20, ema50, ema200].every(finite)) {
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'BULLISH';
    if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'BEARISH';
  }
  if (finite(ema20) && finite(ema50)) {
    if (ema20 > ema50) return 'BULLISH';
    if (ema20 < ema50) return 'BEARISH';
  }
  return 'NEUTRAL';
}

function structureDirection(indicators) {
  const structure = indicators?.marketStructure?.structure;
  if (structure === 'BULLISH') return 'BULLISH';
  if (structure === 'BEARISH') return 'BEARISH';
  const bos = indicators?.marketStructure?.bos?.direction;
  if (bos === 'bullish') return 'BULLISH';
  if (bos === 'bearish') return 'BEARISH';
  return 'NEUTRAL';
}

function momentumDirection(indicators) {
  const rsi = Number(indicators?.rsi);
  const macd = indicators?.macd;
  if (finite(rsi) && macd) {
    if (rsi > 50 && macd.MACD > macd.signal && macd.histogram > 0) return 'BULLISH';
    if (rsi < 50 && macd.MACD < macd.signal && macd.histogram < 0) return 'BEARISH';
  }
  return 'NEUTRAL';
}

function setupDirection(indicators) {
  const structure = structureDirection(indicators);
  const bos = indicators?.marketStructure?.bos?.direction;
  const retest = indicators?.marketStructure?.retest;
  const failed = indicators?.marketStructure?.failedRetest?.detected;
  if (failed) return 'NEUTRAL';
  if (bos === 'bullish' || structure === 'BULLISH' || retest?.complete) return 'BULLISH';
  if (bos === 'bearish' || structure === 'BEARISH') return 'BEARISH';
  return momentumDirection(indicators);
}

function scoreTrend(htf, setup) {
  const htfTrend = trendDirection(htf);
  const setupTrend = trendDirection(setup);
  if (htfTrend === setupTrend && htfTrend !== 'NEUTRAL') return 20;
  if (htfTrend !== 'NEUTRAL' && setupTrend === 'NEUTRAL') return 12;
  if (htfTrend !== setupTrend && setupTrend !== 'NEUTRAL') return 5;
  return 8;
}

function scoreStructure(htf, setup) {
  const htfStructure = structureDirection(htf);
  const setupStructure = structureDirection(setup);
  let score = 0;
  if (htfStructure !== 'NEUTRAL') score += 8;
  if (setupStructure !== 'NEUTRAL') score += 10;
  if (htfStructure === setupStructure && htfStructure !== 'NEUTRAL') score += 7;
  return Math.min(25, score);
}

function scoreMomentum(setup) {
  const direction = momentumDirection(setup);
  if (direction === 'NEUTRAL') return 5;
  return 10;
}

function scoreVolume(setup) {
  const ratio = Number(setup?.currentVolume) / Number(setup?.averageVolume);
  if (!finite(ratio) || ratio <= 0) return 4;
  if (ratio >= 2) return 10;
  if (ratio >= 1.5) return 9;
  if (ratio >= 1.2) return 7;
  return 4;
}

function scoreDerivatives(derivatives = {}) {
  const oi1h = Number(derivatives.oiChange1h);
  const taker = Number(derivatives.takerDeltaPct);
  const funding = Number(derivatives.funding);
  let score = 4;
  if (finite(oi1h) && Math.abs(oi1h) >= 2) score += 2;
  if (finite(taker) && Math.abs(taker) >= 3) score += 2;
  if (finite(funding) && Math.abs(funding) <= 0.0005) score += 2;
  return Math.min(10, score);
}

function scoreBtcContext(btcContext, setup) {
  if (!btcContext) return 3;
  const btcTrend = btcContext.trend ?? 'NEUTRAL';
  const setupTrend = trendDirection(setup);
  if (btcTrend === setupTrend && btcTrend !== 'NEUTRAL') return 5;
  if (btcTrend === 'NEUTRAL' || setupTrend === 'NEUTRAL') return 3;
  return 1;
}

function qualityLabel(score) {
  if (score >= 85) return '强';
  if (score >= 75) return '可关注';
  if (score >= 65) return '观察';
  return '弱';
}

export function scanSymbol({ symbol, candles4h = [], candles15m = [], derivatives = {}, btcContext = null } = {}) {
  const htf = calculateIndicators(candles4h, '4h');
  const setup = calculateIndicators(candles15m, '15m');
  const technicalValid = Boolean(htf?.valid || setup?.valid);
  const dataQuality = htf?.valid && setup?.valid ? 'GOOD' : technicalValid ? 'PARTIAL' : 'INVALID';

  const components = {
    htfTrend: scoreTrend(htf, setup),
    htfStructure: scoreStructure(htf, setup),
    setupStructure: Math.min(20, scoreStructure(htf, setup)),
    momentum: scoreMomentum(setup),
    volume: scoreVolume(setup),
    derivatives: scoreDerivatives(derivatives),
    btc: scoreBtcContext(btcContext, setup),
  };
  const rawScore = components.htfTrend + components.htfStructure + components.setupStructure + components.momentum + components.volume + components.derivatives + components.btc;
  const score = dataQuality === 'INVALID' ? 0 : clamp(rawScore);

  const htfTrend = trendDirection(htf);
  const setupTrend = setupDirection(setup);
  const direction = htfTrend === setupTrend ? htfTrend : setupTrend === 'NEUTRAL' ? htfTrend : 'NEUTRAL';
  const sweep = setup?.marketStructure?.liquiditySweep ?? setup?.liquiditySweep ?? null;

  return {
    symbol,
    price: setup?.price ?? htf?.price ?? null,
    htf: {
      timeframe: '4h',
      trend: htfTrend,
      structure: structureDirection(htf),
      ema20: htf?.ema20 ?? null,
      ema50: htf?.ema50 ?? null,
      ema200: htf?.ema200 ?? null,
      rsi14: htf?.rsi ?? null,
      macd: htf?.macd ?? null,
      atr14: htf?.atr ?? null,
      support: htf?.support ?? null,
      resistance: htf?.resistance ?? null,
      bos: htf?.marketStructure?.bos ?? null,
    },
    setup: {
      timeframe: '15m',
      trend: setupTrend,
      structure: structureDirection(setup),
      ema20: setup?.ema20 ?? null,
      ema50: setup?.ema50 ?? null,
      ema200: setup?.ema200 ?? null,
      rsi14: setup?.rsi ?? null,
      macd: setup?.macd ?? null,
      atr14: setup?.atr ?? null,
      volumeRatio: finite(setup?.averageVolume) && Number(setup.averageVolume) > 0 ? Number(setup.currentVolume) / Number(setup.averageVolume) : null,
      bos: setup?.marketStructure?.bos ?? null,
      retest: setup?.marketStructure?.retest ?? null,
      failedRetest: setup?.marketStructure?.failedRetest ?? null,
      liquiditySweep: sweep,
      support: setup?.support ?? null,
      resistance: setup?.resistance ?? null,
    },
    derivatives,
    btcContext,
    ranking: { score, direction, quality: qualityLabel(score), components },
    dataQuality,
    generatedAt: new Date().toISOString(),
  };
}

export function rankScans(scans = []) {
  return [...scans]
    .sort((a, b) => (b?.ranking?.score ?? 0) - (a?.ranking?.score ?? 0))
    .map((scan, index) => ({ ...scan, ranking: { ...scan.ranking, rank: index + 1 } }));
}
