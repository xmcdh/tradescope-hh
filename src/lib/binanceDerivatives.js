import { normalizeSymbol, createMarketDataError, MARKET_ERROR_TYPES } from './marketData.js';

const PROXY = import.meta.env.DEV ? 'http://localhost:3001' : '';
const FETCH_TIMEOUT_MS = 8000;
const ALLOWED_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const PERIOD_MS = { '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '30m': 30 * 60 * 1000, '1h': 60 * 60 * 1000, '2h': 2 * 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000, '12h': 12 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000 };

function buildUrl(type, symbol, { period = '15m', limit = 100, startTime, endTime } = {}) {
  const params = new URLSearchParams({
    provider: 'binance',
    type,
    symbol: normalizeSymbol(symbol),
    period,
    limit: String(Math.min(500, Math.max(1, Number(limit) || 100))),
  });
  if (Number.isFinite(startTime)) params.set('startTime', String(Math.floor(startTime)));
  if (Number.isFinite(endTime)) params.set('endTime', String(Math.floor(endTime)));
  return `${PROXY}/api/market-data?${params.toString()}`;
}

async function fetchJson(type, symbol, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(type, symbol, options), { signal: controller.signal });
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok || payload?.ok === false) {
      const errorType = payload?.errorType ?? (response.status === 429 ? MARKET_ERROR_TYPES.RATE_LIMITED : MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR);
      throw createMarketDataError(payload?.message ?? `Binance ${type} error ${response.status}`, errorType, payload ?? {});
    }
    if (!Array.isArray(payload)) {
      throw createMarketDataError(`Binance ${type} returned invalid payload`, MARKET_ERROR_TYPES.INVALID_JSON);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createMarketDataError(`Binance ${type} timed out after ${FETCH_TIMEOUT_MS / 1000}s`, MARKET_ERROR_TYPES.UPSTREAM_TIMEOUT);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function assertPeriod(period) {
  if (!ALLOWED_PERIODS.has(period)) throw new Error(`Unsupported Binance derivative period: ${period}`);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function filterClosedPeriodRows(rows, period, timestampMode = 'start', now = Date.now()) {
  const periodMs = PERIOD_MS[period];
  if (!periodMs) return [];
  const currentPeriodStart = Math.floor(now / periodMs) * periodMs;
  return [...rows]
    .filter((row) => Number.isFinite(row?.timestamp))
    .filter((row) => timestampMode === 'end' ? row.timestamp <= currentPeriodStart : row.timestamp < currentPeriodStart)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchBinanceOpenInterestHistory(symbol, options = {}) {
  const period = options.period ?? '1h';
  assertPeriod(period);
  const rows = await fetchJson('openinteresthistory', symbol, { ...options, period });
  return filterClosedPeriodRows(rows.map((row) => ({
    symbol: normalizeSymbol(row?.symbol ?? symbol),
    sumOpenInterest: normalizeNumber(row?.sumOpenInterest),
    sumOpenInterestValue: normalizeNumber(row?.sumOpenInterestValue),
    timestamp: Number(row?.timestamp) || null,
  })).filter((row) => row.timestamp && row.sumOpenInterest != null), period, 'end');
}

export async function fetchBinanceGlobalLongShortRatio(symbol, options = {}) {
  const period = options.period ?? '15m';
  assertPeriod(period);
  const rows = await fetchJson('longshortratio', symbol, { ...options, period });
  return filterClosedPeriodRows(rows.map((row) => ({
    symbol: normalizeSymbol(row?.symbol ?? symbol),
    longShortRatio: normalizeNumber(row?.longShortRatio),
    longAccount: normalizeNumber(row?.longAccount),
    shortAccount: normalizeNumber(row?.shortAccount),
    timestamp: Number(row?.timestamp) || null,
  })).filter((row) => row.timestamp && row.longShortRatio != null), period, 'end');
}

export async function fetchBinanceTakerLongShort(symbol, options = {}) {
  const period = options.period ?? '15m';
  assertPeriod(period);
  const rows = await fetchJson('takerlongshort', symbol, { ...options, period });
  return filterClosedPeriodRows(rows.map((row) => {
    const buyVol = normalizeNumber(row?.buyVol);
    const sellVol = normalizeNumber(row?.sellVol);
    const buySellRatio = normalizeNumber(row?.buySellRatio);
    return {
      symbol: normalizeSymbol(row?.symbol ?? symbol),
      buySellRatio,
      buyVol,
      sellVol,
      delta: buyVol != null && sellVol != null ? buyVol - sellVol : null,
      timestamp: Number(row?.timestamp) || null,
    };
  }).filter((row) => row.timestamp && (row.delta != null || row.buySellRatio != null)), period, 'start');
}

function latestAtOrBefore(rows, targetTime) {
  let candidate = null;
  for (const row of rows) {
    if (row.timestamp <= targetTime && (!candidate || row.timestamp > candidate.timestamp)) candidate = row;
  }
  return candidate;
}

export function calculateOpenInterestChanges(history) {
  if (!Array.isArray(history) || history.length === 0) return { current: null, change1hPct: null, change4hPct: null, timestamp: null };
  const sorted = [...history].filter((row) => row?.timestamp && row.sumOpenInterest != null).sort((a, b) => a.timestamp - b.timestamp);
  const current = sorted.at(-1);
  const oneHourAgo = latestAtOrBefore(sorted, current.timestamp - 60 * 60 * 1000);
  const fourHoursAgo = latestAtOrBefore(sorted, current.timestamp - 4 * 60 * 60 * 1000);
  const pct = (base) => base?.sumOpenInterest ? ((current.sumOpenInterest - base.sumOpenInterest) / base.sumOpenInterest) * 100 : null;
  return { current: current.sumOpenInterest, change1hPct: pct(oneHourAgo), change4hPct: pct(fourHoursAgo), timestamp: current.timestamp };
}

export function calculateTakerCvd(history) {
  if (!Array.isArray(history) || !history.length) return { delta: null, delta15m: null, delta1h: null, cvd: null, buyVolume: null, sellVolume: null, timestamp: null, window: null };
  const rows = [...history].filter((row) => row?.timestamp).sort((a, b) => a.timestamp - b.timestamp);
  const recent = rows.slice(-8);
  const last = rows.at(-1);
  const delta15m = last?.delta ?? null;
  const delta1h = recent.slice(-4).reduce((sum, row) => sum + (row.delta ?? 0), 0);
  const buyVolume = recent.reduce((sum, row) => sum + (row.buyVol ?? 0), 0);
  const sellVolume = recent.reduce((sum, row) => sum + (row.sellVol ?? 0), 0);
  const cvd = recent.reduce((sum, row) => sum + (row.delta ?? 0), 0);
  return {
    delta: delta1h,
    delta15m,
    delta1h,
    cvd,
    buyVolume,
    sellVolume,
    window: `${recent.length}×15m`,
    timestamp: last?.timestamp ?? null,
    latest15mTimestamp: last?.timestamp ?? null,
  };
}

export function buildDerivativeSnapshot({ openInterestHistory = [], longShortHistory = [], takerHistory = [] } = {}) {
  const oi = calculateOpenInterestChanges(openInterestHistory);
  const taker = calculateTakerCvd(takerHistory);
  const latestLongShort = [...longShortHistory].sort((a, b) => a.timestamp - b.timestamp).at(-1) ?? null;
  return {
    openInterest: oi,
    longShort: latestLongShort,
    taker,
    dataQuality: {
      openInterest: openInterestHistory.length > 0,
      longShort: longShortHistory.length > 0,
      taker: takerHistory.length > 0,
    },
  };
}