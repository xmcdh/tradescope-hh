import { calculateIndicators } from './indicators';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const directionSign = (direction) => direction === 'BULLISH' ? 1 : direction === 'BEARISH' ? -1 : 0;

function trendDirection(i) {
  const p = number(i?.price), e20 = number(i?.ema20), e50 = number(i?.ema50), e200 = number(i?.ema200);
  if ([p, e20, e50, e200].every((v) => v != null)) {
    if (p > e20 && e20 > e50 && e50 > e200) return 'BULLISH';
    if (p < e20 && e20 < e50 && e50 < e200) return 'BEARISH';
  }
  if (e20 != null && e50 != null) return e20 > e50 ? 'BULLISH' : e20 < e50 ? 'BEARISH' : 'NEUTRAL';
  return 'NEUTRAL';
}
function structureDirection(i) {
  const s = i?.marketStructure?.structure;
  if (s === 'BULLISH' || s === 'BEARISH') return s;
  const b = i?.marketStructure?.bos?.direction;
  return b === 'bullish' ? 'BULLISH' : b === 'bearish' ? 'BEARISH' : 'NEUTRAL';
}
function momentumDirection(i) {
  const rsi = number(i?.rsi), m = i?.macd;
  const macd = number(m?.MACD), signal = number(m?.signal), hist = number(m?.histogram);
  if ([rsi, macd, signal, hist].every((v) => v != null)) {
    if (rsi > 50 && macd > signal && hist > 0) return 'BULLISH';
    if (rsi < 50 && macd < signal && hist < 0) return 'BEARISH';
  }
  return 'NEUTRAL';
}
function setupDirection(i) {
  const structure = structureDirection(i);
  const bos = i?.marketStructure?.bos?.direction;
  const retest = i?.marketStructure?.retest;
  const failedRetest = i?.marketStructure?.failedRetest;
  const sweep = i?.marketStructure?.liquiditySweep;
  if (failedRetest?.detected) return 'NEUTRAL';
  if (bos === 'bullish' || bos === 'bearish') return bos === 'bullish' ? 'BULLISH' : 'BEARISH';
  if (retest?.complete && structure !== 'NEUTRAL') return structure;
  if (structure !== 'NEUTRAL') return structure;
  if (sweep?.detected && sweep?.reclaimed) return sweep.direction === 'bullish' ? 'BULLISH' : 'BEARISH';
  return momentumDirection(i);
}
function scoreTrend(i) {
  const d = trendDirection(i);
  if (d === 'NEUTRAL') return 6;
  const p = number(i?.price), e20 = number(i?.ema20), e50 = number(i?.ema50), e200 = number(i?.ema200);
  if ([p, e20, e50, e200].every((v) => v != null)) {
    const aligned = d === 'BULLISH' ? p > e20 && e20 > e50 && e50 > e200 : p < e20 && e20 < e50 && e50 < e200;
    if (aligned) return 20;
  }
  return 13;
}
function scoreHtfStructure(i) {
  const d = structureDirection(i), b = i?.marketStructure?.bos?.direction;
  if (d === 'NEUTRAL') return 4;
  if (b && ((b === 'bullish' && d === 'BULLISH') || (b === 'bearish' && d === 'BEARISH'))) return 15;
  return 10;
}
function scoreSetupStructure(i) {
  const d = setupDirection(i), b = i?.marketStructure?.bos?.direction;
  if (d === 'NEUTRAL') return 3;
  let score = 6;
  if (b && ((b === 'bullish' && d === 'BULLISH') || (b === 'bearish' && d === 'BEARISH'))) score += 4;
  const retest = i?.marketStructure?.retest;
  if (retest?.complete && retest?.level != null) score += 4;
  const sweep = i?.marketStructure?.liquiditySweep;
  if (sweep?.detected && sweep?.reclaimed && ((sweep.direction === 'bullish' && d === 'BULLISH') || (sweep.direction === 'bearish' && d === 'BEARISH'))) score += 5;
  return Math.min(20, score);
}
function scoreMomentum(i) {
  const d = momentumDirection(i), rsi = number(i?.rsi);
  if (d === 'NEUTRAL') return 2;
  if (rsi != null && (rsi >= 70 || rsi <= 30)) return 5;
  return 10;
}
function scoreVolume(i) {
  const current = number(i?.currentVolume), average = number(i?.averageVolume);
  if (current == null || average == null || average <= 0) return 0;
  const ratio = current / average;
  if (ratio >= 2) return 10;
  if (ratio >= 1.5) return 9;
  if (ratio >= 1.2) return 7;
  if (ratio >= 1) return 5;
  return 2;
}
function scoreTaker(d, direction) {
  const delta = number(d?.taker?.delta15m ?? d?.taker?.delta);
  const buy = number(d?.taker?.buyVolume15m ?? d?.taker?.latestBuyVolume), sell = number(d?.taker?.sellVolume15m ?? d?.taker?.latestSellVolume);
  const fallbackBuy = number(d?.taker?.buyVolume), fallbackSell = number(d?.taker?.sellVolume);
  const total = buy != null && sell != null ? buy + sell : fallbackBuy != null && fallbackSell != null ? fallbackBuy + fallbackSell : null;
  if (delta == null || total == null || total <= 0 || direction === 'NEUTRAL') return delta != null && total > 0 ? 3 : 0;
  const alignedRatio = (delta / total) * directionSign(direction);
  if (alignedRatio >= 0.15) return 7;
  if (alignedRatio >= 0.08) return 6;
  if (alignedRatio >= 0.03) return 5;
  if (alignedRatio >= 0) return 3;
  if (alignedRatio >= -0.08) return 2;
  return 1;
}
function scoreFunding(d, direction) {
  const funding = number(d?.funding ?? d?.fundingRate);
  if (funding == null) return 0;
  const absolute = Math.abs(funding);
  if (direction === 'NEUTRAL') return absolute <= 0.001 ? 4 : 2;
  const crowdedAgainst = funding * directionSign(direction) > 0;
  if (absolute <= 0.0005) return 5;
  if (absolute <= 0.001) return crowdedAgainst ? 3 : 5;
  if (absolute <= 0.002) return crowdedAgainst ? 2 : 5;
  return crowdedAgainst ? 1 : 4;
}
function scoreOi(d, direction) {
  const change = number(d?.openInterest?.change1hPct ?? d?.oiChange1h);
  if (change == null) return 0;
  const magnitude = Math.abs(change);
  let score = magnitude >= 5 ? 6 : magnitude >= 3 ? 5 : magnitude >= 1.5 ? 4 : 3;
  if (direction === 'NEUTRAL') return Math.min(8, score);
  const takerDelta = number(d?.taker?.delta1h ?? d?.taker?.delta);
  const takerBuy = number(d?.taker?.buyVolume), takerSell = number(d?.taker?.sellVolume);
  const takerTotal = takerBuy != null && takerSell != null ? takerBuy + takerSell : 0;
  const takerSign = takerDelta != null && takerTotal > 0 ? Math.sign(takerDelta) : 0;
  const aligned = takerSign !== 0 && takerSign === directionSign(direction);
  const conflicting = takerSign !== 0 && takerSign !== directionSign(direction);
  if (change >= 1.5 && aligned) score += 2;
  if (change >= 1.5 && conflicting) score -= 2;
  if (change <= -1.5) score = Math.max(1, score - 1);
  return Math.max(0, Math.min(8, score));
}
function scoreBtcContext(btc, setup) {
  if (!btc) return 0;
  const btcTrend = btc.trend ?? btc.bias ?? 'NEUTRAL', setupTrend = trendDirection(setup);
  if (btcTrend === setupTrend && btcTrend !== 'NEUTRAL') return 5;
  if (btcTrend === 'NEUTRAL' || setupTrend === 'NEUTRAL') return 3;
  return 1;
}
function score4h({ htf, derivatives, btcContext }) {
  if (!htf?.valid) return 0;
  const direction = trendDirection(htf);
  return clamp((scoreTrend(htf) + scoreHtfStructure(htf) + scoreOi(derivatives, direction) + scoreFunding(derivatives, direction) + scoreBtcContext(btcContext, htf)) / 53 * 100);
}
function score15m({ htf, setup, derivatives }) {
  if (!setup?.valid) return 0;
  const ht = trendDirection(htf), st = setupDirection(setup);
  const alignment = ht === st && st !== 'NEUTRAL' ? 5 : ht === 'NEUTRAL' || st === 'NEUTRAL' ? 3 : 1;
  return clamp((scoreSetupStructure(setup) + scoreMomentum(setup) + scoreVolume(setup) + scoreOi(derivatives, st) + scoreTaker(derivatives, st) + scoreFunding(derivatives, st) + alignment) / 65 * 100);
}
function qualityLabel(score, quality) {
  if (quality === 'INVALID') return '数据不足';
  if (quality === 'PARTIAL') return score >= 80 ? '部分数据' : score >= 60 ? '谨慎' : '数据不足';
  return score >= 85 ? '强' : score >= 75 ? '可关注' : score >= 65 ? '观察' : '弱';
}

export function scanSymbol({ symbol, candles4h = [], candles15m = [], derivatives = {}, btcContext = null } = {}) {
  const htf = calculateIndicators(candles4h, '4h');
  const setup = calculateIndicators(candles15m, '15m');
  const technicalValid = Boolean(htf?.valid && setup?.valid);
  const dataQuality = technicalValid ? 'GOOD' : htf?.valid || setup?.valid ? 'PARTIAL' : 'INVALID';
  const score4hValue = score4h({ htf, derivatives, btcContext });
  const score15mValue = score15m({ htf, setup, derivatives });
  const score = technicalValid ? Math.round(score4hValue * 0.45 + score15mValue * 0.55) : 0;
  const htfTrend = trendDirection(htf), setupTrend = setupDirection(setup);
  const direction = htfTrend === setupTrend ? htfTrend : setupTrend === 'NEUTRAL' ? htfTrend : 'NEUTRAL';
  const sweep = setup?.marketStructure?.liquiditySweep ?? setup?.liquiditySweep ?? null;
  return {
    symbol, price: setup?.price ?? htf?.price ?? null,
    htf: { timeframe: '4h', trend: htfTrend, structure: structureDirection(htf), ema20: htf?.ema20 ?? null, ema50: htf?.ema50 ?? null, ema200: htf?.ema200 ?? null, rsi14: htf?.rsi ?? null, macd: htf?.macd ?? null, atr14: htf?.atr ?? null, support: htf?.support ?? null, resistance: htf?.resistance ?? null, bos: htf?.marketStructure?.bos ?? null },
    setup: { timeframe: '15m', trend: setupTrend, structure: structureDirection(setup), ema20: setup?.ema20 ?? null, ema50: setup?.ema50 ?? null, ema200: setup?.ema200 ?? null, rsi14: setup?.rsi ?? null, macd: setup?.macd ?? null, atr14: setup?.atr ?? null, volumeRatio: number(setup?.averageVolume) > 0 ? number(setup.currentVolume) / number(setup.averageVolume) : null, bos: setup?.marketStructure?.bos ?? null, retest: setup?.marketStructure?.retest ?? null, failedRetest: setup?.marketStructure?.failedRetest ?? null, liquiditySweep: sweep, support: setup?.support ?? null, resistance: setup?.resistance ?? null },
    derivatives, btcContext,
    ranking: { score, score4h: Math.round(score4hValue), score15m: Math.round(score15mValue), direction, quality: qualityLabel(score, dataQuality), components: { score4h: score4hValue, score15m: score15mValue } },
    dataQuality, generatedAt: new Date().toISOString(),
  };
}
export function rankScans(scans = [], mode = 'all') {
  return [...scans].sort((a, b) => {
    const scoreA = mode === '4h' ? a?.ranking?.score4h : mode === '15m' ? a?.ranking?.score15m : a?.ranking?.score;
    const scoreB = mode === '4h' ? b?.ranking?.score4h : mode === '15m' ? b?.ranking?.score15m : b?.ranking?.score;
    return (scoreB ?? 0) - (scoreA ?? 0);
  }).map((scan, index) => ({ ...scan, ranking: { ...scan.ranking, rank: index + 1 } }));
}
