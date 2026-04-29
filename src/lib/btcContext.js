import { EMA, RSI } from 'technicalindicators';
import { fetchBinanceCandles } from './marketData';

export const BTC_CONTEXT_POLL_MS = 300000;
const BTC_SYMBOL = 'BTCUSDT';
const BTC_CONTEXT_TIMEFRAME = '1h';
const BTC_CONTEXT_LIMIT = 200;

function tailValue(values) {
  return values.length ? Number(values[values.length - 1]) : null;
}

function countDirections(candles) {
  return candles.reduce(
    (counts, candle) => {
      if (candle.close > candle.open) {
        counts.bullish += 1;
      } else if (candle.close < candle.open) {
        counts.bearish += 1;
      }
      return counts;
    },
    { bullish: 0, bearish: 0 },
  );
}

function buildFourHourCandles(candles) {
  const buckets = new Map();

  candles.forEach((candle) => {
    const bucket = Math.floor(candle.time / 14400) * 14400;
    const current = buckets.get(bucket);

    if (!current) {
      buckets.set(bucket, { ...candle, time: bucket });
      return;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  });

  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

export function analyzeBtcContext(candles) {
  if (!Array.isArray(candles) || candles.length < 200) {
    return {
      btcBias: 'NEUTRAL',
      btcTrend: 'NEUTRAL',
      btcRSI: null,
      btcPrice: null,
      btcEma20: null,
      btcEma50: null,
      btcEma200: null,
      btc4hDirection: 'NEUTRAL',
      btcNote: 'BTC context unavailable: insufficient 1h candles.',
      updatedAt: Date.now(),
    };
  }

  const closes = candles.map((candle) => candle.close);
  const btcPrice = candles[candles.length - 1]?.close ?? null;
  const btcEma20 = tailValue(EMA.calculate({ period: 20, values: closes }));
  const btcEma50 = tailValue(EMA.calculate({ period: 50, values: closes }));
  const btcEma200 = tailValue(EMA.calculate({ period: 200, values: closes }));
  const btcRSI = tailValue(RSI.calculate({ period: 14, values: closes }));
  const trendBullish = btcPrice > btcEma20 && btcEma20 > btcEma50;
  const trendBearish = btcPrice < btcEma20 && btcEma20 < btcEma50;
  const btcTrend = trendBullish ? 'BULLISH' : trendBearish ? 'BEARISH' : 'NEUTRAL';
  const fourHourCandles = buildFourHourCandles(candles).slice(-3);
  const directionCounts = countDirections(fourHourCandles);
  const btc4hDirection =
    directionCounts.bullish >= 2 ? 'BULLISH' : directionCounts.bearish >= 2 ? 'BEARISH' : 'NEUTRAL';
  const btcBias =
    trendBullish && btcRSI > 50 && directionCounts.bullish >= 2
      ? 'BULLISH'
      : trendBearish && btcRSI < 50 && directionCounts.bearish >= 2
        ? 'BEARISH'
        : 'NEUTRAL';

  return {
    btcBias,
    btcTrend,
    btcRSI,
    btcPrice,
    btcEma20,
    btcEma50,
    btcEma200,
    btc4hDirection,
    btc4hBullishCount: directionCounts.bullish,
    btc4hBearishCount: directionCounts.bearish,
    btcNote: `BTC ${btcBias}: 1h trend ${btcTrend}, RSI ${Number.isFinite(btcRSI) ? btcRSI.toFixed(1) : '--'}, 4h candles ${btc4hDirection}.`,
    updatedAt: Date.now(),
  };
}

export async function fetchBtcContext() {
  const candles = await fetchBinanceCandles(BTC_SYMBOL, BTC_CONTEXT_TIMEFRAME, BTC_CONTEXT_LIMIT);
  return analyzeBtcContext(candles);
}
