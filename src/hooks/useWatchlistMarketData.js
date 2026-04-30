import { useEffect, useMemo, useRef, useState } from 'react';
import { BTC_CONTEXT_POLL_MS, fetchBtcContext } from '../lib/btcContext';
import { calculateIndicators } from '../lib/indicators';
import {
  AVOID_PAIR_REASON,
  CANDLE_POLL_MS,
  DATA_STALE_SIGNAL_MS,
  fetchBinanceBatchPrices,
  fetchBinanceMarketSnapshot,
  getSourceLabel,
  getSourceMode,
  getWatchlistMeta,
  isAvoidSymbol,
  isPairUnavailableError,
  isRateLimitedError,
  MARKET_ERROR_TYPES,
  PRICE_POLL_MS,
  RATE_LIMIT_BACKOFF_MS,
  TIMEFRAME,
  normalizeTimeframe,
} from '../lib/marketData';
import { buildSignalSetup } from '../lib/signalLogic';

function buildAvoidSetup(indicators, meta) {
  return {
    signal: 'AVOID',
    marketRegime: 'AVOID',
    trend: 'NEUTRAL',
    longScore: 0,
    shortScore: 0,
    score: 0,
    confidenceScore: 0,
    scoreMax: 10,
    signalValidity: 'MARGINAL',
    confidence: { label: 'LOW' },
    scoreBreakdown: {
      total: 0,
      max: 10,
      breakdown: {
        trend: 0,
        rsiMomentum: 0,
        macd: 0,
        volume: 0,
        levelLong: 0,
        levelShort: 0,
        rsiFilter: 0,
        rrRatio: 0,
        candleStructure: 0,
        marketStructure: 0,
      },
      rawTotal: 0,
      technicalTotal: 0,
      btcAdjustment: 0,
      fundingOiAdjustment: 0,
      adjustmentTotal: 0,
      status: 'AVOID',
      items: [],
      adjustments: [],
      hardBlock: AVOID_PAIR_REASON,
      warnings: [AVOID_PAIR_REASON],
    },
    candidates: null,
    hardBlock: AVOID_PAIR_REASON,
    rrWarning: null,
    levelWarning: null,
    warnings: [AVOID_PAIR_REASON],
    stale: Boolean(indicators?.stale),
    lastUpdate: indicators?.lastUpdate ?? null,
    blockedReason: [],
    dataValid: true,
    invalidReason: null,
    btcBias: null,
    btcRSI: null,
    btcConfirmation: false,
    btcNote: null,
    marketStructure: null,
    entryContext: 'AVOID',
    entryAdvice: AVOID_PAIR_REASON,
    rejectionReasons: [AVOID_PAIR_REASON],
    action: 'No entry recommended. Pair is blacklisted for this dashboard.',
    watchLevels: null,
    tradeLevelsVisible: false,
    rr: null,
    rrRatio: null,
    atr: null,
    layers: {},
    basis: [],
    entry1: null,
    entry2: null,
    tp1: null,
    tp2: null,
    sl: null,
    tp1Price: null,
    tp2Price: null,
    slPrice: null,
    watchlistStatus: meta.status,
    watchlistTier: meta.tier,
  };
}

function buildUnavailableSetup(snapshot, indicators) {
  const blocked = snapshot.errorType === MARKET_ERROR_TYPES.NETWORK_BLOCKED;
  const priceOnly = snapshot.dataQuality === 'PRICE_ONLY';
  const reason = blocked
    ? 'Market data blocked by current network'
    : priceOnly
      ? 'Insufficient futures candle data. Price-only fallback cannot generate futures signals.'
      : snapshot.error || 'Market data unavailable';

  return {
    signal: 'NO_TRADE',
    marketRegime: blocked ? 'MARKET_DATA_BLOCKED' : 'DATA_UNAVAILABLE',
    trend: 'NEUTRAL',
    longScore: 0,
    shortScore: 0,
    score: 0,
    confidenceScore: 0,
    scoreMax: 10,
    signalValidity: 'BLOCKED',
    confidence: { label: 'LOW' },
    scoreBreakdown: {
      total: 0,
      max: 10,
      technicalTotal: 0,
      adjustmentTotal: 0,
      breakdown: {},
      items: [],
      adjustments: [
        { key: 'btc', label: 'BTC Confirmation', points: 0, max: 1, passed: false, reason: 'Disabled without fresh futures candles.' },
        { key: 'fundingOi', label: 'Funding/OI', points: 0, max: 1, passed: false, reason: 'Disabled without fresh futures candles.' },
      ],
      rawTotal: 0,
      btcAdjustment: 0,
      fundingOiAdjustment: 0,
      status: 'NO_TRADE',
      hardBlock: reason,
      warnings: [reason],
    },
    warnings: [
      reason,
      blocked ? 'Binance/Bybit did not return valid futures JSON.' : null,
      'Signal generation disabled for safety.',
    ].filter(Boolean),
    blockedReason: [
      reason,
      blocked ? 'Binance/Bybit did not return valid futures JSON.' : null,
      'Signal generation disabled for safety.',
    ].filter(Boolean),
    rejectionReasons: [
      reason,
      blocked ? 'Binance/Bybit did not return valid futures JSON.' : null,
      'Signal generation disabled for safety.',
    ].filter(Boolean),
    hardBlock: reason,
    stale: true,
    dataValid: false,
    invalidReason: snapshot.errorType ?? 'market_data_unavailable',
    entryContext: 'NO_TRADE',
    entryAdvice: 'No entry recommended.',
    action: blocked
      ? 'Try another network or deploy proxy to cloud. Do not trade from stale data.'
      : 'Wait until fresh futures candle data is restored.',
    tradeLevelsVisible: false,
    watchLevels: null,
    rr: null,
    rrRatio: null,
    rrTp1: null,
    rrTp2: null,
    atr: indicators?.atr ?? null,
    basis: [],
    entry1: null,
    entry2: null,
    tp1: null,
    tp2: null,
    sl: null,
    selectedDirection: null,
  };
}

function hydrateSnapshot(snapshot, btcContext = snapshot.btcContext ?? null, signalMode = snapshot.signalMode ?? 'conservative') {
  const watchlistMeta = getWatchlistMeta(snapshot.symbol);
  const priceFeedStale = snapshot.updatedAt ? Date.now() - snapshot.updatedAt > DATA_STALE_SIGNAL_MS : true;
  const indicators = calculateIndicators(snapshot.candles ?? [], snapshot.timeframe);
  const liveIndicators = indicators
    ? {
        ...indicators,
        price: snapshot.latestPrice ?? indicators.price,
        change24h: snapshot.priceChange24h ?? indicators.change24h,
        stale: Boolean(indicators.stale || priceFeedStale || snapshot.error),
        feedStale: Boolean(priceFeedStale),
        dataError: snapshot.error ?? '',
        fundingRate: snapshot.fundingRate ?? null,
        fundingUpdatedAt: snapshot.fundingUpdatedAt ?? null,
        nextFundingTime: snapshot.nextFundingTime ?? null,
        openInterest: snapshot.openInterest ?? null,
        openInterestChange: snapshot.openInterestChange ?? null,
        openInterestUpdatedAt: snapshot.openInterestUpdatedAt ?? null,
        derivativesWarning: snapshot.derivativesWarning ?? '',
        dataQuality: snapshot.dataQuality ?? 'FUTURES_CANDLES',
        candleErrorType: snapshot.candleErrorType ?? null,
      }
    : Number.isFinite(snapshot.latestPrice)
      ? {
          price: snapshot.latestPrice,
          change24h: snapshot.priceChange24h ?? null,
          valid: false,
          reason: 'insufficient_data',
          stale: Boolean(priceFeedStale || snapshot.error),
          feedStale: Boolean(priceFeedStale),
          dataError: snapshot.error ?? '',
          fundingRate: snapshot.fundingRate ?? null,
          openInterest: snapshot.openInterest ?? null,
          openInterestChange: snapshot.openInterestChange ?? null,
          derivativesWarning: snapshot.derivativesWarning ?? '',
          dataQuality: snapshot.dataQuality ?? 'PRICE_ONLY',
          candleErrorType: snapshot.candleErrorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        }
      : null;

  return {
    ...snapshot,
    watchlistMeta,
    btcContext,
    indicators: liveIndicators,
    setup:
      watchlistMeta.status === 'avoid'
        ? buildAvoidSetup(liveIndicators, watchlistMeta)
        : snapshot.error || snapshot.dataQuality === 'PRICE_ONLY'
          ? buildUnavailableSetup(snapshot, liveIndicators)
        : buildSignalSetup(liveIndicators, {
            symbol: snapshot.symbol,
            btcContext,
            signalMode,
          }),
  };
}

function createBaseSnapshot(symbol, timeframe = TIMEFRAME, signalMode = 'conservative') {
  const watchlistMeta = getWatchlistMeta(symbol);

  return {
    symbol,
    watchlistMeta,
    candles: [],
    latestPrice: null,
    priceChange24h: null,
    exchange: getSourceLabel(),
    mode: getSourceMode(),
    timeframe: normalizeTimeframe(timeframe),
    updatedAt: null,
    loading: true,
    error: '',
    errorType: null,
    warning: '',
    retryAt: null,
    btcContext: null,
    indicators: null,
    setup: null,
    signalMode,
  };
}

function mergeSnapshot(current, patch, btcContext = patch.btcContext ?? current?.btcContext ?? null, signalMode = patch.signalMode ?? current?.signalMode ?? 'conservative') {
  return hydrateSnapshot({
    ...current,
    ...patch,
    signalMode,
  }, btcContext, signalMode);
}

function formatRetryWarning(retryAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return `Binance rate limited, retrying in ${seconds}s`;
}

export function useWatchlistMarketData(symbols, timeframe = TIMEFRAME, signalMode = 'conservative') {
  const [snapshots, setSnapshots] = useState({});
  const retryAtRef = useRef(0);
  const btcContextRef = useRef(null);
  const normalizedTimeframe = normalizeTimeframe(timeframe);

  useEffect(() => {
    setSnapshots((current) => {
      const next = {};
      symbols.forEach((symbol) => {
        const currentSnapshot = current[symbol];
        next[symbol] =
          currentSnapshot?.timeframe === normalizedTimeframe && currentSnapshot?.signalMode === signalMode
            ? currentSnapshot
            : hydrateSnapshot({ ...(currentSnapshot ?? createBaseSnapshot(symbol, normalizedTimeframe, signalMode)), timeframe: normalizedTimeframe, signalMode }, undefined, signalMode);
      });
      return next;
    });
  }, [normalizedTimeframe, signalMode, symbols]);

  useEffect(() => {
    let cancelled = false;
    let priceIntervalId = null;
    let candleIntervalId = null;
    let btcContextIntervalId = null;
    let warningIntervalId = null;

    const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());
    const activeSymbols = normalizedSymbols.filter((symbol) => !isAvoidSymbol(symbol));

    async function syncCandles() {
      const results = await Promise.allSettled(
        activeSymbols.map(async (symbol) => {
          const snapshot = await fetchBinanceMarketSnapshot(symbol, normalizedTimeframe);
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
            next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe), {
              candles: snapshot.candles,
              timeframe: snapshot.timeframe,
              latestPrice: snapshot.latestPrice,
              priceChange24h: snapshot.change24h,
              fundingRate: snapshot.fundingRate,
              fundingUpdatedAt: snapshot.fundingUpdatedAt,
              nextFundingTime: snapshot.nextFundingTime,
              openInterest: snapshot.openInterest,
              openInterestChange:
                Number.isFinite(snapshot.openInterest) && Number.isFinite(current[symbol]?.openInterest)
                  ? ((snapshot.openInterest - current[symbol].openInterest) / current[symbol].openInterest) * 100
                  : null,
              openInterestUpdatedAt: snapshot.openInterestUpdatedAt,
              derivativesWarning: snapshot.derivativesWarning,
              dataQuality: snapshot.dataQuality,
              candleErrorType: snapshot.candleErrorType,
              exchange: getSourceLabel(),
              mode: getSourceMode(),
              updatedAt: current[symbol]?.updatedAt ?? snapshot.updatedAt,
              loading: false,
              error: '',
              warning: current[symbol]?.retryAt ? formatRetryWarning(current[symbol].retryAt) : '',
              retryAt: current[symbol]?.retryAt ?? null,
              signalMode,
            }, btcContextRef.current, signalMode);
            return;
          }

          const symbol = activeSymbols[index];
          const error = result.reason;
          next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe), {
            loading: false,
            error: error.message,
            errorType: error.errorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
            signalMode,
          }, btcContextRef.current, signalMode);
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
            const currentSnapshot = current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe);

            next[symbol] = mergeSnapshot(currentSnapshot, {
              latestPrice: quote?.price ?? currentSnapshot.latestPrice,
              exchange: getSourceLabel(),
              mode: getSourceMode(),
              updatedAt: quote?.updatedAt ?? currentSnapshot.updatedAt,
              loading: false,
              error: quote ? '' : currentSnapshot.error,
              errorType: quote ? null : currentSnapshot.errorType,
              warning: '',
              retryAt: null,
              signalMode,
            }, btcContextRef.current, signalMode);
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
              next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe), {
                warning: formatRetryWarning(retryAtRef.current),
                retryAt: retryAtRef.current,
                loading: false,
                signalMode,
              }, btcContextRef.current, signalMode);
            });
            return next;
          });
          return;
        }

        setSnapshots((current) => {
          const next = { ...current };
          normalizedSymbols.forEach((symbol) => {
            const currentSnapshot = current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe);
            next[symbol] = mergeSnapshot(currentSnapshot, {
              loading: false,
              error: isPairUnavailableError(error) ? error.message : currentSnapshot.error || error.message,
              errorType: error.errorType ?? MARKET_ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
              signalMode,
            }, btcContextRef.current, signalMode);
          });
          return next;
        });
      }
    }

    async function syncBtcContext() {
      try {
        const btcContext = await fetchBtcContext();
        if (cancelled) {
          return;
        }

        btcContextRef.current = btcContext;
        setSnapshots((current) => {
          const next = { ...current };
          normalizedSymbols.forEach((symbol) => {
            next[symbol] = mergeSnapshot(current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe), {
              btcContext,
              signalMode,
            }, btcContext, signalMode);
          });
          return next;
        });
      } catch {
        if (cancelled) {
          return;
        }

        btcContextRef.current = null;
      }
    }

    async function bootstrap() {
      setSnapshots((current) => {
        const next = { ...current };
        normalizedSymbols.forEach((symbol) => {
          next[symbol] = hydrateSnapshot({
            ...(current[symbol] ?? createBaseSnapshot(symbol, normalizedTimeframe)),
            timeframe: normalizedTimeframe,
            loading: true,
            error: '',
            warning: '',
            retryAt: null,
            signalMode,
          }, undefined, signalMode);
        });
        return next;
      });

      await syncBtcContext();
      await syncCandles();
      await syncBatchPrices();

      priceIntervalId = window.setInterval(syncBatchPrices, PRICE_POLL_MS);
      candleIntervalId = window.setInterval(syncCandles, CANDLE_POLL_MS);
      btcContextIntervalId = window.setInterval(syncBtcContext, BTC_CONTEXT_POLL_MS);
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
              signalMode,
            }, undefined, signalMode);
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
      window.clearInterval(btcContextIntervalId);
      window.clearInterval(warningIntervalId);
    };
  }, [normalizedTimeframe, signalMode, symbols]);

  return useMemo(() => snapshots, [snapshots]);
}
