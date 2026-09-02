import { calculateIndicators } from './indicators';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function trendDirection(indicators) {
  const price = number(indicators?.price);
  const ema20 = number(indicators?.ema20);
  const ema50 = number(indicators?.ema50);
  const ema200 = number(indicators?.ema200);
  if ([price, ema20, ema50, ema200].every((value) => value != null)) {
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'BULLISH';
    if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'BEARISH';
  }
  if (ema20 != null && ema50 != null) {
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
  const rsi = number(indicators?.rsi);
  const macd = indicators?.macd;
  if (rsi != null && macd) {
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
  if (htfTrend !== 'NEUTRAL' && setupTrend === 'NEUTRAL') return 13;
  if (htfTrend !== 'NEUTRAL' && setupTrend !== 'NEUTRAL') return 7;
  return 4;
}

function scoreHtfStructure(htf) {
  const direction = structureDirection(htf);
  if (direction === 'NEUTRAL') return 4;
  const bos = htf?.marketStructure?.bos?.direction;
  return bos && ((bos === 'bullish' && direction === 'BULLISH') || (bos === 'bearish' && direction === 'BEARISH')) ? 15 : 11;
}

function scoreSetupStructure(setup) {
  const direction = structureDirection(setup);
  if (direction === 'NEUTRAL') return 5;
  let score = 11;
  if (setup?.marketStructure?.bos?.direction) score += 3;
  if (setup?.marketStructure?.retest?.complete) score += 3;
  if (setup?.marketStructure?.liquiditySweep?.detected || setup?.liquiditySweep?.detected) score += 3;
  return Math.min(20, score);
}

function scoreMomentum(setup) {
  const rsi = number(setup?.rsi);
  const direction = momentumDirection(setup);
  if (direction === 'NEUTRAL') return 4;
  if (rsi != null && (rsi >= 70 || rsi <= 30)) return 6;
  return 10;
}

function scoreVolume(setup) {
  const current = number(setup?.currentVolume);
  const average = number(setup?.averageVolume);
  if (current == null || !average) return 3;
  const ratio = current / average;
  if (ratio >= 2) return 10;
  if (ratio >= 1.5) return 9;
  if (ratio >= 1.2) return 7;
  if (ratio >= 1) return 5;
  return 2;
}

function scoreOi(derivatives) {
  const change = number(derivatives?.openInterest?.change1hPct ?? derivatives?.oiChange1h);
  if (change == null) return 3;
  const magnitude = Math.abs(change);
  if (magnitude >= 5) return 8;
  if (magnitude >= 3) return 7;
  if (magnitude >= 1.5) return 6;
  return 4;
}

function scoreTaker(derivatives) {
  const delta = number(derivatives?.taker?.delta ?? derivatives?.takerDelta);
  const buy = number(derivatives?.taker?.buyVolume);
  const sell = number(derivatives?.taker?.sellVolume);
  const ratio = delta != null && buy != null && sell != null && buy + sell > 0 ? Math.abs(delta) / (buy + sell) : null;
  if (ratio == null) return 3;
  if (ratio >= 0.15) return 7;
  if (ratio >= 0.08) return 6;
  if (ratio >= 0.03) return 5;
  return 3;
}

function scoreFunding(derivatives) {
  const funding = number(derivatives?.funding ?? derivatives?.fundingRate);
  if (funding == null) return 3;
  const absolute = Math.abs(funding);
  if (absolute <= 0.0005) return 5;
  if (absolute <= 0.001) return 4;
  return 2;
}

function scoreBtcContext(btcContext, setup) {
  if (!btcContext) return 3;
  const btcTrend = btcContext.trend ?? btcContext.bias ?? 'NEUTRAL';
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
  const technicalValid = Boolean(htf?.valid && setup?.valid);
  const dataQuality = technicalValid ? 'GOOD' : htf?.valid || setup?.valid ? 'PARTIAL' : 'INVALID';

  const components = {
    htfTrend: scoreTrend(htf, setup),
    htfStructure: scoreHtfStructure(htf),
    setupStructure: scoreSetupStructure(setup),
    momentum: scoreMomentum(setup),
    volume: scoreVolume(setup),
    openInterest: scoreOi(derivatives),
    takerCvd: scoreTaker(derivatives),
    funding: scoreFunding(derivatives),
    btc: scoreBtcContext(btcContext, setup),
  };
  const rawScore = Object.values(components).reduce((sum, value) => sum + value, 0);
  const score = dataQuality === 'INVALID' ? 0 : clamp(rawScore);
  const htfTrend = trendDirection(htf);
  const setupTrend = setupDirection(setup);
  const direction = htfTrend === setupTrend ? htfTrend : setupTrend === 'NEUTRAL' ? htfTrend : 'NEUTRAL';
  const sweep = setup?.marketStructure?.liquiditySweep ?? setup?.liquiditySweep ?? null;

  return {
    symbol,
    price: setup?.price ?? htf?.price ?? null,
    htf: {
      timeframe: '4h', trend: htfTrend, structure: structureDirection(htf), ema20: htf?.ema20 ?? null,
      ema50: htf?.ema50 ?? null, ema200: htf?.ema200 ?? null, rsi14: htf?.rsi ?? null, macd: htf?.macd ?? null,
      atr14: htf?.atr ?? null, support: htf?.support ?? null, resistance: htf?.resistance ?? null,
      bos: htf?.marketStructure?.bos ?? null,
    },
    setup: {
      timeframe: '15m', trend: setupTrend, structure: structureDirection(setup), ema20: setup?.ema20 ?? null,
      ema50: setup?.ema50 ?? null, ema200: setup?.ema200 ?? null, rsi14: setup?.rsi ?? null, macd: setup?.macd ?? null,
      atr14: setup?.atr ?? null,
      volumeRatio: number(setup?.averageVolume) > 0 ? number(setup.currentVolume) / number(setup.averageVolume) : null,
      bos: setup?.marketStructure?.bos ?? null, retest: setup?.marketStructure?.retest ?? null,
      failedRetest: setup?.marketStructure?.failedRetest ?? null, liquiditySweep: sweep,
      support: setup?.support ?? null, resistance: setup?.resistance ?? null,
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
