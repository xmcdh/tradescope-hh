export const ALLOWED_BINANCE_ENDPOINTS = new Set([
  'klines',
  'ticker/24hr',
  'ticker/price',
  'premiumIndex',
  'openInterest',
  'fundingRate',
  'openInterestHist',
  'globalLongShortAccountRatio',
  'takerlongshortRatio',
]);

export const ERROR_TYPES = {
  NETWORK_BLOCKED: 'NETWORK_BLOCKED',
  TLS_ERROR: 'TLS_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_HTML_RESPONSE: 'UPSTREAM_HTML_RESPONSE',
  INVALID_JSON: 'INVALID_JSON',
  RATE_LIMITED: 'RATE_LIMITED',
  STALE_DATA: 'STALE_DATA',
  UNKNOWN_UPSTREAM_ERROR: 'UNKNOWN_UPSTREAM_ERROR',
};

const FUTURES_API_BASE_URL = 'https://fapi.binance.com';
const FETCH_TIMEOUT_MS = 8000;

function buildUrl(endpoint, params) {
  const query = new URLSearchParams(params).toString();
  return `${FUTURES_API_BASE_URL}/fapi/v1/${endpoint}?${query}`;
}

function shouldTryNextUpstream(status) {
  return status === 403 || status === 451 || status === 502 || status === 503 || status === 504;
}

export function isBlockedHtml(text, contentType = '') {
  const normalized = String(text ?? '').toLowerCase();
  return (
    normalized.includes('situs diblokir') ||
    normalized.includes('karena mengandung konten') ||
    normalized.includes('internetsehat') ||
    normalized.includes('kominfo')
  );
}

export function isHtmlResponse(text, contentType = '') {
  const normalized = String(text ?? '').trim().toLowerCase();
  return contentType.includes('text/html') || normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

function isTlsError(error) {
  const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`.toLowerCase();
  return message.includes('certificate') || message.includes('unable to get local issuer') || message.includes('tls');
}

export function buildErrorPayload({
  source = 'binance_futures',
  endpoint,
  symbol,
  errorType,
  message,
  upstream = FUTURES_API_BASE_URL,
}) {
  return {
    ok: false,
    source,
    endpoint,
    symbol: symbol ?? null,
    errorType,
    message,
    upstream,
    timestamp: new Date().toISOString(),
    signalAllowed: false,
  };
}

function errorResult(payload, status = 502) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    text: JSON.stringify(payload),
    upstream: payload.upstream ?? null,
  };
}

export async function fetchBinanceEndpoint(endpoint, params, fetcher = fetch) {
  if (!endpoint || !ALLOWED_BINANCE_ENDPOINTS.has(endpoint)) {
    return errorResult(
      buildErrorPayload({
        endpoint: endpoint ?? 'unknown',
        symbol: params?.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Endpoint not allowed',
        upstream: null,
      }),
      400,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  let text;
  let contentType;

  try {
    response = await fetcher(buildUrl(endpoint, params), {
      headers: { 'User-Agent': 'TradeScope/1.0' },
      signal: controller.signal,
    });
    text = await response.text();
    contentType = response.headers.get('content-type') || 'application/json';

    if (isBlockedHtml(text, contentType)) {
      return errorResult(buildErrorPayload({
        endpoint,
        symbol: params?.symbol,
        errorType: ERROR_TYPES.NETWORK_BLOCKED,
        message: 'Binance Futures upstream returned blocked HTML instead of market JSON',
      }));
    }

    if (isHtmlResponse(text, contentType)) {
      return errorResult(buildErrorPayload({
        endpoint,
        symbol: params?.symbol,
        errorType: ERROR_TYPES.UPSTREAM_HTML_RESPONSE,
        message: 'Binance Futures upstream returned HTML instead of market JSON',
      }));
    }
  } catch (error) {
    const errorType =
      error?.name === 'AbortError'
        ? ERROR_TYPES.UPSTREAM_TIMEOUT
        : isTlsError(error)
          ? ERROR_TYPES.TLS_ERROR
          : ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR;
    const message =
      error?.name === 'AbortError'
        ? `Binance Futures request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : `Binance Futures request failed: ${error.message}`;

    return errorResult(buildErrorPayload({ endpoint, symbol: params?.symbol, errorType, message }));
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    return errorResult(buildErrorPayload({
      endpoint,
      symbol: params?.symbol,
      errorType: ERROR_TYPES.RATE_LIMITED,
      message: 'Binance Futures rate limit reached',
    }), 429);
  }

  if (response.ok || !shouldTryNextUpstream(response.status)) {
    return { status: response.status, contentType, text, upstream: FUTURES_API_BASE_URL };
  }

  return errorResult(buildErrorPayload({
    endpoint,
    symbol: params?.symbol,
    errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
    message: 'All Binance upstreams rejected the request',
    upstream: null,
  }));
}

export async function fetchBinanceFunding(symbol, fetcher = fetch) {
  return fetchBinanceEndpoint('premiumIndex', { symbol }, fetcher);
}

export async function fetchBinanceOpenInterest(symbol, fetcher = fetch) {
  return fetchBinanceEndpoint('openInterest', { symbol }, fetcher);
}

export async function fetchBinanceBatchPrices(symbols, fetcher = fetch) {
  return Promise.all(symbols.map(async (symbol) => {
    const result = await fetchBinanceEndpoint('ticker/price', { symbol }, fetcher);
    if (result.status < 200 || result.status >= 300) {
      return { symbol, error: `HTTP ${result.status}`, upstream: result.upstream };
    }
    return { ...JSON.parse(result.text), upstream: result.upstream };
  }));
}
