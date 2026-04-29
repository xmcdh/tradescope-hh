import { useEffect, useMemo, useState } from 'react';
import { DATA_STALE_SIGNAL_MS, MARKET_ERROR_TYPES } from '../lib/marketData';

const PROXY = import.meta.env.DEV ? 'http://localhost:3001' : '';
const HEALTH_POLL_MS = 30000;
const TEST_SYMBOL = 'BTCUSDT';

const ENDPOINTS = [
  { key: 'binance-klines', source: 'Binance Futures', sourceId: 'binance_futures', endpoint: 'Klines', path: `/api/klines/${TEST_SYMBOL}?interval=15m&limit=5`, signalCritical: true },
  { key: 'binance-ticker', source: 'Binance Futures', sourceId: 'binance_futures', endpoint: 'Ticker', path: `/api/ticker/${TEST_SYMBOL}` },
  { key: 'binance-funding', source: 'Binance Futures', sourceId: 'binance_futures', endpoint: 'Funding', path: `/api/funding/${TEST_SYMBOL}` },
  { key: 'binance-oi', source: 'Binance Futures', sourceId: 'binance_futures', endpoint: 'Open Interest', path: `/api/openinterest/${TEST_SYMBOL}` },
  { key: 'bybit-klines', source: 'Bybit', sourceId: 'bybit_futures', endpoint: 'Klines', path: `/api/bybit/klines/${TEST_SYMBOL}?interval=15m&limit=5`, signalCritical: true },
  { key: 'bybit-ticker', source: 'Bybit', sourceId: 'bybit_futures', endpoint: 'Ticker', path: `/api/bybit/ticker/${TEST_SYMBOL}` },
];

function statusFromErrorType(errorType) {
  if (errorType === MARKET_ERROR_TYPES.NETWORK_BLOCKED) {
    return 'BLOCKED';
  }

  if (errorType === MARKET_ERROR_TYPES.UPSTREAM_TIMEOUT) {
    return 'TIMEOUT';
  }

  if (errorType === MARKET_ERROR_TYPES.STALE_DATA) {
    return 'STALE';
  }

  return 'FAILED';
}

async function checkEndpoint(endpoint) {
  const response = await fetch(`${PROXY}${endpoint.path}`);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = {
      ok: false,
      errorType: MARKET_ERROR_TYPES.INVALID_JSON,
      message: 'Proxy returned invalid JSON',
    };
  }

  if (response.ok && payload?.ok !== false) {
    return {
      status: 'OK',
      errorType: null,
      message: 'OK',
      responseSource: payload?.source ?? endpoint.sourceId,
      at: Date.now(),
    };
  }

  return {
    status: statusFromErrorType(payload?.errorType),
    errorType: payload?.errorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
    message: payload?.message ?? `HTTP ${response.status}`,
    responseSource: payload?.source ?? endpoint.sourceId,
    at: Date.now(),
  };
}

export function useMarketDataHealth() {
  const [rows, setRows] = useState(() =>
    ENDPOINTS.map((endpoint) => ({
      ...endpoint,
      status: 'STALE',
      lastSuccessAt: null,
      lastErrorAt: null,
      errorType: MARKET_ERROR_TYPES.STALE_DATA,
      message: 'Not checked yet',
      responseSource: endpoint.sourceId,
    })),
  );

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function refresh() {
      const results = await Promise.allSettled(ENDPOINTS.map(checkEndpoint));
      if (cancelled) {
        return;
      }

      setRows((current) =>
        ENDPOINTS.map((endpoint, index) => {
          const previous = current.find((row) => row.key === endpoint.key);
          const result = results[index];
          const value =
            result.status === 'fulfilled'
              ? result.value
              : {
                  status: 'FAILED',
                  errorType: MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
                  message: result.reason?.message ?? 'Health check failed',
                  responseSource: endpoint.sourceId,
                  at: Date.now(),
                };

          if (value.status === 'OK') {
            return {
              ...endpoint,
              status: 'OK',
              lastSuccessAt: value.at,
              lastErrorAt: previous?.lastErrorAt ?? null,
              errorType: null,
              message: 'OK',
              responseSource: value.responseSource,
            };
          }

          const lastSuccessAt = previous?.lastSuccessAt ?? null;
          const staleStatus =
            lastSuccessAt && Date.now() - lastSuccessAt > DATA_STALE_SIGNAL_MS && value.status === 'FAILED'
              ? 'STALE'
              : value.status;

          return {
            ...endpoint,
            status: staleStatus,
            lastSuccessAt,
            lastErrorAt: value.at,
            errorType: value.errorType,
            message: value.message,
            responseSource: value.responseSource,
          };
        }),
      );
    }

    refresh();
    intervalId = window.setInterval(refresh, HEALTH_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return useMemo(() => {
    const successful = rows.filter((row) => row.status === 'OK');
    const signalSource = rows.find((row) => row.signalCritical && row.status === 'OK');
    const lastSuccessfulUpdate = successful
      .map((row) => row.lastSuccessAt)
      .filter(Boolean)
      .sort((left, right) => right - left)[0] ?? null;
    const signalAllowed = Boolean(signalSource);
    const allFailed = rows.length > 0 && rows.every((row) => row.status !== 'OK');

    return {
      rows,
      summary: {
        activeDataSource: signalSource?.source ?? successful[0]?.source ?? 'None',
        lastSuccessfulUpdate,
        freshnessStatus: signalAllowed ? 'Fresh futures candles available' : 'Market data unavailable',
        signalAllowed,
        allFailed,
        message: allFailed
          ? 'Market data unavailable. Signals disabled until fresh futures data is restored.'
          : signalAllowed
            ? 'Signal generation allowed from fresh futures candles.'
            : 'Price-only or partial data available. Signal generation disabled.',
      },
    };
  }, [rows]);
}
