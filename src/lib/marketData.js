export const TIMEFRAME = '15m';
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
export const CANDLE_LIMIT = 250;
export const PRICE_POLL_MS = 10000;
export const CANDLE_POLL_MS = 300000;
export const DATA_FRESH_MS = 15000;
export const RATE_LIMIT_BACKOFF_MS = 30000;

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

async function assertUsableJsonResponse(response, provider) {
  const location = response.headers.get('location') ?? '';
  const contentType = response.headers.get('content-type') ?? '';
  const wasBlocked =
    location.includes(NETWORK_BLOCK_HOST) ||
    response.url.includes(NETWORK_BLOCK_HOST) ||
    response.redirected;

  if (wasBlocked) {
    throw new Error(`${provider} blocked by network filter (${NETWORK_BLOCK_HOST})`);
  }

  if (contentType.includes('text/html')) {
    const html = await response.text();
    if (html.includes(NETWORK_BLOCK_HOST) || html.toLowerCase().includes('internetsehat')) {
      throw new Error(`${provider} blocked by network filter (${NETWORK_BLOCK_HOST})`);
    }

    throw new Error(`${provider} returned HTML instead of market JSON`);
  }
}

function normalizeFetchError(error, provider) {
  if (error instanceof Error && error.message === 'Failed to fetch') {
    return new Error(`${provider} request failed. Network policy or proxy setup is blocking data access.`);
  }

  return error;
}

function createPairUnavailableError() {
  return new Error(PAIR_UNAVAILABLE);
}

function createRateLimitedError() {
  return new Error(RATE_LIMITED);
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
  try {
    const response = await fetch(buildProxyUrl(path, params));
    await assertUsableJsonResponse(response, provider);

    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        throw createPairUnavailableError();
      }

      if (response.status === 429) {
        throw createRateLimitedError();
      }

      throw new Error(`${provider} error ${response.status}`);
    }

    const payload = await response.json();
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
    throw normalizeFetchError(error, provider);
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

export async function fetchBinanceMarketSnapshot(symbol, interval = TIMEFRAME) {
  const normalizedInterval = normalizeTimeframe(interval);
  const [candles, ticker24h] = await Promise.all([
    fetchBinanceCandles(symbol, normalizedInterval, CANDLE_LIMIT),
    fetchBinance24hr(symbol),
  ]);

  return {
    candles,
    timeframe: normalizedInterval,
    latestPrice: ticker24h.price ?? candles[candles.length - 1]?.close ?? null,
    change24h: ticker24h.change24h,
    updatedAt: ticker24h.updatedAt,
  };
}

export function buildTradingViewSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return `BINANCE:${normalized}`;
}
