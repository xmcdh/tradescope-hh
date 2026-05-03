function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function summarize(trades) {
  const returns = trades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = trades.filter((trade) => trade.outcome === 'WIN');
  const losses = trades.filter((trade) => trade.outcome === 'LOSS');
  const netR = returns.reduce((sum, value) => sum + value, 0);

  return {
    trades: trades.length,
    winners: wins.length,
    losers: losses.length,
    netR: round(netR),
    expectancy: returns.length ? round(netR / returns.length) : 0,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 2) : 0,
  };
}

function featureStats(trades, feature) {
  const winners = trades.filter((trade) => trade.outcome === 'WIN').map((trade) => Number(trade.regimeFeatures?.[feature]));
  const losers = trades.filter((trade) => trade.outcome === 'LOSS').map((trade) => Number(trade.regimeFeatures?.[feature]));

  return {
    feature,
    winnerAvg: round(average(winners)),
    loserAvg: round(average(losers)),
    availableTrades: trades.filter((trade) => Number.isFinite(Number(trade.regimeFeatures?.[feature]))).length,
  };
}

function groupBy(trades, label, getter) {
  const groups = new Map();
  for (const trade of trades) {
    const key = getter(trade) ?? 'UNKNOWN';
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, items]) => ({
      [label]: key,
      ...summarize(items),
    }));
}

function bucketNumeric(value, buckets) {
  if (!Number.isFinite(value)) {
    return 'UNKNOWN';
  }

  return buckets.find((bucket) => value <= bucket.max)?.label ?? buckets.at(-1).label;
}

function evaluateFilter(trades, filter, predicate, overfittingRisk, generalizable) {
  const removed = trades.filter(predicate);
  const kept = trades.filter((trade) => !predicate(trade));
  const removedSummary = summarize(removed);
  const keptSummary = summarize(kept);
  const baseline = summarize(trades);

  return {
    filter,
    tradesRemoved: removedSummary.trades,
    winnersRemoved: removedSummary.winners,
    losersRemoved: removedSummary.losers,
    netRRemoved: removedSummary.netR,
    baselineExpectancy: baseline.expectancy,
    expectedExpectancyAfterFilter: keptSummary.expectancy,
    overfittingRisk,
    generalizable,
  };
}

function candidateFilters(trades) {
  const candidates = [];
  const sideways = evaluateFilter(
    trades,
    'avoid_SIDEWAYS_trendRegime',
    (trade) => trade.regimeFeatures?.trendRegime === 'SIDEWAYS',
    'medium',
    'moderate if trendRegime is computed from rolling EMA slope and validates across OOS windows',
  );
  if (sideways.tradesRemoved > 0 && sideways.expectedExpectancyAfterFilter > sideways.baselineExpectancy) {
    candidates.push(sideways);
  }

  const weakTrend = evaluateFilter(
    trades,
    'require_trendStrengthScore_above_3',
    (trade) => Number(trade.regimeFeatures?.trendStrengthScore) <= 3,
    'medium',
    'moderate if threshold is predeclared and not fitted to one range',
  );
  if (weakTrend.tradesRemoved > 0 && weakTrend.expectedExpectancyAfterFilter > weakTrend.baselineExpectancy) {
    candidates.push(weakTrend);
  }

  const lowImpulse = evaluateFilter(
    trades,
    'require_impulseSizeAtr_above_2',
    (trade) => Number(trade.regimeFeatures?.impulseSizeAtr) <= 2,
    'medium-high',
    'uncertain until impulse quality is tested on other pairs/timeframes',
  );
  if (lowImpulse.tradesRemoved > 0 && lowImpulse.expectedExpectancyAfterFilter > lowImpulse.baselineExpectancy) {
    candidates.push(lowImpulse);
  }

  const extremeVolatility = evaluateFilter(
    trades,
    'avoid_EXTREME_volatilityRegime',
    (trade) => trade.regimeFeatures?.volatilityRegime === 'EXTREME',
    'medium',
    'moderate if rolling ATR percentile is used and sample remains above 50',
  );
  if (extremeVolatility.tradesRemoved > 0 && extremeVolatility.expectedExpectancyAfterFilter > extremeVolatility.baselineExpectancy) {
    candidates.push(extremeVolatility);
  }

  return candidates
    .sort((left, right) => right.expectedExpectancyAfterFilter - left.expectedExpectancyAfterFilter)
    .slice(0, 3);
}

export function buildRegimeFeatureAudit(payload) {
  const trades = (payload?.backtest?.trades ?? [])
    .filter((trade) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(trade.outcome))
    .filter((trade) => trade.regimeFeatures && typeof trade.regimeFeatures === 'object');
  const missingFeatureTrades = (payload?.backtest?.trades ?? []).filter((trade) => !trade.regimeFeatures).length;
  const numericFeatures = [
    'atrPercentile',
    'emaSlope',
    'trendStrengthScore',
    'chopScore',
    'impulseSizeAtr',
    'pullbackDepthAtr',
    'distanceToSupportAtr',
    'distanceToResistanceAtr',
  ];

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      pair: payload?.metadata?.pair ?? 'SOL/USDT',
      timeframe: payload?.metadata?.timeframe ?? '1h',
      experimentId: payload?.metadata?.experimentId ?? 'v1.5-trailing-after-1r',
      from: payload?.metadata?.from ?? null,
      to: payload?.metadata?.to ?? null,
    },
    safety: {
      activeProductionStrategy: 'v1.1-atr-risk',
      experimentBacktestOnly: true,
      approvedSetups: 0,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
    summary: {
      ...summarize(trades),
      missingFeatureTrades,
    },
    winnerVsLoserNumeric: numericFeatures.map((feature) => featureStats(trades, feature)),
    grouped: {
      atrPercentile: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.atrPercentile), [
          { label: 'LOW_0_25', max: 0.25 },
          { label: 'NORMAL_0_75', max: 0.75 },
          { label: 'HIGH_0_90', max: 0.9 },
          { label: 'EXTREME_1_00', max: 1 },
        ]),
      ),
      emaSlope: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.emaSlope), [
          { label: 'NEGATIVE', max: -0.02 },
          { label: 'FLAT', max: 0.02 },
          { label: 'POSITIVE', max: Infinity },
        ]),
      ),
      trendStrengthScore: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.trendStrengthScore), [
          { label: 'WEAK_0_3', max: 3 },
          { label: 'MEDIUM_3_8', max: 8 },
          { label: 'STRONG_8_PLUS', max: Infinity },
        ]),
      ),
      chopScore: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.chopScore), [
          { label: 'LOW_CHOP_0_25', max: 25 },
          { label: 'MID_CHOP_25_60', max: 60 },
          { label: 'HIGH_CHOP_60_PLUS', max: Infinity },
        ]),
      ),
      impulseSizeAtr: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.impulseSizeAtr), [
          { label: 'LOW_0_2', max: 2 },
          { label: 'MEDIUM_2_4', max: 4 },
          { label: 'HIGH_4_PLUS', max: Infinity },
        ]),
      ),
      pullbackDepthAtr: groupBy(trades, 'bucket', (trade) =>
        bucketNumeric(Number(trade.regimeFeatures?.pullbackDepthAtr), [
          { label: 'SHALLOW_0_1', max: 1 },
          { label: 'MEDIUM_1_2', max: 2 },
          { label: 'DEEP_2_PLUS', max: Infinity },
        ]),
      ),
      volatilityRegime: groupBy(trades, 'regime', (trade) => trade.regimeFeatures?.volatilityRegime),
      trendRegime: groupBy(trades, 'regime', (trade) => trade.regimeFeatures?.trendRegime),
      direction: groupBy(trades, 'direction', (trade) => trade.signal),
    },
    candidateFilters: candidateFilters(trades),
    conclusion: {
      implementedFilter: false,
      v15Status: 'NOT_PROMOTABLE',
      reason: 'Regime feature audit is research-only. Any candidate filter must be tested as a future experiment with OOS/walk-forward gates.',
    },
  };
}

function table(rows, firstColumn) {
  return [
    `| ${firstColumn} | Trades | Winners | Losers | Net R | Expectancy | Win Rate |`,
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => {
      const key = row.bucket ?? row.regime ?? row.direction ?? 'UNKNOWN';
      return `| ${key} | ${row.trades} | ${row.winners} | ${row.losers} | ${row.netR} | ${row.expectancy} | ${row.winRate}% |`;
    }),
  ];
}

export function regimeFeatureAuditToMarkdown(audit) {
  const lines = [
    '# SOL/USDT 1h v1.5 Regime Feature Audit',
    '',
    `Generated at: ${audit.generatedAt}`,
    '',
    '## Safety',
    `- Active production strategy: ${audit.safety.activeProductionStrategy}`,
    `- Experiment backtest-only: ${audit.safety.experimentBacktestOnly ? 'yes' : 'no'}`,
    `- Approved setups: ${audit.safety.approvedSetups}`,
    `- Paper Day 1: ${audit.safety.paperDay1}`,
    `- Global verdict: ${audit.safety.globalVerdict}`,
    `- Live execution: ${audit.safety.liveExecution}`,
    '',
    '## Summary',
    `- Trades analyzed: ${audit.summary.trades}`,
    `- Missing feature trades: ${audit.summary.missingFeatureTrades}`,
    `- Net R: ${audit.summary.netR}`,
    `- Expectancy: ${audit.summary.expectancy}`,
    `- Win rate: ${audit.summary.winRate}%`,
    '',
    '## Winner vs Loser Numeric Averages',
    '| Feature | Winner Avg | Loser Avg | Available Trades |',
    '| --- | ---: | ---: | ---: |',
    ...audit.winnerVsLoserNumeric.map((row) => `| ${row.feature} | ${row.winnerAvg} | ${row.loserAvg} | ${row.availableTrades} |`),
    '',
    '## Grouped Feature Performance',
    '',
    '### ATR Percentile',
    ...table(audit.grouped.atrPercentile, 'Bucket'),
    '',
    '### EMA Slope',
    ...table(audit.grouped.emaSlope, 'Bucket'),
    '',
    '### Trend Strength Score',
    ...table(audit.grouped.trendStrengthScore, 'Bucket'),
    '',
    '### Chop Score',
    ...table(audit.grouped.chopScore, 'Bucket'),
    '',
    '### Impulse Size ATR',
    ...table(audit.grouped.impulseSizeAtr, 'Bucket'),
    '',
    '### Pullback Depth ATR',
    ...table(audit.grouped.pullbackDepthAtr, 'Bucket'),
    '',
    '### Volatility Regime',
    ...table(audit.grouped.volatilityRegime, 'Regime'),
    '',
    '### Trend Regime',
    ...table(audit.grouped.trendRegime, 'Regime'),
    '',
    '### Direction',
    ...table(audit.grouped.direction, 'Direction'),
    '',
    '## Candidate Objective Filters',
    ...(audit.candidateFilters.length
      ? audit.candidateFilters.map(
          (candidate) =>
            `- ${candidate.filter}: removes ${candidate.tradesRemoved} trades (${candidate.winnersRemoved} winners, ${candidate.losersRemoved} losers), netR removed ${candidate.netRRemoved}, expectancy ${candidate.baselineExpectancy} -> ${candidate.expectedExpectancyAfterFilter}, overfitting risk ${candidate.overfittingRisk}, generalizable: ${candidate.generalizable}`,
        )
      : ['- No objective filter candidate improved expectancy without obvious sample risk.']),
    '',
    '## Conclusion',
    `- Filter implemented: ${audit.conclusion.implementedFilter ? 'yes' : 'no'}`,
    `- v1.5 status: ${audit.conclusion.v15Status}`,
    `- ${audit.conclusion.reason}`,
    '- No setup is approved.',
    '- Paper Day 1 remains PENDING_SETUP_APPROVAL.',
    '- Global verdict remains NOT READY.',
    '- Live execution remains STUBBED.',
  ];

  return `${lines.join('\n')}\n`;
}
