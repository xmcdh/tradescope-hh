const MIN_CLOSED_TRADES = 50;
const WIN_RATE_THRESHOLD = 45;
const EXPECTANCY_THRESHOLD = 0.3;
const MAX_DRAWDOWN_THRESHOLD = 0.15;
const OOS_DEGRADATION_THRESHOLD = 0.15;
const PAIR_DEPENDENCE_THRESHOLD = 0.6;

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function setupKey(result) {
  return `${result.pair}:${result.timeframe}`;
}

function evaluateSetup(result) {
  const validation = result.validation ?? {};
  const backtest = result.backtest ?? result;
  const oosDegradation = validation.comparison?.oosDegradation ?? null;
  const metrics = {
    pair: result.pair,
    timeframe: result.timeframe,
    closedTrades: backtest.actionableClosedTradeCount ?? 0,
    actionableTrades: backtest.actionableTradeCount ?? 0,
    winRate: backtest.actionableWinRate ?? 0,
    expectancy: backtest.actionableExpectancy ?? 0,
    avgR: backtest.actionableAvgR ?? 0,
    maxDrawdown: backtest.actionableMaxDrawdown ?? 0,
    profitFactor: backtest.actionableProfitFactor ?? 0,
    oosDegradation,
    walkForwardPass: validation.walkForward?.pass ?? false,
    oosPass: !validation.flags?.some((flag) =>
      ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag),
    ),
  };
  const failedCriteria = [];
  let status = 'PROVEN_READY_FOR_PAPER';

  if (metrics.closedTrades < MIN_CLOSED_TRADES) {
    return {
      setup: setupKey(result),
      status: 'INSUFFICIENT_SAMPLE',
      failedCriteria: [`MIN_CLOSED_TRADES (${metrics.closedTrades}/${MIN_CLOSED_TRADES})`],
      metrics,
    };
  }

  if (metrics.winRate <= WIN_RATE_THRESHOLD) {
    status = 'FAILED_WIN_RATE';
    failedCriteria.push(`WIN_RATE (${round(metrics.winRate, 2)} <= ${WIN_RATE_THRESHOLD})`);
  }

  if (metrics.expectancy <= EXPECTANCY_THRESHOLD || metrics.avgR <= 0) {
    status = 'FAILED_EXPECTANCY';
    failedCriteria.push(`EXPECTANCY (${round(metrics.expectancy)} <= ${EXPECTANCY_THRESHOLD})`);
  }

  if (metrics.maxDrawdown >= MAX_DRAWDOWN_THRESHOLD) {
    status = 'FAILED_DRAWDOWN';
    failedCriteria.push(`MAX_DRAWDOWN (${round(metrics.maxDrawdown)} >= ${MAX_DRAWDOWN_THRESHOLD})`);
  }

  if (!Number.isFinite(metrics.oosDegradation) || metrics.oosDegradation > OOS_DEGRADATION_THRESHOLD || !metrics.oosPass || !metrics.walkForwardPass) {
    status = 'FAILED_OOS';
    failedCriteria.push(
      !Number.isFinite(metrics.oosDegradation)
        ? 'OOS_DEGRADATION unavailable'
        : `OOS_DEGRADATION (${round(metrics.oosDegradation)} > ${OOS_DEGRADATION_THRESHOLD})`,
    );
    if (!metrics.walkForwardPass) {
      failedCriteria.push('WALK_FORWARD failed');
    }
  }

  if (status === 'PROVEN_READY_FOR_PAPER' && failedCriteria.length === 0) {
    return {
      setup: setupKey(result),
      status,
      failedCriteria,
      metrics,
    };
  }

  return {
    setup: setupKey(result),
    status,
    failedCriteria,
    metrics,
  };
}

export function evaluateProfitabilityProof(results, options = {}) {
  const setups = (Array.isArray(results) ? results : []).map(evaluateSetup);
  const closedActionableTrades = setups.reduce((sum, item) => sum + item.metrics.closedTrades, 0);
  const netByPair = new Map();

  (Array.isArray(results) ? results : []).forEach((result) => {
    const pair = result.pair;
    const netR = result.backtest?.actionableNetR ?? result.actionableNetR ?? 0;
    netByPair.set(pair, (netByPair.get(pair) ?? 0) + netR);
  });

  const positiveContribution = [...netByPair.values()].filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const topPairEntry = [...netByPair.entries()].sort((left, right) => right[1] - left[1])[0] ?? [null, 0];
  const pairDependence = positiveContribution > 0 ? topPairEntry[1] / positiveContribution : 0;

  const failedStatuses = setups.filter((item) => item.status.startsWith('FAILED_'));
  const insufficient = setups.filter((item) => item.status === 'INSUFFICIENT_SAMPLE');
  const proven = setups.filter((item) => item.status === 'PROVEN_READY_FOR_PAPER');

  let status = 'PROMISING_NEEDS_MORE_DATA';
  const failedCriteria = [];

  if (!setups.length) {
    status = 'INSUFFICIENT_SAMPLE';
    failedCriteria.push('No backtest results available.');
  } else if (failedStatuses.length) {
    status = failedStatuses[0].status;
    failedCriteria.push(...failedStatuses.flatMap((item) => [`${item.setup}: ${item.failedCriteria.join(', ')}`]));
  } else if (insufficient.length === setups.length) {
    status = 'INSUFFICIENT_SAMPLE';
    failedCriteria.push('Every setup is below the minimum sample requirement.');
  } else if (netByPair.size > 1 && pairDependence > (options.pairDependenceThreshold ?? PAIR_DEPENDENCE_THRESHOLD)) {
    status = 'PROMISING_NEEDS_MORE_DATA';
    failedCriteria.push(
      `PAIR_DEPENDENCE (${topPairEntry[0]} contributes ${(pairDependence * 100).toFixed(2)}% of positive net R)`,
    );
  } else if (proven.length === setups.length) {
    status = 'PROVEN_READY_FOR_PAPER';
  } else {
    status = 'PROMISING_NEEDS_MORE_DATA';
    failedCriteria.push('Some setups are still below minimum evidence or need cleaner OOS consistency.');
  }

  return {
    status,
    thresholds: {
      minClosedTrades: MIN_CLOSED_TRADES,
      winRate: WIN_RATE_THRESHOLD,
      expectancy: EXPECTANCY_THRESHOLD,
      maxDrawdown: MAX_DRAWDOWN_THRESHOLD,
      oosDegradation: OOS_DEGRADATION_THRESHOLD,
      pairDependence: options.pairDependenceThreshold ?? PAIR_DEPENDENCE_THRESHOLD,
    },
    failedCriteria,
    overall: {
      setupCount: setups.length,
      provenSetups: proven.length,
      insufficientSetups: insufficient.length,
      failedSetups: failedStatuses.length,
      closedActionableTrades,
      pairDependence: round(pairDependence),
      dominantPair: topPairEntry[0],
    },
    setups,
  };
}
