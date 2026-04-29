export const ALLOWED_BINANCE_ENDPOINTS = new Set(['klines', 'ticker/24hr', 'ticker/price']);

const UPSTREAMS = [
  'https://data-api.binance.vision',
  'https://api-gcp.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
  'https://api.binance.com',
];

function buildUrl(baseUrl, endpoint, params) {
  const query = new URLSearchParams(params).toString();
  return `${baseUrl}/api/v3/${endpoint}?${query}`;
}

function shouldTryNextUpstream(status) {
  return status === 403 || status === 451 || status === 502 || status === 503 || status === 504;
}

export async function fetchBinanceEndpoint(endpoint, params, fetcher = fetch) {
  if (!endpoint || !ALLOWED_BINANCE_ENDPOINTS.has(endpoint)) {
    return {
      status: 400,
      contentType: 'application/json',
      text: JSON.stringify({ error: 'Endpoint not allowed' }),
      upstream: null,
    };
  }

  const attempts = [];

  for (const upstream of UPSTREAMS) {
    const response = await fetcher(buildUrl(upstream, endpoint, params), {
      headers: { 'User-Agent': 'TradeScope/1.0' },
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    attempts.push({ upstream, status: response.status });

    if (response.ok || !shouldTryNextUpstream(response.status)) {
      return {
        status: response.status,
        contentType,
        text,
        upstream,
      };
    }
  }

  return {
    status: 502,
    contentType: 'application/json',
    text: JSON.stringify({
      error: 'All Binance upstreams rejected the request',
      attempts,
    }),
    upstream: null,
  };
}

export async function fetchBinanceBatchPrices(symbols, fetcher = fetch) {
  return Promise.all(
    symbols.map(async (symbol) => {
      const result = await fetchBinanceEndpoint('ticker/price', { symbol }, fetcher);

      if (result.status < 200 || result.status >= 300) {
        return {
          symbol,
          error: `HTTP ${result.status}`,
          upstream: result.upstream,
        };
      }

      return {
        ...JSON.parse(result.text),
        upstream: result.upstream,
      };
    }),
  );
}
