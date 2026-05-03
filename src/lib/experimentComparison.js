import fs from 'node:fs/promises';
import path from 'node:path';
import { getBacktestOnlyStrategyExperiments } from '../config/strategyExperiments.js';

const DEFAULT_RESULTS_DIR = 'backtest-results';
const MIN_CLOSED_TRADES = 50;
const EXPECTANCY_THRESHOLD = 0.3;
const WIN_RATE_THRESHOLD = 45;
const MAX_DRAWDOWN_THRESHOLD = 0.15;
const OOS_DEGRADATION_THRESHOLD = 0.15;

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function setupKey(result) {
  return `${result.pair} ${result.timeframe}`;
}

function resultMetrics(result) {
  const backtest = result?.backtest ?? {};
  const validation = result?.validation ?? {};
  const flags = validation.flags ?? [];
  const profitConcentration = validation.walkForward?.summary?.profitConcentration ?? 0;

  return {
    setup: setupKey(result),
    pair: result.pair,
    timeframe: result.timeframe,
    closedActionableTrades: backtest.actionableClosedTradeCount ?? 0,
    distanceTo50: Math.max(0, MIN_CLOSED_TRADES - (backtest.actionableClosedTradeCount ?? 0)),
    winRate: round(backtest.actionableWinRate ?? 0, 2),
    expectancy: round(backtest.actionableExpectancy ?? 0),
    maxDrawdown: round(backtest.actionableMaxDrawdown ?? 0),
    profitFactor: round(backtest.actionableProfitFactor ?? 0),
    netR: round(backtest.actionableNetR ?? 0),
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    oosResult: flags.some((flag) => ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag))
      ? 'FAIL'
      : 'PASS',
    walkForwardResult: validation.walkForward?.pass ? 'PASS' : 'FAIL',
    profitConcentration: round(profitConcentration),
    validationFlags: flags,
    promotedMarginalConfirmations: backtest.diagnostics?.experimentPromotedMarginalConfirmationCount ?? 0,
    status: classifyStatus({ backtest, validation, flags, profitConcentration }),
  };
}

function classifyStatus({ backtest, validation, flags, profitConcentration }) {
  const closed = backtest.actionableClosedTradeCount ?? 0;
  const expectancy = backtest.actionableExpectancy ?? 0;
  const winRate = backtest.actionableWinRate ?? 0;
  const maxDrawdown = backtest.actionableMaxDrawdown ?? 0;
  const oosDegradation = validation.comparison?.oosDegradation ?? Infinity;
  const walkForwardPass = validation.walkForward?.pass === true;
  const oosPass = !flags.some((flag) => ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag));

  if (closed < MIN_CLOSED_TRADES) {
    return 'CANDIDATE_ONLY_INSUFFICIENT_SAMPLE';
  }

  if (
    expectancy > EXPECTANCY_THRESHOLD &&
    winRate > WIN_RATE_THRESHOLD &&
    maxDrawdown < MAX_DRAWDOWN_THRESHOLD &&
    oosDegradation <= OOS_DEGRADATION_THRESHOLD &&
    walkForwardPass &&
    oosPass &&
    profitConcentration <= 0.6
  ) {
    return 'CANDIDATE_ONLY_PASSES_METRICS_REQUIRES_EXPLICIT_PROMOTION';
  }

  return 'CANDIDATE_ONLY_FAILED_METRICS';
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestBatchSummaries(resultsDir) {
  const files = await fs.readdir(resultsDir);
  const summaries = [];

  for (const file of files.filter((item) => item.startsWith('batch-summary-') && item.endsWith('.json'))) {
    const filePath = path.join(resultsDir, file);
    const stat = await fs.stat(filePath);
    const summary = await readJson(filePath);
    summaries.push({ file, filePath, stat, summary });
  }

  return summaries.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
}

function latestForExperiment(summaries, experimentId) {
  return summaries.find((item) => item.summary?.metadata?.experimentId === experimentId) ?? null;
}

function baselineFromProofReport(report) {
  return {
    label: 'v1.1 baseline',
    experimentId: null,
    strategyVersion: report.summary?.metadata?.strategyVersion ?? report.strategyVersion,
    sourceFile: report.sourcePath ?? 'backtest-results/report.json',
    proofStatus: report.summary?.proof?.status ?? null,
    candidateOnly: false,
    results: (report.summary?.results ?? []).map(resultMetrics),
  };
}

function antiOverfittingFlags(variant, baselineBySetup) {
  const flags = [];
  const proof = variant.proof ?? {};

  if ((proof.overall?.pairDependence ?? 0) > 0.6) {
    flags.push(`PAIR_DEPENDENCE_${proof.overall.dominantPair ?? 'UNKNOWN'}`);
  }

  for (const result of variant.results) {
    const baseline = baselineBySetup.get(result.setup);
    if (!baseline) {
      continue;
    }

    if (result.closedActionableTrades > baseline.closedActionableTrades && result.expectancy < baseline.expectancy) {
      flags.push(`${result.setup}: SAMPLE_UP_EXPECTANCY_DOWN`);
    }

    if (result.maxDrawdown > baseline.maxDrawdown) {
      flags.push(`${result.setup}: DRAWDOWN_WORSE`);
    }

    if (result.oosDegradation > OOS_DEGRADATION_THRESHOLD) {
      flags.push(`${result.setup}: OOS_DEGRADATION_GT_15`);
    }

    if (result.validationFlags.some((flag) => String(flag).includes('PROFIT_CONCENTRATION')) || result.profitConcentration > 0.6) {
      flags.push(`${result.setup}: PROFIT_CONCENTRATION`);
    }

    if (result.promotedMarginalConfirmations > 0) {
      flags.push(`${result.setup}: PERFORMANCE_USES_MARGINAL_CONFIRMATION_COHORT`);
    }
  }

  return [...new Set(flags)];
}

export async function buildExperimentComparison({
  resultsDir = DEFAULT_RESULTS_DIR,
  baselineReportPath = path.join(DEFAULT_RESULTS_DIR, 'report.json'),
} = {}) {
  const experiments = getBacktestOnlyStrategyExperiments();
  const baselineReport = await readJson(baselineReportPath);
  const summaries = await latestBatchSummaries(resultsDir);
  const baseline = baselineFromProofReport(baselineReport);
  const baselineBySetup = new Map(baseline.results.map((result) => [result.setup, result]));

  const variants = await Promise.all(experiments.map(async (experiment) => {
    const found = latestForExperiment(summaries, experiment.experimentId);
    if (!found) {
      return {
        experimentId: experiment.experimentId,
        label: experiment.label,
        strategyVersion: experiment.strategyVersion,
        candidateOnly: true,
        tested: false,
        missingReason: 'No batch summary found for experiment.',
        results: [],
        antiOverfittingFlags: ['NOT_TESTED'],
        anySetupAutoApproved: false,
      };
    }

    const results = (found.summary.results ?? []).map(resultMetrics);
    const variant = {
      experimentId: experiment.experimentId,
      label: experiment.label,
      strategyVersion: found.summary.metadata?.strategyVersion ?? experiment.strategyVersion,
      sourceFile: found.filePath,
      generatedAt: found.summary.generatedAt,
      candidateOnly: true,
      tested: true,
      proofStatus: found.summary.proof?.status ?? null,
      proof: found.summary.proof ?? null,
      results,
      antiOverfittingFlags: [],
      anySetupAutoApproved: false,
    };

    variant.antiOverfittingFlags = antiOverfittingFlags(variant, baselineBySetup);
    return variant;
  }));

  return {
    generatedAt: new Date().toISOString(),
    baseline,
    variants,
    safety: {
      noAutoPromotion: true,
      paperDay1RemainsPending: true,
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function experimentComparisonToMarkdown(comparison) {
  const allRows = [];
  for (const result of comparison.baseline.results) {
    allRows.push([
      'v1.1 baseline',
      result.setup,
      result.closedActionableTrades,
      result.distanceTo50,
      `${result.winRate}%`,
      result.expectancy,
      result.maxDrawdown,
      result.profitFactor,
      result.oosResult,
      result.walkForwardResult,
      result.profitConcentration,
      'BASELINE_LOCKED',
    ]);
  }

  for (const variant of comparison.variants) {
    if (!variant.tested) {
      allRows.push([
        variant.experimentId,
        'ALL',
        'not tested',
        '--',
        '--',
        '--',
        '--',
        '--',
        '--',
        '--',
        '--',
        'CANDIDATE_ONLY_NOT_TESTED',
      ]);
      continue;
    }

    for (const result of variant.results) {
      allRows.push([
        variant.experimentId,
        result.setup,
        result.closedActionableTrades,
        result.distanceTo50,
        `${result.winRate}%`,
        result.expectancy,
        result.maxDrawdown,
        result.profitFactor,
        result.oosResult,
        result.walkForwardResult,
        result.profitConcentration,
        result.status,
      ]);
    }
  }

  const flags = comparison.variants.map((variant) => [
    variant.experimentId,
    variant.tested ? 'yes' : 'no',
    variant.antiOverfittingFlags.length ? variant.antiOverfittingFlags.join('; ') : 'none',
  ]);

  return `# v1.2 Experiment Comparison\n\nGenerated at: ${comparison.generatedAt}\n\n## Safety\n- No setup is auto-approved.\n- v1.1 remains locked.\n- Paper Day 1 remains PENDING_SETUP_APPROVAL.\n- Global verdict remains NOT READY.\n- Live execution remains STUBBED.\n\n## Metrics\n${markdownTable(['Variant', 'Setup', 'Closed', 'Distance To 50', 'Win Rate', 'Expectancy', 'Max DD', 'Profit Factor', 'OOS', 'Walk-Forward', 'Profit Concentration', 'Status'], allRows)}\n\n## Anti-Overfitting Flags\n${markdownTable(['Variant', 'Tested', 'Flags'], flags)}\n`;
}
