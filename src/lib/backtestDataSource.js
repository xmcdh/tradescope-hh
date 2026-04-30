import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCandles, timeframeToMs, validateCandleIntegrity } from './backtester.js';
import { strategyMetadata } from '../config/strategyVersion.js';

export const BACKTEST_DATA_SOURCES = new Set([
  'ccxt-binance',
  'vercel-market-data-proxy',
  'local-cache',
  'local-file',
]);

const PROJECT_ROOT = process.cwd();
const DEFAULT_CACHE_DIR = path.join(PROJECT_ROOT, 'data/ohlcv-cache');
const DEFAULT_VERCEL_PROXY_BASE_URL = 'https://tradescope-lyart.vercel.app/api/market-data';
const DEFAULT_BINANCE_LIMIT = 1000;
const DEFAULT_PROXY_LIMIT = 1500;

function requiredDate(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Missing or invalid --${label} date. Use YYYY-MM-DD.`);
  }

  return timestamp;
}

export function normalizePair(pair) {
  if (String(pair ?? '').includes('/')) {
    return String(pair).toUpperCase();
  }

  const upper = String(pair ?? '').toUpperCase();
  if (upper.endsWith('USDT')) {
    return `${upper.slice(0, -4)}/USDT`;
  }

  return upper;
}

export function pairToSymbol(pair) {
  return normalizePair(pair).replace(/[^A-Z0-9]/g, '');
}

function safePart(value) {
  return String(value ?? '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
}

export function cacheFilePath({ pair, timeframe, from, to, source = 'binance', cacheDir = DEFAULT_CACHE_DIR }) {
  const symbol = pairToSymbol(pair);
  const filename = `${safePart(source)}_${safePart(symbol)}_${safePart(timeframe)}_${safePart(from)}_${safePart(to)}.json`;
  return path.join(cacheDir, filename);
}

async function loadCcxt() {
  try {
    return await import('ccxt');
  } catch {
    throw new Error('CCXT is required for backtesting. Install it with `npm install ccxt`.');
  }
}

function classifyFetchError(error) {
  const message = String(error?.message ?? error ?? '');
  const lower = message.toLowerCase();

  if (lower.includes('exchangeinfo') || lower.includes('ddosprotection') || lower.includes('cloudflare')) {
    return 'Binance provider blocking detected while loading markets. Try a different network or a local residential connection.';
  }

  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('enotfound')) {
    return 'Network fetch failed while requesting Binance candles. Check connectivity or provider blocking.';
  }

  if (lower.includes('bad symbol') || lower.includes('not supported')) {
    return 'Requested pair or timeframe is unavailable on the selected Binance market type.';
  }

  return message || 'Unknown backtest fetch error.';
}

function normalizeKlineRow(row) {
  if (Array.isArray(row)) {
    return {
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5] ?? 0),
    };
  }

  return {
    time: Number(row.time ?? row.timestamp ?? row.openTime),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0),
  };
}

function assertSource(source) {
  if (!BACKTEST_DATA_SOURCES.has(source)) {
    throw new Error(`Invalid --data-source ${source}. Use ${[...BACKTEST_DATA_SOURCES].join(', ')}.`);
  }
}

function validateSourceCandles(candles, timeframe, source) {
  const integrity = validateCandleIntegrity(candles, timeframe);
  if (!integrity.valid) {
    throw new Error(`${source} candle integrity failed: ${integrity.issues.join(' | ')}`);
  }
  return integrity;
}

export async function fetchCcxtBinanceOhlcv({ pair, timeframe, from, to, marketType = 'future' }) {
  const fromMs = requiredDate(from, 'from');
  const toMs = requiredDate(to, 'to');
  const ccxt = await loadCcxt();
  const useUsdm = ['future', 'futures', 'swap', 'usdm'].includes(String(marketType).toLowerCase());
  const ExchangeClass = useUsdm && ccxt.binanceusdm ? ccxt.binanceusdm : ccxt.binance;
  const exchange = new ExchangeClass({
    enableRateLimit: true,
    options: { defaultType: marketType },
  });

  try {
    await exchange.loadMarkets();
  } catch (error) {
    throw new Error(classifyFetchError(error));
  }

  const rows = [];
  let since = fromMs;
  const normalizedPair = normalizePair(pair);
  const marketSymbol = exchange.markets[normalizedPair]
    ? normalizedPair
    : exchange.markets[`${normalizedPair}:USDT`]
      ? `${normalizedPair}:USDT`
      : normalizedPair;

  while (since < toMs) {
    let batch;
    try {
      batch = await exchange.fetchOHLCV(marketSymbol, timeframe, since, DEFAULT_BINANCE_LIMIT);
    } catch (error) {
      throw new Error(classifyFetchError(error));
    }

    if (!batch.length) {
      break;
    }

    for (const row of batch) {
      if (row[0] >= toMs) {
        break;
      }
      rows.push(row);
    }

    const nextSince = batch.at(-1)[0] + 1;
    if (nextSince <= since) {
      break;
    }
    since = nextSince;
  }

  if (!rows.length) {
    throw new Error('No OHLCV data returned by Binance for the requested range.');
  }

  return {
    source: 'ccxt-binance',
    exchangeId: exchange.id,
    marketSymbol,
    candles: rows.map(normalizeKlineRow),
  };
}

export async function fetchVercelMarketDataOhlcv({
  pair,
  timeframe,
  from,
  to,
  proxyBaseUrl = DEFAULT_VERCEL_PROXY_BASE_URL,
  fetcher = fetch,
}) {
  const fromMs = requiredDate(from, 'from');
  const toMs = requiredDate(to, 'to');
  const timeframeMs = timeframeToMs(timeframe);
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    throw new Error(`Invalid timeframe for proxy pagination: ${timeframe}`);
  }

  const symbol = pairToSymbol(pair);
  const rows = [];
  let cursor = fromMs;

  while (cursor < toMs) {
    const url = new URL(proxyBaseUrl);
    url.searchParams.set('provider', 'binance');
    url.searchParams.set('type', 'klines');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', timeframe);
    url.searchParams.set('limit', String(DEFAULT_PROXY_LIMIT));
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(toMs));

    const response = await fetcher(url);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Vercel market-data proxy returned ${response.status}: ${text.slice(0, 160)}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Vercel market-data proxy returned invalid JSON: ${error.message}`);
    }

    if (!Array.isArray(payload)) {
      throw new Error(`Vercel market-data proxy returned non-kline payload: ${JSON.stringify(payload).slice(0, 160)}`);
    }

    const batch = payload.filter((row) => {
      const openTime = Number(row?.[0] ?? row?.time ?? row?.openTime);
      return openTime >= cursor && openTime < toMs;
    });
    if (!batch.length && payload.length) {
      throw new Error('Vercel market-data proxy returned candles outside the requested range. Deploy the startTime/endTime proxy update or use a local cache/file.');
    }
    if (!batch.length) {
      break;
    }

    rows.push(...batch);
    const lastOpenTime = Number(batch.at(-1)?.[0] ?? batch.at(-1)?.time ?? batch.at(-1)?.openTime);
    const nextCursor = lastOpenTime + timeframeMs;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      break;
    }
    cursor = nextCursor;
  }

  if (!rows.length) {
    throw new Error('No OHLCV data returned by Vercel market-data proxy for the requested range.');
  }

  return {
    source: 'vercel-market-data-proxy',
    exchangeId: 'binance-futures-proxy',
    marketSymbol: symbol,
    candles: rows.map(normalizeKlineRow),
  };
}

export async function readLocalFileOhlcv({ file }) {
  if (!file) {
    throw new Error('Missing --file for local-file data source.');
  }

  const raw = await fs.readFile(path.resolve(file), 'utf8');
  const payload = JSON.parse(raw);
  const candles = Array.isArray(payload) ? payload : payload.candles;
  if (!Array.isArray(candles)) {
    throw new Error('Local file must contain a JSON OHLCV array or an object with candles[].');
  }

  return {
    source: 'local-file',
    exchangeId: 'local-file',
    marketSymbol: path.basename(file),
    candles: candles.map(normalizeKlineRow),
  };
}

export async function readCachedOhlcv({ pair, timeframe, from, to, cacheDir = DEFAULT_CACHE_DIR }) {
  const filePath = cacheFilePath({ pair, timeframe, from, to, cacheDir });
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const candles = normalizeCandles(payload.candles ?? []);
  validateSourceCandles(candles, timeframe, 'local-cache');

  return {
    source: 'local-cache',
    exchangeId: payload.source ?? 'local-cache',
    marketSymbol: payload.symbol ?? pairToSymbol(pair),
    cachePath: filePath,
    cachePayload: payload,
    candles,
  };
}

export async function writeOhlcvCache({ pair, timeframe, from, to, source, candles, cacheDir = DEFAULT_CACHE_DIR }) {
  const normalizedPair = normalizePair(pair);
  const symbol = pairToSymbol(pair);
  const filePath = cacheFilePath({ pair, timeframe, from, to, cacheDir });
  const payload = {
    source,
    pair: normalizedPair,
    symbol,
    timeframe,
    from,
    to,
    candleCount: candles.length,
    generatedAt: new Date().toISOString(),
    ...strategyMetadata(),
    candles: normalizeCandles(candles),
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

export async function fetchBacktestOhlcv(options = {}) {
  const source = options.dataSource ?? 'ccxt-binance';
  assertSource(source);

  let result;
  if (source === 'ccxt-binance') {
    result = await fetchCcxtBinanceOhlcv(options);
  } else if (source === 'vercel-market-data-proxy') {
    result = await fetchVercelMarketDataOhlcv(options);
  } else if (source === 'local-cache') {
    result = await readCachedOhlcv(options);
  } else {
    result = await readLocalFileOhlcv(options);
  }

  const candles = normalizeCandles(result.candles);
  const integrity = validateSourceCandles(candles, options.timeframe, result.source);
  const shouldWriteCache = options.writeCache === true || options.writeCache === 'true';
  let cachePath = result.cachePath ?? null;

  if (shouldWriteCache && source !== 'local-cache') {
    cachePath = await writeOhlcvCache({
      pair: options.pair,
      timeframe: options.timeframe,
      from: options.from,
      to: options.to,
      source: result.source,
      candles,
      cacheDir: options.cacheDir,
    });
  }

  return {
    ...result,
    candles,
    integrity,
    cachePath,
  };
}
