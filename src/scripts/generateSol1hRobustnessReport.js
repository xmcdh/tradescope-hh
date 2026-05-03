import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-robustness-report.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-robustness-report.md');

const VARIANTS = [
  {
    experimentId: 'v1.4-trend-strength-filter',
    label: 'v1.4 trend-strength',
  },
  {
    experimentId: 'v1.4-chop-avoidance-filter',
    label: 'v1.4 chop-avoidance',
  },
];

const RANGES = [
  { from: '2022-07-01', to: '2024-07-01' },
  { from: '2022-01-01', to: '2024-07-01' },
  { from: '2021-07-01', to: '2024-07-01' },
];

const COSTS_R = [0.02, 0.05, 0.1];
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
  return {
    closedTrades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    expectancy: returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length) : 0,
    netR: round(returns.reduce((sum, value) => sum + value, 0)),
    profitFactor: round(profitFactor(returns)),
  };
}

function monthlyDistribution(trades) {
  const months = new Map();
  for (const trade of trades) {
    const key = monthKey(trade.exitTimestamp ?? trade.timestamp);
    const current = months.get(key) ?? { month: key, trades: 0, wins: 0, losses: 0, netR: 0 };
    current.trades += 1;
    current.wins += trade.outcome === 'WIN' ? 1 : 0;
    current.losses += trade.outcome === 'LOSS' ? 1 : 0;
    current.netR += Number(trade.r) || 0;
    months.set(key, current);
  }

  return [...months.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((item) => ({
      ...item,
      winRate: item.trades ? round((item.wins / item.trades) * 100, 2) : 0,
      netR: round(item.netR),
      expectancy: item.trades ? round(item.netR / item.trades) : 0,
    }));
}

function concentration(monthly) {
  const positive = monthly.filter((item) => item.netR > 0);
  const positiveNetR = positive.reduce((sum, item) => sum + item.netR, 0);
  const top = [...positive].sort((left, right) => right.netR - left.netR)[0] ?? null;
  const top3 = [...positive].sort((left, right) => right.netR - left.netR).slice(0, 3);

  return {
    positiveMonthCount: positive.length,
    topPositiveMonth: top,
    topPositiveMonthShare: positiveNetR > 0 ? round((top?.netR ?? 0) / positiveNetR) : 0,
    top3PositiveMonthShare: positiveNetR > 0 ? round(top3.reduce((sum, item) => sum + item.netR, 0) / positiveNetR) : 0,
    positiveNetR: round(positiveNetR),
  };
}

function sensitivity(expectancy) {
  return Object.fromEntries(
    [
      ['raw', expectancy],
      ...COSTS_R.map((cost) => [`minus${String(cost).replace('.', '_')}R`, round(expectancy - cost)]),
    ],
  );
}

function gates(metrics) {
  const failures = [];
  if (metrics.closedTrades < GATES.minClosedTrades) failures.push(`FAILED_SAMPLE (${metrics.closedTrades}/${GATES.minClosedTrades})`);
  if (metrics.winRate <= GATES.minWinRate) failures.push(`FAILED_WIN_RATE (${metrics.winRate} <= ${GATES.minWinRate})`);
  if (metrics.expectancy <= GATES.minExpectancy) failures.push(`FAILED_EXPECTANCY (${metrics.expectancy} <= ${GATES.minExpectancy})`);
  if (metrics.maxDrawdown >= GATES.maxDrawdown) failures.push(`FAILED_DRAWDOWN (${metrics.maxDrawdown} >= ${GATES.maxDrawdown})`);
  if (metrics.oosDegradation > GATES.maxOosDegradation) failures.push(`FAILED_OOS (${metrics.oosDegradation} > ${GATES.maxOosDegradation})`);
  if (!metrics.walkForwardPass) failures.push('FAILED_WALK_FORWARD');
  if (metrics.profitConcentration > GATES.maxProfitConcentration) failures.push(`FAILED_PROFIT_CONCENTRATION (${metrics.profitConcentration} > ${GATES.maxProfitConcentration})`);
  for (const cost of COSTS_R) {
    const adjusted = round(metrics.expectancy - cost);
    if (adjusted <= GATES.minExpectancy) {
      failures.push(`FAILED_COST_SENSITIVITY (${adjusted}R after ${cost}R cost)`);
      break;
    }
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'PROMOTION_CANDIDATE_ONLY' : failures[0].split(' ')[0],
    failures,
  };
}

async function latestRunFile({ experimentId, from, to }) {
  const prefix = `${experimentId}-SOL-USDT-1h-${from}-to-${to}-`;
  const files = await fs.readdir(RESULTS_DIR);
  const candidates = await Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function summarizeRun(variant, range) {
  const filePath = await latestRunFile({ experimentId: variant.experimentId, ...range });
  if (!filePath) {
    return {
      variant: variant.label,
      experimentId: variant.experimentId,
      range,
      available: false,
      reason: 'run_file_not_found',
    };
  }

  const payload = await readJson(filePath);
  const trades = closedTrades(payload);
  const monthly = monthlyDistribution(trades);
  const tradeMetrics = summarizeTrades(trades);
  const validation = payload.validation ?? {};
  const metrics = {
    ...tradeMetrics,
    maxDrawdown: round(payload.backtest?.actionableMaxDrawdown ?? 0),
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    walkForwardPass: validation.walkForward?.pass === true,
    validationFlags: validation.flags ?? [],
    walkForwardFlags: validation.walkForward?.flags ?? [],
    profitConcentration: round(validation.walkForward?.summary?.profitConcentration ?? 0),
    samplePass: trades.length >= GATES.minClosedTrades,
    expectancySensitivity: sensitivity(tradeMetrics.expectancy),
  };
  const gateResult = gates(metrics);

  return {
    variant: variant.label,
    experimentId: variant.experimentId,
    range,
    available: true,
    sourceFile: filePath,
    metadata: payload.metadata,
    metrics,
    monthly,
    concentration: concentration(monthly),
    bestMonth: [...monthly].sort((left, right) => right.netR - left.netR)[0] ?? null,
    worstMonth: [...monthly].sort((left, right) => left.netR - right.netR)[0] ?? null,
    walkForward: {
      summary: validation.walkForward?.summary ?? null,
      windows: validation.walkForward?.windows ?? [],
    },
    gateResult,
  };
}

function regimeStability(runs) {
  const available = runs.filter((run) => run.available);
  const augustDependent = available.some((run) => run.concentration?.topPositiveMonth?.month === '2023-08');
  const concentrationProblem = available.some((run) => run.metrics.profitConcentration > GATES.maxProfitConcentration);
  const feeFragile = available.every((run) => run.metrics.expectancySensitivity.minus0_02R <= GATES.minExpectancy);

  return {
    august2023StillDominant: augustDependent,
    oneClusterRisk: concentrationProblem,
    feeSensitivityFragile: feeFragile,
    verdict: augustDependent || concentrationProblem || feeFragile ? 'NOT_STABLE_ENOUGH' : 'STABLE_CANDIDATE_ONLY',
    reason: augustDependent
      ? 'Best month remains August 2023 in one or more extended runs.'
      : concentrationProblem
        ? 'Walk-forward profit concentration remains above threshold.'
        : feeFragile
          ? 'Adjusted expectancy falls below 0.3R after low cost assumptions.'
          : 'No single dominant instability detected.',
  };
}

function reportDecision(runs) {
  const candidates = runs.filter((run) => run.available && run.gateResult.pass);
  return {
    promotionCandidates: candidates.map((run) => ({
      experimentId: run.experimentId,
      range: `${run.range.from} to ${run.range.to}`,
      status: 'PROMOTION_CANDIDATE_ONLY',
    })),
    anyApproved: false,
    paperDay1CanStart: false,
    globalVerdict: 'NOT READY',
    liveExecution: 'STUBBED',
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function reportToMarkdown(report) {
  const summaryRows = report.runs.map((run) => [
    run.variant,
    `${run.range.from} to ${run.range.to}`,
    run.available ? run.metrics.closedTrades : 'unavailable',
    run.available ? `${run.metrics.winRate}%` : '--',
    run.available ? run.metrics.expectancy : '--',
    run.available ? run.metrics.maxDrawdown : '--',
    run.available ? run.metrics.profitFactor : '--',
    run.available ? run.metrics.oosDegradation : '--',
    run.available ? (run.metrics.walkForwardPass ? 'PASS' : 'FAIL') : '--',
    run.available ? run.metrics.profitConcentration : '--',
    run.available ? (run.metrics.samplePass ? 'yes' : 'no') : '--',
    run.available ? run.gateResult.status : 'UNAVAILABLE',
  ]);

  const sensitivityRows = report.runs.filter((run) => run.available).map((run) => [
    run.variant,
    `${run.range.from} to ${run.range.to}`,
    run.metrics.expectancySensitivity.raw,
    run.metrics.expectancySensitivity.minus0_02R,
    run.metrics.expectancySensitivity.minus0_05R,
    run.metrics.expectancySensitivity.minus0_1R,
  ]);

  const concentrationRows = report.runs.filter((run) => run.available).map((run) => [
    run.variant,
    `${run.range.from} to ${run.range.to}`,
    run.concentration.topPositiveMonth?.month ?? 'none',
    run.concentration.topPositiveMonth?.netR ?? 0,
    run.concentration.topPositiveMonthShare,
    run.concentration.top3PositiveMonthShare,
    run.bestMonth?.month ?? 'none',
    run.bestMonth?.netR ?? 0,
    run.worstMonth?.month ?? 'none',
    run.worstMonth?.netR ?? 0,
  ]);

  const monthlyRows = report.runs.flatMap((run) =>
    run.available
      ? run.monthly.map((month) => [
          run.variant,
          `${run.range.from} to ${run.range.to}`,
          month.month,
          month.trades,
          `${month.winRate}%`,
          month.netR,
          month.expectancy,
        ])
      : [[run.variant, `${run.range.from} to ${run.range.to}`, 'unavailable', '--', '--', '--', '--']],
  );

  return `# SOL/USDT 1h Robustness Report

Generated at: ${report.generatedAt}

## Decision
- Active production strategy remains ${report.safety.activeProductionStrategyVersion}.
- Scope: SOL/USDT 1h only, v1.4 trend-strength and v1.4 chop-avoidance.
- No setup is approved.
- Paper Day 1 remains PENDING_SETUP_APPROVAL.
- Global verdict remains NOT READY.
- Live execution remains STUBBED.

## Summary
${markdownTable(['Variant', 'Range', 'Closed', 'Win Rate', 'Expectancy', 'Max DD', 'Profit Factor', 'OOS Deg', 'Walk-Forward', 'Profit Conc', 'Sample >=50', 'Status'], summaryRows)}

## Fee / Slippage Sensitivity
${markdownTable(['Variant', 'Range', 'Raw Exp', '-0.02R', '-0.05R', '-0.10R'], sensitivityRows)}

## Profit Concentration
${markdownTable(['Variant', 'Range', 'Top Month', 'Top Month R', 'Top Month Share', 'Top 3 Share', 'Best Month', 'Best R', 'Worst Month', 'Worst R'], concentrationRows)}

## Monthly R Distribution
${markdownTable(['Variant', 'Range', 'Month', 'Trades', 'Win Rate', 'Net R', 'Expectancy'], monthlyRows)}

## Regime Stability
- Verdict: ${report.regimeStability.verdict}
- August 2023 dominant: ${report.regimeStability.august2023StillDominant ? 'yes' : 'no'}
- Cluster/profit concentration risk: ${report.regimeStability.oneClusterRisk ? 'yes' : 'no'}
- Fee sensitivity fragile: ${report.regimeStability.feeSensitivityFragile ? 'yes' : 'no'}
- Reason: ${report.regimeStability.reason}

## Promotion Status
- Promotion candidates: ${report.decision.promotionCandidates.length ? report.decision.promotionCandidates.map((item) => `${item.experimentId} ${item.range}`).join(', ') : 'none'}
- Even if a numeric candidate appears later, it must be PROMOTION_CANDIDATE_ONLY and needs separate explicit review.
- paperGate and liveGate ignore these experiments.
`;
}

async function main() {
  const runs = [];
  for (const range of RANGES) {
    for (const variant of VARIANTS) {
      runs.push(await summarizeRun(variant, range));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    setup: 'SOL/USDT 1h',
    gates: GATES,
    costAssumptionsR: COSTS_R,
    runs,
    regimeStability: regimeStability(runs),
    decision: reportDecision(runs),
    safety: {
      activeProductionStrategyVersion: activeStrategy.strategyVersion,
      experimentsActiveInProduction: false,
      noAutoApproval: true,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, reportToMarkdown(report));
  console.log(JSON.stringify({
    jsonPath: OUTPUT_JSON,
    markdownPath: OUTPUT_MD,
    promotionCandidates: report.decision.promotionCandidates,
    regimeStability: report.regimeStability,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
