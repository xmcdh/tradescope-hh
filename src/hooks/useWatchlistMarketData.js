import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateIndicators } from '../lib/indicators';
import {
  CANDLE_POLL_MS,
  fetchCoinGeckoBatchPrices,
  fetchCoinGeckoMarketSnapshot,
  getCoinbaseProduct,
  getCoinGeckoMeta,
  isPairUnavailableError,
  isRateLimitedError,
  PRICE_POLL_MS,
  RATE_LIMIT_BACKOFF_MS,
  subscribeCoinbaseTicker,
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
  const coinbaseProduct = getCoinbaseProduct(symbol);
  return {
    symbol,
    candles: [],
    latestPrice: null,
    priceChange24h: null,
    exchange: coinbaseProduct ? 'Coinbase' : 'CoinGecko',
    mode: coinbaseProduct ? 'stream' : 'polling',
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
  return `Rate limited — retrying in ${seconds}s`;
}

export function useWatchlistMarketData(symbols) {
  const [snapshots, setSnapshots] = useState({});
  const retryAtRef = useRef(0);
  const wsLiveSymbolsRef = useRef(new Set());

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
    let coinbaseSocket = null;
    let priceIntervalId = null;
    let candleIntervalId = null;
    let warningIntervalId = null;

    const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());

    async function syncCandles() {
      const results = await Promise.allSettled(
        normalizedSymbols.map(async (symbol) => {
          const snapshot = await fetchCoinGeckoMarketSnapshot(symbol);
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
            const hasWsPrice = wsLiveSymbolsRef.current.has(symbol);
            next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
              candles: snapshot.candles,
              latestPrice: hasWsPrice ? current[symbol]?.latestPrice ?? snapshot.latestPrice : snapshot.latestPrice,
              priceChange24h: snapshot.change24h,
              exchange: hasWsPrice ? 'Coinbase' : 'CoinGecko',
              mode: hasWsPrice ? 'stream' : 'polling',
              updatedAt: hasWsPrice ? current[symbol]?.updatedAt ?? snapshot.updatedAt : snapshot.updatedAt,
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

    async function syncCoinGeckoBatchPrices() {
      if (!normalizedSymbols.length || Date.now() < retryAtRef.current) {
        return;
      }

      try {
        const quotes = await fetchCoinGeckoBatchPrices(normalizedSymbols);
        if (cancelled) {
          return;
        }

        retryAtRef.current = 0;
        setSnapshots((current) => {
          const next = { ...current };

          normalizedSymbols.forEach((symbol) => {
            const quote = quotes[symbol];
            const currentSnapshot = current[symbol] ?? createBaseSnapshot(symbol);
            const hasWsPrice = wsLiveSymbolsRef.current.has(symbol);

            next[symbol] = mergeSnapshot(currentSnapshot, {
              latestPrice: hasWsPrice ? currentSnapshot.latestPrice : quote?.price ?? currentSnapshot.latestPrice,
              priceChange24h: quote?.change24h ?? currentSnapshot.priceChange24h,
              exchange: hasWsPrice ? 'Coinbase' : 'CoinGecko',
              mode: hasWsPrice ? 'stream' : 'polling',
              updatedAt: hasWsPrice ? currentSnapshot.updatedAt : quote?.updatedAt ?? currentSnapshot.updatedAt,
              loading: false,
              error: currentSnapshot.error === 'Coinbase websocket connection failed' ? '' : currentSnapshot.error,
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

    function startCoinbaseStream() {
      const streamSymbols = normalizedSymbols.filter((symbol) => Boolean(getCoinbaseProduct(symbol)));
      if (!streamSymbols.length) {
        return;
      }

      coinbaseSocket = subscribeCoinbaseTicker(streamSymbols, {
        onTicker: ({ symbol, price, updatedAt, change24h }) => {
          if (cancelled) {
            return;
          }

          wsLiveSymbolsRef.current.add(symbol);
          setSnapshots((current) => ({
            ...current,
            [symbol]: mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
              latestPrice: price,
              priceChange24h: change24h ?? current[symbol]?.priceChange24h,
              exchange: 'Coinbase',
              mode: 'stream',
              updatedAt,
              loading: false,
              error: '',
            }),
          }));
        },
        onError: (error) => {
          if (cancelled) {
            return;
          }

          wsLiveSymbolsRef.current = new Set();
          setSnapshots((current) => {
            const next = { ...current };
            streamSymbols.forEach((symbol) => {
              next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
                exchange: 'CoinGecko',
                mode: 'polling',
                loading: false,
                error: '',
                warning: error.message,
              });
            });
            return next;
          });
        },
        onClose: () => {
          if (cancelled) {
            return;
          }

          wsLiveSymbolsRef.current = new Set();
          setSnapshots((current) => {
            const next = { ...current };
            streamSymbols.forEach((symbol) => {
              next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol), {
                exchange: 'CoinGecko',
                mode: 'polling',
                loading: false,
              });
            });
            return next;
          });
        },
      });
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
      await syncCoinGeckoBatchPrices();
      startCoinbaseStream();

      priceIntervalId = window.setInterval(syncCoinGeckoBatchPrices, PRICE_POLL_MS);
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
      coinbaseSocket?.close();
      window.clearInterval(priceIntervalId);
      window.clearInterval(candleIntervalId);
      window.clearInterval(warningIntervalId);
    };
  }, [symbols]);

  return useMemo(() => snapshots, [snapshots]);
}
