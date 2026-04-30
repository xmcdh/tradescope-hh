export const TIMEFRAME = '15m';
export const WATCHLIST_STORAGE_KEY = 'tradescope_watchlist';
export const WATCHLIST_VERSION_KEY = 'tradescope_watchlist_version';
export const WATCHLIST_STORAGE_VERSION = '2026-04-futures-v2';
export const DEFAULT_WATCHLIST = [
  { symbol: 'BTCUSDT', label: 'BTC/USDT', tier: 1, status: 'active' },
  { symbol: 'ETHUSDT', label: 'ETH/USDT', tier: 1, status: 'active' },
  { symbol: 'SOLUSDT', label: 'SOL/USDT', tier: 1, status: 'active' },
  { symbol: 'BNBUSDT', label: 'BNB/USDT', tier: 1, status: 'active' },
  { symbol: 'DOGEUSDT', label: 'DOGE/USDT', tier: 2, status: 'active' },
  { symbol: 'LINKUSDT', label: 'LINK/USDT', tier: 2, status: 'active' },
  { symbol: 'AVAXUSDT', label: 'AVAX/USDT', tier: 2, status: 'active' },
  { symbol: 'ADAUSDT', label: 'ADA/USDT', tier: 2, status: 'active' },
  { symbol: 'SUIUSDT', label: 'SUI/USDT', tier: 2, status: 'active' },
  { symbol: 'APTUSDT', label: 'APT/USDT', tier: 2, status: 'active' },
  { symbol: 'NEARUSDT', label: 'NEAR/USDT', tier: 2, status: 'active' },
  { symbol: 'XRPUSDT', label: 'XRP/USDT', tier: 2, status: 'avoid' },
];
export const DEFAULT_SYMBOLS = DEFAULT_WATCHLIST.map((item) => item.symbol);
export const MOMENTUM_SYMBOLS = ['DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'ADAUSDT', 'SUIUSDT', 'APTUSDT', 'NEARUSDT'];
export const AVOID_PAIR_REASON = 'Pair flagged as AVOID. Monitor only, no entry recommended.';
export const CANDLE_LIMIT = 250;
export const PRICE_POLL_MS = 10000;
export const CANDLE_POLL_MS = 300000;
export const DATA_FRESH_MS = 15000;
export const DATA_STALE_SIGNAL_MS = 30000;
export const RATE_LIMIT_BACKOFF_MS = 30000;
export const FETCH_TIMEOUT_MS = 8000;
export const MARKET_ERROR_TYPES = {
  NETWORK_BLOCKED: 'NETWORK_BLOCKED',
  TLS_ERROR: 'TLS_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_HTML_RESPONSE: 'UPSTREAM_HTML_RESPONSE',
  INVALID_JSON: 'INVALID_JSON',
  RATE_LIMITED: 'RATE_LIMITED',
  STALE_DATA: 'STALE_DATA',
  UNKNOWN_UPSTREAM_ERROR: 'UNKNOWN_UPSTREAM_ERROR',
};

const PROXY = import.meta.env.DEV ? 'http://localhost:3001' : '';
const NETWORK_BLOCK_HOST = 'internetsehat.iconpln.net.id';
const PAIR_UNAVAILABLE = 'Pair not available on Binance';
const RATE_LIMITED = 'Binance rate limit reached';
const SOURCE_LABEL = 'Binance via Proxy';
const SOURCE_MODE = 'polling';
const BINANCE_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h']);

export const TIMEFRAME_OPTIONS = ['1m', '5m', '15m', '1h', '4h'];

export function normalizeTimeframe(timeframe) {
  return BINANCE_INTERVALS.has(timeframe) ? timeframe : TIMEFRAME;
}

export function normalizeSymbol(symbol) {
  return symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function getWatchlistMeta(symbol) {
  const normalized = normalizeSymbol(symbol);
  return (
    DEFAULT_WATCHLIST.find((item) => item.symbol === normalized) ?? {
      symbol: normalized,
      label: `${normalized.replace(/USDT$/i, '')}/USDT`,
      tier: 2,
      status: 'active',
    }
  );
}

export function isAvoidSymbol(symbol) {
  return getWatchlistMeta(symbol).status === 'avoid';
}

export function getSourceLabel() {
  return SOURCE_LABEL;
}

export function getSourceMode() {
  return SOURCE_MODE;
}

function buildProxyUrl(path, params) {
  const search = new URLSearchParams(params);
  return `${PROXY}${path}?${search.toString()}`;
}

export function createMarketDataError(message, errorType = MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR, details = {}) {
  const error = new Error(message);
  error.errorType = errorType;
  error.details = details;
  error.source = details.source ?? null;
  error.endpoint = details.endpoint ?? null;
  error.signalAllowed = false;
  return error;
}

async function assertUsableJsonResponse(response, provider) {
  const location = response.headers.get('location') ?? '';
  const contentType = response.headers.get('content-type') ?? '';
  const wasBlocked =
    location.includes(NETWORK_BLOCK_HOST) ||
    response.url.includes(NETWORK_BLOCK_HOST) ||
    response.redirected;

  if (wasBlocked) {
    throw createMarketDataError(
      `${provider} blocked by network filter (${NETWORK_BLOCK_HOST})`,
      MARKET_ERROR_TYPES.NETWORK_BLOCKED,
    );
  }

  if (contentType.includes('text/html')) {
    const html = await response.text();
    if (html.includes(NETWORK_BLOCK_HOST) || html.toLowerCase().includes('internetsehat')) {
      throw createMarketDataError(
        `${provider} blocked by network filter (${NETWORK_BLOCK_HOST})`,
        MARKET_ERROR_TYPES.NETWORK_BLOCKED,
      );
    }

    throw createMarketDataError(`${provider} returned HTML instead of market JSON`, MARKET_ERROR_TYPES.UPSTREAM_HTML_RESPONSE);
  }
}

function normalizeFetchError(error, provider) {
  if (error instanceof Error && error.message === 'Failed to fetch') {
    return createMarketDataError(
      `${provider} request failed. Network policy or proxy setup is blocking data access.`,
      MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
    );
  }

  return error;
}

function createPairUnavailableError() {
  return new Error(PAIR_UNAVAILABLE);
}

function createRateLimitedError() {
  return createMarketDataError(RATE_LIMITED, MARKET_ERROR_TYPES.RATE_LIMITED);
}

export function isPairUnavailableError(error) {
  return error instanceof Error && error.message === PAIR_UNAVAILABLE;
}

export function isRateLimitedError(error) {
  return error instanceof Error && error.message === RATE_LIMITED;
}

function ensureKlinesPayload(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw createPairUnavailableError();
  }

  return payload;
}

function parseKline(kline) {
  const [
    openTime,
    open,
    high,
    low,
    close,
    volume,
  ] = kline;

  return {
    time: Math.floor(Number(openTime) / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  };
}

async function fetchBinanceJson(path, params, provider, { allowEmptyArray = false } = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(buildProxyUrl(path, params), { signal: controller.signal });
    await assertUsableJsonResponse(response, provider);

    if (!response.ok) {
      let errorPayload = null;
      try {
        errorPayload = await response.clone().json();
      } catch {
        errorPayload = null;
      }

      if (errorPayload?.errorType) {
        throw createMarketDataError(errorPayload.message ?? `${provider} error ${response.status}`, errorPayload.errorType, errorPayload);
      }

      if (response.status === 404 || response.status === 400) {
        throw createPairUnavailableError();
      }

      if (response.status === 429) {
        throw createRateLimitedError();
      }

      throw createMarketDataError(`${provider} error ${response.status}`, MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw createMarketDataError(`${provider} returned invalid JSON`, MARKET_ERROR_TYPES.INVALID_JSON);
    }
    if (payload?.ok === false && payload?.errorType) {
      throw createMarketDataError(payload.message ?? `${provider} error`, payload.errorType, payload);
    }
    if (!allowEmptyArray && Array.isArray(payload) && payload.length === 0) {
      throw createPairUnavailableError();
    }

    if (payload?.code === -1121) {
      throw createPairUnavailableError();
    }

    if (payload?.code === -1003) {
      throw createRateLimitedError();
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createMarketDataError(`${provider} timed out after ${FETCH_TIMEOUT_MS / 1000}s`, MARKET_ERROR_TYPES.UPSTREAM_TIMEOUT);
    }

    throw normalizeFetchError(error, provider);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchBinanceCandles(symbol, interval = TIMEFRAME, limit = CANDLE_LIMIT) {
  const normalized = normalizeSymbol(symbol);
  const normalizedInterval = normalizeTimeframe(interval);
  const payload = await fetchBinanceJson(
    '/api/binance',
    {
      endpoint: 'klines',
      symbol: normalized,
      interval: normalizedInterval,
      limit: String(limit),
    },
    'Binance klines',
  );

  return ensureKlinesPayload(payload).map(parseKline);
}

export async function fetchBinance24hr(symbol) {
  const normalized = normalizeSymbol(symbol);
  const payload = await fetchBinanceJson(
    '/api/binance',
    {
      endpoint: 'ticker/24hr',
      symbol: normalized,
    },
    'Binance 24hr ticker',
  );

  const lastPrice = Number(payload?.lastPrice);
  const change24h = Number(payload?.priceChangePercent);

  if (!Number.isFinite(lastPrice)) {
    throw new Error('Binance returned invalid 24hr ticker payload');
  }

  return {
    price: lastPrice,
    change24h: Number.isFinite(change24h) ? change24h : null,
    updatedAt: Date.now(),
  };
}

export async function fetchBinancePrice(symbol) {
  const normalized = normalizeSymbol(symbol);
  const payload = await fetchBinanceJson(
    '/api/binance',
    {
      endpoint: 'ticker/price',
      symbol: normalized,
    },
    'Binance price ticker',
  );

  const price = Number(payload?.price);
  if (!Number.isFinite(price)) {
    throw new Error('Binance returned invalid price payload');
  }

  return {
    price,
    updatedAt: Date.now(),
  };
}

export async function fetchBinanceBatchPrices(symbols) {
  const normalizedSymbols = symbols.map(normalizeSymbol).filter(Boolean);
  if (!normalizedSymbols.length) {
    return {};
  }

  const payload = await fetchBinanceJson(
    '/api/binance-ws-fallback',
    {
      symbols: normalizedSymbols.join(','),
    },
    'Binance batch price polling',
    { allowEmptyArray: true },
  );

  if (!Array.isArray(payload)) {
    throw new Error('Binance batch polling returned invalid payload');
  }

  const now = Date.now();

  return payload.reduce((accumulator, item) => {
    const symbol = normalizeSymbol(item?.symbol ?? '');
    const price = Number(item?.price);

    if (symbol && Number.isFinite(price)) {
      accumulator[symbol] = {
        price,
        updatedAt: now,
      };
    }

    return accumulator;
  }, {});
}

export async function fetchBinanceFunding(symbol) {
  const normalized = normalizeSymbol(symbol);
  const payload = await fetchBinanceJson(
    '/api/market-data',
    {
      provider: 'binance',
      type: 'funding',
      symbol: normalized,
    },
    'Binance funding rate',
  );

  const fundingRate = Number(payload?.fundingRate ?? payload?.lastFundingRate);
  if (!Number.isFinite(fundingRate)) {
    throw new Error('Binance returned invalid funding payload');
  }

  return {
    fundingRate,
    nextFundingTime: Number(payload?.nextFundingTime) || null,
    updatedAt: Date.now(),
  };
}

export async function fetchBinanceOpenInterest(symbol) {
  const normalized = normalizeSymbol(symbol);
  const payload = await fetchBinanceJson(
    '/api/market-data',
    {
      provider: 'binance',
      type: 'openinterest',
      symbol: normalized,
    },
    'Binance open interest',
  );

  const openInterest = Number(payload?.openInterest);
  if (!Number.isFinite(openInterest)) {
    throw new Error('Binance returned invalid open interest payload');
  }

  return {
    openInterest,
    updatedAt: Date.now(),
  };
}

export async function fetchBinanceMarketSnapshot(symbol, interval = TIMEFRAME) {
  const normalizedInterval = normalizeTimeframe(interval);
  const [candlesResult, tickerResult, fundingResult, openInterestResult] = await Promise.allSettled([
    fetchBinanceCandles(symbol, normalizedInterval, CANDLE_LIMIT),
    fetchBinance24hr(symbol),
    fetchBinanceFunding(symbol),
    fetchBinanceOpenInterest(symbol),
  ]);
  const candles = candlesResult.status === 'fulfilled' ? candlesResult.value : [];
  const ticker24h = tickerResult.status === 'fulfilled' ? tickerResult.value : null;

  if (!candles.length && !ticker24h) {
    const error = candlesResult.reason ?? tickerResult.reason;
    throw error;
  }

  const fundingValue = fundingResult.status === 'fulfilled' ? fundingResult.value : { error: fundingResult.reason };
  const openInterestValue =
    openInterestResult.status === 'fulfilled' ? openInterestResult.value : { error: openInterestResult.reason };

  const derivativesWarnings = [
    fundingValue?.error ? `Funding/OI unavailable: ${fundingValue.error.message}` : null,
    openInterestValue?.error ? `Funding/OI unavailable: ${openInterestValue.error.message}` : null,
  ].filter(Boolean);
  const candleWarning = candles.length ? '' : `Insufficient futures candle data: ${candlesResult.reason?.message ?? 'klines unavailable'}`;

  return {
    candles,
    timeframe: normalizedInterval,
    latestPrice: ticker24h?.price ?? candles[candles.length - 1]?.close ?? null,
    change24h: ticker24h?.change24h ?? null,
    updatedAt: candles.length ? (ticker24h?.updatedAt ?? Date.now()) : ticker24h?.updatedAt,
    fundingRate: fundingValue?.error ? null : fundingValue.fundingRate,
    fundingUpdatedAt: fundingValue?.error ? null : fundingValue.updatedAt,
    nextFundingTime: fundingValue?.error ? null : fundingValue.nextFundingTime,
    openInterest: openInterestValue?.error ? null : openInterestValue.openInterest,
    openInterestUpdatedAt: openInterestValue?.error ? null : openInterestValue.updatedAt,
    derivativesWarning: [...derivativesWarnings, candleWarning].filter(Boolean).join('; '),
    dataQuality: candles.length ? 'FUTURES_CANDLES' : 'PRICE_ONLY',
    signalAllowed: Boolean(candles.length),
    candleErrorType: candles.length ? null : candlesResult.reason?.errorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
  };
}

export function buildTradingViewSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return `BINANCE:${normalized}`;
}

function freshnessFromUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return 'STALE';
  }

  return Date.now() - updatedAt <= DATA_STALE_SIGNAL_MS ? 'FRESH' : 'STALE';
}

function providerError(error, source, endpoint, symbol) {
  return {
    source,
    ok: false,
    data: null,
    errorType: error?.errorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
    message: error?.message ?? 'Unknown market data error',
    endpoint,
    symbol,
    freshness: 'STALE',
    signalAllowed: false,
  };
}

export async function getKlines(symbol, timeframe = TIMEFRAME, source = 'binance_futures') {
  try {
    if (source !== 'binance_futures') {
      throw createMarketDataError(`${source} klines provider not wired into signal engine yet`, MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR);
    }
    const data = await fetchBinanceCandles(symbol, timeframe, CANDLE_LIMIT);
    return { source, ok: true, data, errorType: null, freshness: 'FRESH', signalAllowed: true };
  } catch (error) {
    return providerError(error, source, 'klines', symbol);
  }
}

export async function getFunding(symbol, source = 'binance_futures') {
  try {
    if (source !== 'binance_futures') {
      throw createMarketDataError(`${source} funding unavailable`, MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR);
    }
    const data = await fetchBinanceFunding(symbol);
    return { source, ok: true, data, errorType: null, freshness: freshnessFromUpdatedAt(data.updatedAt), signalAllowed: true };
  } catch (error) {
    return providerError(error, source, 'funding', symbol);
  }
}

export async function getOpenInterest(symbol, source = 'binance_futures') {
  try {
    if (source !== 'binance_futures') {
      throw createMarketDataError(`${source} open interest unavailable`, MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR);
    }
    const data = await fetchBinanceOpenInterest(symbol);
    return { source, ok: true, data, errorType: null, freshness: freshnessFromUpdatedAt(data.updatedAt), signalAllowed: true };
  } catch (error) {
    return providerError(error, source, 'open_interest', symbol);
  }
}

export async function getMarketSnapshot(symbol, timeframe = TIMEFRAME) {
  try {
    const data = await fetchBinanceMarketSnapshot(symbol, timeframe);
    return {
      source: 'binance_futures',
      ok: true,
      data,
      errorType: null,
      freshness: freshnessFromUpdatedAt(data.updatedAt),
      signalAllowed: Boolean(data.signalAllowed),
    };
  } catch (error) {
    return providerError(error, 'binance_futures', 'snapshot', symbol);
  }
}
