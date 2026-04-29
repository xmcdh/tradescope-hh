import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateIndicators } from '../lib/indicators';
import {
  CANDLE_POLL_MS,
  fetchBinanceBatchPrices,
  fetchBinanceMarketSnapshot,
  getSourceLabel,
  getSourceMode,
  isPairUnavailableError,
  isRateLimitedError,
  PRICE_POLL_MS,
  RATE_LIMIT_BACKOFF_MS,
  TIMEFRAME,
} from '../lib/marketData';
import { buildSignalSetup } from '../lib/signalLogic';

function hydrateSnapshot(snapshot) {
  const indicators = calculateIndicators(snapshot.candles ?? []);
  const liveIndicators = indicators
    ? {
        ...indicators,
        price: snapshot.latestPrice ?? indicators.price,
        change24h: snapshot.priceChange24h ?? indicators.change24h,
      }
    : null;

  return {
    ...snapshot,
    indicators: liveIndicators,
    setup: buildSignalSetup(liveIndicators),
  };
}

function createBaseSnapshot(symbol) {
  return {
    symbol,
    candles: [],
    latestPrice: null,
    priceChange24h: null,
    exchange: getSourceLabel(),
    mode: getSourceMode(),
    timeframe: TIMEFRAME,
    updatedAt: null,
    loading: true,
    error: '',
    warning: '',
    retryAt: null,
    indicators: null,
    setup: null,
  };
}

function mergeSnapshot(current, patch) {
  return hydrateSnapshot({
    ...current,
    ...patch,
  });
}

function formatRetryWarning(retryAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return `Binance rate limited, retrying in ${seconds}s`;
}

export function useWatchlistMarketData(symbols) {
  const [snapshots, setSnapshots] = useState({});
  const retryAtRef = useRef(0);

  useEffect(() => {
    setSnapshots((current) => {
      const next = {};
      symbols.forEach((symbol) => {
        next[symbol] = current[symbol] ?? hydrateSnapshot(createBaseSnapshot(symbol));
      });
      return next;
    });
  }, [symbols]);

  useEffect(() => {
    let cancelled = false;
    let priceIntervalId = null;
    let candleIntervalId = null;
    let warningIntervalId = null;

    const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());

    async function syncCandles() {
      const results = await Promise.allSettled(
        normalizedSymbols.map(async (symbol) => {
          const snapshot = await fetchBinanceMarketSnapshot(symbol);
          return { symbol, snapshot };
        }),
      );

      if (cancelled) {
        return;
      }

      setSnapshots((current) => {
        const next = { ...current };

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            const { symbol, snapshot } = result.value;
            next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
              candles: snapshot.candles,
              latestPrice: snapshot.latestPrice,
              priceChange24h: snapshot.change24h,
              exchange: getSourceLabel(),
              mode: getSourceMode(),
              updatedAt: current[symbol]?.updatedAt ?? snapshot.updatedAt,
              loading: false,
              error: '',
              warning: current[symbol]?.retryAt ? formatRetryWarning(current[symbol].retryAt) : '',
              retryAt: current[symbol]?.retryAt ?? null,
            });
            return;
          }

          const symbol = normalizedSymbols[index];
          const error = result.reason;
          next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
            loading: false,
            error: error.message,
          });
        });

        return next;
      });
    }

    async function syncBatchPrices() {
      if (!normalizedSymbols.length || Date.now() < retryAtRef.current) {
        return;
      }

      try {
        const quotes = await fetchBinanceBatchPrices(normalizedSymbols);
        if (cancelled) {
          return;
        }

        retryAtRef.current = 0;
        setSnapshots((current) => {
          const next = { ...current };

          normalizedSymbols.forEach((symbol) => {
            const quote = quotes[symbol];
            const currentSnapshot = current[symbol] ?? createBaseSnapshot(symbol);

            next[symbol] = mergeSnapshot(currentSnapshot, {
              latestPrice: quote?.price ?? currentSnapshot.latestPrice,
              exchange: getSourceLabel(),
              mode: getSourceMode(),
              updatedAt: quote?.updatedAt ?? currentSnapshot.updatedAt,
              loading: false,
              error: quote ? '' : currentSnapshot.error,
              warning: '',
              retryAt: null,
            });
          });

          return next;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isRateLimitedError(error)) {
          retryAtRef.current = Date.now() + RATE_LIMIT_BACKOFF_MS;
          setSnapshots((current) => {
            const next = { ...current };
            normalizedSymbols.forEach((symbol) => {
              next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
                warning: formatRetryWarning(retryAtRef.current),
                retryAt: retryAtRef.current,
                loading: false,
              });
            });
            return next;
          });
          return;
        }

        setSnapshots((current) => {
          const next = { ...current };
          normalizedSymbols.forEach((symbol) => {
            const currentSnapshot = current[symbol] ?? createBaseSnapshot(symbol);
            next[symbol] = mergeSnapshot(currentSnapshot, {
              loading: false,
              error: isPairUnavailableError(error) ? error.message : currentSnapshot.error || error.message,
            });
          });
          return next;
        });
      }
    }

    async function bootstrap() {
      setSnapshots((current) => {
        const next = { ...current };
        normalizedSymbols.forEach((symbol) => {
          next[symbol] = hydrateSnapshot({
            ...(current[symbol] ?? createBaseSnapshot(symbol)),
            loading: true,
            error: '',
            warning: '',
            retryAt: null,
          });
        });
        return next;
      });

      await syncCandles();
      await syncBatchPrices();

      priceIntervalId = window.setInterval(syncBatchPrices, PRICE_POLL_MS);
      candleIntervalId = window.setInterval(syncCandles, CANDLE_POLL_MS);
      warningIntervalId = window.setInterval(() => {
        if (cancelled) {
          return;
        }

        setSnapshots((current) => {
          const next = { ...current };
          let changed = false;

          normalizedSymbols.forEach((symbol) => {
            const snapshot = current[symbol];
            if (!snapshot?.retryAt) {
              return;
            }

            changed = true;
            next[symbol] = mergeSnapshot(snapshot, {
              warning: snapshot.retryAt > Date.now() ? formatRetryWarning(snapshot.retryAt) : '',
              retryAt: snapshot.retryAt > Date.now() ? snapshot.retryAt : null,
            });
          });

          return changed ? next : current;
        });
      }, 1000);
    }

    bootstrap();

    return () => {
      cancelled = true;
      window.clearInterval(priceIntervalId);
      window.clearInterval(candleIntervalId);
      window.clearInterval(warningIntervalId);
    };
  }, [symbols]);

  return useMemo(() => snapshots, [snapshots]);
}
