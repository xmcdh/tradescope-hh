import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v14QualityFilterExperiments } from '../config/strategyExperiments.js';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const V13_REPORT_PATH = path.join(RESULTS_DIR, 'v1.3-trend-pullback-report.json');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'v1.4-quality-filter-comparison.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'v1.4-quality-filter-comparison.md');

const GATES = {
  minClosedTrades: 50,
  minExpectancy: 0.3,
  minWinRate: 45,
  maxDrawdown: 0.15,
  maxOosDegradation: 0.15,
  maxProfitConcentration: 0.6,
};

const FOCUS_SETUPS = new Set(['SOL/USDT 1h', 'SOLUSDT 1h', 'BNB/USDT 15m', 'BNBUSDT 15m']);

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function setupKey(result) {
  return `${result.pair} ${result.timeframe}`;
}

function dominantReason(...maps) {
  const counts = {};
  const ignored = new Set([
    'Signal NO_TRADE is not executable; backtester opens LONG/SHORT only.',
    'Signal WAIT is not executable; backtester opens LONG/SHORT only.',
    'Signal WAIT_RETEST is not executable; backtester opens LONG/SHORT only.',
  ]);
  for (const map of maps) {
    for (const [reason, count] of Object.entries(map ?? {})) {
      if (ignored.has(reason)) {
        continue;
      }
      counts[reason] = (counts[reason] ?? 0) + count;
    }
  }

  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'none';
}

function oosFailed(flags = []) {
  return flags.some((flag) => ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag));
}

function classifyStatus(metrics) {
  if (metrics.closedActionableTrades < GATES.minClosedTrades) {
    return 'FAILED_SAMPLE';
  }

  if (metrics.expectancy <= GATES.minExpectancy) {
    return 'FAILED_EXPECTANCY';
  }

  if (metrics.winRate <= GATES.minWinRate) {
    return 'FAILED_WIN_RATE';
  }

  if (metrics.maxDrawdown >= GATES.maxDrawdown) {
    return 'FAILED_DRAWDOWN';
  }

  if (metrics.oosResult !== 'PASS' || metrics.oosDegradation > GATES.maxOosDegradation) {
    return 'FAILED_OOS';
  }

  if (metrics.walkForwardStatus !== 'PASS') {
    return 'FAILED_WALK_FORWARD';
  }

  if (metrics.profitConcentration > GATES.maxProfitConcentration) {
    return 'FAILED_PROFIT_CONCENTRATION';
  }

  return 'PROMOTION_CANDIDATE';
}

function summarizeResult(result) {
  const backtest = result?.backtest ?? {};
  const validation = result?.validation ?? {};
  const diagnostics = backtest.diagnostics ?? {};
  const flags = validation.flags ?? [];
  const profitConcentration = validation.walkForward?.summary?.profitConcentration ?? 0;
  const metrics = {
    setup: setupKey(result),
    pair: result.pair,
    timeframe: result.timeframe,
    strategyVersion: result.metadata?.strategyVersion ?? result.strategyVersion ?? null,
    experimentId: result.metadata?.experimentId ?? result.experimentId ?? null,
    closedActionableTrades: backtest.actionableClosedTradeCount ?? result.closedActionableTrades ?? 0,
    winRate: round(backtest.actionableWinRate ?? result.winRate ?? 0, 2),
    expectancy: round(backtest.actionableExpectancy ?? result.expectancy ?? 0),
    maxDrawdown: round(backtest.actionableMaxDrawdown ?? result.maxDrawdown ?? 0),
    profitFactor: round(backtest.actionableProfitFactor ?? result.profitFactor ?? 0),
    netR: round(backtest.actionableNetR ?? result.netR ?? 0),
    oosDegradation: round(validation.comparison?.oosDegradation ?? result.oosDegradation ?? 0),
    oosResult: oosFailed(flags) || result.oosResult === 'FAIL' ? 'FAIL' : 'PASS',
    walkForwardStatus: validation.walkForward?.pass || result.walkForwardStatus === 'PASS' ? 'PASS' : 'FAIL',
    profitConcentration: round(profitConcentration || result.profitConcentration || 0),
    validationFlags: flags.length ? flags : result.validationFlags ?? [],
    dominantBlockedOrMarginalReason: dominantReason(
      diagnostics.hardBlockReasonBreakdown,
      diagnostics.nonActionableReasonBreakdown,
      result.hardBlockReasonBreakdown,
      result.nonActionableReasonBreakdown,
    ),
  };

  metrics.sampleDistanceTo50 = Math.max(0, GATES.minClosedTrades - metrics.closedActionableTrades);
  metrics.status = classifyStatus(metrics);
  metrics.passedAllGates = metrics.status === 'PROMOTION_CANDIDATE';
  return metrics;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestSummariesForExperiments(experimentIds) {
  const needed = new Set(experimentIds);
  const found = new Map();
  const files = await fs.readdir(RESULTS_DIR);
  const candidates = await Promise.all(
    files
      .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { file, filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  for (const candidate of candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    if (!needed.size) {
      break;
    }

    const summary = await readJson(candidate.filePath);
    const experimentId = summary?.metadata?.experimentId;
    if (needed.has(experimentId) && summary?.metadata?.experimentFamily === 'v1.4-quality-filter') {
      found.set(experimentId, { ...candidate, summary });
      needed.delete(experimentId);
    }
  }

  return found;
}

function variantSummary(experiment, found) {
  if (!found) {
    return {
      experimentId: experiment.experimentId,
      strategyVersion: experiment.strategyVersion,
      label: experiment.label,
      tested: false,
      sourceFile: null,
      generatedAt: null,
      candidateOnly: true,
      backtestOnly: true,
      liveGateEligible: false,
      paperGateEligible: false,
      results: [],
      setupStatuses: {},
      anyPromotionCandidate: false,
    };
  }

  const results = (found.summary.results ?? []).map(summarizeResult);
  return {
    experimentId: experiment.experimentId,
    strategyVersion: found.summary.metadata?.strategyVersion ?? experiment.strategyVersion,
    label: experiment.label,
    tested: true,
    sourceFile: found.filePath,
    generatedAt: found.summary.generatedAt,
    proofStatus: found.summary.proof?.status ?? null,
    candidateOnly: true,
    backtestOnly: true,
    liveGateEligible: false,
    paperGateEligible: false,
    results,
    setupStatuses: Object.fromEntries(results.map((result) => [result.setup, result.status])),
    anyPromotionCandidate: results.some((result) => result.status === 'PROMOTION_CANDIDATE'),
  };
}

function compareSetup({ setup, baseline, variants }) {
  const rows = variants
    .map((variant) => ({
      experimentId: variant.experimentId,
      result: variant.results.find((result) => result.setup === setup) ?? null,
    }))
    .filter((item) => item.result);

  const bestExpectancy = rows.sort((left, right) => right.result.expectancy - left.result.expectancy)[0] ?? null;
  const bestDrawdown = rows.sort((left, right) => left.result.maxDrawdown - right.result.maxDrawdown)[0] ?? null;
  const baselineResult = baseline.find((result) => result.setup === setup) ?? null;

  return {
    setup,
    baseline: baselineResult,
    bestExpectancyVariant: bestExpectancy
      ? {
          experimentId: bestExpectancy.experimentId,
          expectancy: bestExpectancy.result.expectancy,
          closedActionableTrades: bestExpectancy.result.closedActionableTrades,
          status: bestExpectancy.result.status,
        }
      : null,
    bestDrawdownVariant: bestDrawdown
      ? {
          experimentId: bestDrawdown.experimentId,
          maxDrawdown: bestDrawdown.result.maxDrawdown,
          closedActionableTrades: bestDrawdown.result.closedActionableTrades,
          status: bestDrawdown.result.status,
        }
      : null,
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildMarkdown(report) {
  const rows = [
    ...report.baseline.results.map((result) => [
      'v1.3 baseline',
      result.setup,
      result.closedActionableTrades,
      `${result.winRate}%`,
      result.expectancy,
      result.maxDrawdown,
      result.profitFactor,
      result.oosDegradation,
      result.walkForwardStatus,
      result.profitConcentration,
      result.sampleDistanceTo50,
      result.status,
      result.dominantBlockedOrMarginalReason,
    ]),
    ...report.variants.flatMap((variant) =>
      variant.tested
        ? variant.results.map((result) => [
            variant.experimentId,
            result.setup,
            result.closedActionableTrades,
            `${result.winRate}%`,
            result.expectancy,
            result.maxDrawdown,
            result.profitFactor,
            result.oosDegradation,
            result.walkForwardStatus,
            result.profitConcentration,
            result.sampleDistanceTo50,
            result.status,
            result.dominantBlockedOrMarginalReason,
          ])
        : [[variant.experimentId, 'ALL', 'not tested', '--', '--', '--', '--', '--', '--', '--', '--', 'FAILED_SAMPLE', 'No batch summary found']],
    ),
  ];

  const focusRows = Object.values(report.focusAnalysis).map((focus) => [
    focus.setup,
    focus.baseline?.closedActionableTrades ?? '--',
    focus.baseline?.expectancy ?? '--',
    focus.baseline?.maxDrawdown ?? '--',
    focus.bestExpectancyVariant?.experimentId ?? '--',
    focus.bestExpectancyVariant?.expectancy ?? '--',
    focus.bestExpectancyVariant?.closedActionableTrades ?? '--',
    focus.bestExpectancyVariant?.status ?? '--',
    focus.bestDrawdownVariant?.experimentId ?? '--',
    focus.bestDrawdownVariant?.maxDrawdown ?? '--',
  ]);

  const candidateRows = report.promotionCandidates.length
    ? report.promotionCandidates.map((item) => [item.experimentId, item.setup, item.expectancy, item.winRate, item.maxDrawdown])
    : [['none', 'none', '--', '--', '--']];

  return `# v1.4 Quality Filter Comparison

Generated at: ${report.generatedAt}

## Decision
- Active production strategy: ${report.safety.activeProductionStrategyVersion}
- v1.4 status: backtest-only research
- No setup is auto-approved.
- Paper Day 1: PENDING_SETUP_APPROVAL
- Global verdict: NOT READY
- Live execution: STUBBED

## Strict Gate Result
- Promotion candidates found: ${report.promotionCandidates.length}
- Old v1.0/v1.1/v1.2/v1.3 results are not counted as v1.4 approval.
- A promotion candidate still requires explicit review before any paper gate change.

## Metrics
${markdownTable(['Variant', 'Setup', 'Closed', 'Win Rate', 'Expectancy', 'Max DD', 'Profit Factor', 'OOS Deg', 'Walk-Forward', 'Profit Conc', 'Distance To 50', 'Status', 'Dominant Reason'], rows)}

## Focus Analysis
${markdownTable(['Setup', 'Baseline Closed', 'Baseline Exp', 'Baseline DD', 'Best Exp Variant', 'Best Exp', 'Best Exp Closed', 'Best Exp Status', 'Best DD Variant', 'Best DD'], focusRows)}

## Promotion Candidates
${markdownTable(['Variant', 'Setup', 'Expectancy', 'Win Rate', 'Max DD'], candidateRows)}

## Safety
- Active production strategy remains v1.1-atr-risk.
- v1.2, v1.3, and v1.4 remain backtest-only.
- paperGate and liveGate ignore experiments.
- Paper Day 1 remains PENDING_SETUP_APPROVAL unless an explicit later promotion changes it.
- Live execution remains STUBBED.
`;
}

async function main() {
  const v13Report = await readJson(V13_REPORT_PATH);
  const experimentIds = v14QualityFilterExperiments.map((experiment) => experiment.experimentId);
  const summaries = await latestSummariesForExperiments(experimentIds);
  const baselineResults = (v13Report.v13?.results ?? []).map(summarizeResult);
  const variants = v14QualityFilterExperiments.map((experiment) => variantSummary(experiment, summaries.get(experiment.experimentId)));
  const promotionCandidates = variants.flatMap((variant) =>
    variant.results
      .filter((result) => result.status === 'PROMOTION_CANDIDATE')
      .map((result) => ({ experimentId: variant.experimentId, ...result })),
  );
  const focusSetups = [...new Set([
    ...baselineResults.map((result) => result.setup).filter((setup) => FOCUS_SETUPS.has(setup)),
    'SOL/USDT 1h',
    'BNB/USDT 15m',
  ])];
  const focusAnalysis = Object.fromEntries(
    focusSetups.map((setup) => [
      setup,
      compareSetup({
        setup,
        baseline: baselineResults,
        variants,
      }),
    ]),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    baseline: {
      experimentId: 'v1.3-trend-pullback-continuation',
      sourceFile: V13_REPORT_PATH,
      results: baselineResults,
    },
    variants,
    focusAnalysis,
    promotionCandidates,
    gates: GATES,
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
  await fs.writeFile(OUTPUT_MD, buildMarkdown(report));
  console.log(JSON.stringify({
    jsonPath: OUTPUT_JSON,
    markdownPath: OUTPUT_MD,
    testedVariants: variants.filter((variant) => variant.tested).length,
    promotionCandidates: promotionCandidates.map((item) => `${item.experimentId} ${item.setup}`),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
