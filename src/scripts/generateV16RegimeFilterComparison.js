import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.6-regime-filter-comparison.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.6-regime-filter-comparison.md');

const BASELINE_ID = 'v1.5-trailing-after-1r';
const VARIANTS = [
  'v1.6-impulse-filter-soft',
  'v1.6-impulse-filter-medium',
  'v1.6-low-volatility-filter',
  'v1.6-bearish-regime-filter',
  'v1.6-combined-regime-filter',
];
const RANGES = [
  { from: '2022-07-01', to: '2024-07-01' },
  { from: '2022-01-01', to: '2024-07-01' },
  { from: '2021-07-01', to: '2024-07-01' },
];
const COSTS = [0.02, 0.05, 0.1];

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
  const closed = trades.filter((trade) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(trade.outcome));
  const returns = closed.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = closed.filter((trade) => trade.outcome === 'WIN').length;
  const losses = closed.filter((trade) => trade.outcome === 'LOSS').length;
  const netR = returns.reduce((sum, value) => sum + value, 0);
  const positive = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  return {
    closed: closed.length,
    wins,
    losses,
    netR: round(netR),
    winRate: closed.length ? round((wins / closed.length) * 100, 2) : 0,
    expectancy: closed.length ? round(netR / closed.length) : 0,
    costAdjustedExpectancy: Object.fromEntries(COSTS.map((cost) => [`minus${String(cost).replace('.', '')}R`, closed.length ? round((netR / closed.length) - cost) : 0])),
    profitFactor: negative > 0 ? round(positive / negative) : positive > 0 ? Infinity : 0,
  };
}

function groupByPeriod(trades, getter) {
  const groups = new Map();
  for (const trade of trades.filter((item) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(item.outcome))) {
    const key = getter(trade.exitTimestamp ?? trade.timestamp);
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([period, items]) => ({
      period,
      ...summarizeTrades(items),
    }));
}

function topShare(rows) {
  const positiveRows = rows.filter((row) => row.netR > 0);
  const totalPositive = positiveRows.reduce((sum, row) => sum + row.netR, 0);
  if (totalPositive <= 0) {
    return { period: null, share: 0, netR: 0 };
  }

  const top = positiveRows.slice().sort((left, right) => right.netR - left.netR)[0];
  return {
    period: top.period,
    share: round(top.netR / totalPositive, 4),
    netR: top.netR,
  };
}

function dominantReason(map = {}) {
  const entries = Object.entries(map);
  if (!entries.length) {
    return null;
  }
  const [reason, count] = entries.sort((left, right) => right[1] - left[1])[0];
  return { reason, count };
}

function classify(metrics, validation, monthlyTop, quarterlyTop) {
  const flags = [];
  const oosDegradation = validation?.comparison?.oosDegradation ?? Infinity;
  const walkForwardPass = validation?.walkForward?.pass === true;
  const profitConcentration = validation?.walkForward?.summary?.profitConcentration ?? 0;

  if (metrics.closed < 50) flags.push('FAILED_SAMPLE');
  if (metrics.expectancy <= 0.3) flags.push('FAILED_EXPECTANCY');
  if ((metrics.costAdjustedExpectancy.minus002R ?? -Infinity) <= 0.3) flags.push('FAILED_COST_SENSITIVITY');
  if ((validation?.inSample?.actionableMaxDrawdown ?? validation?.comparison?.maxDrawdown ?? 0) >= 0.15) flags.push('FAILED_DRAWDOWN');
  if (oosDegradation > 0.15 || (validation?.flags ?? []).some((flag) => String(flag).startsWith('OOS_'))) flags.push('FAILED_OOS');
  if (!walkForwardPass) flags.push('FAILED_WALK_FORWARD');
  if (profitConcentration > 0.6 || monthlyTop.share > 0.35 || quarterlyTop.share > 0.45) flags.push('FAILED_PROFIT_CONCENTRATION');

  if (!flags.length) {
    return ['PROMOTION_CANDIDATE_ONLY'];
  }

  return [...new Set([...flags, 'CANDIDATE_ONLY'])];
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestPayload(experimentId, range) {
  const files = await fs.readdir(RESULTS_DIR);
  const prefix = `${experimentId}-SOL-USDT-1h-${range.from}-to-${range.to}-`;
  const matches = [];
  for (const file of files.filter((item) => item.startsWith(prefix) && item.endsWith('.json'))) {
    const filePath = path.join(RESULTS_DIR, file);
    const stat = await fs.stat(filePath);
    matches.push({ file, filePath, stat });
  }

  const found = matches.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
  if (!found) {
    return null;
  }

  return {
    file: found.file,
    filePath: found.filePath,
    payload: await readJson(found.filePath),
  };
}

function summarizePayload(found, range) {
  if (!found) {
    return {
      range,
      tested: false,
      status: ['NOT_TESTED'],
    };
  }

  const payload = found.payload;
  const trades = payload.backtest?.trades ?? [];
  const metrics = summarizeTrades(trades);
  const monthlyR = groupByPeriod(trades, monthKey);
  const quarterlyR = groupByPeriod(trades, quarterKey);
  const monthlyTop = topShare(monthlyR);
  const quarterlyTop = topShare(quarterlyR);
  const validation = payload.validation ?? {};
  const status = classify(metrics, validation, monthlyTop, quarterlyTop);

  return {
    range,
    tested: true,
    sourceFile: found.file,
    experimentId: payload.metadata?.experimentId,
    strategyVersion: payload.metadata?.strategyVersion,
    regimeFilter: payload.metadata?.regimeFilter ?? null,
    exitGeometry: payload.metadata?.exitGeometry ?? null,
    closedActionableTrades: metrics.closed,
    sampleDistanceTo50: Math.max(0, 50 - metrics.closed),
    winRate: metrics.winRate,
    rawExpectancy: metrics.expectancy,
    costAdjustedExpectancy: metrics.costAdjustedExpectancy,
    maxDrawdown: round(payload.backtest?.actionableMaxDrawdown ?? 0),
    profitFactor: metrics.profitFactor,
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    walkForwardResult: validation.walkForward?.pass ? 'PASS' : 'FAIL',
    profitConcentration: round(validation.walkForward?.summary?.profitConcentration ?? 0),
    monthlyR,
    quarterlyR,
    topMonthShare: monthlyTop,
    topQuarterShare: quarterlyTop,
    dominantBlockedReason: dominantReason(payload.backtest?.diagnostics?.hardBlockReasonBreakdown),
    dominantMarginalReason: dominantReason(payload.backtest?.diagnostics?.nonActionableReasonBreakdown),
    validationFlags: validation.flags ?? [],
    status,
    antiOverfitWarnings: [
      metrics.closed < 50 ? 'SAMPLE_BELOW_50' : null,
      monthlyTop.period === '2023-08' ? 'TOP_MONTH_2023_08' : null,
      quarterlyTop.period === '2023-Q3' ? 'TOP_QUARTER_2023_Q3' : null,
      monthlyTop.share > 0.35 ? 'SINGLE_MONTH_CLUSTER' : null,
      quarterlyTop.share > 0.45 ? 'SINGLE_QUARTER_CLUSTER' : null,
      status.includes('FAILED_PROFIT_CONCENTRATION') ? 'PROFIT_CONCENTRATION' : null,
    ].filter(Boolean),
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function toMarkdown(report) {
  const rows = [];
  for (const block of [report.baseline, ...report.variants]) {
    for (const run of block.runs) {
      rows.push([
        block.experimentId,
        `${run.range.from} to ${run.range.to}`,
        run.tested ? run.closedActionableTrades : 'not tested',
        run.tested ? `${run.winRate}%` : '--',
        run.tested ? run.rawExpectancy : '--',
        run.tested ? run.costAdjustedExpectancy.minus002R : '--',
        run.tested ? run.maxDrawdown : '--',
        run.tested ? run.profitFactor : '--',
        run.tested ? run.walkForwardResult : '--',
        run.tested ? run.profitConcentration : '--',
        run.tested ? `${run.topMonthShare.period ?? '--'} (${run.topMonthShare.share})` : '--',
        run.status.join(', '),
      ]);
    }
  }

  const focus = report.focus;
  return `# SOL/USDT 1h v1.6 Regime Filter Comparison

Generated at: ${report.generatedAt}

## Safety
- Active production strategy: ${report.safety.activeProductionStrategy}
- v1.5/v1.6 backtest-only: yes
- Approved setups: 0
- Paper Day 1: PENDING_SETUP_APPROVAL
- Global verdict: NOT READY
- Live execution: STUBBED

## Metrics
${markdownTable(['Experiment', 'Range', 'Closed', 'Win Rate', 'Raw Exp', 'Exp -0.02R', 'Max DD', 'PF', 'WF', 'Profit Conc.', 'Top Month Share', 'Status'], rows)}

## Focus
- Any variant keeps sample >=50: ${focus.anySampleAbove50 ? 'yes' : 'no'}
- Any variant keeps -0.02R expectancy above 0.3R: ${focus.anyCostAdjustedAbove03 ? 'yes' : 'no'}
- Any promotion candidate only: ${focus.anyPromotionCandidateOnly ? 'yes' : 'no'}
- Best long-run raw expectancy: ${focus.bestLongRun?.experimentId ?? 'none'} (${focus.bestLongRun?.rawExpectancy ?? '--'}R)
- Best long-run cost-adjusted -0.02R expectancy: ${focus.bestLongRun?.costAdjustedExpectancy?.minus002R ?? '--'}R
- Best long-run status: ${focus.bestLongRun?.status?.join(', ') ?? '--'}

## Decision
No setup is auto-approved. A PROMOTION_CANDIDATE_ONLY result would still require separate human review before paper Day 1.
`;
}

async function main() {
  const baselineRuns = [];
  for (const range of RANGES) {
    baselineRuns.push(summarizePayload(await latestPayload(BASELINE_ID, range), range));
  }

  const variants = [];
  for (const experimentId of VARIANTS) {
    const runs = [];
    for (const range of RANGES) {
      runs.push(summarizePayload(await latestPayload(experimentId, range), range));
    }
    variants.push({ experimentId, runs });
  }

  const longRun = { from: '2021-07-01', to: '2024-07-01' };
  const longRunResults = variants
    .map((variant) => variant.runs.find((run) => run.range.from === longRun.from && run.range.to === longRun.to))
    .filter((run) => run?.tested);
  const bestLongRun = longRunResults
    .slice()
    .sort((left, right) => right.rawExpectancy - left.rawExpectancy)[0] ?? null;
  const allRuns = variants.flatMap((variant) => variant.runs.filter((run) => run.tested));

  const report = {
    generatedAt: new Date().toISOString(),
    subject: {
      pair: 'SOL/USDT',
      timeframe: '1h',
      baseExperiment: BASELINE_ID,
    },
    safety: {
      activeProductionStrategy: 'v1.1-atr-risk',
      approvedSetups: 0,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
    baseline: {
      experimentId: BASELINE_ID,
      runs: baselineRuns,
    },
    variants,
    focus: {
      anySampleAbove50: allRuns.some((run) => run.closedActionableTrades >= 50),
      anyCostAdjustedAbove03: allRuns.some((run) => run.costAdjustedExpectancy.minus002R > 0.3),
      anyPromotionCandidateOnly: allRuns.some((run) => run.status.includes('PROMOTION_CANDIDATE_ONLY')),
      bestLongRun,
    },
  };

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, toMarkdown(report));
  console.log(JSON.stringify({
    outputJson: OUTPUT_JSON,
    outputMarkdown: OUTPUT_MD,
    anyPromotionCandidateOnly: report.focus.anyPromotionCandidateOnly,
    bestLongRun: report.focus.bestLongRun
      ? {
          experimentId: report.focus.bestLongRun.experimentId,
          rawExpectancy: report.focus.bestLongRun.rawExpectancy,
          costAdjustedMinus002: report.focus.bestLongRun.costAdjustedExpectancy.minus002R,
          status: report.focus.bestLongRun.status,
        }
      : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
