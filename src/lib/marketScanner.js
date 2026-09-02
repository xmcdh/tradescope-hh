import { calculateIndicators } from './indicators';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function trendDirection(indicators) {
  const price = number(indicators?.price), ema20 = number(indicators?.ema20), ema50 = number(indicators?.ema50), ema200 = number(indicators?.ema200);
  if ([price, ema20, ema50, ema200].every((value) => value != null)) {
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'BULLISH';
    if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'BEARISH';
  }
  if (ema20 != null && ema50 != null) return ema20 > ema50 ? 'BULLISH' : ema20 < ema50 ? 'BEARISH' : 'NEUTRAL';
  return 'NEUTRAL';
}
function structureDirection(indicators) {
  const structure = indicators?.marketStructure?.structure;
  if (structure === 'BULLISH' || structure === 'BEARISH') return structure;
  const bos = indicators?.marketStructure?.bos?.direction;
  return bos === 'bullish' ? 'BULLISH' : bos === 'bearish' ? 'BEARISH' : 'NEUTRAL';
}
function momentumDirection(indicators) {
  const rsi = number(indicators?.rsi), macd = indicators?.macd;
  if (rsi != null && macd) {
    if (rsi > 50 && macd.MACD > macd.signal && macd.histogram > 0) return 'BULLISH';
    if (rsi < 50 && macd.MACD < macd.signal && macd.histogram < 0) return 'BEARISH';
  }
  return 'NEUTRAL';
}
function setupDirection(indicators) {
  const structure = structureDirection(indicators), bos = indicators?.marketStructure?.bos?.direction;
  const retest = indicators?.marketStructure?.retest, failed = indicators?.marketStructure?.failedRetest?.detected;
  if (failed) return 'NEUTRAL';
  if (bos === 'bullish' || structure === 'BULLISH' || retest?.complete) return 'BULLISH';
  if (bos === 'bearish' || structure === 'BEARISH') return 'BEARISH';
  return momentumDirection(indicators);
}
function scoreTrend(htf) {
  const direction = trendDirection(htf);
  if (direction === 'NEUTRAL') return 8;
  const price = number(htf?.price), ema20 = number(htf?.ema20), ema50 = number(htf?.ema50), ema200 = number(htf?.ema200);
  if ([price, ema20, ema50, ema200].every((value) => value != null)) {
    const aligned = direction === 'BULLISH' ? price > ema20 && ema20 > ema50 && ema50 > ema200 : price < ema20 && ema20 < ema50 && ema50 < ema200;
    if (aligned) return 20;
  }
  return 14;
}
function scoreHtfStructure(htf) {
  const direction = structureDirection(htf), bos = htf?.marketStructure?.bos?.direction;
  if (direction === 'NEUTRAL') return 6;
  if (bos && ((bos === 'bullish' && direction === 'BULLISH') || (bos === 'bearish' && direction === 'BEARISH'))) return 15;
  return 11;
}
function scoreSetupStructure(setup) {
  const direction = structureDirection(setup), bos = setup?.marketStructure?.bos?.direction;
  if (direction === 'NEUTRAL') return 4;
  let score = 7;
  if (bos) score += 4;
  if (setup?.marketStructure?.retest?.complete) score += 4;
  if (setup?.marketStructure?.liquiditySweep?.detected || setup?.liquiditySweep?.detected) score += 5;
  return Math.min(20, score);
}
function scoreMomentum(setup) {
  const rsi = number(setup?.rsi), direction = momentumDirection(setup);
  if (direction === 'NEUTRAL') return 3;
  if (rsi != null && (rsi >= 70 || rsi <= 30)) return 5;
  return 10;
}
function scoreVolume(setup) {
  const current = number(setup?.currentVolume), average = number(setup?.averageVolume);
  if (current == null || !average) return 3;
  const ratio = current / average;
  if (ratio >= 2) return 10; if (ratio >= 1.5) return 9; if (ratio >= 1.2) return 7; if (ratio >= 1) return 5; return 2;
}
function scoreOi(derivatives) {
  const change = number(derivatives?.openInterest?.change1hPct ?? derivatives?.oiChange1h);
  if (change == null) return 3;
  const magnitude = Math.abs(change);
  if (magnitude >= 5) return 8; if (magnitude >= 3) return 7; if (magnitude >= 1.5) return 6; return 4;
}
function scoreTaker(derivatives) {
  const delta = number(derivatives?.taker?.delta ?? derivatives?.takerDelta), buy = number(derivatives?.taker?.buyVolume), sell = number(derivatives?.taker?.sellVolume);
  const ratio = delta != null && buy != null && sell != null && buy + sell > 0 ? Math.abs(delta) / (buy + sell) : null;
  if (ratio == null) return 3; if (ratio >= 0.15) return 7; if (ratio >= 0.08) return 6; if (ratio >= 0.03) return 5; return 3;
}
function scoreFunding(derivatives) {
  const funding = number(derivatives?.funding ?? derivatives?.fundingRate);
  if (funding == null) return 3;
  const absolute = Math.abs(funding);
  if (absolute <= 0.0005) return 5; if (absolute <= 0.001) return 4; return 2;
}
function scoreBtcContext(btcContext, setup) {
  if (!btcContext) return 3;
  const btcTrend = btcContext.trend ?? btcContext.bias ?? 'NEUTRAL', setupTrend = trendDirection(setup);
  if (btcTrend === setupTrend && btcTrend !== 'NEUTRAL') return 5;
  if (btcTrend === 'NEUTRAL' || setupTrend === 'NEUTRAL') return 3;
  return 1;
}
function score4h({ htf, derivatives, btcContext }) {
  // Raw components total 53 points. Normalize to a true 0-100 scale.
  return clamp((scoreTrend(htf) + scoreHtfStructure(htf) + scoreOi(derivatives) + scoreFunding(derivatives) + scoreBtcContext(btcContext, htf)) / 53 * 100);
}
function score15m({ htf, setup, derivatives, btcContext }) {
  // Raw components total 65 points. Normalize to a true 0-100 scale.
  const htfTrend = trendDirection(htf), setupTrend = setupDirection(setup);
  const alignment = htfTrend === setupTrend && setupTrend !== 'NEUTRAL' ? 5 : htfTrend === 'NEUTRAL' || setupTrend === 'NEUTRAL' ? 3 : 1;
  return clamp((scoreSetupStructure(setup) + scoreMomentum(setup) + scoreVolume(setup) + scoreOi(derivatives) + scoreTaker(derivatives) + scoreFunding(derivatives) + alignment) / 65 * 100);
}
function qualityLabel(score) { return score >= 85 ? '强' : score >= 75 ? '可关注' : score >= 65 ? '观察' : '弱'; }

export function scanSymbol({ symbol, candles4h = [], candles15m = [], derivatives = {}, btcContext = null } = {}) {
  const htf = calculateIndicators(candles4h, '4h'), setup = calculateIndicators(candles15m, '15m');
  const technicalValid = Boolean(htf?.valid && setup?.valid), dataQuality = technicalValid ? 'GOOD' : htf?.valid || setup?.valid ? 'PARTIAL' : 'INVALID';
  const score4hValue = score4h({ htf, derivatives, btcContext }), score15mValue = score15m({ htf, setup, derivatives, btcContext });
  const score = dataQuality === 'INVALID' ? 0 : Math.round((score4hValue * 0.45) + (score15mValue * 0.55));
  const htfTrend = trendDirection(htf), setupTrend = setupDirection(setup);
  const direction = htfTrend === setupTrend ? htfTrend : setupTrend === 'NEUTRAL' ? htfTrend : 'NEUTRAL';
  const sweep = setup?.marketStructure?.liquiditySweep ?? setup?.liquiditySweep ?? null;
  return {
    symbol, price: setup?.price ?? htf?.price ?? null,
    htf: { timeframe: '4h', trend: htfTrend, structure: structureDirection(htf), ema20: htf?.ema20 ?? null, ema50: htf?.ema50 ?? null, ema200: htf?.ema200 ?? null, rsi14: htf?.rsi ?? null, macd: htf?.macd ?? null, atr14: htf?.atr ?? null, support: htf?.support ?? null, resistance: htf?.resistance ?? null, bos: htf?.marketStructure?.bos ?? null },
    setup: { timeframe: '15m', trend: setupTrend, structure: structureDirection(setup), ema20: setup?.ema20 ?? null, ema50: setup?.ema50 ?? null, ema200: setup?.ema200 ?? null, rsi14: setup?.rsi ?? null, macd: setup?.macd ?? null, atr14: setup?.atr ?? null, volumeRatio: number(setup?.averageVolume) > 0 ? number(setup.currentVolume) / number(setup.averageVolume) : null, bos: setup?.marketStructure?.bos ?? null, retest: setup?.marketStructure?.retest ?? null, failedRetest: setup?.marketStructure?.failedRetest ?? null, liquiditySweep: sweep, support: setup?.support ?? null, resistance: setup?.resistance ?? null },
    derivatives, btcContext,
    ranking: { score, score4h: Math.round(score4hValue), score15m: Math.round(score15mValue), direction, quality: qualityLabel(score), components: { score4h: score4hValue, score15m: score15mValue } },
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
