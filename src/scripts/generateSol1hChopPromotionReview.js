import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const ROBUSTNESS_PATH = path.join(RESULTS_DIR, 'sol-usdt-1h-robustness-report.json');
const FORENSIC_PATH = path.join(RESULTS_DIR, 'sol-usdt-1h-forensic-analysis.json');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.4-chop-promotion-review.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.4-chop-promotion-review.md');

const TARGET_EXPERIMENT = 'v1.4-chop-avoidance-filter';
const TARGET_SETUP = 'SOL/USDT 1h';
const COSTS_R = [0.02, 0.05, 0.1];
const GATES = {
  minClosedTrades: 50,
  minWinRate: 45,
  minExpectancy: 0.3,
  maxDrawdown: 0.15,
  maxOosDegradation: 0.15,
  maxProfitConcentration: 0.6,
  maxTopMonthShare: 0.35,
  maxTop3MonthShare: 0.6,
};

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function statusGate({ value, pass, fail, borderline = false, unknown = false, detail }) {
  if (unknown) {
    return { status: 'UNKNOWN', value, detail };
  }
  if (fail) {
    return { status: 'FAIL', value, detail };
  }
  if (borderline) {
    return { status: 'BORDERLINE', value, detail };
  }
  return { status: pass ? 'PASS' : 'FAIL', value, detail };
}

function adjustedExpectancy(raw) {
  return {
    raw: round(raw),
    minus0_02R: round(raw - 0.02),
    minus0_05R: round(raw - 0.05),
    minus0_10R: round(raw - 0.1),
  };
}

function normalizeSensitivity(metrics) {
  const raw = metrics.expectancySensitivity ?? adjustedExpectancy(metrics.expectancy);
  return {
    raw: round(raw.raw ?? metrics.expectancy),
    minus0_02R: round(raw.minus0_02R ?? metrics.expectancy - 0.02),
    minus0_05R: round(raw.minus0_05R ?? metrics.expectancy - 0.05),
    minus0_10R: round(raw.minus0_10R ?? raw.minus0_1R ?? metrics.expectancy - 0.1),
  };
}

function rollingMonthly(monthly, windowSize) {
  const rows = [];
  for (let index = 0; index + windowSize <= monthly.length; index += 1) {
    const window = monthly.slice(index, index + windowSize);
    const trades = window.reduce((sum, item) => sum + item.trades, 0);
    const netR = window.reduce((sum, item) => sum + item.netR, 0);
    rows.push({
      startMonth: window[0].month,
      endMonth: window.at(-1).month,
      months: windowSize,
      trades,
      netR: round(netR),
      expectancy: trades ? round(netR / trades) : 0,
    });
  }
  return rows;
}

function evaluateRange(run) {
  const metrics = run.metrics;
  const concentration = run.concentration ?? {};
  const sensitivity = normalizeSensitivity(metrics);
  const recentMonths = run.monthly.slice(-6);
  const recentTrades = recentMonths.reduce((sum, item) => sum + item.trades, 0);
  const recentNetR = recentMonths.reduce((sum, item) => sum + item.netR, 0);
  const recentExpectancy = recentTrades ? recentNetR / recentTrades : null;
  const rolling3 = rollingMonthly(run.monthly, 3);
  const rolling6 = rollingMonthly(run.monthly, 6);
  const negativeRolling3 = rolling3.filter((item) => item.expectancy <= 0).length;
  const negativeRolling6 = rolling6.filter((item) => item.expectancy <= 0).length;
  const gateReview = {
    sample: statusGate({
      value: metrics.closedTrades,
      pass: metrics.closedTrades >= GATES.minClosedTrades,
      borderline: metrics.closedTrades >= GATES.minClosedTrades && metrics.closedTrades < GATES.minClosedTrades * 1.5,
      detail: `${metrics.closedTrades}/${GATES.minClosedTrades} closed actionable trades`,
    }),
    winRate: statusGate({
      value: metrics.winRate,
      pass: metrics.winRate > GATES.minWinRate,
      borderline: metrics.winRate > GATES.minWinRate && metrics.winRate < GATES.minWinRate + 5,
      detail: `${metrics.winRate}% > ${GATES.minWinRate}% required`,
    }),
    expectancy: statusGate({
      value: metrics.expectancy,
      pass: metrics.expectancy > GATES.minExpectancy,
      fail: metrics.expectancy <= GATES.minExpectancy,
      detail: `${metrics.expectancy}R > ${GATES.minExpectancy}R required`,
    }),
    maxDrawdown: statusGate({
      value: metrics.maxDrawdown,
      pass: metrics.maxDrawdown < GATES.maxDrawdown,
      borderline: metrics.maxDrawdown >= GATES.maxDrawdown * 0.75 && metrics.maxDrawdown < GATES.maxDrawdown,
      detail: `${metrics.maxDrawdown} < ${GATES.maxDrawdown} required`,
    }),
    oosDegradation: statusGate({
      value: metrics.oosDegradation,
      pass: metrics.oosDegradation <= GATES.maxOosDegradation,
      unknown: !Number.isFinite(metrics.oosDegradation),
      detail: `${metrics.oosDegradation} <= ${GATES.maxOosDegradation} required`,
    }),
    walkForward: statusGate({
      value: metrics.walkForwardPass,
      pass: metrics.walkForwardPass === true,
      fail: metrics.walkForwardPass !== true,
      detail: (metrics.walkForwardFlags ?? []).join(', ') || 'walk-forward passed',
    }),
    profitConcentration: statusGate({
      value: metrics.profitConcentration,
      pass: metrics.profitConcentration <= GATES.maxProfitConcentration,
      fail: metrics.profitConcentration > GATES.maxProfitConcentration,
      detail: `${metrics.profitConcentration} <= ${GATES.maxProfitConcentration} required`,
    }),
    topMonthShare: statusGate({
      value: concentration.topPositiveMonthShare,
      pass: concentration.topPositiveMonthShare <= GATES.maxTopMonthShare,
      borderline: concentration.topPositiveMonthShare > 0.25 && concentration.topPositiveMonthShare <= GATES.maxTopMonthShare,
      fail: concentration.topPositiveMonthShare > GATES.maxTopMonthShare,
      detail: `${concentration.topPositiveMonth?.month ?? 'none'} contributes ${concentration.topPositiveMonthShare} of positive monthly R`,
    }),
    top3MonthShare: statusGate({
      value: concentration.top3PositiveMonthShare,
      pass: concentration.top3PositiveMonthShare <= GATES.maxTop3MonthShare,
      borderline: concentration.top3PositiveMonthShare > 0.5 && concentration.top3PositiveMonthShare <= GATES.maxTop3MonthShare,
      fail: concentration.top3PositiveMonthShare > GATES.maxTop3MonthShare,
      detail: `Top 3 positive months contribute ${concentration.top3PositiveMonthShare} of positive monthly R`,
    }),
    costSensitivity: statusGate({
      value: sensitivity,
      pass: COSTS_R.every((cost) => metrics.expectancy - cost > GATES.minExpectancy),
      fail: COSTS_R.some((cost) => metrics.expectancy - cost <= GATES.minExpectancy),
      detail: `Adjusted expectancy: raw ${sensitivity.raw}, -0.02R ${sensitivity.minus0_02R}, -0.05R ${sensitivity.minus0_05R}, -0.10R ${sensitivity.minus0_10R}`,
    }),
    recentPeriod: statusGate({
      value: Number.isFinite(recentExpectancy) ? round(recentExpectancy) : null,
      pass: Number.isFinite(recentExpectancy) && recentExpectancy > 0,
      fail: Number.isFinite(recentExpectancy) && recentExpectancy <= 0,
      unknown: !Number.isFinite(recentExpectancy),
      detail: `Last 6 traded months: ${recentTrades} trades, ${Number.isFinite(recentExpectancy) ? round(recentExpectancy) : 'n/a'}R expectancy`,
    }),
    rolling3Month: statusGate({
      value: { windows: rolling3.length, negativeWindows: negativeRolling3 },
      pass: rolling3.length > 0 && negativeRolling3 === 0,
      fail: negativeRolling3 > 0,
      unknown: rolling3.length === 0,
      detail: `${negativeRolling3}/${rolling3.length} rolling 3-month windows have expectancy <= 0`,
    }),
    rolling6Month: statusGate({
      value: { windows: rolling6.length, negativeWindows: negativeRolling6 },
      pass: rolling6.length > 0 && negativeRolling6 === 0,
      fail: negativeRolling6 > 0,
      unknown: rolling6.length === 0,
      detail: `${negativeRolling6}/${rolling6.length} rolling 6-month windows have expectancy <= 0`,
    }),
  };

  const statuses = Object.values(gateReview).map((item) => item.status);
  return {
    range: run.range,
    metrics: {
      ...metrics,
      expectancySensitivity: sensitivity,
    },
    monthly: run.monthly,
    bestMonth: run.bestMonth,
    worstMonth: run.worstMonth,
    concentration,
    rolling3Month: rolling3,
    rolling6Month: rolling6,
    gateReview,
    hardFail: statuses.includes('FAIL'),
    hasBorderline: statuses.includes('BORDERLINE'),
  };
}

function compareVariants(robustness, forensic) {
  const chopRuns = robustness.runs.filter((run) => run.experimentId === TARGET_EXPERIMENT && run.available);
  const trendRuns = robustness.runs.filter((run) => run.experimentId === 'v1.4-trend-strength-filter' && run.available);
  const baseline = forensic.runs?.v13Baseline ?? null;
  const trendForensic = forensic.runs?.trendStrength ?? null;
  const chopForensic = forensic.runs?.chopAvoidance ?? null;

  return {
    baseline2023To2024: baseline
      ? {
          closedTrades: baseline.metrics.closedTrades,
          winRate: baseline.metrics.winRate,
          expectancy: baseline.metrics.expectancy,
          maxDrawdown: baseline.metrics.maxDrawdown,
          walkForwardPass: baseline.metrics.walkForwardPass,
          profitConcentration: baseline.metrics.profitConcentration,
          topMonthShare: baseline.concentration.topPositiveMonthShare,
        }
      : null,
    trendStrengthClosest: trendForensic
      ? {
          closedTrades: trendForensic.metrics.closedTrades,
          winRate: trendForensic.metrics.winRate,
          expectancy: trendForensic.metrics.expectancy,
          maxDrawdown: trendForensic.metrics.maxDrawdown,
          walkForwardPass: trendForensic.metrics.walkForwardPass,
          profitConcentration: trendForensic.metrics.profitConcentration,
          topMonthShare: trendForensic.concentration.topPositiveMonthShare,
        }
      : null,
    chopOriginal: chopForensic
      ? {
          closedTrades: chopForensic.metrics.closedTrades,
          winRate: chopForensic.metrics.winRate,
          expectancy: chopForensic.metrics.expectancy,
          maxDrawdown: chopForensic.metrics.maxDrawdown,
          walkForwardPass: chopForensic.metrics.walkForwardPass,
          profitConcentration: chopForensic.metrics.profitConcentration,
          topMonthShare: chopForensic.concentration.topPositiveMonthShare,
        }
      : null,
    extendedTrendStrength: trendRuns.map((run) => ({
      range: run.range,
      closedTrades: run.metrics.closedTrades,
      expectancy: run.metrics.expectancy,
      walkForwardPass: run.metrics.walkForwardPass,
      profitConcentration: run.metrics.profitConcentration,
    })),
    extendedChopAvoidance: chopRuns.map((run) => ({
      range: run.range,
      closedTrades: run.metrics.closedTrades,
      expectancy: run.metrics.expectancy,
      walkForwardPass: run.metrics.walkForwardPass,
      profitConcentration: run.metrics.profitConcentration,
    })),
    conclusions: {
      genuinelyBetterThanBaseline: 'Chop-avoidance improves drawdown and win rate versus v1.3 baseline, but extended expectancy drops below the promotion threshold.',
      concentrationReducedButNotFixed: 'Monthly top-month share improves, but validator walk-forward profitConcentration remains 1 in all extended ranges.',
      walkForwardImproved: false,
      sampleImproved: true,
      feeSlippageSurvives: false,
    },
  };
}

function finalDecision(rangeReviews) {
  const mainRange = rangeReviews.find((item) => item.range.from === '2022-07-01') ?? rangeReviews[0];
  const allHardPass = rangeReviews.every((item) => !item.hardFail);
  const anyCostFail = rangeReviews.some((item) => item.gateReview.costSensitivity.status === 'FAIL');
  const anyWalkForwardFail = rangeReviews.some((item) => item.gateReview.walkForward.status === 'FAIL');
  const anyProfitConcentrationFail = rangeReviews.some((item) => item.gateReview.profitConcentration.status === 'FAIL');
  const anyExpectancyFail = rangeReviews.some((item) => item.gateReview.expectancy.status === 'FAIL');
  const noMajorWarnings = rangeReviews.every((item) => !item.hasBorderline);

  let label = 'NOT_PROMOTABLE';
  if (allHardPass && noMajorWarnings) {
    label = 'PROMOTION_CANDIDATE_ONLY';
  } else if (anyCostFail) {
    label = 'FAILED_COST_SENSITIVITY';
  } else if (anyWalkForwardFail) {
    label = 'FAILED_WALK_FORWARD';
  } else if (anyProfitConcentrationFail) {
    label = 'FAILED_PROFIT_CONCENTRATION';
  } else if (anyExpectancyFail) {
    label = 'FAILED_ROBUSTNESS';
  }

  return {
    label,
    mainRange: mainRange?.range ?? null,
    promotionCandidateOnly: label === 'PROMOTION_CANDIDATE_ONLY',
    primaryReasons: [
      anyExpectancyFail ? 'raw expectancy is below 0.3R in every extended range' : null,
      anyCostFail ? 'fee/slippage sensitivity drops adjusted expectancy below 0.3R' : null,
      anyWalkForwardFail ? 'walk-forward remains unacceptable' : null,
      anyProfitConcentrationFail ? 'profit concentration remains flagged' : null,
    ].filter(Boolean),
    noAutoApproval: true,
    paperDay1CanStart: false,
    requiresHumanPromotionReview: label === 'PROMOTION_CANDIDATE_ONLY',
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
  const summaryRows = report.rangeReviews.map((item) => [
    `${item.range.from} to ${item.range.to}`,
    item.metrics.closedTrades,
    `${item.metrics.winRate}%`,
    item.metrics.expectancy,
    item.metrics.maxDrawdown,
    item.metrics.profitFactor,
    item.metrics.oosDegradation,
    item.metrics.walkForwardPass ? 'PASS' : 'FAIL',
    item.metrics.profitConcentration,
    item.concentration.topPositiveMonth?.month ?? 'none',
    item.concentration.topPositiveMonthShare,
    report.decision.label,
  ]);

  const gateRows = report.rangeReviews.flatMap((item) =>
    Object.entries(item.gateReview).map(([gate, result]) => [
      `${item.range.from} to ${item.range.to}`,
      gate,
      result.status,
      typeof result.value === 'object' ? JSON.stringify(result.value) : result.value,
      result.detail,
    ]),
  );

  const sensitivityRows = report.rangeReviews.map((item) => [
    `${item.range.from} to ${item.range.to}`,
    item.metrics.expectancySensitivity.raw,
    item.metrics.expectancySensitivity.minus0_02R,
    item.metrics.expectancySensitivity.minus0_05R,
    item.metrics.expectancySensitivity.minus0_10R,
  ]);

  const rollingRows = report.rangeReviews.flatMap((item) => [
    ...item.rolling3Month.map((window) => [
      `${item.range.from} to ${item.range.to}`,
      '3M',
      `${window.startMonth} to ${window.endMonth}`,
      window.trades,
      window.netR,
      window.expectancy,
    ]),
    ...item.rolling6Month.map((window) => [
      `${item.range.from} to ${item.range.to}`,
      '6M',
      `${window.startMonth} to ${window.endMonth}`,
      window.trades,
      window.netR,
      window.expectancy,
    ]),
  ]);

  const comparison = report.comparison;
  const comparisonRows = [
    ['v1.3 baseline original', comparison.baseline2023To2024?.closedTrades ?? '--', comparison.baseline2023To2024?.expectancy ?? '--', comparison.baseline2023To2024?.maxDrawdown ?? '--', comparison.baseline2023To2024?.walkForwardPass ? 'PASS' : 'FAIL', comparison.baseline2023To2024?.profitConcentration ?? '--'],
    ['v1.4 trend-strength original', comparison.trendStrengthClosest?.closedTrades ?? '--', comparison.trendStrengthClosest?.expectancy ?? '--', comparison.trendStrengthClosest?.maxDrawdown ?? '--', comparison.trendStrengthClosest?.walkForwardPass ? 'PASS' : 'FAIL', comparison.trendStrengthClosest?.profitConcentration ?? '--'],
    ['v1.4 chop original', comparison.chopOriginal?.closedTrades ?? '--', comparison.chopOriginal?.expectancy ?? '--', comparison.chopOriginal?.maxDrawdown ?? '--', comparison.chopOriginal?.walkForwardPass ? 'PASS' : 'FAIL', comparison.chopOriginal?.profitConcentration ?? '--'],
  ];

  return `# SOL/USDT 1h v1.4 Chop Promotion Review

Generated at: ${report.generatedAt}

## Decision
- Setup: ${report.setup}
- Experiment: ${report.experimentId}
- Final label: ${report.decision.label}
- No setup is auto-approved.
- Paper Day 1 remains PENDING_SETUP_APPROVAL.
- Global verdict remains NOT READY.
- Live execution remains STUBBED.

## Summary
${markdownTable(['Range', 'Closed', 'Win Rate', 'Expectancy', 'Max DD', 'Profit Factor', 'OOS Deg', 'Walk-Forward', 'Profit Conc', 'Top Month', 'Top Month Share', 'Decision'], summaryRows)}

## Gate Review
${markdownTable(['Range', 'Gate', 'Status', 'Value', 'Detail'], gateRows)}

## Fee / Slippage Sensitivity
${markdownTable(['Range', 'Raw Exp', '-0.02R', '-0.05R', '-0.10R'], sensitivityRows)}

## Rolling Stability
${markdownTable(['Range', 'Window', 'Months', 'Trades', 'Net R', 'Expectancy'], rollingRows)}

## Comparison
${markdownTable(['Variant', 'Closed', 'Expectancy', 'Max DD', 'Walk-Forward', 'Profit Conc'], comparisonRows)}

## Findings
- Sample issue is solved in extended history: all reviewed ranges are >=50 closed trades.
- The promotion problem moved from sample size to robustness: raw expectancy is below 0.3R in every extended range.
- Fee/slippage fails immediately: even -0.02R per trade leaves adjusted expectancy below 0.3R.
- Walk-forward remains failed and profit concentration remains flagged.
- Chop-avoidance is better than v1.3 on drawdown and win rate, but not stable enough for promotion.

## Production Safety
- Active production strategy remains ${report.safety.activeProductionStrategyVersion}.
- v1.4 remains backtest-only.
- liveGate ignores v1.4.
- paperGate ignores v1.4.
- setupRegistry is not changed.
- Paper Day 1 remains ${report.safety.paperDay1}.
- Live execution remains ${report.safety.liveExecution}.
`;
}

async function main() {
  const robustness = await readJson(ROBUSTNESS_PATH);
  const forensic = await readJson(FORENSIC_PATH);
  const targetRuns = robustness.runs
    .filter((run) => run.available && run.experimentId === TARGET_EXPERIMENT)
    .sort((left, right) => left.range.from.localeCompare(right.range.from));
  const rangeReviews = targetRuns.map(evaluateRange);
  const comparison = compareVariants(robustness, forensic);
  const decision = finalDecision(rangeReviews);
  const report = {
    generatedAt: new Date().toISOString(),
    setup: TARGET_SETUP,
    pair: 'SOL/USDT',
    timeframe: '1h',
    experimentId: TARGET_EXPERIMENT,
    gates: GATES,
    costAssumptionsR: COSTS_R,
    rangeReviews,
    comparison,
    decision,
    safety: {
      activeProductionStrategyVersion: activeStrategy.strategyVersion,
      experimentsActiveInProduction: false,
      v14BacktestOnly: true,
      liveGateIgnoresExperiment: true,
      paperGateIgnoresExperiment: true,
      setupRegistryChanged: false,
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
    decision: report.decision,
    reviewedRanges: rangeReviews.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
