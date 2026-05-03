import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.4-chop-expectancy-analysis.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.4-chop-expectancy-analysis.md');

const RUNS = [
  {
    label: '2021-07-01 to 2024-07-01',
    from: '2021-07-01',
    to: '2024-07-01',
    file: 'v1.4-chop-avoidance-filter-SOL-USDT-1h-2021-07-01-to-2024-07-01-2026-05-01T15-25-13-091Z.json',
  },
  {
    label: '2022-01-01 to 2024-07-01',
    from: '2022-01-01',
    to: '2024-07-01',
    file: 'v1.4-chop-avoidance-filter-SOL-USDT-1h-2022-01-01-to-2024-07-01-2026-05-01T15-23-44-713Z.json',
  },
  {
    label: '2022-07-01 to 2024-07-01',
    from: '2022-07-01',
    to: '2024-07-01',
    file: 'v1.4-chop-avoidance-filter-SOL-USDT-1h-2022-07-01-to-2024-07-01-2026-05-01T15-22-37-869Z.json',
    focus: true,
  },
];

const COST_STEPS = [0.01, 0.02, 0.05, 0.1];
const MIN_EXPECTANCY = 0.3;
const MIN_CLOSED_TRADES = 50;

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function pctDistance(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === 0) {
    return null;
  }

  return (Math.abs(left - right) / Math.abs(left)) * 100;
}

function histogram(values) {
  const buckets = [
    { key: '<=-1.00R', test: (value) => value <= -1 },
    { key: '(-1.00,-0.50]R', test: (value) => value > -1 && value <= -0.5 },
    { key: '(-0.50,0.00)R', test: (value) => value > -0.5 && value < 0 },
    { key: '[0.00,0.50)R', test: (value) => value >= 0 && value < 0.5 },
    { key: '[0.50,1.00)R', test: (value) => value >= 0.5 && value < 1 },
    { key: '[1.00,1.50]R', test: (value) => value >= 1 && value <= 1.5 },
    { key: '>1.50R', test: (value) => value > 1.5 },
  ];

  return buckets.map((bucket) => ({
    bucket: bucket.key,
    count: values.filter(bucket.test).length,
  }));
}

function buildMonthly(trades) {
  const months = new Map();
  for (const trade of trades) {
    const key = monthKey(trade.exitTimestamp ?? trade.timestamp);
    const current = months.get(key) ?? {
      month: key,
      trades: 0,
      wins: 0,
      losses: 0,
      netR: 0,
    };
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
      expectancy: item.trades ? round(item.netR / item.trades) : 0,
      winRate: item.trades ? round((item.wins / item.trades) * 100, 2) : 0,
      netR: round(item.netR),
    }));
}

function buildLossStreaks(trades) {
  const streaks = [];
  let current = [];

  for (const trade of trades) {
    if (trade.outcome === 'LOSS') {
      current.push(trade);
      continue;
    }

    if (current.length) {
      streaks.push(current);
      current = [];
    }
  }

  if (current.length) {
    streaks.push(current);
  }

  return streaks.map((streak) => ({
    length: streak.length,
    start: new Date(streak[0].timestamp).toISOString(),
    end: new Date((streak.at(-1).exitTimestamp ?? streak.at(-1).timestamp)).toISOString(),
    netR: round(streak.reduce((sum, trade) => sum + (Number(trade.r) || 0), 0)),
  }));
}

function costSensitivity(rawExpectancy) {
  const adjusted = {
    minus0_01R: round(rawExpectancy - 0.01),
    minus0_02R: round(rawExpectancy - 0.02),
    minus0_05R: round(rawExpectancy - 0.05),
    minus0_10R: round(rawExpectancy - 0.1),
  };
  const costBeforeBelowTarget = rawExpectancy > MIN_EXPECTANCY ? round(rawExpectancy - MIN_EXPECTANCY) : null;
  const costBeforeBelowZero = rawExpectancy > 0 ? round(rawExpectancy) : null;

  return {
    raw: round(rawExpectancy),
    ...adjusted,
    maxTolerableCostBeforeBelowTarget: costBeforeBelowTarget,
    maxTolerableCostBeforeBelowZero: costBeforeBelowZero,
    fragileForRealExecution: rawExpectancy <= MIN_EXPECTANCY || round(rawExpectancy - 0.02) <= MIN_EXPECTANCY,
  };
}

function featureVector(trade) {
  return {
    atr: Number(trade.atr) || null,
    rrRatio: Number(trade.rrRatio) || null,
    score: Number(trade.score) || null,
    confidenceScore: Number(trade.confidenceScore) || null,
    pullbackDistancePct: pctDistance(Number(trade.entry), Number(trade.plannedLevels?.entry2)),
    stopDistancePct: pctDistance(Number(trade.entry), Number(trade.sl)),
    tp1DistancePct: pctDistance(Number(trade.entry), Number(trade.tp)),
    hasLevelWarning: Boolean(trade.levelWarning),
    entryContext: trade.entryContext ?? null,
  };
}

function compareWinnersLosers(trades) {
  const wins = trades.filter((trade) => trade.outcome === 'WIN');
  const losses = trades.filter((trade) => trade.outcome === 'LOSS');
  const summarize = (sideTrades) => {
    const vectors = sideTrades.map(featureVector);
    const numeric = (key) => vectors.map((item) => item[key]).filter(Number.isFinite);
    const entryContexts = {};

    vectors.forEach((item) => {
      if (item.entryContext) {
        entryContexts[item.entryContext] = (entryContexts[item.entryContext] ?? 0) + 1;
      }
    });

    return {
      tradeCount: sideTrades.length,
      atrAverage: round(mean(numeric('atr'))),
      atrMedian: round(median(numeric('atr'))),
      scoreAverage: round(mean(numeric('score'))),
      scoreMedian: round(median(numeric('score'))),
      confidenceAverage: round(mean(numeric('confidenceScore'))),
      pullbackDistancePctAverage: round(mean(numeric('pullbackDistancePct'))),
      stopDistancePctAverage: round(mean(numeric('stopDistancePct'))),
      tp1DistancePctAverage: round(mean(numeric('tp1DistancePct'))),
      levelWarningRate: sideTrades.length
        ? round(sideTrades.filter((trade) => trade.levelWarning).length / sideTrades.length)
        : 0,
      entryContexts,
    };
  };

  const winners = summarize(wins);
  const losers = summarize(losses);

  return {
    winners,
    losers,
    separationRead: {
      atrGap: round(winners.atrAverage - losers.atrAverage),
      scoreGap: round(winners.scoreAverage - losers.scoreAverage),
      pullbackDistanceGapPct: round(winners.pullbackDistancePctAverage - losers.pullbackDistancePctAverage),
      stopDistanceGapPct: round(winners.stopDistancePctAverage - losers.stopDistancePctAverage),
      tp1DistanceGapPct: round(winners.tp1DistancePctAverage - losers.tp1DistancePctAverage),
      clearFeatureSeparation:
        Math.abs(winners.scoreAverage - losers.scoreAverage) >= 1 ||
        Math.abs(winners.atrAverage - losers.atrAverage) >= 0.5,
    },
    unavailableFeatures: [
      'trend strength at entry is not persisted in the trade record',
      'volatility regime label is not persisted in the trade record',
      'time since impulse/pullback is not persisted in the trade record',
      'entry candle structure beyond summary fields is not persisted in the trade record',
    ],
  };
}

function failureDiagnosis(trades) {
  const rs = trades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = rs.filter((value) => value > 0);
  const losses = rs.filter((value) => value < 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const expectancy = mean(rs);
  const requiredWinRateAtCurrentGeometry =
    Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgWin > 0 && avgLoss < 0
      ? Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss))
      : null;

  let primary = 'other';
  if (Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgWin <= 1.55 && avgWin >= 1.45 && avgLoss === -1) {
    primary = 'low_win_size_or_capped_tp';
  } else if (winRate < 0.5) {
    primary = 'loss_frequency';
  }

  return {
    expectancy: round(expectancy),
    winRate: round(winRate * 100, 2),
    avgWinR: round(avgWin),
    avgLossR: round(avgLoss),
    requiredWinRateAtCurrentGeometry: Number.isFinite(requiredWinRateAtCurrentGeometry)
      ? round(requiredWinRateAtCurrentGeometry * 100, 2)
      : null,
    primary,
    notes: [
      Number.isFinite(requiredWinRateAtCurrentGeometry)
        ? `At fixed ${round(avgWin)}R winners and ${round(avgLoss)}R losses, break-even win rate is ${round(
            requiredWinRateAtCurrentGeometry * 100,
            2,
          )}%.`
        : 'Unable to derive break-even win rate from current geometry.',
      `To exceed ${MIN_EXPECTANCY}R expectancy with the observed payoff geometry, win rate must stay materially above break-even and leave room for costs.`,
    ],
  };
}

function topTrades(trades, direction = 'desc', limit = 5) {
  const sorted = [...trades].sort((left, right) =>
    direction === 'desc' ? Number(right.r) - Number(left.r) : Number(left.r) - Number(right.r),
  );
  return sorted.slice(0, limit).map((trade) => ({
    timestamp: new Date(trade.timestamp).toISOString(),
    exitTimestamp: new Date((trade.exitTimestamp ?? trade.timestamp)).toISOString(),
    direction: trade.direction,
    outcome: trade.outcome,
    r: round(Number(trade.r)),
    entry: round(Number(trade.entry), 6),
    sl: round(Number(trade.sl), 6),
    tp1: round(Number(trade.tp), 6),
    atr: round(Number(trade.atr), 6),
    score: trade.score,
    confidenceScore: trade.confidenceScore,
    entryContext: trade.entryContext,
    levelWarning: trade.levelWarning ?? null,
  }));
}

function sampleStatus(trades, from, to) {
  const closedTrades = trades.length;
  const durationMonths = Math.max(
    1,
    (new Date(to).getUTCFullYear() - new Date(from).getUTCFullYear()) * 12 +
      (new Date(to).getUTCMonth() - new Date(from).getUTCMonth()),
  );
  const monthlyRate = closedTrades / durationMonths;
  const additionalTradesNeeded = Math.max(0, MIN_CLOSED_TRADES - closedTrades);
  const estimatedAdditionalMonths = monthlyRate > 0 ? round(additionalTradesNeeded / monthlyRate, 2) : null;

  return {
    closedTrades,
    minimumRequired: MIN_CLOSED_TRADES,
    distanceToMinimum: closedTrades - MIN_CLOSED_TRADES,
    additionalTradesNeeded,
    estimatedAdditionalMonths,
  };
}

async function readRun(run) {
  const filePath = path.join(RESULTS_DIR, run.file);
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const trades = (payload.backtest?.trades ?? [])
    .filter((trade) => ['WIN', 'LOSS'].includes(trade.outcome))
    .sort((left, right) => (left.exitTimestamp ?? left.timestamp) - (right.exitTimestamp ?? right.timestamp));
  const returns = trades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const monthly = buildMonthly(trades);
  const negativeMonths = monthly.filter((item) => item.netR < 0);
  const flatOrWeakMonths = monthly.filter((item) => item.expectancy <= 0.1);

  return {
    label: run.label,
    from: run.from,
    to: run.to,
    sourceFile: run.file,
    focus: Boolean(run.focus),
    sample: sampleStatus(trades, run.from, run.to),
    expectancy: {
      closedTrades: trades.length,
      rawExpectancy: round(mean(returns)),
      averageWinR: round(mean(wins)),
      averageLossR: round(mean(losses)),
      medianWinR: round(median(wins)),
      medianLossR: round(median(losses)),
      winRate: trades.length ? round((wins.length / trades.length) * 100, 2) : 0,
      winCount: wins.length,
      lossCount: losses.length,
      distribution: histogram(returns),
      biggestWinners: topTrades(trades, 'desc'),
      biggestLosers: topTrades(trades, 'asc'),
      consecutiveLossStreaks: buildLossStreaks(trades),
      maxConsecutiveLosses: Math.max(0, ...buildLossStreaks(trades).map((item) => item.length)),
    },
    costSensitivity: costSensitivity(mean(returns)),
    failureDiagnosis: failureDiagnosis(trades),
    winnerLoserComparison: compareWinnersLosers(trades),
    monthly,
    negativeMonths,
    flatOrWeakMonths,
    notes: {
      tpGeometryBottleneck: 'Winners and losses are effectively fixed at +1.5R / -1.0R, so expectancy depends almost entirely on win rate.',
      entryTimingEvidence:
        'Persisted trade records do not show a strong late-entry signature. Pullback distance and level-warning rates are nearly identical between winners and losers.',
    },
  };
}

function classifyCrossRangeFailure(runs) {
  const primaries = runs.map((run) => run.failureDiagnosis.primary);
  const counts = Object.fromEntries(
    [...new Set(primaries)].map((key) => [key, primaries.filter((item) => item === key).length]),
  );
  const dominant = Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'other';

  return {
    dominantFailureClass: dominant,
    looksLikeStrategyStrictness: false,
    looksLikeRuleDesignIssue: dominant === 'low_win_size_or_capped_tp',
    rationale:
      dominant === 'low_win_size_or_capped_tp'
        ? 'The payoff geometry is capped at +1.5R while losses stay at -1R. Win rate passes, but not by enough margin to clear 0.3R after costs.'
        : 'Loss frequency appears to be the dominant limiter.',
  };
}

function nextResearchDirection(focusRun, classification) {
  if (classification.dominantFailureClass === 'low_win_size_or_capped_tp') {
    return {
      recommendation: 'EXIT_GEOMETRY_RESEARCH',
      reason:
        'The candidate already reaches 50% to 51.56% win rate with controlled drawdown, but the fixed +1.5R payoff leaves too little room above the 0.3R gate and collapses under small execution costs.',
      notYet:
        'Do not promote or relax gates. Test whether different profit-taking / hold geometry can create more expectancy buffer before touching production.',
    };
  }

  return {
    recommendation: 'REGIME_FILTER_RESEARCH',
    reason: 'Loss clustering across several months suggests the remaining weakness is regime-specific rather than pure sample noise.',
    notYet: 'Do not promote or relax gates.',
  };
}

function bestSampleSetup(runs) {
  return [...runs].sort((left, right) => right.sample.closedTrades - left.sample.closedTrades)[0] ?? null;
}

function toMarkdown(report) {
  const lines = [
    '# SOL/USDT 1h v1.4 Chop Expectancy Analysis',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    '## Status',
    `- Candidate: ${report.setup}`,
    `- Decision: ${report.status}`,
    `- Active production strategy: ${report.activeStrategy.strategyVersion}`,
    `- Approved setup count: ${report.safety.approvedSetups}`,
    `- Paper Day 1: ${report.safety.paperDay1}`,
    `- Global verdict: ${report.safety.globalVerdict}`,
    `- Live execution: ${report.safety.liveExecution}`,
    '',
    '## Cross-Range Summary',
    '| Range | Closed | Sample | Win Rate | Raw Exp | Avg Win | Avg Loss | Max Cost >0.3R | Max Cost >0 | Direction |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.runs.map(
      (run) =>
        `| ${run.label} | ${run.sample.closedTrades} | ${run.sample.closedTrades}/${run.sample.minimumRequired} | ${run.expectancy.winRate}% | ${run.expectancy.rawExpectancy}R | ${run.expectancy.averageWinR}R | ${run.expectancy.averageLossR}R | ${run.costSensitivity.maxTolerableCostBeforeBelowTarget ?? 'none'} | ${run.costSensitivity.maxTolerableCostBeforeBelowZero ?? 'none'} | ${run.failureDiagnosis.primary} |`,
    ),
    '',
    '## Main Read',
    `- Dominant failure class: ${report.classification.dominantFailureClass}`,
    `- Rationale: ${report.classification.rationale}`,
    `- Best sample run: ${report.bestSample.label} with ${report.bestSample.sample.closedTrades} closed trades`,
    '',
    '## Focus Range',
    `- Focused range: ${report.focusRun.label}`,
    `- Raw expectancy: ${report.focusRun.expectancy.rawExpectancy}R`,
    `- Cost sensitivity: raw ${report.focusRun.costSensitivity.raw}, -0.01R ${report.focusRun.costSensitivity.minus0_01R}, -0.02R ${report.focusRun.costSensitivity.minus0_02R}, -0.05R ${report.focusRun.costSensitivity.minus0_05R}, -0.10R ${report.focusRun.costSensitivity.minus0_10R}`,
    `- Win rate: ${report.focusRun.expectancy.winRate}%`,
    `- Avg win / loss: ${report.focusRun.expectancy.averageWinR}R / ${report.focusRun.expectancy.averageLossR}R`,
    `- Median win / loss: ${report.focusRun.expectancy.medianWinR}R / ${report.focusRun.expectancy.medianLossR}R`,
    `- Max consecutive losses: ${report.focusRun.expectancy.maxConsecutiveLosses}`,
    `- Return histogram: ${report.focusRun.expectancy.distribution.map((item) => `${item.bucket}=${item.count}`).join(', ')}`,
    '',
    '## Winner vs Loser Comparison',
    `- Winner avg ATR: ${report.focusRun.winnerLoserComparison.winners.atrAverage}`,
    `- Loser avg ATR: ${report.focusRun.winnerLoserComparison.losers.atrAverage}`,
    `- Winner avg score: ${report.focusRun.winnerLoserComparison.winners.scoreAverage}`,
    `- Loser avg score: ${report.focusRun.winnerLoserComparison.losers.scoreAverage}`,
    `- Winner avg pullback distance: ${report.focusRun.winnerLoserComparison.winners.pullbackDistancePctAverage}%`,
    `- Loser avg pullback distance: ${report.focusRun.winnerLoserComparison.losers.pullbackDistancePctAverage}%`,
    `- Clear separating feature: ${report.focusRun.winnerLoserComparison.separationRead.clearFeatureSeparation ? 'yes' : 'no'}`,
    `- Unavailable persisted features: ${report.focusRun.winnerLoserComparison.unavailableFeatures.join('; ')}`,
    '',
    '## Month / Regime Clues',
    `- Negative months: ${report.focusRun.negativeMonths.map((item) => `${item.month} (${item.netR}R)`).join(', ') || 'none'}`,
    `- Flat or weak months: ${report.focusRun.flatOrWeakMonths.map((item) => `${item.month} (${item.expectancy}R)`).join(', ') || 'none'}`,
    '',
    '## Top Trades',
    `- Biggest winners: ${report.focusRun.expectancy.biggestWinners.map((item) => `${item.timestamp} ${item.direction} ${item.r}R`).join(' | ')}`,
    `- Biggest losers: ${report.focusRun.expectancy.biggestLosers.map((item) => `${item.timestamp} ${item.direction} ${item.r}R`).join(' | ')}`,
    '',
    '## Recommendation',
    `- Next research direction: ${report.nextStep.recommendation}`,
    `- Why: ${report.nextStep.reason}`,
    `- Not yet: ${report.nextStep.notYet}`,
    '',
    '## Safety',
    '- No setup is approved.',
    '- Paper Day 1 remains PENDING_SETUP_APPROVAL.',
    '- Global verdict remains NOT READY.',
    '- Live execution remains STUBBED.',
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const runs = await Promise.all(RUNS.map(readRun));
  const focusRun = runs.find((run) => run.focus) ?? runs.at(-1);
  const classification = classifyCrossRangeFailure(runs);
  const nextStep = nextResearchDirection(focusRun, classification);
  const bestSample = bestSampleSetup(runs);

  const report = {
    generatedAt: new Date().toISOString(),
    setup: 'SOL/USDT 1h v1.4-chop-avoidance-filter',
    status: 'FAILED_COST_SENSITIVITY',
    activeStrategy,
    runs,
    focusRun,
    classification,
    bestSample,
    nextStep,
    safety: {
      approvedSetups: 0,
      paperDay1: 'PENDING_SETUP_APPROVAL',
      globalVerdict: 'NOT READY',
      liveExecution: 'STUBBED',
    },
  };

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        outputJson: OUTPUT_JSON,
        outputMarkdown: OUTPUT_MD,
        status: report.status,
        recommendation: report.nextStep.recommendation,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
