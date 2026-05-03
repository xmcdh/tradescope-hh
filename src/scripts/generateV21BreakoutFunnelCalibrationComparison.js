import fs from 'node:fs/promises';
import path from 'node:path';
import { getStrategyExperiment } from '../config/strategyExperiments.js';

const RESULTS_DIR = 'backtest-results';
const BASELINE_EXPERIMENT_ID = 'v2-breakout-volume-expansion';
const VARIANT_IDS = [
  'v2.1-breakout-close-buffer-soft',
  'v2.1-breakout-body-soft',
  'v2.1-opposing-room-soft',
  'v2.1-volume-expansion-soft',
  'v2.1-breakout-structure-balanced',
];
const EXPERIMENT_IDS = [BASELINE_EXPERIMENT_ID, ...VARIANT_IDS];
const COSTS_R = [0.02, 0.05, 0.1];
const GATES = {
  minClosedTrades: 50,
  minWinRate: 45,
  minRawExpectancy: 0.3,
  minCostAdjustedExpectancyMinus0_02R: 0.3,
  maxDrawdown: 0.15,
  maxOosDegradation: 0.15,
  maxProfitConcentration: 0.6,
};

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function costAdjusted(rawExpectancy) {
  return Object.fromEntries(COSTS_R.map((cost) => [`minus${cost.toFixed(2).replace('.', '_')}R`, round(rawExpectancy - cost)]));
}

function dominantReason(breakdown = {}) {
  const [reason, count] = Object.entries(breakdown).sort((left, right) => right[1] - left[1])[0] ?? [];
  return reason ? { reason, count } : null;
}

function v2DiagnosticsFromBacktest(backtest = {}) {
  const diagnostics = backtest.diagnostics ?? {};
  const v2 = diagnostics.v2Breakout ?? {};
  const primaryBreakdown = v2.primaryBlockedReasonBreakdown ?? {};

  return {
    candlesEvaluated: diagnostics.totalCandlesEvaluated ?? 0,
    compressionDetections: v2.compressionZoneDetectedCount ?? 0,
    breakoutCandidates: v2.breakoutCandidateCount ?? 0,
    volumeExpansionPass: v2.volumeExpansionPassCount ?? 0,
    rangeExpansionPass: v2.rangeAtrExpansionPassCount ?? 0,
    bodyQualityPass: v2.bodyQualityPassCount ?? 0,
    wickFailure: v2.rejectionWickFailureCount ?? 0,
    opposingLevelRoomFailure: v2.opposingLevelRoomFailureCount ?? 0,
    rrFailure: v2.rrFailureCount ?? 0,
    executableLong: v2.validExecutableLongCount ?? 0,
    executableShort: v2.validExecutableShortCount ?? 0,
    executableLongShort: (v2.validExecutableLongCount ?? 0) + (v2.validExecutableShortCount ?? 0),
    closedTrades: diagnostics.simulatedTradeClosedCount ?? 0,
    blockedReasonBreakdown: v2.blockedReasonBreakdown ?? {},
    primaryBlockedReasonBreakdown: primaryBreakdown,
    dominantBlocker: dominantReason(primaryBreakdown),
  };
}

function classifySetup(metrics) {
  const failures = [];

  if (metrics.closedActionableTrades < GATES.minClosedTrades) {
    failures.push('FAILED_SAMPLE');
  }
  if (metrics.winRate <= GATES.minWinRate) {
    failures.push('FAILED_EXPECTANCY');
  }
  if (metrics.rawExpectancy <= GATES.minRawExpectancy) {
    failures.push('FAILED_EXPECTANCY');
  }
  if (metrics.costAdjustedExpectancy.minus0_02R <= GATES.minCostAdjustedExpectancyMinus0_02R) {
    failures.push('FAILED_COST_SENSITIVITY');
  }
  if (metrics.maxDrawdown >= GATES.maxDrawdown) {
    failures.push('FAILED_DRAWDOWN');
  }
  if (!Number.isFinite(metrics.oosDegradation) || metrics.oosDegradation > GATES.maxOosDegradation || metrics.oosResult !== 'PASS') {
    failures.push('FAILED_WALK_FORWARD');
  }
  if (metrics.walkForwardResult !== 'PASS') {
    failures.push('FAILED_WALK_FORWARD');
  }
  if (metrics.profitConcentration > GATES.maxProfitConcentration || metrics.singleMonthDominates) {
    failures.push('FAILED_PROFIT_CONCENTRATION');
  }

  const uniqueFailures = [...new Set(failures)];
  return {
    status: uniqueFailures.length ? uniqueFailures[0] : 'PROMOTION_CANDIDATE_ONLY',
    failureReasons: uniqueFailures,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestSummaryForExperiment(experimentId) {
  const files = await fs.readdir(RESULTS_DIR);
  const candidates = [];

  for (const file of files.filter((item) => item.startsWith('batch-summary-') && item.endsWith('.json'))) {
    const filePath = path.join(RESULTS_DIR, file);
    const summary = await readJson(filePath);
    if (summary?.metadata?.experimentId !== experimentId) {
      continue;
    }
    const stat = await fs.stat(filePath);
    candidates.push({ filePath, summary, stat });
  }

  return candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0] ?? null;
}

async function enrichResult(experimentId, result) {
  const backtest = result.backtest ?? {};
  const validation = result.validation ?? {};
  const rawExpectancy = Number(backtest.actionableExpectancy ?? 0);
  const netR = Number(backtest.actionableNetR ?? 0);
  const profitConcentration = Number(validation.walkForward?.summary?.profitConcentration ?? 0);
  const singleMonthDominates = profitConcentration > GATES.maxProfitConcentration;
  const oosFailed = (validation.flags ?? []).some((flag) =>
    ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag),
  );
  const metrics = {
    experimentId,
    setup: `${result.pair} ${result.timeframe}`,
    pair: result.pair,
    timeframe: result.timeframe,
    closedActionableTrades: backtest.actionableClosedTradeCount ?? 0,
    actionableTrades: backtest.actionableTradeCount ?? 0,
    sampleReached50: (backtest.actionableClosedTradeCount ?? 0) >= GATES.minClosedTrades,
    winRate: round(backtest.actionableWinRate ?? 0, 2),
    rawExpectancy: round(rawExpectancy),
    costAdjustedExpectancy: costAdjusted(rawExpectancy),
    maxDrawdown: round(backtest.actionableMaxDrawdown ?? 0),
    profitFactor: round(backtest.actionableProfitFactor ?? 0),
    netR: round(netR),
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    oosResult: oosFailed ? 'FAIL' : 'PASS',
    walkForwardResult: validation.walkForward?.pass ? 'PASS' : 'FAIL',
    walkForwardFlags: validation.walkForward?.flags ?? [],
    profitConcentration: round(profitConcentration),
    singleMonthDominates,
    topMonth: null,
    monthlyDistribution: [],
    funnelStats: v2DiagnosticsFromBacktest(backtest),
  };
  const classification = classifySetup(metrics);

  return {
    ...metrics,
    status: classification.status,
    failureReasons: classification.failureReasons,
    antiOverfittingFlags: buildAntiOverfittingFlags(metrics),
    outputPath: result.outputPath ?? null,
  };
}

function buildAntiOverfittingFlags(metrics) {
  const flags = [];

  if (metrics.sampleReached50 && metrics.rawExpectancy < 0) {
    flags.push('SAMPLE_INCREASED_EXPECTANCY_NEGATIVE');
  }
  if (metrics.funnelStats?.executableLongShort > 0 && metrics.winRate <= 45 && metrics.rawExpectancy <= 0) {
    flags.push('LOW_QUALITY_MARGINAL_BREAKOUT_RISK');
  }
  if (metrics.singleMonthDominates) {
    flags.push('SINGLE_MONTH_DOMINATES');
  }
  if (metrics.profitConcentration > GATES.maxProfitConcentration) {
    flags.push('PROFIT_CONCENTRATION');
  }

  return flags;
}

function aggregateFunnel(setups) {
  const totals = {
    candlesEvaluated: 0,
    compressionDetections: 0,
    breakoutCandidates: 0,
    volumeExpansionPass: 0,
    rangeExpansionPass: 0,
    bodyQualityPass: 0,
    wickFailure: 0,
    opposingLevelRoomFailure: 0,
    rrFailure: 0,
    executableLong: 0,
    executableShort: 0,
    executableLongShort: 0,
    closedTrades: 0,
    primaryBlockedReasonBreakdown: {},
  };

  for (const setup of setups) {
    const stats = setup.funnelStats ?? {};
    for (const key of [
      'candlesEvaluated',
      'compressionDetections',
      'breakoutCandidates',
      'volumeExpansionPass',
      'rangeExpansionPass',
      'bodyQualityPass',
      'wickFailure',
      'opposingLevelRoomFailure',
      'rrFailure',
      'executableLong',
      'executableShort',
      'executableLongShort',
      'closedTrades',
    ]) {
      totals[key] += stats[key] ?? 0;
    }
    for (const [reason, count] of Object.entries(stats.primaryBlockedReasonBreakdown ?? {})) {
      totals.primaryBlockedReasonBreakdown[reason] = (totals.primaryBlockedReasonBreakdown[reason] ?? 0) + count;
    }
  }

  return {
    ...totals,
    dominantBlocker: dominantReason(totals.primaryBlockedReasonBreakdown),
  };
}

function experimentQualitySummary(experiment) {
  const setupsWith50 = experiment.setups.filter((setup) => setup.sampleReached50);
  const promotionCandidates = experiment.setups.filter((setup) => setup.status === 'PROMOTION_CANDIDATE_ONLY');
  const bestBySample = [...experiment.setups].sort((left, right) => right.closedActionableTrades - left.closedActionableTrades || right.rawExpectancy - left.rawExpectancy)[0] ?? null;
  const bestByExpectancy = [...experiment.setups].sort((left, right) => right.rawExpectancy - left.rawExpectancy || right.closedActionableTrades - left.closedActionableTrades)[0] ?? null;
  const oneSetupCarriesPerformance = (() => {
    const positiveNet = experiment.setups.filter((setup) => setup.netR > 0);
    const totalPositiveNet = positiveNet.reduce((sum, setup) => sum + setup.netR, 0);
    const top = [...positiveNet].sort((left, right) => right.netR - left.netR)[0];
    return totalPositiveNet > 0 && top?.netR / totalPositiveNet > GATES.maxProfitConcentration;
  })();

  return {
    setupsWith50: setupsWith50.map((setup) => setup.setup),
    promotionCandidates: promotionCandidates.map((setup) => setup.setup),
    bestBySample: bestBySample ? {
      setup: bestBySample.setup,
      closedActionableTrades: bestBySample.closedActionableTrades,
      rawExpectancy: bestBySample.rawExpectancy,
      status: bestBySample.status,
    } : null,
    bestByExpectancy: bestByExpectancy ? {
      setup: bestByExpectancy.setup,
      closedActionableTrades: bestByExpectancy.closedActionableTrades,
      rawExpectancy: bestByExpectancy.rawExpectancy,
      status: bestByExpectancy.status,
    } : null,
    onePairTimeframeCarriesPerformance: oneSetupCarriesPerformance,
  };
}

async function buildExperiment(experimentId) {
  const found = await latestSummaryForExperiment(experimentId);
  const config = getStrategyExperiment(experimentId);

  if (!found) {
    return {
      experimentId,
      strategyVersion: config?.strategyVersion ?? experimentId,
      label: config?.label ?? experimentId,
      missing: true,
      sourceSummaryPath: null,
      setups: [],
      funnelTotals: aggregateFunnel([]),
      quality: {},
    };
  }

  const setups = await Promise.all((found.summary.results ?? []).map((result) => enrichResult(experimentId, result)));
  return {
    experimentId,
    strategyVersion: found.summary.metadata?.strategyVersion ?? config?.strategyVersion ?? experimentId,
    label: found.summary.metadata?.experimentLabel ?? config?.label ?? experimentId,
    missing: false,
    sourceSummaryPath: found.filePath,
    range: {
      from: found.summary.metadata?.from ?? null,
      to: found.summary.metadata?.to ?? null,
    },
    safety: {
      candidateOnly: found.summary.metadata?.candidateOnly === true,
      backtestOnly: found.summary.metadata?.backtestOnly === true,
      liveGateEligible: found.summary.metadata?.liveGateEligible === true,
      paperGateEligible: found.summary.metadata?.paperGateEligible === true,
      activeProductionStrategy: found.summary.metadata?.activeProductionStrategyVersion ?? 'v1.1-atr-risk',
    },
    changedParameters: config?.changedParameters ?? {},
    setups,
    funnelTotals: aggregateFunnel(setups),
    quality: experimentQualitySummary({ setups }),
  };
}

function focusAnalysis(experiments) {
  const focus = ['XRP/USDT 15m', 'BNB/USDT 1h'];

  return Object.fromEntries(
    focus.map((setupName) => [
      setupName,
      experiments.map((experiment) => {
        const setup = experiment.setups.find((item) => item.setup === setupName);
        return {
          experimentId: experiment.experimentId,
          closedActionableTrades: setup?.closedActionableTrades ?? 0,
          winRate: setup?.winRate ?? 0,
          rawExpectancy: setup?.rawExpectancy ?? 0,
          costAdjustedMinus0_02R: setup?.costAdjustedExpectancy?.minus0_02R ?? 0,
          maxDrawdown: setup?.maxDrawdown ?? 0,
          profitFactor: setup?.profitFactor ?? 0,
          sampleReached50: setup?.sampleReached50 ?? false,
          status: setup?.status ?? 'MISSING',
          failureReasons: setup?.failureReasons ?? ['MISSING'],
          dominantBlocker: setup?.funnelStats?.dominantBlocker?.reason ?? null,
        };
      }),
    ]),
  );
}

function toMarkdown(report) {
  const experimentRows = report.experiments.map((experiment) => [
    experiment.experimentId,
    experiment.missing ? 'yes' : 'no',
    experiment.funnelTotals.closedTrades,
    experiment.funnelTotals.executableLongShort,
    experiment.funnelTotals.breakoutCandidates,
    experiment.funnelTotals.dominantBlocker?.reason ?? 'none',
    experiment.quality?.setupsWith50?.join(', ') || 'none',
    experiment.quality?.promotionCandidates?.join(', ') || 'none',
    experiment.quality?.bestBySample?.setup ?? 'none',
    experiment.quality?.bestBySample?.closedActionableTrades ?? 0,
    experiment.quality?.bestBySample?.rawExpectancy ?? 0,
  ]);
  const setupRows = report.experiments.flatMap((experiment) =>
    experiment.setups.map((setup) => [
      experiment.experimentId,
      setup.setup,
      setup.closedActionableTrades,
      `${setup.winRate}%`,
      setup.rawExpectancy,
      setup.costAdjustedExpectancy.minus0_02R,
      setup.costAdjustedExpectancy.minus0_05R,
      setup.costAdjustedExpectancy.minus0_10R,
      setup.maxDrawdown,
      setup.profitFactor,
      setup.oosDegradation,
      setup.walkForwardResult,
      setup.profitConcentration,
      setup.sampleReached50 ? 'yes' : 'no',
      setup.funnelStats.dominantBlocker?.reason ?? 'none',
      setup.status,
      setup.failureReasons.join(', ') || 'none',
    ]),
  );
  const focusRows = Object.entries(report.focusAnalysis).flatMap(([setup, rows]) =>
    rows.map((row) => [
      setup,
      row.experimentId,
      row.closedActionableTrades,
      `${row.winRate}%`,
      row.rawExpectancy,
      row.costAdjustedMinus0_02R,
      row.maxDrawdown,
      row.profitFactor,
      row.sampleReached50 ? 'yes' : 'no',
      row.dominantBlocker ?? 'none',
      row.status,
      row.failureReasons.join(', ') || 'none',
    ]),
  );

  return `# v2.1 Breakout Funnel Calibration Comparison

Generated at: ${report.generatedAt}

## Safety
- Active production strategy remains ${report.safety.activeProductionStrategy}.
- v2/v2.1 remain backtest-only: yes.
- setupRegistry unchanged by this report.
- paperGate unchanged by this report.
- liveGate unchanged by this report.
- Approved setups: 0.
- Paper Day 1: PENDING_SETUP_APPROVAL.
- Global verdict: NOT READY.
- Live execution: STUBBED.
- Auto-promotion: disabled.

## Experiment Summary
${markdownTable(
  ['Experiment', 'Missing', 'Closed', 'Executable', 'Breakouts', 'Dominant Blocker', 'Setups >=50', 'Promotion Candidates', 'Best Sample Setup', 'Best Closed', 'Best Raw Exp'],
  experimentRows,
)}

## Per-Setup Comparison
${markdownTable(
  ['Experiment', 'Setup', 'Closed', 'Win Rate', 'Raw Exp', '-0.02R', '-0.05R', '-0.10R', 'Max DD', 'PF', 'OOS Deg', 'WF', 'Profit Conc', '>=50', 'Dominant Blocker', 'Status', 'Failures'],
  setupRows,
)}

## Focus Setups
${markdownTable(
  ['Setup', 'Experiment', 'Closed', 'Win Rate', 'Raw Exp', '-0.02R', 'Max DD', 'PF', '>=50', 'Dominant Blocker', 'Status', 'Failures'],
  focusRows,
)}

## Decision
- PROMOTION_CANDIDATE_ONLY setups: ${report.promotionCandidates.length ? report.promotionCandidates.map((item) => `${item.setup} (${item.experimentId})`).join(', ') : 'none'}.
- Setups reaching >=50 trades: ${report.setupsReaching50.length ? report.setupsReaching50.map((item) => `${item.setup} (${item.experimentId})`).join(', ') : 'none'}.
- Dominant blocker after calibration: ${report.globalDominantBlocker?.reason ?? 'none'} (${report.globalDominantBlocker?.count ?? 0}).
- Final verdict: ${report.finalVerdict}.

No setup is approved. Paper Day 1 remains PENDING_SETUP_APPROVAL. Global verdict remains NOT READY. Live execution remains STUBBED.
`;
}

async function main() {
  const experiments = await Promise.all(EXPERIMENT_IDS.map(buildExperiment));
  const globalReasons = {};

  for (const experiment of experiments) {
    for (const [reason, count] of Object.entries(experiment.funnelTotals?.primaryBlockedReasonBreakdown ?? {})) {
      globalReasons[reason] = (globalReasons[reason] ?? 0) + count;
    }
  }

  const promotionCandidates = experiments.flatMap((experiment) =>
    experiment.setups
      .filter((setup) => setup.status === 'PROMOTION_CANDIDATE_ONLY')
      .map((setup) => ({ experimentId: experiment.experimentId, setup: setup.setup })),
  );
  const setupsReaching50 = experiments.flatMap((experiment) =>
    experiment.setups
      .filter((setup) => setup.sampleReached50)
      .map((setup) => ({ experimentId: experiment.experimentId, setup: setup.setup })),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    baselineExperimentId: BASELINE_EXPERIMENT_ID,
    variantExperimentIds: VARIANT_IDS,
    gates: GATES,
    safety: {
      activeProductionStrategy: 'v1.1-atr-risk',
      backtestOnly: true,
      candidateOnly: true,
      setupRegistryUnchanged: true,
      paperGateUnchanged: true,
      liveGateUnchanged: true,
      approvedSetups: 0,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT_READY',
      liveExecution: 'STUBBED',
      autoPromotion: false,
    },
    experiments,
    focusAnalysis: focusAnalysis(experiments),
    setupsReaching50,
    promotionCandidates,
    globalDominantBlocker: dominantReason(globalReasons),
    finalVerdict: 'NOT_READY',
  };

  await fs.writeFile(path.join(RESULTS_DIR, 'v2.1-breakout-funnel-calibration-comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(RESULTS_DIR, 'v2.1-breakout-funnel-calibration-comparison.md'), toMarkdown(report));

  console.log(JSON.stringify({
    comparisonJson: path.join(RESULTS_DIR, 'v2.1-breakout-funnel-calibration-comparison.json'),
    comparisonMarkdown: path.join(RESULTS_DIR, 'v2.1-breakout-funnel-calibration-comparison.md'),
    promotionCandidates,
    setupsReaching50,
    finalVerdict: report.finalVerdict,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
