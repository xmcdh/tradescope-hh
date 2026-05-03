import fs from 'node:fs/promises';
import path from 'node:path';

const RESULTS_DIR = 'backtest-results';
const EXPERIMENT_ID = 'v2-breakout-volume-expansion';
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

function monthKey(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return 'UNKNOWN';
  }

  return new Date(timestamp).toISOString().slice(0, 7);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function monthlyDistribution(trades) {
  const groups = new Map();

  for (const trade of trades) {
    const key = monthKey(trade.exitTimestamp ?? trade.timestamp);
    const current = groups.get(key) ?? { month: key, trades: 0, wins: 0, losses: 0, netR: 0, returns: [] };
    const r = Number(trade.r ?? trade.rResult ?? 0);
    current.trades += 1;
    current.wins += trade.outcome === 'WIN' ? 1 : 0;
    current.losses += trade.outcome === 'LOSS' ? 1 : 0;
    current.netR += Number.isFinite(r) ? r : 0;
    if (Number.isFinite(r)) {
      current.returns.push(r);
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((row) => ({
      month: row.month,
      trades: row.trades,
      wins: row.wins,
      losses: row.losses,
      winRate: row.trades ? round((row.wins / row.trades) * 100, 2) : 0,
      netR: round(row.netR),
      expectancy: round(average(row.returns)),
    }));
}

function classifySetup(metrics) {
  const failures = [];

  if (metrics.closedTrades < GATES.minClosedTrades) {
    failures.push('FAILED_SAMPLE');
  }
  if (metrics.winRate <= GATES.minWinRate) {
    failures.push('FAILED_WIN_RATE');
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
    failures.push('FAILED_OOS');
  }
  if (metrics.walkForwardResult !== 'PASS') {
    failures.push('FAILED_WALK_FORWARD');
  }
  if (metrics.profitConcentration > GATES.maxProfitConcentration) {
    failures.push('FAILED_PROFIT_CONCENTRATION');
  }

  if (!failures.length) {
    return {
      status: 'PROMOTION_CANDIDATE_ONLY',
      failureReasons: [],
    };
  }

  return {
    status: metrics.closedTrades < GATES.minClosedTrades ? 'COLLECT_MORE_DATA' : failures[0],
    failureReasons: failures,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestExperimentSummary() {
  const files = await fs.readdir(RESULTS_DIR);
  const candidates = [];

  for (const file of files.filter((item) => item.startsWith('batch-summary-') && item.endsWith('.json'))) {
    const filePath = path.join(RESULTS_DIR, file);
    const summary = await readJson(filePath);
    if (summary?.metadata?.experimentId !== EXPERIMENT_ID) {
      continue;
    }

    const stat = await fs.stat(filePath);
    candidates.push({ file, filePath, stat, summary });
  }

  return candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0] ?? null;
}

function dominantReason(breakdown = {}) {
  const [reason, count] = Object.entries(breakdown).sort((left, right) => right[1] - left[1])[0] ?? [];
  return reason ? { reason, count } : null;
}

function v2DiagnosticsFromBacktest(backtest = {}) {
  const diagnostics = backtest.diagnostics ?? {};
  const v2 = diagnostics.v2Breakout ?? {};

  return {
    totalCandlesEvaluated: diagnostics.totalCandlesEvaluated ?? 0,
    compressionZoneDetectedCount: v2.compressionZoneDetectedCount ?? 0,
    breakoutCandidateCount: v2.breakoutCandidateCount ?? 0,
    volumeExpansionPassCount: v2.volumeExpansionPassCount ?? 0,
    rangeAtrExpansionPassCount: v2.rangeAtrExpansionPassCount ?? 0,
    bodyQualityPassCount: v2.bodyQualityPassCount ?? 0,
    rejectionWickFailureCount: v2.rejectionWickFailureCount ?? 0,
    opposingLevelRoomFailureCount: v2.opposingLevelRoomFailureCount ?? 0,
    rrFailureCount: v2.rrFailureCount ?? 0,
    blockedCount: diagnostics.blockedCount ?? 0,
    marginalCount: diagnostics.marginalCount ?? 0,
    validExecutableLongCount: v2.validExecutableLongCount ?? 0,
    validExecutableShortCount: v2.validExecutableShortCount ?? 0,
    simulatedTradeOpenedCount: diagnostics.simulatedTradeOpenedCount ?? 0,
    simulatedTradeClosedCount: diagnostics.simulatedTradeClosedCount ?? 0,
    blockedReasonBreakdown: v2.blockedReasonBreakdown ?? {},
    primaryBlockedReasonBreakdown: v2.primaryBlockedReasonBreakdown ?? {},
    dominantBlocker: dominantReason(v2.primaryBlockedReasonBreakdown ?? v2.blockedReasonBreakdown ?? {}),
  };
}

async function enrichResult(result) {
  const fullPayload = result.outputPath ? await readJson(result.outputPath) : null;
  const backtest = result.backtest ?? {};
  const validation = result.validation ?? {};
  const diagnostics = backtest.diagnostics ?? {};
  const trades = (fullPayload?.backtest?.trades ?? []).filter((trade) => trade.signalValidity === 'VALID');
  const closed = trades.filter((trade) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(trade.outcome));
  const rawExpectancy = backtest.actionableExpectancy ?? 0;
  const oosFailed = (validation.flags ?? []).some((flag) =>
    ['OOS_WIN_RATE_DROP_GT_15', 'OOS_EXPECTANCY_NEGATIVE', 'OOS_NEGATIVE'].includes(flag),
  );
  const metrics = {
    setup: `${result.pair} ${result.timeframe}`,
    pair: result.pair,
    timeframe: result.timeframe,
    closedTrades: backtest.actionableClosedTradeCount ?? 0,
    actionableTrades: backtest.actionableTradeCount ?? 0,
    winRate: round(backtest.actionableWinRate ?? 0, 2),
    rawExpectancy: round(rawExpectancy),
    costAdjustedExpectancy: costAdjusted(rawExpectancy),
    maxDrawdown: round(backtest.actionableMaxDrawdown ?? 0),
    profitFactor: round(backtest.actionableProfitFactor ?? 0),
    netR: round(backtest.actionableNetR ?? 0),
    oosDegradation: round(validation.comparison?.oosDegradation ?? 0),
    oosResult: oosFailed ? 'FAIL' : 'PASS',
    walkForwardResult: validation.walkForward?.pass ? 'PASS' : 'FAIL',
    walkForwardFlags: validation.walkForward?.flags ?? [],
    profitConcentration: round(validation.walkForward?.summary?.profitConcentration ?? 0),
    signalCount: {
      raw: diagnostics.rawSignalCount ?? 0,
      long: diagnostics.longSignalCount ?? 0,
      short: diagnostics.shortSignalCount ?? 0,
      wait: diagnostics.waitCount ?? 0,
      waitRetest: diagnostics.waitRetestCount ?? 0,
      noTrade: diagnostics.noTradeCount ?? 0,
      valid: diagnostics.validCount ?? 0,
      marginal: diagnostics.marginalCount ?? 0,
      blocked: diagnostics.blockedCount ?? 0,
      validExecutable: diagnostics.validExecutableSignalCount ?? 0,
    },
    blockedReasonBreakdown: diagnostics.hardBlockReasonBreakdown ?? {},
    v2Diagnostics: v2DiagnosticsFromBacktest(backtest),
    nonActionableReasonBreakdown: diagnostics.nonActionableReasonBreakdown ?? {},
    monthlyDistribution: monthlyDistribution(closed),
  };
  const classification = classifySetup(metrics);

  return {
    ...metrics,
    status: classification.status,
    failureReasons: classification.failureReasons,
    outputPath: result.outputPath ?? null,
    fullPayload,
  };
}

function chooseBest(setups) {
  return [...setups].sort((left, right) => {
    if (left.status === 'PROMOTION_CANDIDATE_ONLY' && right.status !== 'PROMOTION_CANDIDATE_ONLY') {
      return -1;
    }
    if (right.status === 'PROMOTION_CANDIDATE_ONLY' && left.status !== 'PROMOTION_CANDIDATE_ONLY') {
      return 1;
    }
    if (left.closedTrades >= GATES.minClosedTrades && right.closedTrades < GATES.minClosedTrades) {
      return -1;
    }
    if (right.closedTrades >= GATES.minClosedTrades && left.closedTrades < GATES.minClosedTrades) {
      return 1;
    }
    return right.rawExpectancy - left.rawExpectancy || right.closedTrades - left.closedTrades;
  })[0] ?? null;
}

function chooseWorst(setups) {
  return [...setups].sort((left, right) => left.rawExpectancy - right.rawExpectancy || left.closedTrades - right.closedTrades)[0] ?? null;
}

function compactSetupForDiagnostics(setup) {
  const { fullPayload, ...rest } = setup;
  return rest;
}

function summarizeStrictness(setups) {
  const totals = setups.reduce(
    (acc, setup) => {
      const diag = setup.v2Diagnostics ?? {};
      acc.candles += diag.totalCandlesEvaluated ?? 0;
      acc.compression += diag.compressionZoneDetectedCount ?? 0;
      acc.breakout += diag.breakoutCandidateCount ?? 0;
      acc.volume += diag.volumeExpansionPassCount ?? 0;
      acc.range += diag.rangeAtrExpansionPassCount ?? 0;
      acc.body += diag.bodyQualityPassCount ?? 0;
      acc.roomFails += diag.opposingLevelRoomFailureCount ?? 0;
      acc.validExecutable += (diag.validExecutableLongCount ?? 0) + (diag.validExecutableShortCount ?? 0);
      acc.closed += diag.simulatedTradeClosedCount ?? 0;
      for (const [reason, count] of Object.entries(diag.primaryBlockedReasonBreakdown ?? {})) {
        acc.reasons[reason] = (acc.reasons[reason] ?? 0) + count;
      }
      return acc;
    },
    { candles: 0, compression: 0, breakout: 0, volume: 0, range: 0, body: 0, roomFails: 0, validExecutable: 0, closed: 0, reasons: {} },
  );
  const breakoutToExecutable = totals.breakout ? totals.validExecutable / totals.breakout : 0;
  const compressionToBreakout = totals.compression ? totals.breakout / totals.compression : 0;

  return {
    totals,
    dominantBlocker: dominantReason(totals.reasons),
    tooStrictGlobally: totals.breakout > 0 && breakoutToExecutable < 0.02,
    dataScarcityLikely: totals.compression > 0 && compressionToBreakout < 0.03,
    interpretation:
      totals.breakout > 0 && breakoutToExecutable < 0.02
        ? 'Rules are globally strict after breakout candidates appear.'
        : totals.compression > 0 && compressionToBreakout < 0.03
          ? 'The setup is rare at the compression-to-breakout stage in this data window.'
          : 'Strictness appears concentrated in specific filters or setup/timeframe combinations.',
  };
}

function bestNearMissSetups(setups) {
  return [...setups]
    .map((setup) => {
      const diag = setup.v2Diagnostics ?? {};
      const executable = (diag.validExecutableLongCount ?? 0) + (diag.validExecutableShortCount ?? 0);
      return {
        setup: setup.setup,
        pair: setup.pair,
        timeframe: setup.timeframe,
        compression: diag.compressionZoneDetectedCount ?? 0,
        breakout: diag.breakoutCandidateCount ?? 0,
        volumePass: diag.volumeExpansionPassCount ?? 0,
        rangePass: diag.rangeAtrExpansionPassCount ?? 0,
        executable,
        closed: diag.simulatedTradeClosedCount ?? 0,
        dominantBlocker: diag.dominantBlocker,
      };
    })
    .sort((left, right) =>
      right.breakout - left.breakout ||
      right.volumePass - left.volumePass ||
      right.executable - left.executable ||
      right.closed - left.closed,
    )
    .slice(0, 8);
}

function setupsWithBreakoutsFailingLater(setups) {
  return setups
    .filter((setup) => {
      const diag = setup.v2Diagnostics ?? {};
      const executable = (diag.validExecutableLongCount ?? 0) + (diag.validExecutableShortCount ?? 0);
      return (diag.breakoutCandidateCount ?? 0) >= 10 && executable < Math.max(1, (diag.breakoutCandidateCount ?? 0) * 0.05);
    })
    .map((setup) => ({
      setup: setup.setup,
      breakoutCandidateCount: setup.v2Diagnostics.breakoutCandidateCount,
      validExecutableCount: setup.v2Diagnostics.validExecutableLongCount + setup.v2Diagnostics.validExecutableShortCount,
      dominantBlocker: setup.v2Diagnostics.dominantBlocker,
    }));
}

function classifyNearMiss(signal) {
  const selected = signal.signalDiagnostics?.selected;
  if (!selected) {
    return null;
  }

  if (selected.compressionDetected && !selected.breakoutCandidate) {
    return 'COMPRESSION_DETECTED_BREAKOUT_FAILED';
  }
  if (selected.breakoutCandidate && !selected.volumeExpansionPass) {
    return 'BREAKOUT_VOLUME_EXPANSION_FAILED';
  }
  if (selected.breakoutCandidate && selected.volumeExpansionPass && selected.opposingLevelRoomFailure) {
    return 'BREAKOUT_VOLUME_PASSED_OPPOSING_LEVEL_BLOCKED';
  }
  if (
    selected.compressionDetected &&
    selected.breakoutCandidate &&
    selected.volumeExpansionPass &&
    selected.rangeExpansionPass &&
    selected.bodyQualityPass &&
    !selected.rejectionWickFailure &&
    !selected.opposingLevelRoomFailure &&
    selected.rrFailure
  ) {
    return 'ALL_CONDITIONS_EXCEPT_RR';
  }

  return null;
}

function nearMissExamples(setups, limit = 50) {
  const buckets = new Map();
  const tradeKeys = new Set();

  for (const setup of setups) {
    for (const trade of setup.fullPayload?.backtest?.trades ?? []) {
      tradeKeys.add(`${trade.timestamp}:${trade.signal}:${trade.pair}:${trade.timeframe}`);
    }
  }

  for (const setup of setups) {
    for (const signal of setup.fullPayload?.backtest?.signals ?? []) {
      const category = classifyNearMiss(signal);
      const tradeKey = `${signal.timestamp}:${signal.signal}:${signal.pair}:${signal.timeframe}`;
      const executableUnclosed =
        signal.actionableEligible &&
        ['LONG', 'SHORT'].includes(signal.signal) &&
        !tradeKeys.has(tradeKey);
      const finalCategory = executableUnclosed ? 'EXECUTABLE_SIGNAL_TRADE_DID_NOT_CLOSE' : category;

      if (!finalCategory) {
        continue;
      }

      const current = buckets.get(finalCategory) ?? [];
      current.push({
        category: finalCategory,
        setup: setup.setup,
        pair: signal.pair,
        timeframe: signal.timeframe,
        timestamp: signal.timestamp,
        isoTime: new Date(signal.timestamp).toISOString(),
        signal: signal.signal,
        signalValidity: signal.signalValidity,
        direction: signal.direction,
        score: signal.score,
        blockReasonCodes: signal.signalDiagnostics?.selected?.blockReasonCodes ?? [],
        primaryBlockReason: signal.signalDiagnostics?.selected?.primaryBlockReason ?? null,
        blockedReason: signal.blockedReason ?? [],
        rejectionReasons: (signal.rejectionReasons ?? []).slice(0, 5),
        diagnostics: signal.signalDiagnostics?.selected ?? null,
      });
      buckets.set(finalCategory, current);
    }
  }

  const preferredOrder = [
    'COMPRESSION_DETECTED_BREAKOUT_FAILED',
    'BREAKOUT_VOLUME_EXPANSION_FAILED',
    'BREAKOUT_VOLUME_PASSED_OPPOSING_LEVEL_BLOCKED',
    'ALL_CONDITIONS_EXCEPT_RR',
    'EXECUTABLE_SIGNAL_TRADE_DID_NOT_CLOSE',
  ];
  const examples = [];
  const perBucket = Math.max(1, Math.floor(limit / preferredOrder.length));

  for (const category of preferredOrder) {
    examples.push(...(buckets.get(category) ?? []).slice(0, perBucket));
  }

  for (const category of preferredOrder) {
    for (const example of buckets.get(category) ?? []) {
      if (examples.length >= limit) {
        return examples;
      }
      if (!examples.includes(example)) {
        examples.push(example);
      }
    }
  }

  return examples.slice(0, limit);
}

function toMarkdown(report) {
  const setupRows = report.setups.map((setup) => [
    setup.setup,
    setup.closedTrades,
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
    setup.status,
    setup.failureReasons.join(', ') || 'none',
  ]);
  const signalRows = report.setups.map((setup) => [
    setup.setup,
    setup.signalCount.raw,
    setup.signalCount.long,
    setup.signalCount.short,
    setup.signalCount.wait,
    setup.signalCount.noTrade,
    setup.signalCount.valid,
    setup.signalCount.marginal,
    setup.signalCount.blocked,
    setup.signalCount.validExecutable,
  ]);
  const blockedRows = report.setups.flatMap((setup) =>
    Object.entries(setup.blockedReasonBreakdown)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([reason, count]) => [setup.setup, reason, count]),
  );
  const monthlyRows = report.setups.flatMap((setup) =>
    setup.monthlyDistribution.map((row) => [
      setup.setup,
      row.month,
      row.trades,
      `${row.winRate}%`,
      row.netR,
      row.expectancy,
    ]),
  );

  return `# v2 Breakout Volume Expansion Report

Generated at: ${report.generatedAt}

## Safety
- Active production strategy remains ${report.safety.activeProductionStrategy}.
- Experiment backtest-only: ${report.safety.backtestOnly ? 'yes' : 'no'}.
- Approved setups: 0.
- Paper Day 1: PENDING_SETUP_APPROVAL.
- Global verdict: NOT READY.
- Live execution: STUBBED.
- Auto-promotion: disabled.

## Summary
- Experiment ID: ${report.experimentId}
- Strategy version: ${report.strategyVersion}
- Range: ${report.range.from} to ${report.range.to}
- Promotion candidates only: ${report.promotionCandidates.length}
- Setups with >=50 closed trades: ${report.setupsWithEnoughSample.map((item) => item.setup).join(', ') || 'none'}
- Best setup: ${report.bestSetup?.setup ?? 'none'} (${report.bestSetup?.status ?? 'n/a'})
- Worst setup: ${report.worstSetup?.setup ?? 'none'} (${report.worstSetup?.status ?? 'n/a'})

## Per-Setup Metrics
${markdownTable(
  ['Setup', 'Closed', 'Win Rate', 'Raw Exp', '-0.02R', '-0.05R', '-0.10R', 'Max DD', 'PF', 'OOS Deg', 'WF', 'Profit Conc', 'Status', 'Failure Reason'],
  setupRows,
)}

## Signal Counts
${markdownTable(
  ['Setup', 'Raw', 'LONG', 'SHORT', 'WAIT', 'NO_TRADE', 'VALID', 'MARGINAL', 'BLOCKED', 'Valid Executable'],
  signalRows,
)}

## Blocked / Marginal Reason Breakdown
${blockedRows.length ? markdownTable(['Setup', 'Reason', 'Count'], blockedRows) : 'No blocked reasons recorded.'}

## Monthly Distribution
${monthlyRows.length ? markdownTable(['Setup', 'Month', 'Trades', 'Win Rate', 'Net R', 'Expectancy'], monthlyRows) : 'No closed actionable trades.'}

## Decision
${report.promotionCandidates.length
  ? `The following setups are PROMOTION_CANDIDATE_ONLY and still require explicit human review before any paper approval: ${report.promotionCandidates.map((item) => item.setup).join(', ')}.`
  : 'No setup passed all strict gates. All setups remain NOT_READY / COLLECT_MORE_DATA / FAILED_*.'}

No setup is auto-approved. Paper Day 1 remains PENDING_SETUP_APPROVAL. Global verdict remains NOT READY. Live execution remains STUBBED.
`;
}

function toDiagnosticsMarkdown(report) {
  const rows = report.setups.map((setup) => {
    const diag = setup.v2Diagnostics ?? {};
    return [
      setup.setup,
      diag.totalCandlesEvaluated,
      diag.compressionZoneDetectedCount,
      diag.breakoutCandidateCount,
      diag.volumeExpansionPassCount,
      diag.rangeAtrExpansionPassCount,
      diag.bodyQualityPassCount,
      diag.rejectionWickFailureCount,
      diag.opposingLevelRoomFailureCount,
      diag.rrFailureCount,
      diag.blockedCount,
      diag.marginalCount,
      diag.validExecutableLongCount,
      diag.validExecutableShortCount,
      diag.simulatedTradeOpenedCount,
      diag.simulatedTradeClosedCount,
      diag.dominantBlocker?.reason ?? 'none',
    ];
  });
  const blockerRows = report.setups.flatMap((setup) =>
    Object.entries(setup.v2Diagnostics?.primaryBlockedReasonBreakdown ?? {})
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => [setup.setup, reason, count]),
  );
  const nearMissRows = report.bestNearMissSetups.map((setup) => [
    setup.setup,
    setup.compression,
    setup.breakout,
    setup.volumePass,
    setup.rangePass,
    setup.executable,
    setup.closed,
    setup.dominantBlocker?.reason ?? 'none',
  ]);
  const funnel = report.strictness.totals;

  return `# v2 Breakout Volume Expansion Diagnostics

Generated at: ${report.generatedAt}

## Safety
- Active production strategy remains ${report.safety.activeProductionStrategy}.
- Experiment backtest-only: ${report.safety.backtestOnly ? 'yes' : 'no'}.
- setupRegistry unchanged by this report.
- paperGate unchanged by this report.
- liveGate unchanged by this report.
- Approved setups: 0.
- Paper Day 1: PENDING_SETUP_APPROVAL.
- Global verdict: NOT READY.
- Live execution: STUBBED.

## Global Funnel
- Candles evaluated: ${funnel.candles}
- Compression detected: ${funnel.compression}
- Breakout candidates: ${funnel.breakout}
- Volume expansion pass: ${funnel.volume}
- Range/ATR expansion pass: ${funnel.range}
- Body quality pass: ${funnel.body}
- Valid executable signals: ${funnel.validExecutable}
- Closed trades: ${funnel.closed}
- Dominant blocker: ${report.strictness.dominantBlocker?.reason ?? 'none'} (${report.strictness.dominantBlocker?.count ?? 0})
- Interpretation: ${report.strictness.interpretation}

## Per-Setup Diagnostics
${markdownTable(
  ['Setup', 'Candles', 'Compression', 'Breakout', 'Vol Pass', 'Range Pass', 'Body Pass', 'Wick Fail', 'Room Fail', 'RR Fail', 'Blocked', 'Marginal', 'Valid LONG', 'Valid SHORT', 'Opened', 'Closed', 'Dominant Blocker'],
  rows,
)}

## Blocked Reason Codes
${blockerRows.length ? markdownTable(['Setup', 'Reason Code', 'Count'], blockerRows) : 'No v2 blocked reason codes recorded.'}

## Best Near-Miss Setups
${nearMissRows.length ? markdownTable(['Setup', 'Compression', 'Breakout', 'Vol Pass', 'Range Pass', 'Executable', 'Closed', 'Dominant Blocker'], nearMissRows) : 'No near-miss setup found.'}

## Breakout Candidates Failing Later
${report.breakoutCandidatesFailingLater.length
  ? markdownTable(
      ['Setup', 'Breakout Candidates', 'Executable', 'Dominant Blocker'],
      report.breakoutCandidatesFailingLater.map((item) => [
        item.setup,
        item.breakoutCandidateCount,
        item.validExecutableCount,
        item.dominantBlocker?.reason ?? 'none',
      ]),
    )
  : 'No setup met the configured breakout-candidate threshold for this section.'}

## Longer History Check
If diagnostics show rules are valid but rare, measure longer history with:

\`\`\`bash
npm run backtest:batch -- --from 2021-07-01 --to 2024-07-01 --data-source vercel-market-data-proxy --fallback-data-source local-cache --write-cache true --experiment v2-breakout-volume-expansion
\`\`\`

Do not use longer history to approve without normal gates.
`;
}

async function main() {
  const found = await latestExperimentSummary();
  if (!found) {
    throw new Error(`No batch summary found for ${EXPERIMENT_ID}. Run the v2 batch backtest first.`);
  }

  const enrichedSetups = await Promise.all((found.summary.results ?? []).map(enrichResult));
  const setups = enrichedSetups.map(compactSetupForDiagnostics);
  const promotionCandidates = setups.filter((setup) => setup.status === 'PROMOTION_CANDIDATE_ONLY');
  const report = {
    generatedAt: new Date().toISOString(),
    sourceSummaryPath: found.filePath,
    experimentId: EXPERIMENT_ID,
    strategyVersion: found.summary.metadata?.strategyVersion ?? EXPERIMENT_ID,
    range: {
      from: found.summary.metadata?.from ?? null,
      to: found.summary.metadata?.to ?? null,
    },
    gates: GATES,
    safety: {
      activeProductionStrategy: found.summary.metadata?.activeProductionStrategyVersion ?? 'v1.1-atr-risk',
      backtestOnly: true,
      candidateOnly: true,
      liveGateEligible: false,
      paperGateEligible: false,
      noAutoPromotion: true,
    },
    setups,
    setupsWithEnoughSample: setups.filter((setup) => setup.closedTrades >= GATES.minClosedTrades),
    promotionCandidates,
    bestSetup: chooseBest(setups),
    worstSetup: chooseWorst(setups),
    finalStatus: promotionCandidates.length ? 'PROMOTION_CANDIDATE_ONLY_REQUIRES_REVIEW' : 'NOT_READY',
  };
  const diagnosticsReport = {
    ...report,
    strictness: summarizeStrictness(enrichedSetups),
    bestNearMissSetups: bestNearMissSetups(enrichedSetups),
    breakoutCandidatesFailingLater: setupsWithBreakoutsFailingLater(enrichedSetups),
  };
  const nearMissDump = {
    generatedAt: report.generatedAt,
    sourceSummaryPath: report.sourceSummaryPath,
    experimentId: EXPERIMENT_ID,
    limit: 50,
    examples: nearMissExamples(enrichedSetups, 50),
  };

  await fs.writeFile(path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-report.md'), toMarkdown(report));
  await fs.writeFile(path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-diagnostics.json'), `${JSON.stringify(diagnosticsReport, null, 2)}\n`);
  await fs.writeFile(path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-diagnostics.md'), toDiagnosticsMarkdown(diagnosticsReport));
  await fs.writeFile(path.join(RESULTS_DIR, 'v2-breakout-near-misses.json'), `${JSON.stringify(nearMissDump, null, 2)}\n`);

  console.log(JSON.stringify({
    sourceSummaryPath: report.sourceSummaryPath,
    reportJson: path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-report.json'),
    reportMarkdown: path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-report.md'),
    diagnosticsJson: path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-diagnostics.json'),
    diagnosticsMarkdown: path.join(RESULTS_DIR, 'v2-breakout-volume-expansion-diagnostics.md'),
    nearMissDump: path.join(RESULTS_DIR, 'v2-breakout-near-misses.json'),
    finalStatus: report.finalStatus,
    promotionCandidates: promotionCandidates.map((item) => item.setup),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
