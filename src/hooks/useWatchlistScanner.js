import { useMemo } from 'react';
import { useWatchlistMarketData } from './useWatchlistMarketData';
import { scanSymbol, rankScans } from '../lib/marketScanner';

export function useWatchlistScanner(symbols, signalMode = 'conservative', refreshToken = 0) {
  const effectiveSymbols = useMemo(() => [...symbols], [symbols, refreshToken]);
  const snapshots = useWatchlistMarketData(effectiveSymbols, '15m', signalMode);

  const scans = useMemo(() => {
    const rows = Object.values(snapshots).map((snapshot) => {
      const derivatives = {
        ...snapshot?.derivatives,
        fundingRate: snapshot?.fundingRate ?? null,
        funding: snapshot?.fundingRate ?? null,
      };
      const scan = scanSymbol({
        symbol: snapshot.symbol,
        candles4h: snapshot.contextCandles ?? [],
        candles15m: snapshot.setupCandles ?? [],
        derivatives,
        btcContext: snapshot.btcContext ?? null,
      });
      return {
        ...scan,
        loading: Boolean(snapshot.loading),
        error: snapshot.error ?? '',
        errorType: snapshot.errorType ?? null,
        exchange: snapshot.exchange ?? 'Binance',
        updatedAt: snapshot.updatedAt ?? null,
        marketSnapshot: snapshot,
      };
    });
    return rankScans(rows);
  }, [snapshots]);

  const bySymbol = useMemo(() => Object.fromEntries(scans.map((scan) => [scan.symbol, scan])), [scans]);
  return useMemo(() => ({ snapshots, scans, bySymbol }), [snapshots, scans, bySymbol]);
}
