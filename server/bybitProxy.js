import {
  ERROR_TYPES,
  buildErrorPayload,
  isBlockedHtml,
  isHtmlResponse,
} from './binanceProxy.js';

const BYBIT_API_BASE_URL = 'https://api.bybit.com';
const FETCH_TIMEOUT_MS = 8000;
const INTERVAL_MAP = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
};

function isTlsError(error) {
  const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`.toLowerCase();
  return message.includes('certificate') || message.includes('unable to get local issuer') || message.includes('tls');
}

function buildUrl(path, params) {
  const query = new URLSearchParams(params).toString();
  return `${BYBIT_API_BASE_URL}${path}?${query}`;
}

async function fetchBybitJson({ path, params, endpoint, symbol, fetcher = fetch }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const url = buildUrl(path, params);

  try {
    const response = await fetcher(url, {
      headers: { 'User-Agent': 'TradeScope/1.0' },
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    if (isBlockedHtml(text, contentType)) {
      return {
        status: 502,
        payload: buildErrorPayload({
          source: 'bybit_futures',
          endpoint,
          symbol,
          errorType: ERROR_TYPES.NETWORK_BLOCKED,
          message: 'Bybit Futures upstream returned blocked HTML instead of market JSON',
          upstream: url,
        }),
      };
    }

    if (isHtmlResponse(text, contentType)) {
      return {
        status: 502,
        payload: buildErrorPayload({
          source: 'bybit_futures',
          endpoint,
          symbol,
          errorType: ERROR_TYPES.UPSTREAM_HTML_RESPONSE,
          message: 'Bybit Futures upstream returned HTML instead of market JSON',
          upstream: url,
        }),
      };
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        status: 502,
        payload: buildErrorPayload({
          source: 'bybit_futures',
          endpoint,
          symbol,
          errorType: ERROR_TYPES.INVALID_JSON,
          message: 'Bybit Futures returned invalid JSON payload',
          upstream: url,
        }),
      };
    }

    if (response.status === 429) {
      return {
        status: 429,
        payload: buildErrorPayload({
          source: 'bybit_futures',
          endpoint,
          symbol,
          errorType: ERROR_TYPES.RATE_LIMITED,
          message: 'Bybit Futures rate limit reached',
          upstream: url,
        }),
      };
    }

    if (!response.ok || payload?.retCode > 0) {
      return {
        status: response.ok ? 502 : response.status,
        payload: buildErrorPayload({
          source: 'bybit_futures',
          endpoint,
          symbol,
          errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
          message: payload?.retMsg ?? `Bybit Futures upstream error ${response.status}`,
          upstream: url,
        }),
      };
    }

    return { status: 200, payload };
  } catch (error) {
    const errorType =
      error?.name === 'AbortError'
        ? ERROR_TYPES.UPSTREAM_TIMEOUT
        : isTlsError(error)
          ? ERROR_TYPES.TLS_ERROR
          : ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR;

    return {
      status: 502,
      payload: buildErrorPayload({
        source: 'bybit_futures',
        endpoint,
        symbol,
        errorType,
        message:
          error?.name === 'AbortError'
            ? 'Bybit Futures request timed out after 8s'
            : `Bybit Futures request failed: ${error.message}`,
        upstream: url,
      }),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function fetchBybitKlines(symbol, interval = '15m', limit = '250', fetcher = fetch) {
  return fetchBybitJson({
    path: '/v5/market/kline',
    params: {
      category: 'linear',
      symbol,
      interval: INTERVAL_MAP[interval] ?? '15',
      limit: String(limit),
    },
    endpoint: 'klines',
    symbol,
    fetcher,
  });
}

export function fetchBybitTicker(symbol, fetcher = fetch) {
  return fetchBybitJson({
    path: '/v5/market/tickers',
    params: {
      category: 'linear',
      symbol,
    },
    endpoint: 'ticker',
    symbol,
    fetcher,
  });
}
