export const TIMEFRAME = '15m';
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
export const PRICE_POLL_MS = 60000;
export const CANDLE_POLL_MS = 900000;
export const RATE_LIMIT_BACKOFF_MS = 120000;

const COINGECKO_API = '/api/coingecko/api/v3';
const COINBASE_WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const NETWORK_BLOCK_HOST = 'internetsehat.iconpln.net.id';
const PAIR_UNAVAILABLE = 'Pair not available — add to watchlist manually';
const RATE_LIMITED = 'CoinGecko rate limit reached';

export const COINGECKO_IDS = {
  BTCUSDT: { id: 'bitcoin', symbol: 'BTC' },
  ETHUSDT: { id: 'ethereum', symbol: 'ETH' },
  SOLUSDT: { id: 'solana', symbol: 'SOL' },
  BNBUSDT: { id: 'binancecoin', symbol: 'BNB' },
  ADAUSDT: { id: 'cardano', symbol: 'ADA' },
  DOTUSDT: { id: 'polkadot', symbol: 'DOT' },
};

export const COINBASE_PRODUCTS = {
  BTCUSDT: 'BTC-USD',
  ETHUSDT: 'ETH-USD',
  SOLUSDT: 'SOL-USD',
};

export function normalizeSymbol(symbol) {
  return symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function getCoinGeckoMeta(symbol) {
  const normalized = normalizeSymbol(symbol);
  return COINGECKO_IDS[normalized] ?? null;
}

export function getCoinbaseProduct(symbol) {
  const normalized = normalizeSymbol(symbol);
  return COINBASE_PRODUCTS[normalized] ?? null;
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
    return new Error(`${provider} request failed. Network policy or TLS trust on this machine is blocking data access.`);
  }

  return error;
}

function createPairUnavailableError() {
  return new Error(PAIR_UNAVAILABLE);
}

export function isPairUnavailableError(error) {
  return error instanceof Error && error.message === PAIR_UNAVAILABLE;
}

export function isRateLimitedError(error) {
  return error instanceof Error && error.message === RATE_LIMITED;
}

function createRateLimitedError() {
  return new Error(RATE_LIMITED);
}

async function fetchCoinGeckoMarketChart(symbol) {
  const meta = getCoinGeckoMeta(symbol);
  if (!meta) {
    throw createPairUnavailableError();
  }

  const url = `${COINGECKO_API}/coins/${meta.id}/market_chart?vs_currency=usd&days=1`;

  try {
    const response = await fetch(url);
    await assertUsableJsonResponse(response, 'CoinGecko');
    if (!response.ok) {
      if (response.status === 404) {
        throw createPairUnavailableError();
      }

      if (response.status === 429) {
        throw createRateLimitedError();
      }

      throw new Error(`CoinGecko market chart error ${response.status}`);
    }

    const payload = await response.json();
    const prices = payload?.prices;
    const totalVolumes = payload?.total_volumes;
    if (!Array.isArray(prices) || prices.length === 0) {
      throw new Error('CoinGecko returned no market chart payload');
    }

    return {
      prices,
      totalVolumes: Array.isArray(totalVolumes) ? totalVolumes : [],
    };
  } catch (error) {
    throw normalizeFetchError(error, 'CoinGecko');
  }
}

function buildQuarterHourCandles(prices, totalVolumes) {
  const buckets = new Map();

  prices.forEach(([timestamp, price], index) => {
    const volume = Number(totalVolumes[index]?.[1] ?? 0);
    const bucket = Math.floor(Number(timestamp) / 900000) * 900000;
    const currentPrice = Number(price);

    if (!buckets.has(bucket)) {
      buckets.set(bucket, {
        time: Math.floor(bucket / 1000),
        open: currentPrice,
        high: currentPrice,
        low: currentPrice,
        close: currentPrice,
        volume,
      });
      return;
    }

    const candle = buckets.get(bucket);
    candle.high = Math.max(candle.high, currentPrice);
    candle.low = Math.min(candle.low, currentPrice);
    candle.close = currentPrice;
    candle.volume = volume;
  });

  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

function calculate24hChange(prices) {
  if (!Array.isArray(prices) || prices.length < 2) {
    return null;
  }

  const first = Number(prices[0]?.[1]);
  const last = Number(prices[prices.length - 1]?.[1]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null;
  }

  return ((last - first) / first) * 100;
}

export async function fetchCoinGeckoCandles(symbol) {
  const { prices, totalVolumes } = await fetchCoinGeckoMarketChart(symbol);
  return buildQuarterHourCandles(prices, totalVolumes);
}

export async function fetchCoinGeckoMarketSnapshot(symbol) {
  const { prices, totalVolumes } = await fetchCoinGeckoMarketChart(symbol);
  const candles = buildQuarterHourCandles(prices, totalVolumes);
  const latestPrice = Number(prices[prices.length - 1]?.[1] ?? candles[candles.length - 1]?.close ?? null);

  return {
    candles,
    latestPrice: Number.isFinite(latestPrice) ? latestPrice : null,
    change24h: calculate24hChange(prices),
    updatedAt: Date.now(),
  };
}

export async function fetchCoinGeckoPrice(symbol) {
  const meta = getCoinGeckoMeta(symbol);
  if (!meta) {
    throw createPairUnavailableError();
  }

  const url = `${COINGECKO_API}/simple/price?ids=${meta.id}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;

  try {
    const response = await fetch(url);
    await assertUsableJsonResponse(response, 'CoinGecko');
    if (!response.ok) {
      if (response.status === 404) {
        throw createPairUnavailableError();
      }

      if (response.status === 429) {
        throw createRateLimitedError();
      }

      throw new Error(`CoinGecko price error ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status?.error_code === 429) {
      throw createRateLimitedError();
    }

    const data = payload?.[meta.id];
    const price = Number(data?.usd);
    const change24h = Number(data?.usd_24h_change);
    const lastUpdatedAt = Number(data?.last_updated_at);

    if (!Number.isFinite(price)) {
      throw new Error('CoinGecko returned invalid price payload');
    }

    return {
      price,
      change24h: Number.isFinite(change24h) ? change24h : null,
      updatedAt: Number.isFinite(lastUpdatedAt) ? lastUpdatedAt * 1000 : Date.now(),
      symbol: meta.symbol,
    };
  } catch (error) {
    throw normalizeFetchError(error, 'CoinGecko');
  }
}

export async function fetchCoinGeckoBatchPrices(symbols) {
  const metas = symbols
    .map((symbol) => ({
      symbol: normalizeSymbol(symbol),
      meta: getCoinGeckoMeta(symbol),
    }))
    .filter((entry) => entry.meta);

  if (!metas.length) {
    return {};
  }

  const ids = [...new Set(metas.map((entry) => entry.meta.id))];
  const url = `${COINGECKO_API}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;

  try {
    const response = await fetch(url);
    await assertUsableJsonResponse(response, 'CoinGecko');
    if (!response.ok) {
      if (response.status === 429) {
        throw createRateLimitedError();
      }

      throw new Error(`CoinGecko batch price error ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status?.error_code === 429) {
      throw createRateLimitedError();
    }

    return metas.reduce((accumulator, entry) => {
      const data = payload?.[entry.meta.id];
      const price = Number(data?.usd);
      const change24h = Number(data?.usd_24h_change);
      const lastUpdatedAt = Number(data?.last_updated_at);

      if (Number.isFinite(price)) {
        accumulator[entry.symbol] = {
          price,
          change24h: Number.isFinite(change24h) ? change24h : null,
          updatedAt: Number.isFinite(lastUpdatedAt) ? lastUpdatedAt * 1000 : Date.now(),
        };
      }

      return accumulator;
    }, {});
  } catch (error) {
    throw normalizeFetchError(error, 'CoinGecko');
  }
}

export function subscribeCoinbaseTicker(symbols, handlers) {
  const productIds = symbols.map((symbol) => getCoinbaseProduct(symbol)).filter(Boolean);
  if (!productIds.length) {
    return null;
  }

  const socket = new WebSocket(COINBASE_WS_URL);

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        product_ids: productIds,
        channels: ['ticker'],
      }),
    );
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type !== 'ticker' || !payload?.product_id) {
        return;
      }

      const symbol = Object.entries(COINBASE_PRODUCTS).find(([, product]) => product === payload.product_id)?.[0];
      const price = Number(payload.price);
      const open24h = Number(payload.open_24h);

      if (!symbol || !Number.isFinite(price)) {
        return;
      }

      handlers?.onTicker?.({
        symbol,
        price,
        updatedAt: Date.now(),
        change24h: Number.isFinite(open24h) && open24h !== 0 ? ((price - open24h) / open24h) * 100 : null,
      });
    } catch (error) {
      handlers?.onError?.(error);
    }
  };

  socket.onerror = () => {
    handlers?.onError?.(new Error('Coinbase websocket connection failed'));
  };

  socket.onclose = () => {
    handlers?.onClose?.();
  };

  return socket;
}

export function buildTradingViewSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return `BYBIT:${normalized}`;
}
