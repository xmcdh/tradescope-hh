function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function quarterKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function summarizeTrades(trades) {
  const returns = trades.map((trade) => trade.r).filter(Number.isFinite);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const netR = returns.reduce((sum, value) => sum + value, 0);

  return {
    trades: returns.length,
    wins: wins.length,
    losses: losses.length,
    netR: round(netR),
    expectancy: returns.length ? round(netR / returns.length) : 0,
    winRate: returns.length ? round((wins.length / returns.length) * 100, 2) : 0,
  };
}

function groupBy(trades, keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade);
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, items]) => ({
      key,
      ...summarizeTrades(items),
    }));
}

function rollingDistribution(monthly, size) {
  const windows = [];
  for (let index = 0; index + size <= monthly.length; index += 1) {
    const slice = monthly.slice(index, index + size);
    const trades = slice.reduce((sum, item) => sum + item.trades, 0);
    const netR = slice.reduce((sum, item) => sum + item.netR, 0);
    const wins = slice.reduce((sum, item) => sum + item.wins, 0);
    const losses = slice.reduce((sum, item) => sum + item.losses, 0);

    windows.push({
      startMonth: slice[0].month,
      endMonth: slice.at(-1).month,
      trades,
      wins,
      losses,
      netR: round(netR),
      expectancy: trades ? round(netR / trades) : 0,
      winRate: trades ? round((wins / trades) * 100, 2) : 0,
    });
  }

  return windows;
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length || !Number.isFinite(value)) {
    return null;
  }

  const lowerOrEqual = sortedValues.filter((item) => item <= value).length;
  return lowerOrEqual / sortedValues.length;
}

function bucket(value, buckets) {
  if (value == null) {
    return 'unavailable';
  }

  return buckets.find((item) => value <= item.max)?.label ?? buckets.at(-1).label;
}

function classifyMarketWindow(timestamp) {
  const iso = new Date(timestamp).toISOString().slice(0, 10);
  if (iso < '2022-01-01') {
    return '2021_SOL_BULL_EXHAUSTION';
  }
  if (iso < '2023-01-01') {
    return '2022_BEAR_MARKET';
  }
  if (iso < '2023-10-01') {
    return '2023_RECOVERY_RANGE';
  }
  return '2023_2024_BULL_RECOVERY';
}

function normalizeTrades(payload) {
  return (payload?.backtest?.trades ?? [])
    .filter((trade) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(trade.outcome))
    .map((trade) => ({
      ...trade,
      r: Number(trade.r),
      timestamp: trade.timestamp,
      exitTimestamp: trade.exitTimestamp ?? trade.timestamp,
      atr: Number(trade.atr),
      score: Number(trade.confidenceScore ?? trade.score),
      pullbackDepthPercent:
        Number.isFinite(Number(trade.entry)) && Number.isFinite(Number(trade.tradeLevelFields?.sl))
          ? Math.abs((Number(trade.entry) - Number(trade.tradeLevelFields.sl)) / Number(trade.entry)) * 100
          : null,
    }))
    .filter((trade) => Number.isFinite(trade.r));
}

function topShare(rows) {
  const positive = rows.filter((row) => row.netR > 0);
  const totalPositive = positive.reduce((sum, row) => sum + row.netR, 0);
  const top = [...positive].sort((left, right) => right.netR - left.netR)[0] ?? null;

  return {
    top: top?.key ?? top?.month ?? null,
    topNetR: top?.netR ?? 0,
    positiveNetR: round(totalPositive),
    share: totalPositive > 0 ? round((top?.netR ?? 0) / totalPositive) : 0,
  };
}

function availability(trades) {
  const has = (field) => trades.some((trade) => trade[field] != null && Number.isFinite(Number(trade[field])));

  return {
    atr: has('atr'),
    score: has('score'),
    pullbackDepthPercent: has('pullbackDepthPercent'),
    direction: trades.some((trade) => ['LONG', 'SHORT'].includes(trade.signal)),
    trendStrengthOrEmaSlope: false,
    volatilityRegimeLabel: false,
    distanceFromSupportResistance: false,
    impulseSizeBeforeEntry: false,
  };
}

function buildRegimeBreakdowns(trades) {
  const atrValues = trades.map((trade) => trade.atr).filter(Number.isFinite).sort((left, right) => left - right);
  const enriched = trades.map((trade) => ({
    ...trade,
    atrPercentile: percentileRank(atrValues, trade.atr),
  }));

  return {
    byDirection: groupBy(enriched, (trade) => trade.signal ?? 'UNKNOWN').map((row) => ({ direction: row.key, ...row })),
    byMarketWindow: groupBy(enriched, (trade) => classifyMarketWindow(trade.timestamp)).map((row) => ({ regime: row.key, ...row })),
    byAtrPercentile: groupBy(enriched, (trade) =>
      bucket(trade.atrPercentile, [
        { label: 'low_0_33', max: 0.33 },
        { label: 'mid_0_66', max: 0.66 },
        { label: 'high_1_00', max: 1 },
      ]),
    ).map((row) => ({ atrBucket: row.key, ...row })),
    byPullbackDepth: groupBy(enriched, (trade) =>
      bucket(trade.pullbackDepthPercent, [
        { label: 'shallow_0_1pct', max: 1 },
        { label: 'medium_1_2pct', max: 2 },
        { label: 'deep_gt_2pct', max: Infinity },
      ]),
    ).map((row) => ({ pullbackDepthBucket: row.key, ...row })),
    byScore: groupBy(enriched, (trade) =>
      bucket(trade.score, [
        { label: 'score_7', max: 7 },
        { label: 'score_8_plus', max: Infinity },
      ]),
    ).map((row) => ({ scoreBucket: row.key, ...row })),
  };
}

function filterCandidates(analysis) {
  const candidates = [];
  const byDirection = analysis.regimeBreakdowns.byDirection;
  const byMarketWindow = analysis.regimeBreakdowns.byMarketWindow;
  const byAtr = analysis.regimeBreakdowns.byAtrPercentile;

  const long = byDirection.find((item) => item.direction === 'LONG');
  const short = byDirection.find((item) => item.direction === 'SHORT');
  if (long && short && Math.abs(long.expectancy - short.expectancy) >= 0.25) {
    const keep = long.expectancy > short.expectancy ? long : short;
    const remove = long.expectancy > short.expectancy ? short : long;
    candidates.push({
      filter: `direction_${keep.direction.toLowerCase()}_only_candidate`,
      losingRegimeRemoved: `${remove.direction} expectancy ${remove.expectancy}R`,
      estimatedTradesRemoved: remove.trades,
      overfittingRisk: 'medium-high',
      generalizable: 'weak unless confirmed across other SOL ranges and at least one additional pair',
      testPlan: 'Run as v1.6 candidate across the same 3 ranges, require OOS/walk-forward pass and no profit concentration.',
      metricMustImprove: 'walk-forward stability and cost-adjusted expectancy',
      metricMustNotDegrade: 'closed trades >= 50, max drawdown < 15%, win rate > 45%',
    });
  }

  const weakWindows = byMarketWindow.filter((item) => item.trades >= 5 && item.expectancy < 0);
  if (weakWindows.length) {
    candidates.push({
      filter: 'avoid_negative_macro_window_candidate',
      losingRegimeRemoved: weakWindows.map((item) => `${item.regime} ${item.expectancy}R`).join('; '),
      estimatedTradesRemoved: weakWindows.reduce((sum, item) => sum + item.trades, 0),
      overfittingRisk: 'high',
      generalizable: 'low unless replaced by objective trend/volatility features rather than calendar labels',
      testPlan: 'Translate calendar clue into objective EMA/ATR/chop feature first, then test out-of-sample.',
      metricMustImprove: 'negative-month reduction without deleting most sample',
      metricMustNotDegrade: 'trade count and OOS sample coverage',
    });
  }

  const atrRows = byAtr.filter((item) => item.atrBucket !== 'unavailable' && item.trades >= 10);
  const weakAtr = atrRows.filter((item) => item.expectancy < 0);
  if (weakAtr.length) {
    candidates.push({
      filter: 'atr_percentile_band_candidate',
      losingRegimeRemoved: weakAtr.map((item) => `${item.atrBucket} ${item.expectancy}R`).join('; '),
      estimatedTradesRemoved: weakAtr.reduce((sum, item) => sum + item.trades, 0),
      overfittingRisk: 'medium',
      generalizable: 'moderate if the ATR percentile is computed on rolling historical candles, not fixed full-sample ranks',
      testPlan: 'Use rolling ATR percentile only, then test 2021-2024 ranges plus OOS windows.',
      metricMustImprove: 'profit concentration and expectancy after -0.02R cost',
      metricMustNotDegrade: 'minimum 50 trades and drawdown',
    });
  }

  return candidates.slice(0, 3);
}

export function buildRegimeDependencyAnalysis(payload, comparisonRun = null) {
  const trades = normalizeTrades(payload);
  const monthly = groupBy(trades, (trade) => monthKey(trade.exitTimestamp)).map((row) => ({ month: row.key, ...row }));
  const quarterly = groupBy(trades, (trade) => quarterKey(trade.exitTimestamp)).map((row) => ({ quarter: row.key, ...row }));
  const rolling3 = rollingDistribution(monthly, 3);
  const rolling6 = rollingDistribution(monthly, 6);
  const monthShare = topShare(monthly);
  const quarterShare = topShare(quarterly);
  const validation = payload.validation ?? {};
  const walkForward = validation.walkForward ?? {};
  const regimeBreakdowns = buildRegimeBreakdowns(trades);
  const unavailableFields = Object.entries(availability(trades))
    .filter(([, available]) => !available)
    .map(([field]) => field);

  const analysis = {
    generatedAt: new Date().toISOString(),
    subject: {
      pair: payload.metadata?.pair ?? 'SOL/USDT',
      timeframe: payload.metadata?.timeframe ?? '1h',
      experimentId: payload.metadata?.experimentId ?? 'v1.5-trailing-after-1r',
      strategyVersion: payload.metadata?.strategyVersion ?? null,
      from: payload.metadata?.from ?? null,
      to: payload.metadata?.to ?? null,
      dataSource: payload.metadata?.dataSource ?? null,
    },
    safety: {
      activeProductionStrategy: 'v1.1-atr-risk',
      experimentBacktestOnly: true,
      approvedSetups: 0,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
    headlineMetrics: {
      closedActionableTrades: payload.backtest?.actionableClosedTradeCount ?? trades.length,
      winRate: payload.backtest?.actionableWinRate ?? summarizeTrades(trades).winRate,
      rawExpectancy: payload.backtest?.actionableExpectancy ?? summarizeTrades(trades).expectancy,
      costAdjustedExpectancyMinus0_02R: round((payload.backtest?.actionableExpectancy ?? summarizeTrades(trades).expectancy) - 0.02),
      maxDrawdown: payload.backtest?.actionableMaxDrawdown ?? 0,
      walkForwardPass: walkForward.pass === true,
      walkForwardFlags: walkForward.flags ?? [],
      profitConcentration: walkForward.summary?.profitConcentration ?? comparisonRun?.profitConcentration ?? null,
      topMonth: monthShare.top,
      topMonthShare: monthShare.share,
      topQuarter: quarterShare.top,
      topQuarterShare: quarterShare.share,
      promotionStatus: comparisonRun?.status ?? 'NOT_PROMOTABLE',
    },
    timeWindowAnalysis: {
      monthlyRDistribution: monthly,
      quarterlyRDistribution: quarterly,
      rolling3MonthExpectancy: rolling3,
      rolling6MonthExpectancy: rolling6,
      bestMonth: [...monthly].sort((left, right) => right.netR - left.netR)[0] ?? null,
      worstMonth: [...monthly].sort((left, right) => left.netR - right.netR)[0] ?? null,
      bestQuarter: [...quarterly].sort((left, right) => right.netR - left.netR)[0] ?? null,
      worstQuarter: [...quarterly].sort((left, right) => left.netR - right.netR)[0] ?? null,
      topMonthShare: monthShare,
      topQuarterShare: quarterShare,
      profitConcentrationSource:
        walkForward.windows?.length === 1
          ? 'walk-forward has only one OOS window, so all positive OOS profit is concentrated in that single window'
          : 'positive OOS profit is concentrated in too few walk-forward windows',
      failedWalkForwardWindows: (walkForward.windows ?? [])
        .filter((window) => !window.pass || (window.outOfSample?.netR ?? 0) > 0)
        .map((window) => ({
          index: window.index,
          startTimestamp: window.startTimestamp,
          endTimestamp: window.endTimestamp,
          inSample: window.inSample,
          outOfSample: window.outOfSample,
          flags: window.flags ?? [],
          pass: window.pass,
        })),
    },
    regimeBreakdowns,
    unavailableFields,
    regimeFilterCandidates: [],
    conclusion: {
      notPromotableReason:
        'v1.5-trailing-after-1r clears sample/win-rate/drawdown and narrowly clears -0.02R expectancy on the longest run, but fails walk-forward/profit concentration.',
      setupApproved: false,
      paperDay1CanStart: false,
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };

  analysis.regimeFilterCandidates = filterCandidates(analysis);
  return analysis;
}

function tableRow(row, labelKey) {
  return `| ${row[labelKey] ?? row.key} | ${row.trades} | ${row.netR} | ${row.expectancy} | ${row.winRate}% |`;
}

export function regimeDependencyAnalysisToMarkdown(analysis) {
  const lines = [
    '# SOL/USDT 1h v1.5 Trailing Regime Analysis',
    '',
    `Generated at: ${analysis.generatedAt}`,
    '',
    '## Safety',
    `- Active production strategy: ${analysis.safety.activeProductionStrategy}`,
    `- Experiment backtest-only: ${analysis.safety.experimentBacktestOnly ? 'yes' : 'no'}`,
    `- Approved setups: ${analysis.safety.approvedSetups}`,
    `- Paper Day 1: ${analysis.safety.paperDay1}`,
    `- Global verdict: ${analysis.safety.globalVerdict}`,
    `- Live execution: ${analysis.safety.liveExecution}`,
    '',
    '## Headline',
    `- Experiment: ${analysis.subject.experimentId}`,
    `- Range: ${analysis.subject.from} to ${analysis.subject.to}`,
    `- Closed actionable trades: ${analysis.headlineMetrics.closedActionableTrades}`,
    `- Raw expectancy: ${analysis.headlineMetrics.rawExpectancy}R`,
    `- Cost-adjusted expectancy (-0.02R): ${analysis.headlineMetrics.costAdjustedExpectancyMinus0_02R}R`,
    `- Win rate: ${analysis.headlineMetrics.winRate}%`,
    `- Max drawdown: ${(analysis.headlineMetrics.maxDrawdown * 100).toFixed(2)}%`,
    `- Walk-forward: ${analysis.headlineMetrics.walkForwardPass ? 'PASS' : 'FAIL'} (${analysis.headlineMetrics.walkForwardFlags.join(', ') || 'none'})`,
    `- Profit concentration: ${analysis.headlineMetrics.profitConcentration}`,
    `- Promotion status: ${analysis.headlineMetrics.promotionStatus}`,
    '',
    '## Time Window Concentration',
    `- Best month: ${analysis.timeWindowAnalysis.bestMonth?.month ?? '--'} (${analysis.timeWindowAnalysis.bestMonth?.netR ?? 0}R)`,
    `- Worst month: ${analysis.timeWindowAnalysis.worstMonth?.month ?? '--'} (${analysis.timeWindowAnalysis.worstMonth?.netR ?? 0}R)`,
    `- Top month share of positive monthly R: ${(analysis.timeWindowAnalysis.topMonthShare.share * 100).toFixed(2)}%`,
    `- Best quarter: ${analysis.timeWindowAnalysis.bestQuarter?.quarter ?? '--'} (${analysis.timeWindowAnalysis.bestQuarter?.netR ?? 0}R)`,
    `- Worst quarter: ${analysis.timeWindowAnalysis.worstQuarter?.quarter ?? '--'} (${analysis.timeWindowAnalysis.worstQuarter?.netR ?? 0}R)`,
    `- Top quarter share of positive quarterly R: ${(analysis.timeWindowAnalysis.topQuarterShare.share * 100).toFixed(2)}%`,
    `- Profit concentration source: ${analysis.timeWindowAnalysis.profitConcentrationSource}`,
    '',
    '## Monthly R Distribution',
    '| Month | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.timeWindowAnalysis.monthlyRDistribution.map((row) => tableRow(row, 'month')),
    '',
    '## Quarterly R Distribution',
    '| Quarter | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.timeWindowAnalysis.quarterlyRDistribution.map((row) => tableRow(row, 'quarter')),
    '',
    '## Rolling 3-Month Expectancy',
    '| Window | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.timeWindowAnalysis.rolling3MonthExpectancy.map((row) => `| ${row.startMonth} to ${row.endMonth} | ${row.trades} | ${row.netR} | ${row.expectancy} | ${row.winRate}% |`),
    '',
    '## Rolling 6-Month Expectancy',
    '| Window | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.timeWindowAnalysis.rolling6MonthExpectancy.map((row) => `| ${row.startMonth} to ${row.endMonth} | ${row.trades} | ${row.netR} | ${row.expectancy} | ${row.winRate}% |`),
    '',
    '## Regime Breakdowns',
    '',
    '### Direction',
    '| Direction | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.regimeBreakdowns.byDirection.map((row) => tableRow(row, 'direction')),
    '',
    '### Market Window',
    '| Regime | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.regimeBreakdowns.byMarketWindow.map((row) => tableRow(row, 'regime')),
    '',
    '### ATR Percentile',
    '| ATR Bucket | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.regimeBreakdowns.byAtrPercentile.map((row) => tableRow(row, 'atrBucket')),
    '',
    '### Pullback Depth Proxy',
    '| Pullback Depth | Trades | Net R | Expectancy | Win Rate |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...analysis.regimeBreakdowns.byPullbackDepth.map((row) => tableRow(row, 'pullbackDepthBucket')),
    '',
    '## Unavailable Regime Fields',
    ...(analysis.unavailableFields.length ? analysis.unavailableFields.map((field) => `- ${field}`) : ['- none']),
    '',
    '## Candidate Filters For Future Testing',
    ...(analysis.regimeFilterCandidates.length
      ? analysis.regimeFilterCandidates.flatMap((candidate) => [
          `- ${candidate.filter}: removes ${candidate.losingRegimeRemoved}; estimated trades removed ${candidate.estimatedTradesRemoved}; overfitting risk ${candidate.overfittingRisk}; generalizability ${candidate.generalizable}; test ${candidate.testPlan}`,
        ])
      : ['- No conservative filter is justified yet from persisted fields alone.']),
    '',
    '## Conclusion',
    `- ${analysis.conclusion.notPromotableReason}`,
    '- No setup is approved.',
    '- Paper Day 1 remains PENDING_SETUP_APPROVAL.',
    '- Global verdict remains NOT READY.',
    '- Live execution remains STUBBED.',
  ];

  return `${lines.join('\n')}\n`;
}
