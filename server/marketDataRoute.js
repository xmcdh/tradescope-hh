import {
  ERROR_TYPES,
  buildErrorPayload,
  fetchBinanceEndpoint,
  fetchBinanceFunding,
  fetchBinanceOpenInterest,
} from './binanceProxy.js';
import { fetchBybitKlines, fetchBybitTicker } from './bybitProxy.js';

const VALID_PROVIDERS = new Set(['binance', 'bybit']);
const VALID_TYPES = new Set(['klines', 'ticker', 'funding', 'openinterest']);

export function normalizeMarketDataQuery(query = {}) {
  return {
    provider: String(query.provider ?? 'binance').toLowerCase(),
    type: String(query.type ?? '').toLowerCase(),
    symbol: String(query.symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    interval: String(query.interval ?? '15m'),
    limit: String(query.limit ?? '100'),
  };
}

export function validateMarketDataQuery(query) {
  if (!VALID_PROVIDERS.has(query.provider)) {
    return {
      ok: false,
      status: 400,
      payload: buildErrorPayload({
        source: query.provider || 'market_data',
        endpoint: query.type || 'unknown',
        symbol: query.symbol || null,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Invalid provider. Use binance or bybit.',
        upstream: null,
      }),
    };
  }

  if (!VALID_TYPES.has(query.type)) {
    return {
      ok: false,
      status: 400,
      payload: buildErrorPayload({
        source: query.provider,
        endpoint: query.type || 'unknown',
        symbol: query.symbol || null,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Invalid type. Use klines, ticker, funding, or openinterest.',
        upstream: null,
      }),
    };
  }

  if (!query.symbol || query.symbol.length < 6 || query.symbol.length > 24) {
    return {
      ok: false,
      status: 400,
      payload: buildErrorPayload({
        source: query.provider,
        endpoint: query.type,
        symbol: query.symbol || null,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Invalid or missing symbol.',
        upstream: null,
      }),
    };
  }

  if (query.provider === 'bybit' && !['klines', 'ticker'].includes(query.type)) {
    return {
      ok: false,
      status: 400,
      payload: buildErrorPayload({
        source: 'bybit_futures',
        endpoint: query.type,
        symbol: query.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Bybit fallback currently supports klines and ticker only.',
        upstream: null,
      }),
    };
  }

  return { ok: true };
}

function jsonResult(status, payload) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    text: JSON.stringify(payload),
  };
}

function normalizeBinanceDerivativePayload(result, query) {
  if (result.status < 200 || result.status >= 300) {
    return result;
  }

  try {
    const payload = JSON.parse(result.text);
    const body =
      query.type === 'funding'
        ? {
            symbol: payload.symbol,
            fundingRate: payload.lastFundingRate,
            markPrice: payload.markPrice,
            nextFundingTime: payload.nextFundingTime,
          }
        : {
            symbol: payload.symbol,
            openInterest: payload.openInterest,
          };

    return {
      status: result.status,
      contentType: 'application/json; charset=utf-8',
      text: JSON.stringify(body),
      upstream: result.upstream,
    };
  } catch (error) {
    return jsonResult(
      502,
      buildErrorPayload({
        source: 'binance_futures',
        endpoint: query.type === 'funding' ? 'premiumIndex' : 'openInterest',
        symbol: query.symbol,
        errorType: ERROR_TYPES.INVALID_JSON,
        message: error.message,
        upstream: result.upstream,
      }),
    );
  }
}

export async function handleMarketDataRequest(rawQuery, fetcher = fetch) {
  const query = normalizeMarketDataQuery(rawQuery);
  const validation = validateMarketDataQuery(query);

  if (!validation.ok) {
    return jsonResult(validation.status, validation.payload);
  }

  if (query.provider === 'bybit') {
    const result =
      query.type === 'klines'
        ? await fetchBybitKlines(query.symbol, query.interval, query.limit, fetcher)
        : await fetchBybitTicker(query.symbol, fetcher);
    return jsonResult(result.status, result.payload);
  }

  if (query.type === 'klines') {
    return fetchBinanceEndpoint(
      'klines',
      {
        symbol: query.symbol,
        interval: query.interval,
        limit: query.limit,
      },
      fetcher,
    );
  }

  if (query.type === 'ticker') {
    return fetchBinanceEndpoint('ticker/price', { symbol: query.symbol }, fetcher);
  }

  const result =
    query.type === 'funding'
      ? await fetchBinanceFunding(query.symbol, fetcher)
      : await fetchBinanceOpenInterest(query.symbol, fetcher);
  return normalizeBinanceDerivativePayload(result, query);
}
