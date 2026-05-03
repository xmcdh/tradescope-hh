import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-forensic-analysis.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-forensic-analysis.md');

const RUNS = [
  {
    key: 'v13Baseline',
    label: 'v1.3 baseline',
    experimentId: 'v1.3-trend-pullback-continuation',
    filePrefix: 'v1.3-trend-pullback-continuation-SOL-USDT-1h-2023-01-01-to-2024-07-01-',
  },
  {
    key: 'trendStrength',
    label: 'v1.4 trend-strength',
    experimentId: 'v1.4-trend-strength-filter',
    filePrefix: 'v1.4-trend-strength-filter-SOL-USDT-1h-2023-01-01-to-2024-07-01-',
  },
  {
    key: 'chopAvoidance',
    label: 'v1.4 chop-avoidance',
    experimentId: 'v1.4-chop-avoidance-filter',
    filePrefix: 'v1.4-chop-avoidance-filter-SOL-USDT-1h-2023-01-01-to-2024-07-01-',
  },
];

const GATES = {
  minClosedTrades: 50,
  minExpectancy: 0.3,
  minWinRate: 45,
  maxDrawdown: 0.15,
  maxOosDegradation: 0.15,
  maxProfitConcentration: 0.6,
};

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function tradeKey(trade) {
  return `${trade.timestamp}:${trade.direction ?? trade.signal}:${round(trade.entry, 8)}:${round(trade.sl, 8)}:${round(trade.tp, 8)}`;
}

function closedTrades(payload) {
  return (payload.backtest?.trades ?? [])
    .filter((trade) => ['WIN', 'LOSS'].includes(trade.outcome))
    .sort((left, right) => (left.exitTimestamp ?? left.timestamp) - (right.exitTimestamp ?? right.timestamp));
}

function profitFactor(returns) {
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (grossLoss === 0) {
    return grossProfit > 0 ? Infinity : 0;
  }
  return grossProfit / grossLoss;
}

function summarizeTrades(trades) {
  const returns = trades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = trades.filter((trade) => trade.outcome === 'WIN').length;
  const losses = trades.filter((trade) => trade.outcome === 'LOSS').length;

  return {
    closedTrades: trades.length,
    wins,
    losses,
    winRate: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    expectancy: round(returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length)),
    netR: round(returns.reduce((sum, value) => sum + value, 0)),
    avgWinR: round(returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) / Math.max(1, wins)),
    avgLossR: round(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0) / Math.max(1, losses)),
    profitFactor: round(profitFactor(returns)),
  };
}

function monthlyDistribution(trades) {
  const months = new Map();
  for (const trade of trades) {
    const key = monthKey(trade.exitTimestamp ?? trade.timestamp);
    const current = months.get(key) ?? { month: key, trades: 0, wins: 0, losses: 0, netR: 0, returns: [] };
    current.trades += 1;
    current.wins += trade.outcome === 'WIN' ? 1 : 0;
    current.losses += trade.outcome === 'LOSS' ? 1 : 0;
    current.netR += Number(trade.r) || 0;
    current.returns.push(Number(trade.r) || 0);
    months.set(key, current);
  }

  return [...months.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((item) => ({
      month: item.month,
      trades: item.trades,
      wins: item.wins,
      losses: item.losses,
      winRate: item.trades ? round((item.wins / item.trades) * 100, 2) : 0,
      netR: round(item.netR),
      expectancy: round(item.netR / Math.max(1, item.trades)),
    }));
}

function drawdownPeriods(trades) {
  let equity = 0;
  let peak = 0;
  let current = null;
  const periods = [];

  for (const trade of trades) {
    const timestamp = trade.exitTimestamp ?? trade.timestamp;
    equity += Number(trade.r) || 0;
    if (equity >= peak) {
      if (current) {
        current.end = timestamp;
        current.recovered = true;
        periods.push(current);
        current = null;
      }
      peak = equity;
      continue;
    }

    const drawdown = peak - equity;
    if (!current) {
      current = {
        start: timestamp,
        end: timestamp,
        maxDrawdownR: drawdown,
        trough: timestamp,
        recovered: false,
      };
    } else {
      current.end = timestamp;
      if (drawdown > current.maxDrawdownR) {
        current.maxDrawdownR = drawdown;
        current.trough = timestamp;
      }
    }
  }

  if (current) {
    periods.push(current);
  }

  return periods
    .sort((left, right) => right.maxDrawdownR - left.maxDrawdownR)
    .slice(0, 5)
    .map((item) => ({
      start: new Date(item.start).toISOString(),
      end: new Date(item.end).toISOString(),
      trough: new Date(item.trough).toISOString(),
      maxDrawdownR: round(item.maxDrawdownR),
      recovered: item.recovered,
    }));
}

function concentration(monthly) {
  const positive = monthly.filter((item) => item.netR > 0);
  const positiveR = positive.reduce((sum, item) => sum + item.netR, 0);
  const top = [...positive].sort((left, right) => right.netR - left.netR)[0] ?? null;
  const top3 = [...positive].sort((left, right) => right.netR - left.netR).slice(0, 3);

  return {
    positiveMonthCount: positive.length,
    topPositiveMonth: top,
    topPositiveMonthShare: positiveR > 0 ? round(top.netR / positiveR) : 0,
    top3PositiveMonthShare: positiveR > 0 ? round(top3.reduce((sum, item) => sum + item.netR, 0) / positiveR) : 0,
    positiveNetR: round(positiveR),
  };
}

function summarizeRun(run, payload) {
  const trades = closedTrades(payload);
  const monthly = monthlyDistribution(trades);
  const bestMonth = [...monthly].sort((left, right) => right.netR - left.netR)[0] ?? null;
  const worstMonth = [...monthly].sort((left, right) => left.netR - right.netR)[0] ?? null;
  const validation = payload.validation ?? {};

  return {
    key: run.key,
    label: run.label,
    experimentId: run.experimentId,
    sourceFile: run.sourceFile,
    metadata: payload.metadata,
    metrics: {
      ...summarizeTrades(trades),
      maxDrawdown: round(payload.backtest?.actionableMaxDrawdown ?? 0),
      oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
      walkForwardPass: validation.walkForward?.pass === true,
      walkForwardFlags: validation.walkForward?.flags ?? [],
      validationFlags: validation.flags ?? [],
      profitConcentration: round(validation.walkForward?.summary?.profitConcentration ?? 0),
      sampleDistanceTo50: Math.max(0, GATES.minClosedTrades - trades.length),
    },
    monthly,
    bestMonth,
    worstMonth,
    concentration: concentration(monthly),
    drawdownPeriods: drawdownPeriods(trades),
    walkForward: {
      summary: validation.walkForward?.summary ?? null,
      windows: validation.walkForward?.windows ?? [],
    },
    trades,
  };
}

function setComparison(baseTrades, variantTrades) {
  const variantKeys = new Set(variantTrades.map(tradeKey));
  const baseKeys = new Set(baseTrades.map(tradeKey));
  const kept = baseTrades.filter((trade) => variantKeys.has(tradeKey(trade)));
  const removed = baseTrades.filter((trade) => !variantKeys.has(tradeKey(trade)));
  const addedOrChanged = variantTrades.filter((trade) => !baseKeys.has(tradeKey(trade)));

  return {
    kept: summarizeTrades(kept),
    removed: {
      ...summarizeTrades(removed),
      removedWins: removed.filter((trade) => trade.outcome === 'WIN').length,
      removedLosses: removed.filter((trade) => trade.outcome === 'LOSS').length,
      removedNetR: round(removed.reduce((sum, trade) => sum + (Number(trade.r) || 0), 0)),
    },
    addedOrChanged: summarizeTrades(addedOrChanged),
  };
}

function overlap(left, right) {
  const leftKeys = new Set(left.trades.map(tradeKey));
  const rightKeys = new Set(right.trades.map(tradeKey));
  const sharedKeys = [...leftKeys].filter((key) => rightKeys.has(key));
  const leftOnly = left.trades.filter((trade) => !rightKeys.has(tradeKey(trade)));
  const rightOnly = right.trades.filter((trade) => !leftKeys.has(tradeKey(trade)));
  const sharedTrades = left.trades.filter((trade) => rightKeys.has(tradeKey(trade)));

  return {
    sharedTrades: sharedKeys.length,
    leftOnly: summarizeTrades(leftOnly),
    rightOnly: summarizeTrades(rightOnly),
    shared: summarizeTrades(sharedTrades),
    jaccard: round(sharedKeys.length / Math.max(1, new Set([...leftKeys, ...rightKeys]).size)),
  };
}

async function latestRunFile(prefix) {
  const files = await fs.readdir(RESULTS_DIR);
  const candidates = await Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { file, filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildDecision(report) {
  const trend = report.runs.trendStrength.metrics;
  const chop = report.runs.chopAvoidance.metrics;
  const overlapMetrics = report.filterComparison.trendStrengthVsChopAvoidance;
  const comboJustified =
    trend.closedTrades >= GATES.minClosedTrades &&
    trend.expectancy > 0.2 &&
    chop.expectancy > GATES.minExpectancy &&
    chop.closedTrades >= 35 &&
    overlapMetrics.shared.closedTrades >= GATES.minClosedTrades &&
    overlapMetrics.jaccard < 0.5;

  return {
    sol1hClosestButFails: true,
    failureMode: [
      trend.walkForwardPass ? null : 'oos_instability',
      trend.profitConcentration > GATES.maxProfitConcentration ? 'profit_concentration' : null,
      chop.closedTrades < GATES.minClosedTrades ? 'sample_coverage_insufficient' : null,
    ].filter(Boolean),
    stableEnoughForApproval: false,
    conservativeComboExperimentJustified: comboJustified,
    comboExperiment: comboJustified
      ? {
          experimentId: 'v1.4b-sol-1h-trend-chop-combo',
          status: 'PLAN_ONLY_NOT_IMPLEMENTED',
          expectedSampleImpact: 'Likely below trend-strength sample and near/under 50 because chop-avoidance alone has only 43 trades.',
          overfittingRisk: 'High. Both filters were selected after seeing SOL/USDT 1h as closest; must be treated as candidate-only and rejected if sample <50 or WF/profit concentration fail.',
          rejectionCriteria: [
            'closed actionable trades < 50',
            'expectancy <= 0.3R',
            'win rate <= 45%',
            'max drawdown >= 15%',
            'OOS degradation > 15%',
            'walk-forward fail',
            'profit concentration > 0.6',
          ],
          requiredGates: GATES,
          whyNotCurveFitting: 'Only justified as a narrow falsification test if forensic evidence shows the filters remove different failure modes; it cannot change production or paper gates without fresh out-of-sample proof.',
        }
      : {
          experimentId: 'v1.4b-sol-1h-trend-chop-combo',
          status: 'NOT_JUSTIFIED_YET',
          reason: 'Evidence does not yet prove the filters are complementary enough to offset sample loss and profit concentration risk.',
        },
    approval: {
      sol1hCanBeApproved: false,
      reason: 'Walk-forward/profit concentration still fail, and chop-avoidance has only 43/50 trades.',
      paperDay1CanStart: false,
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };
}

function reportToMarkdown(report) {
  const runRows = Object.values(report.runs).map((run) => [
    run.label,
    run.metrics.closedTrades,
    `${run.metrics.winRate}%`,
    run.metrics.expectancy,
    run.metrics.netR,
    run.metrics.maxDrawdown,
    run.metrics.profitFactor,
    run.metrics.oosDegradation,
    run.metrics.walkForwardPass ? 'PASS' : 'FAIL',
    run.metrics.profitConcentration,
    run.metrics.sampleDistanceTo50,
  ]);

  const monthlyRows = Object.values(report.runs).flatMap((run) =>
    run.monthly.map((month) => [
      run.label,
      month.month,
      month.trades,
      `${month.winRate}%`,
      month.netR,
      month.expectancy,
    ]),
  );

  const wfRows = Object.values(report.runs).flatMap((run) =>
    run.walkForward.windows.map((window) => [
      run.label,
      window.index,
      window.outOfSample?.closedTradeCount ?? 0,
      window.outOfSample?.expectancy ?? 0,
      window.outOfSample?.netR ?? 0,
      window.comparison?.oosDegradation ?? 0,
      window.pass ? 'PASS' : 'FAIL',
      (window.flags ?? []).join(', ') || 'none',
    ]),
  );

  const filterRows = [
    ['Trend-strength removed from v1.3', report.filterComparison.v13ToTrendStrength.removed.closedTrades, report.filterComparison.v13ToTrendStrength.removed.removedWins, report.filterComparison.v13ToTrendStrength.removed.removedLosses, report.filterComparison.v13ToTrendStrength.removed.removedNetR],
    ['Chop-avoidance removed from v1.3', report.filterComparison.v13ToChopAvoidance.removed.closedTrades, report.filterComparison.v13ToChopAvoidance.removed.removedWins, report.filterComparison.v13ToChopAvoidance.removed.removedLosses, report.filterComparison.v13ToChopAvoidance.removed.removedNetR],
    ['Trend vs chop shared', report.filterComparison.trendStrengthVsChopAvoidance.shared.closedTrades, report.filterComparison.trendStrengthVsChopAvoidance.shared.wins, report.filterComparison.trendStrengthVsChopAvoidance.shared.losses, report.filterComparison.trendStrengthVsChopAvoidance.shared.netR],
  ];

  const concentrationRows = Object.values(report.runs).map((run) => [
    run.label,
    run.concentration.positiveMonthCount,
    run.concentration.topPositiveMonth?.month ?? 'none',
    run.concentration.topPositiveMonth?.netR ?? 0,
    run.concentration.topPositiveMonthShare,
    run.concentration.top3PositiveMonthShare,
    run.bestMonth?.month ?? 'none',
    run.bestMonth?.netR ?? 0,
    run.worstMonth?.month ?? 'none',
    run.worstMonth?.netR ?? 0,
  ]);

  return `# SOL/USDT 1h Forensic Analysis

Generated at: ${report.generatedAt}

## Decision
- Setup assessed: SOL/USDT 1h.
- Active production strategy remains ${report.safety.activeProductionStrategyVersion}.
- Forensic conclusion: closest research setup, but not approvable.
- Paper Day 1: PENDING_SETUP_APPROVAL.
- Global verdict: NOT READY.
- Live execution: STUBBED.

## Summary Metrics
${markdownTable(['Run', 'Closed', 'Win Rate', 'Expectancy', 'Net R', 'Max DD', 'Profit Factor', 'OOS Deg', 'Walk-Forward', 'Profit Conc', 'Distance To 50'], runRows)}

## Profit Concentration
${markdownTable(['Run', 'Positive Months', 'Top Positive Month', 'Top Month R', 'Top Month Share', 'Top 3 Share', 'Best Month', 'Best R', 'Worst Month', 'Worst R'], concentrationRows)}

## Walk-Forward Windows
${markdownTable(['Run', 'Window', 'OOS Closed', 'OOS Expectancy', 'OOS Net R', 'OOS Deg', 'Pass', 'Flags'], wfRows)}

## Monthly Distribution
${markdownTable(['Run', 'Month', 'Trades', 'Win Rate', 'Net R', 'Expectancy'], monthlyRows)}

## Filter Trade-Set Impact
${markdownTable(['Comparison', 'Trades', 'Wins', 'Losses', 'Net R'], filterRows)}

## Trend-Strength vs Chop-Avoidance
- Shared trades: ${report.filterComparison.trendStrengthVsChopAvoidance.sharedTrades}
- Jaccard overlap: ${report.filterComparison.trendStrengthVsChopAvoidance.jaccard}
- Trend-only trades: ${report.filterComparison.trendStrengthVsChopAvoidance.leftOnly.closedTrades}, expectancy ${report.filterComparison.trendStrengthVsChopAvoidance.leftOnly.expectancy}R.
- Chop-only trades: ${report.filterComparison.trendStrengthVsChopAvoidance.rightOnly.closedTrades}, expectancy ${report.filterComparison.trendStrengthVsChopAvoidance.rightOnly.expectancy}R.

## Combined Filter Proposal
- ${report.decision.comboExperiment.status}: ${report.decision.comboExperiment.reason ?? report.decision.comboExperiment.overfittingRisk}
- Proposed id: ${report.decision.comboExperiment.experimentId}
- Required gates remain unchanged: >=50 trades, >45% win rate, >0.3R expectancy, <15% max DD, OOS degradation <=15%, walk-forward pass, no profit concentration.

## Approval Status
- SOL/USDT 1h cannot be approved.
- v1.4 trend-strength remains below 0.3R and fails walk-forward/profit concentration.
- v1.4 chop-avoidance remains below sample requirement at 43/50 trades and fails walk-forward/profit concentration.
- No setup can start Paper Day 1.
`;
}

async function main() {
  const payloads = {};

  for (const run of RUNS) {
    const sourceFile = await latestRunFile(run.filePrefix);
    if (!sourceFile) {
      throw new Error(`Missing SOL/USDT 1h run file for ${run.experimentId}.`);
    }
    run.sourceFile = sourceFile;
    payloads[run.key] = await readJson(sourceFile);
  }

  const runs = Object.fromEntries(
    RUNS.map((run) => [run.key, summarizeRun(run, payloads[run.key])]),
  );
  const filterComparison = {
    v13ToTrendStrength: setComparison(runs.v13Baseline.trades, runs.trendStrength.trades),
    v13ToChopAvoidance: setComparison(runs.v13Baseline.trades, runs.chopAvoidance.trades),
    trendStrengthVsChopAvoidance: overlap(runs.trendStrength, runs.chopAvoidance),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    setup: 'SOL/USDT 1h',
    gates: GATES,
    runs,
    filterComparison,
    safety: {
      activeProductionStrategyVersion: activeStrategy.strategyVersion,
      experimentsActiveInProduction: false,
      noAutoApproval: true,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };
  report.decision = buildDecision(report);

  const compactReport = {
    ...report,
    runs: Object.fromEntries(
      Object.entries(report.runs).map(([key, run]) => {
        const { trades, ...compactRun } = run;
        return [key, compactRun];
      }),
    ),
  };
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(compactReport, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, reportToMarkdown(compactReport));

  console.log(JSON.stringify({
    jsonPath: OUTPUT_JSON,
    markdownPath: OUTPUT_MD,
    comboStatus: compactReport.decision.comboExperiment.status,
    approval: compactReport.decision.approval,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
