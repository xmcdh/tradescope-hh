import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const EXPERIMENT_ID = 'v1.3-trend-pullback-continuation';
const BEST_V12_ID = 'v1.2-confirmation-close';

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

function setupKey(result) {
  return `${result.pair} ${result.timeframe}`;
}

function oosFailed(flags = []) {
  return flags.some((flag) => ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag));
}

function classify(result) {
  const backtest = result?.backtest ?? {};
  const validation = result?.validation ?? {};
  const flags = validation.flags ?? [];
  const profitConcentration = validation.walkForward?.summary?.profitConcentration ?? 0;
  const closed = backtest.actionableClosedTradeCount ?? 0;
  const expectancy = backtest.actionableExpectancy ?? 0;
  const winRate = backtest.actionableWinRate ?? 0;
  const maxDrawdown = backtest.actionableMaxDrawdown ?? 0;
  const oosDegradation = validation.comparison?.oosDegradation ?? Infinity;
  const walkForwardPass = validation.walkForward?.pass === true;
  const oosPass = !oosFailed(flags);
  const passed =
    closed >= GATES.minClosedTrades &&
    expectancy > GATES.minExpectancy &&
    winRate > GATES.minWinRate &&
    maxDrawdown < GATES.maxDrawdown &&
    oosDegradation <= GATES.maxOosDegradation &&
    walkForwardPass &&
    oosPass &&
    profitConcentration <= GATES.maxProfitConcentration;

  if (passed) {
    return 'CANDIDATE_ONLY_PASSES_METRICS_REQUIRES_EXPLICIT_PROMOTION';
  }

  if (closed < GATES.minClosedTrades) {
    return 'CANDIDATE_ONLY_INSUFFICIENT_SAMPLE';
  }

  return 'CANDIDATE_ONLY_FAILED_METRICS';
}

function summarizeResult(result) {
  const backtest = result?.backtest ?? {};
  const validation = result?.validation ?? {};
  const diagnostics = backtest.diagnostics ?? {};
  const flags = validation.flags ?? [];
  const profitConcentration = validation.walkForward?.summary?.profitConcentration ?? 0;

  return {
    setup: setupKey(result),
    pair: result.pair,
    timeframe: result.timeframe,
    closedActionableTrades: backtest.actionableClosedTradeCount ?? 0,
    distanceTo50: Math.max(0, GATES.minClosedTrades - (backtest.actionableClosedTradeCount ?? 0)),
    winRate: round(backtest.actionableWinRate ?? 0, 2),
    expectancy: round(backtest.actionableExpectancy ?? 0),
    maxDrawdown: round(backtest.actionableMaxDrawdown ?? 0),
    profitFactor: round(backtest.actionableProfitFactor ?? 0),
    netR: round(backtest.actionableNetR ?? 0),
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    oosResult: oosFailed(flags) ? 'FAIL' : 'PASS',
    walkForwardStatus: validation.walkForward?.pass ? 'PASS' : 'FAIL',
    profitConcentration: round(profitConcentration),
    blockedCount: diagnostics.blockedCount ?? 0,
    marginalCount: diagnostics.marginalCount ?? 0,
    validCount: diagnostics.validCount ?? 0,
    longCount: diagnostics.longSignalCount ?? 0,
    shortCount: diagnostics.shortSignalCount ?? 0,
    waitCount: diagnostics.waitCount ?? 0,
    waitRetestCount: diagnostics.waitRetestCount ?? 0,
    noTradeCount: diagnostics.noTradeCount ?? 0,
    hardBlockReasonBreakdown: diagnostics.hardBlockReasonBreakdown ?? {},
    nonActionableReasonBreakdown: diagnostics.nonActionableReasonBreakdown ?? {},
    validationFlags: flags,
    reached50ClosedTrades: (backtest.actionableClosedTradeCount ?? 0) >= GATES.minClosedTrades,
    passedAllGates: classify(result) === 'CANDIDATE_ONLY_PASSES_METRICS_REQUIRES_EXPLICIT_PROMOTION',
    status: classify(result),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function latestBatchSummary(experimentId) {
  const files = await fs.readdir(RESULTS_DIR);
  const summaries = [];

  for (const file of files.filter((item) => item.startsWith('batch-summary-') && item.endsWith('.json'))) {
    const filePath = path.join(RESULTS_DIR, file);
    const stat = await fs.stat(filePath);
    const summary = await readJson(filePath);
    if (summary?.metadata?.experimentId === experimentId) {
      summaries.push({ file, filePath, stat, summary });
    }
  }

  return summaries.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0] ?? null;
}

function summarizeBaseline(report) {
  return {
    label: 'v1.1 baseline',
    strategyVersion: report?.summary?.metadata?.strategyVersion ?? report?.strategyVersion ?? 'v1.1-atr-risk',
    proofStatus: report?.summary?.proof?.status ?? null,
    results: (report?.summary?.results ?? []).map(summarizeResult),
  };
}

function summarizeBestV12(comparison) {
  const variant = (comparison?.variants ?? []).find((item) => item.experimentId === BEST_V12_ID);
  return {
    label: 'best v1.2 candidate',
    experimentId: BEST_V12_ID,
    strategyVersion: variant?.strategyVersion ?? BEST_V12_ID,
    proofStatus: variant?.proofStatus ?? null,
    tested: Boolean(variant?.tested),
    results: variant?.results ?? [],
    antiOverfittingFlags: variant?.antiOverfittingFlags ?? [],
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function topReasonMap(results, key) {
  const counts = {};
  for (const result of results) {
    for (const [reason, count] of Object.entries(result[key] ?? {})) {
      counts[reason] = (counts[reason] ?? 0) + count;
    }
  }

  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 12));
}

function buildMarkdown(report) {
  const rows = report.v13.results.map((result) => [
    result.setup,
    result.closedActionableTrades,
    result.distanceTo50,
    `${result.winRate}%`,
    result.expectancy,
    result.maxDrawdown,
    result.profitFactor,
    result.oosResult,
    result.walkForwardStatus,
    result.profitConcentration,
    result.status,
  ]);
  const comparisonRows = [
    ...report.baseline.results.map((result) => ['v1.1 baseline', result.setup, result.closedActionableTrades, `${result.winRate}%`, result.expectancy, result.status]),
    ...report.bestV12.results.map((result) => [report.bestV12.experimentId, result.setup, result.closedActionableTrades, `${result.winRate}%`, result.expectancy, result.status]),
    ...report.v13.results.map((result) => [EXPERIMENT_ID, result.setup, result.closedActionableTrades, `${result.winRate}%`, result.expectancy, result.status]),
  ];

  return `# v1.3 Trend Pullback Continuation Report

Generated at: ${report.generatedAt}

## Decision
- Experiment: ${EXPERIMENT_ID}
- Status: CANDIDATE_ONLY
- Any setup reached 50 closed trades: ${report.summary.anySetupReached50 ? 'yes' : 'no'}
- Any setup passed all gates: ${report.summary.anySetupPassedAllGates ? 'yes' : 'no'}
- Paper Day 1: PENDING_SETUP_APPROVAL
- Global verdict: NOT READY
- Live execution: STUBBED

## v1.3 Metrics
${markdownTable(['Setup', 'Closed', 'Distance To 50', 'Win Rate', 'Expectancy', 'Max DD', 'Profit Factor', 'OOS', 'Walk-Forward', 'Profit Concentration', 'Status'], rows)}

## Comparison
${markdownTable(['Variant', 'Setup', 'Closed', 'Win Rate', 'Expectancy', 'Status'], comparisonRows)}

## BLOCKED / MARGINAL Breakdown
- Total BLOCKED: ${report.summary.blockedCount}
- Total MARGINAL: ${report.summary.marginalCount}
- Total VALID: ${report.summary.validCount}
- Top hard blocks: ${JSON.stringify(report.summary.topHardBlocks)}
- Top non-actionable reasons: ${JSON.stringify(report.summary.topNonActionableReasons)}

## Safety
- Active production strategy remains locked outside this experiment.
- v1.3 results are backtest-only metadata.
- No setup is auto-approved.
- liveGate and paperGate remain ineligible for experimental versions.
`;
}

async function main() {
  const baselineReport = await readOptionalJson(path.join(RESULTS_DIR, 'report.json'));
  const v12Comparison = await readOptionalJson(path.join(RESULTS_DIR, 'v1.2-experiment-comparison.json'));
  const latest = await latestBatchSummary(EXPERIMENT_ID);
  const v13Results = latest?.summary?.results?.map(summarizeResult) ?? [];
  const summary = {
    anySetupReached50: v13Results.some((result) => result.reached50ClosedTrades),
    anySetupPassedAllGates: v13Results.some((result) => result.passedAllGates),
    bestSetup: v13Results
      .slice()
      .sort((left, right) => right.closedActionableTrades - left.closedActionableTrades || right.expectancy - left.expectancy)[0] ?? null,
    blockedCount: v13Results.reduce((sum, result) => sum + result.blockedCount, 0),
    marginalCount: v13Results.reduce((sum, result) => sum + result.marginalCount, 0),
    validCount: v13Results.reduce((sum, result) => sum + result.validCount, 0),
    topHardBlocks: topReasonMap(v13Results, 'hardBlockReasonBreakdown'),
    topNonActionableReasons: topReasonMap(v13Results, 'nonActionableReasonBreakdown'),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    experimentId: EXPERIMENT_ID,
    strategyVersion: EXPERIMENT_ID,
    sourceFile: latest?.filePath ?? null,
    tested: Boolean(latest),
    gates: GATES,
    baseline: summarizeBaseline(baselineReport),
    bestV12: summarizeBestV12(v12Comparison),
    v13: {
      experimentId: EXPERIMENT_ID,
      strategyVersion: latest?.summary?.metadata?.strategyVersion ?? EXPERIMENT_ID,
      proofStatus: latest?.summary?.proof?.status ?? null,
      results: v13Results,
    },
    summary,
    safety: {
      candidateOnly: true,
      noAutoPromotion: true,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(path.join(RESULTS_DIR, 'v1.3-trend-pullback-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(RESULTS_DIR, 'v1.3-trend-pullback-report.md'), buildMarkdown(report));

  console.log(JSON.stringify({
    experimentId: EXPERIMENT_ID,
    tested: report.tested,
    sourceFile: report.sourceFile,
    bestSetup: report.summary.bestSetup?.setup ?? null,
    anySetupReached50: report.summary.anySetupReached50,
    anySetupPassedAllGates: report.summary.anySetupPassedAllGates,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
