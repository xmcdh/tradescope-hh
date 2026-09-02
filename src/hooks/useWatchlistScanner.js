import { useMemo } from 'react';
import { useWatchlistMarketData } from './useWatchlistMarketData';
import { scanSymbol, rankScans } from '../lib/marketScanner';

const SETUP_STALE_MS = 20 * 60 * 1000;
const CONTEXT_STALE_MS = 5 * 60 * 60 * 1000;
const OI_STALE_MS = 75 * 60 * 1000;
const DERIVATIVE_15M_STALE_MS = 20 * 60 * 1000;
const FUNDING_STALE_MS = 20 * 60 * 1000;

function isFresh(timestamp, maxAge, now) {
  return Number.isFinite(Number(timestamp)) && now - Number(timestamp) <= maxAge;
}

function buildFreshDerivatives(snapshot, now) {
  const source = snapshot?.derivatives ?? {};
  const oiFresh = isFresh(source?.openInterest?.timestamp, OI_STALE_MS, now);
  const longShortFresh = isFresh(source?.longShort?.timestamp, DERIVATIVE_15M_STALE_MS, now);
  const takerFresh = isFresh(source?.taker?.timestamp, DERIVATIVE_15M_STALE_MS, now);
  const fundingFresh = isFresh(snapshot?.fundingUpdatedAt, FUNDING_STALE_MS, now);

  return {
    ...source,
    openInterest: oiFresh ? source.openInterest : { current: null, change1hPct: null, change4hPct: null, timestamp: source?.openInterest?.timestamp ?? null },
    longShort: longShortFresh ? source.longShort : null,
    taker: takerFresh ? source.taker : null,
    fundingRate: fundingFresh ? snapshot?.fundingRate ?? null : null,
    funding: fundingFresh ? snapshot?.fundingRate ?? null : null,
    freshness: { oi: oiFresh, longShort: longShortFresh, taker: takerFresh, funding: fundingFresh },
  };
}

function applyFreshness(scan, snapshot, now) {
  const candles15mUpdatedAt = snapshot?.candles15mUpdatedAt ?? null;
  const candles4hUpdatedAt = snapshot?.candles4hUpdatedAt ?? null;
  const fresh15m = isFresh(candles15mUpdatedAt, SETUP_STALE_MS, now);
  const fresh4h = isFresh(candles4hUpdatedAt, CONTEXT_STALE_MS, now);
  const derivativeFreshness = scan.derivatives?.freshness ?? {};
  const freshDerivatives = Boolean(derivativeFreshness.oi || derivativeFreshness.longShort || derivativeFreshness.taker || derivativeFreshness.funding);
  const freshness = {
    candles15m: { updatedAt: candles15mUpdatedAt, fresh: fresh15m },
    candles4h: { updatedAt: candles4hUpdatedAt, fresh: fresh4h },
    derivatives: {
      updatedAt: snapshot?.derivativesUpdatedAt ?? null,
      fresh: freshDerivatives,
      oi: Boolean(derivativeFreshness.oi),
      longShort: Boolean(derivativeFreshness.longShort),
      taker: Boolean(derivativeFreshness.taker),
      funding: Boolean(derivativeFreshness.funding),
    },
    all: fresh15m && fresh4h,
  };

  const raw4h = scan.ranking.score4h;
  const raw15m = scan.ranking.score15m;
  const rawCombined = scan.ranking.score;
  const score4h = fresh4h ? raw4h : 0;
  const score15m = fresh15m ? raw15m : 0;
  const score = freshness.all ? rawCombined : 0;
  const quality = !fresh15m || !fresh4h
    ? '数据过期'
    : !freshDerivatives
      ? '衍生品过期'
      : scan.ranking.quality;

  return {
    ...scan,
    ranking: {
      ...scan.ranking,
      score,
      score4h,
      score15m,
      quality,
      rawScore: rawCombined,
      rawScore4h: raw4h,
      rawScore15m: raw15m,
    },
    freshness,
    marketSnapshot: snapshot,
  };
}

export function useWatchlistScanner(symbols, signalMode = 'conservative', refreshToken = 0) {
  const effectiveSymbols = useMemo(() => [...symbols], [symbols, refreshToken]);
  const snapshots = useWatchlistMarketData(effectiveSymbols, '15m', signalMode, refreshToken);
  const scans = useMemo(() => {
    const now = Date.now();
    const rows = Object.values(snapshots).map((snapshot) => {
      const derivatives = buildFreshDerivatives(snapshot, now);
      const scan = scanSymbol({
        symbol: snapshot.symbol,
        candles4h: snapshot.contextCandles ?? [],
        candles15m: snapshot.setupCandles ?? [],
        derivatives,
        btcContext: snapshot.btcContext ?? null,
      });
      return applyFreshness({
        ...scan,
        loading: Boolean(snapshot.loading),
        error: snapshot.error ?? '',
        errorType: snapshot.errorType ?? null,
        exchange: snapshot.exchange ?? 'Binance',
        updatedAt: snapshot.updatedAt ?? null,
      }, snapshot, now);
    });
    return rankScans(rows, 'all');
  }, [snapshots]);
  const bySymbol = useMemo(() => Object.fromEntries(scans.map((scan) => [scan.symbol, scan])), [scans]);
  return useMemo(() => ({ snapshots, scans, bySymbol }), [snapshots, scans, bySymbol]);
}
