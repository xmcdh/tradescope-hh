export const EXIT_GEOMETRY_COSTS_R = [0.01, 0.02, 0.05, 0.1];
export const EXIT_GEOMETRY_RANGES = [
  { from: '2022-07-01', to: '2024-07-01' },
  { from: '2022-01-01', to: '2024-07-01' },
  { from: '2021-07-01', to: '2024-07-01' },
];

const GATES = {
  minClosedTrades: 50,
  minWinRate: 45,
  minExpectancy: 0.3,
  maxDrawdown: 0.15,
  maxOosDegradation: 0.15,
  maxProfitConcentration: 0.6,
  maxTopMonthShare: 0.25,
};

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function profitFactor(returns) {
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (grossLoss === 0) {
    return grossProfit > 0 ? Infinity : 0;
  }

  return grossProfit / grossLoss;
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function oosFlagsFail(flags = []) {
  return flags.some((flag) => ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag));
}

export function normalizeClosedTrades(payload) {
  return (payload?.backtest?.trades ?? [])
    .filter((trade) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(trade.outcome))
    .map((trade) => ({
      ...trade,
      r: Number(trade.r),
      exitTimestamp: trade.exitTimestamp ?? trade.timestamp,
    }))
    .filter((trade) => Number.isFinite(trade.r));
}

export function monthlyRDistribution(trades) {
  const months = new Map();

  for (const trade of trades) {
    const key = monthKey(trade.exitTimestamp ?? trade.timestamp);
    const current = months.get(key) ?? { month: key, trades: 0, wins: 0, losses: 0, breakevens: 0, netR: 0 };
    current.trades += 1;
    current.wins += trade.outcome === 'WIN' ? 1 : 0;
    current.losses += trade.outcome === 'LOSS' ? 1 : 0;
    current.breakevens += trade.outcome === 'BREAKEVEN' ? 1 : 0;
    current.netR += trade.r;
    months.set(key, current);
  }

  return [...months.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((item) => ({
      ...item,
      netR: round(item.netR),
      expectancy: item.trades ? round(item.netR / item.trades) : 0,
      winRate: item.trades ? round((item.wins / item.trades) * 100, 2) : 0,
    }));
}

function tradeOutlierShare(trades) {
  const winners = trades.filter((trade) => trade.r > 0).sort((left, right) => right.r - left.r);
  const positiveNetR = winners.reduce((sum, trade) => sum + trade.r, 0);
  const topTrade = winners[0]?.r ?? 0;
  const topTwo = winners.slice(0, 2).reduce((sum, trade) => sum + trade.r, 0);

  return {
    positiveNetR: round(positiveNetR),
    topTradeShare: positiveNetR > 0 ? round(topTrade / positiveNetR) : 0,
    topTwoTradeShare: positiveNetR > 0 ? round(topTwo / positiveNetR) : 0,
  };
}

function costAdjustedExpectancy(rawExpectancy) {
  return Object.fromEntries(
    EXIT_GEOMETRY_COSTS_R.map((cost) => [`minus${cost.toFixed(2).replace('.', '_')}R`, round(rawExpectancy - cost)]),
  );
}

export function classifyExitExperimentRun(metrics) {
  if (metrics.closedActionableTrades < GATES.minClosedTrades) {
    return 'FAILED_SAMPLE';
  }

  if (metrics.rawExpectancy <= GATES.minExpectancy) {
    return 'FAILED_EXPECTANCY';
  }

  if (metrics.costAdjustedExpectancy.minus0_02R <= GATES.minExpectancy) {
    return 'FAILED_COST_SENSITIVITY';
  }

  if (metrics.maxDrawdown >= GATES.maxDrawdown) {
    return 'FAILED_DRAWDOWN';
  }

  if (metrics.oosResult !== 'PASS' || metrics.oosDegradation > GATES.maxOosDegradation) {
    return 'FAILED_OOS';
  }

  if (!metrics.walkForwardPass) {
    return 'FAILED_WALK_FORWARD';
  }

  if (metrics.profitConcentration > GATES.maxProfitConcentration || metrics.topMonthShare > GATES.maxTopMonthShare) {
    return 'FAILED_PROFIT_CONCENTRATION';
  }

  return 'PROMOTION_CANDIDATE_ONLY';
}

export function buildExitGeometryMetrics(payload, baselineMetrics = null) {
  const trades = normalizeClosedTrades(payload);
  const returns = trades.map((trade) => trade.r);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const monthly = monthlyRDistribution(trades);
  const topMonth = [...monthly].sort((left, right) => right.netR - left.netR)[0] ?? null;
  const positiveMonths = monthly.filter((item) => item.netR > 0);
  const positiveMonthlyNetR = positiveMonths.reduce((sum, item) => sum + item.netR, 0);
  const validation = payload?.validation ?? {};
  const walkForward = validation.walkForward ?? {};
  const topShare = positiveMonthlyNetR > 0 ? (topMonth?.netR ?? 0) / positiveMonthlyNetR : 0;
  const outlierShare = tradeOutlierShare(trades);

  const metrics = {
    pair: payload?.metadata?.pair ?? payload?.pair ?? null,
    timeframe: payload?.metadata?.timeframe ?? payload?.timeframe ?? null,
    strategyVersion: payload?.metadata?.strategyVersion ?? payload?.strategyVersion ?? null,
    experimentId: payload?.metadata?.experimentId ?? null,
    experimentLabel: payload?.metadata?.experimentLabel ?? null,
    from: payload?.metadata?.from ?? null,
    to: payload?.metadata?.to ?? null,
    dataSource: payload?.metadata?.dataSource ?? null,
    closedActionableTrades: payload?.backtest?.actionableClosedTradeCount ?? trades.length,
    actionableTradeCount: payload?.backtest?.actionableTradeCount ?? trades.length,
    winRate: round(payload?.backtest?.actionableWinRate ?? (trades.length ? (wins.length / trades.length) * 100 : 0), 2),
    rawExpectancy: round(payload?.backtest?.actionableExpectancy ?? average(returns)),
    avgWinR: round(average(wins)),
    avgLossR: round(average(losses)),
    medianWinR: round(median(wins)),
    medianLossR: round(median(losses)),
    maxDrawdown: round(payload?.backtest?.actionableMaxDrawdown ?? 0),
    profitFactor: Number.isFinite(payload?.backtest?.actionableProfitFactor)
      ? round(payload.backtest.actionableProfitFactor)
      : round(profitFactor(returns)),
    oosDegradation: round(validation?.comparison?.oosDegradation ?? 0),
    oosResult: oosFlagsFail(validation?.flags ?? []) ? 'FAIL' : 'PASS',
    walkForwardPass: walkForward?.pass === true,
    walkForwardFlags: walkForward?.flags ?? [],
    profitConcentration: round(walkForward?.summary?.profitConcentration ?? 0),
    monthlyRDistribution: monthly,
    topMonth: topMonth?.month ?? null,
    topMonthShare: round(topShare),
    costAdjustedExpectancy: costAdjustedExpectancy(payload?.backtest?.actionableExpectancy ?? average(returns)),
    monthlyPositiveCount: positiveMonths.length,
    monthlyNegativeCount: monthly.filter((item) => item.netR < 0).length,
    monthlyFlatCount: monthly.filter((item) => item.netR === 0).length,
    outlierWinnerShare: outlierShare,
    avgWinImprovedBeyondBaseline: round(average(wins)) > 1.5,
    sampleDistanceTo50: Math.max(0, GATES.minClosedTrades - (payload?.backtest?.actionableClosedTradeCount ?? trades.length)),
  };

  const warnings = [];
  if (outlierShare.topTradeShare > 0.25 || outlierShare.topTwoTradeShare > 0.4) {
    warnings.push('OUTLIER_WINNER_DEPENDENCE');
  }
  if (baselineMetrics && metrics.winRate < baselineMetrics.winRate - 8) {
    warnings.push('WIN_RATE_COLLAPSE');
  }
  if (baselineMetrics && metrics.maxDrawdown > baselineMetrics.maxDrawdown + 0.03) {
    warnings.push('DRAWDOWN_MATERIALLY_HIGHER');
  }
  if (baselineMetrics && metrics.profitConcentration > baselineMetrics.profitConcentration + 0.1) {
    warnings.push('PROFIT_CONCENTRATION_WORSE');
  }
  if (metrics.monthlyPositiveCount > 0 && metrics.monthlyNegativeCount / Math.max(metrics.monthlyPositiveCount + metrics.monthlyNegativeCount, 1) > 0.4) {
    warnings.push('REGIME_DEPENDENCE_WARNING');
  }

  metrics.status = classifyExitExperimentRun(metrics);
  metrics.fragilityWarnings = warnings;
  return metrics;
}

export function buildExitGeometryPlan(experiments) {
  return {
    generatedAt: new Date().toISOString(),
    strategyUnderResearch: 'SOL/USDT 1h v1.4-chop-avoidance-filter',
    activeProductionStrategyVersion: 'v1.1-atr-risk',
    objective:
      'Increase average win beyond the capped +1.5R baseline without breaking win rate, drawdown, cost sensitivity, OOS, or walk-forward stability.',
    variants: experiments.map((experiment) => {
      const mode = experiment.exitGeometry?.mode ?? 'single-target';
      let rejectionCriteria = 'Reject if sample stays below 50 closed actionable trades or if any proof gate fails.';
      let overfittingRisk = 'moderate';
      if (mode === 'full-target') {
        rejectionCriteria = 'Reject if win rate drops materially or profit concentration worsens while holding for full runner target.';
        overfittingRisk = 'medium';
      } else if (mode === 'partial-runner') {
        rejectionCriteria = 'Reject if partial + runner relies on a few oversized wins or if breakeven runner still leaves expectancy below 0.3R after -0.02R cost.';
        overfittingRisk = 'medium';
      } else if (mode === 'breakeven-after-1r') {
        rejectionCriteria = 'Reject if breakeven exits reduce losses but still do not lift expectancy above 0.3R after costs.';
        overfittingRisk = 'low-to-medium';
      } else if (mode === 'trailing-after-1r') {
        rejectionCriteria = 'Reject if trailing improves average win only through one or two outlier trades or if drawdown/path dependence worsens.';
        overfittingRisk = 'medium-to-high';
      }

      return {
        experimentId: experiment.experimentId,
        strategyVersion: experiment.strategyVersion,
        label: experiment.label,
        exitRule: experiment.changedParameters?.exitRule ?? experiment.label,
        expectedEffect: experiment.changedParameters?.expectedEffect ?? '',
        expectedAvgWinEffect: mode === 'full-target' ? 'higher' : mode === 'partial-runner' ? 'slightly higher' : mode === 'trailing-after-1r' ? 'potentially higher but path-dependent' : 'mixed',
        expectedWinRateEffect: mode === 'full-target' ? 'lower' : mode === 'partial-runner' ? 'slightly lower to flat' : mode === 'breakeven-after-1r' ? 'flat to lower' : 'lower',
        expectedDrawdownEffect: mode === 'breakeven-after-1r' ? 'flat to lower' : mode === 'partial-runner' ? 'flat' : 'flat to slightly higher',
        overfittingRisk,
        rejectionCriteria,
      };
    }),
    safety: {
      activeProductionStrategyRemains: 'v1.1-atr-risk',
      paperDay1Remains: 'PENDING_SETUP_APPROVAL',
      globalVerdictRemains: 'NOT READY',
      liveExecutionRemains: 'STUBBED',
    },
  };
}

export function exitGeometryPlanToMarkdown(plan) {
  const lines = [
    '# SOL/USDT 1h Exit Geometry Plan',
    '',
    `Generated at: ${plan.generatedAt}`,
    '',
    '## Objective',
    `- ${plan.objective}`,
    `- Active production strategy remains ${plan.activeProductionStrategyVersion}.`,
    '',
    '## Variants',
    '| Experiment | Exit Rule | Avg Win Effect | Win Rate Effect | Drawdown Effect | Overfitting Risk | Rejection Criteria |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...plan.variants.map((variant) =>
      `| ${variant.experimentId} | ${variant.exitRule} | ${variant.expectedAvgWinEffect} | ${variant.expectedWinRateEffect} | ${variant.expectedDrawdownEffect} | ${variant.overfittingRisk} | ${variant.rejectionCriteria} |`,
    ),
    '',
    '## Safety',
    `- Production strategy: ${plan.safety.activeProductionStrategyRemains}`,
    `- Paper Day 1: ${plan.safety.paperDay1Remains}`,
    `- Global verdict: ${plan.safety.globalVerdictRemains}`,
    `- Live execution: ${plan.safety.liveExecutionRemains}`,
  ];

  return `${lines.join('\n')}\n`;
}

export function buildExitGeometryComparison({ baseline, variants }) {
  const resultsByRange = EXIT_GEOMETRY_RANGES.map((range) => {
    const rangeKey = `${range.from}:${range.to}`;
    return {
      range,
      baseline: baseline.find((item) => `${item.from}:${item.to}` === rangeKey) ?? null,
      variants: variants
        .map((variant) => ({
          ...variant,
          runs: variant.runs.filter((run) => !run.missing && `${run.from}:${run.to}` === rangeKey),
        }))
        .filter((variant) => variant.runs.length),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    baseline,
    variants,
    ranges: resultsByRange,
    safety: {
      activeProductionStrategy: 'v1.1-atr-risk',
      v14Status: 'FAILED_COST_SENSITIVITY',
      v15BacktestOnly: true,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      approvedSetups: 0,
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };
}

export function exitGeometryComparisonToMarkdown(comparison) {
  const lines = [
    '# SOL/USDT 1h Exit Geometry Comparison',
    '',
    `Generated at: ${comparison.generatedAt}`,
    '',
    '## Safety',
    `- Active production strategy remains ${comparison.safety.activeProductionStrategy}`,
    `- v1.4 baseline remains ${comparison.safety.v14Status}`,
    `- v1.5 variants are backtest-only: ${comparison.safety.v15BacktestOnly ? 'yes' : 'no'}`,
    `- Approved setups: ${comparison.safety.approvedSetups}`,
    `- Paper Day 1: ${comparison.safety.paperDay1}`,
    `- Global verdict: ${comparison.safety.globalVerdict}`,
    `- Live execution: ${comparison.safety.liveExecution}`,
    '',
  ];

  for (const rangeEntry of comparison.ranges) {
    lines.push(`## Range ${rangeEntry.range.from} to ${rangeEntry.range.to}`);
    lines.push('| Variant | Closed | Distance To 50 | Win Rate | Raw Exp | -0.01R | -0.02R | -0.05R | -0.10R | Avg Win | Avg Loss | Median Win | Median Loss | Max DD | PF | OOS Deg | Walk-Forward | Profit Conc | Top Month | Status | Warnings |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |');

    if (rangeEntry.baseline) {
      lines.push(
        `| baseline-v1.4-chop | ${rangeEntry.baseline.closedActionableTrades} | ${rangeEntry.baseline.sampleDistanceTo50} | ${rangeEntry.baseline.winRate}% | ${rangeEntry.baseline.rawExpectancy} | ${rangeEntry.baseline.costAdjustedExpectancy.minus0_01R} | ${rangeEntry.baseline.costAdjustedExpectancy.minus0_02R} | ${rangeEntry.baseline.costAdjustedExpectancy.minus0_05R} | ${rangeEntry.baseline.costAdjustedExpectancy.minus0_10R} | ${rangeEntry.baseline.avgWinR} | ${rangeEntry.baseline.avgLossR} | ${rangeEntry.baseline.medianWinR} | ${rangeEntry.baseline.medianLossR} | ${rangeEntry.baseline.maxDrawdown} | ${rangeEntry.baseline.profitFactor} | ${rangeEntry.baseline.oosDegradation} | ${rangeEntry.baseline.walkForwardPass ? 'PASS' : 'FAIL'} | ${rangeEntry.baseline.profitConcentration} | ${rangeEntry.baseline.topMonth ?? '--'} | ${rangeEntry.baseline.status} | ${rangeEntry.baseline.fragilityWarnings.join(', ') || 'none'} |`,
      );
    }

    for (const variant of rangeEntry.variants) {
      for (const run of variant.runs) {
        lines.push(
          `| ${variant.experimentId} | ${run.closedActionableTrades} | ${run.sampleDistanceTo50} | ${run.winRate}% | ${run.rawExpectancy} | ${run.costAdjustedExpectancy.minus0_01R} | ${run.costAdjustedExpectancy.minus0_02R} | ${run.costAdjustedExpectancy.minus0_05R} | ${run.costAdjustedExpectancy.minus0_10R} | ${run.avgWinR} | ${run.avgLossR} | ${run.medianWinR} | ${run.medianLossR} | ${run.maxDrawdown} | ${run.profitFactor} | ${run.oosDegradation} | ${run.walkForwardPass ? 'PASS' : 'FAIL'} | ${run.profitConcentration} | ${run.topMonth ?? '--'} | ${run.status} | ${run.fragilityWarnings.join(', ') || 'none'} |`,
        );
      }
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
