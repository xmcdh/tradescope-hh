import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalSetup } from '../src/lib/signalLogic.js';
import { ERROR_TYPES, buildErrorPayload, isBlockedHtml } from '../server/binanceProxy.js';

function baseIndicators(overrides = {}) {
  return {
    valid: true,
    reason: null,
    ema200Valid: true,
    stale: false,
    feedStale: false,
    dataError: '',
    timeframe: '15m',
    price: 100,
    ema20: 99,
    ema50: 97,
    ema200: 90,
    rsi: 55,
    atr: 1,
    macd: { macd: 1.2, signal: 1, histogram: 0.2 },
    currentVolume: 1500,
    averageVolume: 1000,
    support: 98,
    resistance: 104,
    previousSupport: 98,
    previousResistance: 104,
    lastCandle: { open: 99.5, high: 100.5, low: 99.2, close: 100, volume: 1500 },
    previousCandle: { open: 99, high: 100, low: 98.8, close: 99.5, volume: 1000 },
    lastCandleRange: 1.3,
    shortPriceChange: 1.2,
    fundingRate: 0,
    openInterest: 100000,
    openInterestChange: 1.5,
    derivativesWarning: '',
    marketStructure: {
      structure: 'BULLISH',
      swingHighs: [104, 106, 108],
      swingLows: [95, 97, 98],
      bos: { detected: false, direction: null, level: null, candlesAgo: null },
      retest: { detected: true, complete: true, level: 98 },
      failedRetest: { detected: false, level: null },
      structureSummary: 'Structure BULLISH. Higher lows with completed retest.',
    },
    recentCandles: [],
    ...overrides,
  };
}

function bearishIndicators(overrides = {}) {
  return baseIndicators({
    price: 100,
    ema20: 101,
    ema50: 103,
    ema200: 110,
    rsi: 43,
    macd: { macd: -1.2, signal: -1, histogram: -0.2 },
    support: 96,
    resistance: 102,
    previousSupport: 96,
    previousResistance: 102,
    shortPriceChange: -1.2,
    marketStructure: {
      structure: 'BEARISH',
      swingHighs: [108, 105, 102],
      swingLows: [96, 95, 94],
      bos: { detected: false, direction: null, level: null, candlesAgo: null },
      retest: { detected: true, complete: true, level: 102 },
      failedRetest: { detected: false, level: null },
      structureSummary: 'Structure BEARISH. Lower highs with completed retest.',
    },
    ...overrides,
  });
}

const btcBullish = { btcBias: 'BULLISH', btcRSI: 57, btcNote: 'BTC bullish.' };
const btcBearish = { btcBias: 'BEARISH', btcRSI: 42, btcNote: 'BTC bearish.' };
const btcNeutral = { btcBias: 'NEUTRAL', btcRSI: 50, btcNote: 'BTC neutral.' };

const cases = [
  {
    name: 'Bullish clean trend',
    symbol: 'ETHUSDT',
    indicators: baseIndicators(),
    btcContext: btcBullish,
    expectedValidity: 'VALID',
    expect: (setup) => ['LONG', 'WAIT_RETEST', 'WAIT'].includes(setup.signal) && setup.signal !== 'NO_TRADE',
  },
  {
    name: 'Bearish clean trend',
    symbol: 'ETHUSDT',
    indicators: bearishIndicators(),
    btcContext: btcBearish,
    expectedValidity: 'VALID',
    expect: (setup) => ['SHORT', 'WAIT_RETEST', 'WAIT'].includes(setup.signal) && setup.signal !== 'NO_TRADE',
  },
  {
    name: 'Choppy market',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({
      price: 100,
      ema20: 100,
      ema50: 100.1,
      ema200: 99.9,
      rsi: 51,
      macd: { macd: 0.01, signal: 0.01, histogram: 0 },
      support: 99,
      resistance: 101,
      marketStructure: {
        structure: 'NEUTRAL',
        swingHighs: [101, 100.8, 101],
        swingLows: [99, 99.2, 99.1],
        bos: { detected: false, direction: null, level: null, candlesAgo: null },
        retest: { detected: false, complete: false, level: null },
        failedRetest: { detected: false, level: null },
        structureSummary: 'Neutral range. No BOS.',
      },
    }),
    btcContext: btcNeutral,
    expectedValidity: 'BLOCKED',
    expect: (setup) => setup.signal === 'NO_TRADE' && setup.marketRegime === 'CHOPPY_MARKET',
  },
  {
    name: 'RR buruk',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({ resistance: 101, previousResistance: 101 }),
    btcContext: btcBullish,
    expectedValidity: 'BLOCKED',
    expect: (setup) =>
      ['NO_TRADE', 'WAIT'].includes(setup.signal) &&
      setup.rejectionReasons.some((reason) => reason.includes('RR to TP1 is below')),
  },
  {
    name: 'Candle terlalu panjang',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({ lastCandleRange: 2.2 }),
    btcContext: btcBullish,
    expectedValidity: 'BLOCKED',
    expect: (setup) =>
      ['NO_TRADE', 'WAIT'].includes(setup.signal) &&
      (setup.marketRegime === 'VOLATILE_SPIKE' || setup.rejectionReasons.some((reason) => reason.includes('Candle range'))),
  },
  {
    name: 'Stale data',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({ stale: true, feedStale: true }),
    btcContext: btcBullish,
    expectedValidity: 'BLOCKED',
    expect: (setup) => !['LONG', 'SHORT'].includes(setup.signal) && setup.rejectionReasons.some((reason) => reason.includes('Stale data')),
  },
  {
    name: 'Funding ekstrem melawan arah',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({ fundingRate: 0.0012 }),
    btcContext: btcBullish,
    expectedValidity: 'VALID',
    expect: (setup) => setup.fundingOiAdjustment === -1 && !['LONG'].includes(setup.signal),
  },
  {
    name: 'BTC melawan arah',
    symbol: 'ETHUSDT',
    indicators: baseIndicators(),
    btcContext: btcBearish,
    expectedValidity: 'VALID',
    expect: (setup) => setup.btcAdjustment === -2 && setup.signal !== 'LONG',
  },
  {
    name: 'Insufficient candle data',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({
      valid: false,
      reason: 'insufficient_data',
      ema200Valid: false,
      ema200: null,
    }),
    btcContext: btcNeutral,
    expectedValidity: 'BLOCKED',
    expect: (setup) => setup.signal === 'NO_TRADE' && setup.marketRegime === 'INSUFFICIENT_DATA',
  },
  {
    name: 'Funding/OI unavailable but candle fresh',
    symbol: 'ETHUSDT',
    indicators: baseIndicators({
      fundingRate: null,
      openInterest: null,
      openInterestChange: null,
      derivativesWarning: 'Funding/OI unavailable: upstream timeout',
    }),
    btcContext: btcBullish,
    expectedValidity: 'VALID',
    expect: (setup) =>
      ['LONG', 'WAIT', 'WAIT_RETEST'].includes(setup.signal) &&
      setup.fundingOiAdjustment === 0 &&
      setup.warnings.some((warning) => warning.includes('Funding/OI unavailable')),
  },
  {
    name: 'Price-only fallback',
    symbol: 'ETHUSDT',
    indicators: {
      price: 100,
      valid: false,
      reason: 'insufficient_data',
      dataQuality: 'PRICE_ONLY',
      dataError: 'Insufficient futures candle data',
    },
    btcContext: btcNeutral,
    expectedValidity: 'BLOCKED',
    expect: (setup) =>
      setup.signal === 'NO_TRADE' &&
      setup.rejectionReasons.some((reason) => reason.includes('Price-only fallback')),
  },
  {
    name: 'Upstream HTML blocked response',
    symbol: 'ETHUSDT',
    indicators: {
      price: 100,
      valid: false,
      reason: 'market_data_blocked',
      dataQuality: 'PRICE_ONLY',
      dataError: 'Market data blocked by current network',
      dataErrorType: ERROR_TYPES.NETWORK_BLOCKED,
    },
    btcContext: btcNeutral,
    expectedValidity: 'BLOCKED',
    expect: (setup) =>
      setup.signal === 'NO_TRADE' &&
      setup.marketRegime === 'MARKET_DATA_BLOCKED' &&
      setup.rejectionReasons.some((reason) => reason.includes('Market data blocked')),
  },
  {
    name: 'All providers fail',
    symbol: 'ETHUSDT',
    indicators: {
      price: 100,
      valid: false,
      reason: 'market_data_unavailable',
      dataQuality: 'PRICE_ONLY',
      dataError: 'Market data unavailable. Signals disabled until fresh futures data is restored.',
      dataErrorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
    },
    btcContext: btcNeutral,
    expectedValidity: 'BLOCKED',
    expect: (setup) => setup.signal === 'NO_TRADE' && setup.tradeLevelsVisible === false,
  },
];

for (const testCase of cases) {
  test(testCase.name, () => {
    const setup = buildSignalSetup(testCase.indicators, {
      symbol: testCase.symbol,
      btcContext: testCase.btcContext,
      signalMode: 'conservative',
    });

    assert.ok(testCase.expect(setup));
    assert.equal(setup.signalValidity, testCase.expectedValidity);
    assert.equal(setup.confidenceScore, setup.score);
    assert.ok(Array.isArray(setup.blockedReason));

    if (testCase.expectedValidity === 'BLOCKED') {
      assert.ok(setup.blockedReason.length > 0);
    } else {
      assert.equal(setup.blockedReason.length, 0);
    }
  });
}

test('Proxy blocked HTML classification', () => {
  const blockedHtml = '<!DOCTYPE html><html><body><h1>Situs Diblokir!</h1></body></html>';
  const payload = buildErrorPayload({
    endpoint: 'klines',
    symbol: 'BTCUSDT',
    errorType: ERROR_TYPES.NETWORK_BLOCKED,
    message: 'Binance Futures upstream returned blocked HTML instead of market JSON',
  });

  assert.ok(isBlockedHtml(blockedHtml, 'text/html'));
  assert.equal(payload.errorType, ERROR_TYPES.NETWORK_BLOCKED);
  assert.equal(payload.signalAllowed, false);
});
