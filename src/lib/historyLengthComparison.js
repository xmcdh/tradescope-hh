const MIN_CLOSED_TRADES = 50;

function monthsBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  return (end - start) / (30.4375 * 24 * 60 * 60 * 1000);
}

function findProofSetup(summary, pair, timeframe) {
  return (summary.proof?.setups ?? []).find(
    (setup) =>
      setup.metrics?.pair === pair &&
      setup.metrics?.timeframe === timeframe,
  ) ?? null;
}

function setupRow(summary, result) {
  const proofSetup = findProofSetup(summary, result.pair, result.timeframe);
  const closed = result.backtest?.actionableClosedTradeCount ?? 0;
  const winRate = result.backtest?.actionableWinRate ?? 0;
  const expectancy = result.backtest?.actionableExpectancy ?? 0;
  const maxDrawdown = result.backtest?.actionableMaxDrawdown ?? 0;
  const oosFlags = result.validation?.flags ?? [];
  const walkForwardPass = result.validation?.walkForward?.pass ?? false;
  const proofStatus = proofSetup?.status ?? 'UNKNOWN';

  return {
    pair: result.pair,
    timeframe: result.timeframe,
    candleCount: result.metadata?.candleCount ?? result.backtest?.candleCount ?? 0,
    closedActionableTrades: closed,
    distanceToMinimum: Math.max(0, MIN_CLOSED_TRADES - closed),
    winRate,
    expectancy,
    maxDrawdown,
    oosStatus: oosFlags.length ? oosFlags.join(', ') : 'PASS',
    walkForwardStatus: walkForwardPass ? 'PASS' : 'FAIL',
    proofStatus,
    eligibleForApproval: closed >= MIN_CLOSED_TRADES && proofStatus === 'PROVEN_READY_FOR_PAPER',
  };
}

export function buildHistoryLengthComparison(summaries) {
  const ranges = summaries.map((summary) => {
    const rows = (summary.results ?? []).map((result) => setupRow(summary, result));
    const bestSetup = [...rows].sort((left, right) => right.closedActionableTrades - left.closedActionableTrades)[0] ?? null;
    const months = monthsBetween(summary.metadata?.from, summary.metadata?.to);

    return {
      sourceFile: summary.sourceFile ?? null,
      strategyVersion: summary.metadata?.strategyVersion ?? summary.proof?.strategyVersion ?? null,
      riskModel: summary.metadata?.riskModel ?? null,
      rangeTested: {
        from: summary.metadata?.from ?? null,
        to: summary.metadata?.to ?? null,
        approximateMonths: Number(months.toFixed(2)),
      },
      dataSource: summary.metadata?.dataSource ?? null,
      fallbackDataSource: summary.metadata?.fallbackDataSource ?? null,
      totalCandleCount: rows.reduce((sum, row) => sum + row.candleCount, 0),
      totalClosedActionableTrades: summary.proof?.overall?.closedActionableTrades ?? rows.reduce((sum, row) => sum + row.closedActionableTrades, 0),
      proofStatus: summary.proof?.status ?? 'UNKNOWN',
      bestSetup,
      anySetupEligibleForApproval: rows.some((row) => row.eligibleForApproval),
      perSetup: rows,
    };
  });
  const latest = ranges.at(-1) ?? null;
  const sparseUnderCurrentRules = latest ? latest.perSetup.every((row) => row.closedActionableTrades < MIN_CLOSED_TRADES) : true;
  const bySetup = new Map();

  for (const range of ranges) {
    for (const row of range.perSetup) {
      const key = `${row.pair} ${row.timeframe}`;
      const items = bySetup.get(key) ?? [];
      items.push({
        range: `${range.rangeTested.from} to ${range.rangeTested.to}`,
        months: range.rangeTested.approximateMonths,
        closedActionableTrades: row.closedActionableTrades,
      });
      bySetup.set(key, items);
    }
  }

  const growth = [...bySetup.entries()].map(([setup, items]) => {
    const first = items[0];
    const last = items.at(-1);
    const sampleGrowth = (last?.closedActionableTrades ?? 0) - (first?.closedActionableTrades ?? 0);
    const monthGrowth = (last?.months ?? 0) - (first?.months ?? 0);

    return {
      setup,
      firstClosedActionableTrades: first?.closedActionableTrades ?? 0,
      latestClosedActionableTrades: last?.closedActionableTrades ?? 0,
      growthAcrossTestedRanges: sampleGrowth,
      closedTradesPerAdditionalMonth: monthGrowth > 0 ? Number((sampleGrowth / monthGrowth).toFixed(4)) : 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    minClosedTradesPerSetup: MIN_CLOSED_TRADES,
    ranges,
    growth,
    conclusion: {
      anySetupEligibleForApproval: ranges.some((range) => range.anySetupEligibleForApproval),
      sparseUnderCurrentRules,
      statement: sparseUnderCurrentRules
        ? 'The strategy is too selective under current rules for the tested universe/timeframes.'
        : 'At least one setup reached the minimum sample threshold; approval still depends on all proof gates.',
    },
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '--';
}

export function historyLengthComparisonToMarkdown(comparison) {
  const lines = [
    '# TradeScope History Length Comparison',
    '',
    `Generated at: ${comparison.generatedAt}`,
    `Minimum closed actionable trades per setup: ${comparison.minClosedTradesPerSetup}`,
    '',
    '## Executive Summary',
    `- Any setup eligible for approval: ${comparison.conclusion.anySetupEligibleForApproval ? 'yes' : 'no'}`,
    `- Sparse under current rules: ${comparison.conclusion.sparseUnderCurrentRules ? 'yes' : 'no'}`,
    `- Conclusion: ${comparison.conclusion.statement}`,
    '',
    '## Range Summary',
    '| Range | Strategy | Data Source | Total Candles | Total Closed Actionable | Best Setup | Best Sample | Proof Status |',
    '| --- | --- | --- | ---: | ---: | --- | ---: | --- |',
    ...comparison.ranges.map((range) => {
      const best = range.bestSetup;
      return `| ${range.rangeTested.from} to ${range.rangeTested.to} | ${range.strategyVersion ?? '--'} | ${range.dataSource ?? '--'} | ${range.totalCandleCount} | ${range.totalClosedActionableTrades} | ${best ? `${best.pair} ${best.timeframe}` : '--'} | ${best ? `${best.closedActionableTrades}/${comparison.minClosedTradesPerSetup}` : '--'} | ${range.proofStatus} |`;
    }),
    '',
    '## Per Setup Detail',
  ];

  for (const range of comparison.ranges) {
    lines.push(
      '',
      `### ${range.rangeTested.from} to ${range.rangeTested.to}`,
      '| Pair | Timeframe | Closed | Distance To 50 | Win Rate | Expectancy | Max DD | OOS | Walk-Forward | Proof | Approval Eligible |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
      ...range.perSetup.map(
        (row) =>
          `| ${row.pair} | ${row.timeframe} | ${row.closedActionableTrades} | ${row.distanceToMinimum} | ${pct(row.winRate)} | ${row.expectancy} | ${pct(row.maxDrawdown * 100)} | ${row.oosStatus} | ${row.walkForwardStatus} | ${row.proofStatus} | ${row.eligibleForApproval ? 'yes' : 'no'} |`,
      ),
    );
  }

  lines.push(
    '',
    '## Sample Growth',
    '| Setup | First Closed | Latest Closed | Growth | Closed Trades / Additional Month |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...comparison.growth.map(
      (row) =>
        `| ${row.setup} | ${row.firstClosedActionableTrades} | ${row.latestClosedActionableTrades} | ${row.growthAcrossTestedRanges} | ${row.closedTradesPerAdditionalMonth} |`,
    ),
  );

  return `${lines.join('\n')}\n`;
}
