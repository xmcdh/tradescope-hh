import { useEffect, useMemo, useState } from 'react';
import { getStrategyExperiment } from '../config/strategyExperiments.js';
import { calculateIndicators } from '../lib/indicators.js';
import { fetchEthConvictionData } from '../lib/marketData.js';
import { buildSignalSetup } from '../lib/signalLogic.js';

const REFRESH_MS = 5 * 60 * 1000;
const ETH_SYMBOL = 'ETHUSDT';
const ETH_PAIR = 'ETH/USDT';
const TIMEFRAME = '1h';
const V3_EXPERIMENT_ID = 'v3-failed-breakout-long-only';
const V7_EXPERIMENT_ID = 'v7-funding-rate-extreme';

function isValidSetup(setup) {
  return ['LONG', 'SHORT'].includes(setup?.signal) && setup?.signalValidity === 'VALID';
}

function normalizeSetup(strategy, setup) {
  return {
    strategy,
    signal: setup?.signal ?? 'NO_TRADE',
    score: setup?.score ?? setup?.confidenceScore ?? 0,
    scoreMax: setup?.scoreBreakdown?.max ?? setup?.scoreMax ?? 0,
    entry: setup?.entry1 ?? null,
    sl: setup?.sl ?? null,
    tp1: setup?.tp1 ?? null,
    tp2: setup?.tp2 ?? null,
    setup,
  };
}

function blockersFor(strategy, setup) {
  const reasons = setup?.blockedReason?.length
    ? setup.blockedReason
    : setup?.rejectionReasons?.length
      ? setup.rejectionReasons
      : setup?.warnings?.length
        ? setup.warnings
        : ['No valid setup for this strategy right now.'];

  return reasons.map((reason) => `${strategy}: ${reason}`);
}

function pickSignal(v3Setup, v7Setup) {
  const candidates = [normalizeSetup('v3-E', v3Setup), normalizeSetup('v7', v7Setup)].filter((item) => isValidSetup(item.setup));
  if (!candidates.length) {
    return null;
  }

  return candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0];
}

function buildNoTrade(v3Setup, v7Setup) {
  return {
    signal: 'NO_TRADE',
    strategy: null,
    score: 0,
    scoreMax: 0,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    setup: null,
    blockers: [...blockersFor('v3-E', v3Setup), ...blockersFor('v7', v7Setup)],
  };
}

export function useEthConvictionSignal() {
  const [state, setState] = useState({
    signal: 'NO_TRADE',
    strategy: null,
    score: 0,
    scoreMax: 0,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    setup: null,
    blockers: [],
    lastUpdated: null,
    isLoading: true,
    error: '',
    candles: [],
    latestFunding: null,
    fundingHistory: [],
    pair: ETH_PAIR,
    symbol: ETH_SYMBOL,
    timeframe: TIMEFRAME,
  });

  const configs = useMemo(
    () => ({
      v3: getStrategyExperiment(V3_EXPERIMENT_ID),
      v7: getStrategyExperiment(V7_EXPERIMENT_ID),
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function refresh() {
      setState((current) => ({ ...current, isLoading: true, error: '' }));

      try {
        const data = await fetchEthConvictionData();
        if (cancelled) {
          return;
        }

        const indicators = calculateIndicators(data.candles, TIMEFRAME);
        if (!indicators) {
          throw new Error('Unable to calculate ETH 1h indicators.');
        }

        const v3Setup = buildSignalSetup(indicators, {
          symbol: ETH_SYMBOL,
          signalMode: 'conservative',
          experimentConfig: configs.v3,
        });
        const v7Setup = buildSignalSetup(indicators, {
          symbol: ETH_SYMBOL,
          signalMode: 'conservative',
          experimentConfig: configs.v7,
          fundingCache: data.fundingHistory,
        });
        const selected = pickSignal(v3Setup, v7Setup);
        const next = selected
          ? {
              ...selected,
              blockers: [],
            }
          : buildNoTrade(v3Setup, v7Setup);

        setState({
          ...next,
          lastUpdated: new Date().toISOString(),
          isLoading: false,
          error: '',
          candles: data.candles,
          latestFunding: data.latestFunding,
          fundingHistory: data.fundingHistory,
          pair: ETH_PAIR,
          symbol: ETH_SYMBOL,
          timeframe: TIMEFRAME,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          isLoading: false,
          error: error.message,
          lastUpdated: new Date().toISOString(),
        }));
      }
    }

    refresh();
    intervalId = window.setInterval(refresh, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [configs]);

  return state;
}
