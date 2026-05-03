import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './runBacktest.js';
import { loadLiveGate } from '../lib/liveGate.js';
import { buildSetupRegistry } from '../lib/setupRegistry.js';
import { getStorageStatus, writeProofSnapshot, writeSetupApproval } from '../lib/storageAdapter.js';
import { activeStrategy } from '../config/strategyVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');

export async function readLatestBatchSummary(explicitPath = null) {
  if (explicitPath) {
    return {
      path: path.resolve(explicitPath),
      payload: JSON.parse(await fs.readFile(path.resolve(explicitPath), 'utf8')),
    };
  }

  const files = (await fs.readdir(RESULTS_DIR))
    .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
    .map((file) => path.join(RESULTS_DIR, file));

  if (!files.length) {
    throw new Error('No batch backtest summary found in backtest-results/.');
  }

  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      stat: await fs.stat(file),
    })),
  );

  const latest = withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
  return {
    path: latest.file,
    payload: JSON.parse(await fs.readFile(latest.file, 'utf8')),
  };
}

function formatPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '--';
}

function bestAndWorst(results) {
  const ranked = [...results].sort(
    (left, right) => (right.backtest?.actionableExpectancy ?? -Infinity) - (left.backtest?.actionableExpectancy ?? -Infinity),
  );

  return {
    best: ranked[0] ?? null,
    worst: ranked.at(-1) ?? null,
  };
}

function determineZeroTradeReason(summary) {
  const diagnosticsList = (summary.results ?? []).map((item) => item.backtest?.diagnostics).filter(Boolean);
  if (!diagnosticsList.length) {
    return '';
  }

  const totalClosed = diagnosticsList.reduce((sum, item) => sum + (item.simulatedTradeClosedCount ?? 0), 0);
  if (totalClosed > 0) {
    return '';
  }

  const validSignals = diagnosticsList.reduce((sum, item) => sum + (item.validCount ?? 0), 0);
  const validExecutableSignals = diagnosticsList.reduce((sum, item) => sum + (item.validExecutableSignalCount ?? 0), 0);
  const openedTrades = diagnosticsList.reduce((sum, item) => sum + (item.simulatedTradeOpenedCount ?? 0), 0);
  const unresolvedTrades = diagnosticsList.reduce((sum, item) => sum + (item.unresolvedTradeCount ?? 0), 0);
  const missingLevels = diagnosticsList.reduce((sum, item) => sum + (item.missingTradeLevelCount ?? 0), 0);
  const waitRetests = diagnosticsList.reduce((sum, item) => sum + (item.waitRetestCount ?? 0), 0);
  const confirmedRetests = diagnosticsList.reduce((sum, item) => sum + (item.pendingRetestConfirmedCount ?? 0), 0);
  const expiredRetests = diagnosticsList.reduce((sum, item) => sum + (item.pendingRetestExpiredCount ?? 0), 0);
  const invalidatedRetests = diagnosticsList.reduce((sum, item) => sum + (item.pendingRetestInvalidatedCount ?? 0), 0);
  const blockedReasons = {};

  for (const diagnostics of diagnosticsList) {
    for (const [reason, count] of Object.entries(diagnostics.hardBlockReasonBreakdown ?? {})) {
      blockedReasons[reason] = (blockedReasons[reason] ?? 0) + count;
    }
  }

  const topBlocked = Object.entries(blockedReasons).sort((left, right) => right[1] - left[1])[0] ?? null;

  if (validSignals === 0 && topBlocked) {
    return `No VALID signals were generated. Dominant block: ${topBlocked[0]} (${topBlocked[1]}).`;
  }

  if (validSignals > 0 && validExecutableSignals === 0) {
    if (waitRetests > 0 && confirmedRetests === 0) {
      return `WAIT_RETEST setups were observed (${waitRetests}), but none confirmed within the configured window. Expired=${expiredRetests}, invalidated=${invalidatedRetests}.`;
    }

    if (waitRetests > 0 && confirmedRetests > 0 && openedTrades === 0) {
      return `WAIT_RETEST setups confirmed ${confirmedRetests} times, but confirmation candles still did not meet actionable LONG/SHORT requirements.`;
    }

    return 'VALID signals exist, but they are non-executable states such as WAIT/WAIT_RETEST, so no trades were opened.';
  }

  if (missingLevels > 0) {
    return `Executable signals were missing entry/SL/TP fields ${missingLevels} times, so they could not become actionable trades.`;
  }

  if (openedTrades > 0 && unresolvedTrades > 0 && openedTrades === unresolvedTrades) {
    return `Trades were opened (${openedTrades}) but none closed within the tested horizon.`;
  }

  if (topBlocked) {
    return `Most candidate signals were blocked. Dominant block: ${topBlocked[0]} (${topBlocked[1]}).`;
  }

  return 'Zero closed actionable trades were recorded, but no single dominant reason was isolated.';
}

export function buildSampleSizeStatus(summary, minClosedTrades = 50) {
  const rows = (summary.results ?? []).map((item) => {
    const closed = item.backtest?.actionableClosedTradeCount ?? 0;
    const missing = Math.max(0, minClosedTrades - closed);
    const candleCount = item.metadata?.candleCount ?? item.backtest?.candleCount ?? 0;
    const estimate =
      closed > 0 && candleCount > 0
        ? `~${Math.ceil((missing / closed) * candleCount)} more candles at current signal density`
        : 'not estimable from current sample';

    return {
      pair: item.pair,
      timeframe: item.timeframe,
      closed,
      minClosedTrades,
      missing,
      sampleStatus: closed >= minClosedTrades ? 'SAMPLE_OK' : 'INSUFFICIENT_SAMPLE',
      estimatedAdditionalHistory: missing === 0 ? 'none' : estimate,
    };
  });
  const best = [...rows].sort((left, right) => right.closed - left.closed)[0] ?? null;
  const officialMonitored = rows.find((item) => item.pair === 'BTC/USDT' && item.timeframe === '1h') ?? null;

  return {
    minClosedTrades,
    best,
    officialMonitored,
    rows,
  };
}

export function deriveVerdict({ proof, liveGate }) {
  if (!liveGate?.storage?.durable) {
    return 'NOT READY';
  }

  const paperReady = liveGate?.paperGatePassed;
  const durationPassed = liveGate?.paperDurationPassed;
  const durable = liveGate?.storage?.durable;

  if (proof?.strategyVersion === activeStrategy.strategyVersion && proof.status === 'PROVEN_READY_FOR_PAPER' && paperReady && durationPassed && durable) {
    return 'READY FOR SMALL LIVE TEST';
  }

  if (proof?.strategyVersion === activeStrategy.strategyVersion && proof.status === 'PROVEN_READY_FOR_PAPER' && !paperReady) {
    return 'READY FOR PAPER TRADING';
  }

  if (paperReady && (!durationPassed || !durable)) {
    return 'PAPER ONLY';
  }

  return 'NOT READY';
}

export function toMarkdown({ sourcePath, summary, liveGate }) {
  const { best, worst } = bestAndWorst(summary.results);
  const proof = summary.proof;
  const setupRegistry = buildSetupRegistry(summary);
  const sampleSizeStatus = buildSampleSizeStatus(summary, 50);
  const warnings = summary.results
    .filter((item) => (item.backtest?.actionableClosedTradeCount ?? 0) < 50)
    .map((item) => `- ${item.pair} ${item.timeframe}: only ${item.backtest?.actionableClosedTradeCount ?? 0} closed actionable trades`);
  const failureLines = (summary.failures ?? []).map(
    (failure) => `- ${failure.pair} ${failure.timeframe}: ${failure.error}`,
  );
  const zeroTradeReason = determineZeroTradeReason(summary);

  const lines = [
    '# TradeScope Backtest Proof Report',
    '',
    `Source summary: \`${path.basename(sourcePath)}\``,
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Executive Summary',
    `- Final verdict: **${deriveVerdict({ proof, liveGate })}**`,
    `- Active strategy: **${activeStrategy.strategyVersion}**`,
    `- Risk model: **${activeStrategy.riskModel}**`,
    `- Official v1.1 paper Day 1: **${activeStrategy.officialPaperTrackingStartDate ?? 'PENDING_SETUP_APPROVAL'}**`,
    `- Proof status: **${proof.status}**`,
    `- Tested setups: ${summary.results.length}`,
    `- Successes / failures: ${summary.metadata.successCount} / ${summary.metadata.failureCount}`,
    `- Requested data source: ${summary.metadata.dataSource ?? '--'}`,
    `- Fallback data source: ${summary.metadata.fallbackDataSource || 'none'}`,
    `- Paper gate passed: ${liveGate?.paperGatePassed ? 'yes' : 'no'}`,
    `- Durable storage: ${liveGate?.storage?.durable ? 'yes' : 'no'}`,
    `- Approved setups: ${setupRegistry.counts.approved}`,
    `- Collecting-data setups: ${setupRegistry.counts.collectingData}`,
    `- Rejected setups: ${setupRegistry.counts.rejected}`,
    '',
    '## Coverage',
    `- Pairs: ${summary.metadata.pairs.join(', ')}`,
    `- Timeframes: ${summary.metadata.timeframes.join(', ')}`,
    `- Date range: ${summary.metadata.from} to ${summary.metadata.to}`,
    `- Total candles tested: ${summary.results.reduce((sum, item) => sum + (item.metadata?.candleCount ?? 0), 0)}`,
    `- Data sources used: ${[...new Set(summary.results.map((item) => item.metadata?.dataSource).filter(Boolean))].join(', ') || 'none'}`,
    '',
    '## Actionable Metrics',
    `- Closed actionable trades: ${proof.overall.closedActionableTrades}`,
    `- Proven setups: ${proof.overall.provenSetups}/${proof.overall.setupCount}`,
    `- Dominant pair dependence: ${(proof.overall.pairDependence * 100).toFixed(2)}%${proof.overall.dominantPair ? ` (${proof.overall.dominantPair})` : ''}`,
    ...(zeroTradeReason ? [`- Zero-trade diagnosis: ${zeroTradeReason}`] : []),
    '',
    '## Sample Size Status',
    `- Minimum closed actionable trades per setup: ${sampleSizeStatus.minClosedTrades}`,
    `- Best sample setup: ${sampleSizeStatus.best ? `${sampleSizeStatus.best.pair} ${sampleSizeStatus.best.timeframe} (${sampleSizeStatus.best.closed}/${sampleSizeStatus.best.minClosedTrades})` : 'n/a'}`,
    `- Official monitored setup: ${sampleSizeStatus.officialMonitored ? `${sampleSizeStatus.officialMonitored.pair} ${sampleSizeStatus.officialMonitored.timeframe} (${sampleSizeStatus.officialMonitored.closed}/${sampleSizeStatus.officialMonitored.minClosedTrades}, ${sampleSizeStatus.officialMonitored.sampleStatus})` : 'not present in this summary'}`,
    '| Pair | Timeframe | Closed Actionable | Distance To 50 | Sample Status | Estimated Additional History |',
    '| --- | --- | ---: | ---: | --- | --- |',
    ...sampleSizeStatus.rows.map(
      (item) =>
        `| ${item.pair} | ${item.timeframe} | ${item.closed}/${item.minClosedTrades} | ${item.missing} | ${item.sampleStatus} | ${item.estimatedAdditionalHistory} |`,
    ),
    '',
    '## OOS / Walk-Forward',
    ...summary.results.map((item) => {
      const validation = item.validation ?? {};
      return `- ${item.pair} ${item.timeframe}: flags=${(validation.flags ?? []).join(', ') || 'none'}, walkForward=${validation.walkForward?.pass ? 'pass' : 'fail'}, OOS degradation=${validation.comparison?.oosDegradation ?? 'n/a'}`;
    }),
    '',
    '## Data Fetch Failures',
    ...(failureLines.length ? failureLines : ['- none']),
    '',
    '## Candle Integrity',
    ...(summary.results.length
      ? summary.results.map((item) => `- ${item.pair} ${item.timeframe}: ${item.integrity?.valid ? 'pass' : 'fail'}${item.integrity?.issues?.length ? ` (${item.integrity.issues.join(' | ')})` : ''}`)
      : ['- No valid candle data. Proof is blocked by data fetch failure.']),
    '',
    '## Signal Diagnostics',
    ...summary.results.map((item) => {
      const diagnostics = item.backtest?.diagnostics ?? {};
      return `- ${item.pair} ${item.timeframe}: candles=${diagnostics.totalCandlesEvaluated ?? 0}, raw=${diagnostics.rawSignalCount ?? 0}, long=${diagnostics.longSignalCount ?? 0}, short=${diagnostics.shortSignalCount ?? 0}, noTrade=${diagnostics.noTradeCount ?? 0}, wait=${diagnostics.waitCount ?? 0}, waitRetest=${diagnostics.waitRetestCount ?? 0}, valid=${diagnostics.validCount ?? 0}, marginal=${diagnostics.marginalCount ?? 0}, blocked=${diagnostics.blockedCount ?? 0}, validExecutable=${diagnostics.validExecutableSignalCount ?? 0}, pendingCreated=${diagnostics.pendingRetestCreatedCount ?? 0}, pendingConfirmed=${diagnostics.pendingRetestConfirmedCount ?? 0}, pendingExpired=${diagnostics.pendingRetestExpiredCount ?? 0}, pendingInvalidated=${diagnostics.pendingRetestInvalidatedCount ?? 0}, opened=${diagnostics.simulatedTradeOpenedCount ?? 0}, closed=${diagnostics.simulatedTradeClosedCount ?? 0}, unresolved=${diagnostics.unresolvedTradeCount ?? 0}, missingLevels=${diagnostics.missingTradeLevelCount ?? 0}, missingAtr=${diagnostics.missingAtrCount ?? 0}`;
    }),
    '',
    '## Best / Worst Setup',
    `- Best: ${best ? `${best.pair} ${best.timeframe} | expectancy ${best.backtest?.actionableExpectancy}` : 'n/a'}`,
    `- Worst: ${worst ? `${worst.pair} ${worst.timeframe} | expectancy ${worst.backtest?.actionableExpectancy}` : 'n/a'}`,
    '',
    '## Insufficient Sample Warnings',
    ...(warnings.length ? warnings : ['- none']),
    '',
    '## Setup Approval Matrix',
    '| Pair | Timeframe | Proof Status | Setup Status | Actionable Trades | Expectancy | Win Rate | Max DD | OOS Status | Recommendation |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...setupRegistry.entries.map(
      (entry) =>
        `| ${entry.pair} | ${entry.timeframe} | ${entry.proofStatus} | ${entry.setupStatus} | ${entry.actionableTrades} | ${entry.expectancy} | ${entry.winRate.toFixed(2)}% | ${(entry.maxDrawdown * 100).toFixed(2)}% | ${entry.oosStatus} | ${entry.recommendation} |`,
    ),
    '',
    '## Paper Trading Gate',
    `- Status: ${liveGate?.ready ? 'ready' : 'not ready'}`,
    `- Duration passed: ${liveGate?.paperDurationPassed ? 'yes' : 'no'}`,
    `- Closed trades: ${liveGate?.stats?.totalClosedTrades ?? 0}`,
    `- Win rate: ${liveGate?.stats?.winRate != null ? `${(liveGate.stats.winRate * 100).toFixed(2)}%` : '--'}`,
    `- Expectancy: ${liveGate?.stats?.expectancy ?? '--'}`,
    `- Max drawdown: ${formatPct(liveGate?.stats?.maxDrawdown)}`,
    `- Failed criteria: ${(liveGate?.failedCriteria ?? []).join(' | ') || 'none'}`,
    '',
    '## Why Not Ready Yet',
    ...((proof.failedCriteria ?? []).length ? proof.failedCriteria.map((item) => `- ${item}`) : ['- Backtest proof currently passes its own criteria.']),
    ...(liveGate?.failedCriteria ?? []).map((item) => `- ${item}`),
    ...(liveGate?.storage?.warning ? [`- ${liveGate.storage.warning}`] : []),
  ];

  return `${lines.join('\n')}\n`;
}

function buildCompactProofSnapshot({ sourcePath, report, setupRegistry, liveGate, storageStatus }) {
  return {
    generatedAt: report.generatedAt,
    verdict: report.verdict,
    strategy: {
      strategyVersion: report.strategyVersion,
      strategyName: report.strategyName,
      riskModel: report.riskModel,
      activatedAt: report.activatedAt,
      signalLogicVersion: report.signalLogicVersion,
      officialPaperTrackingStartDate: report.officialPaperTrackingStartDate,
    },
    source: {
      summaryFile: path.basename(sourcePath),
      reportFile: 'report.json',
    },
    summary: {
      strategyVersion: report.summary?.metadata?.strategyVersion ?? null,
      from: report.summary?.metadata?.from ?? null,
      to: report.summary?.metadata?.to ?? null,
      dataSource: report.summary?.metadata?.dataSource ?? null,
      fallbackDataSource: report.summary?.metadata?.fallbackDataSource ?? null,
      successCount: report.summary?.metadata?.successCount ?? 0,
      failureCount: report.summary?.metadata?.failureCount ?? 0,
      proofStatus: report.summary?.proof?.status ?? null,
      failedCriteria: report.summary?.proof?.failedCriteria ?? [],
    },
    setupRegistry: {
      counts: setupRegistry.counts,
      entries: setupRegistry.entries,
    },
    liveGate: {
      ready: liveGate?.ready ?? false,
      paperGatePassed: liveGate?.paperGatePassed ?? false,
      paperDurationPassed: liveGate?.paperDurationPassed ?? false,
      failedCriteria: liveGate?.failedCriteria ?? [],
      stats: liveGate?.stats ?? {},
    },
    storage: {
      code: storageStatus.code,
      authority: storageStatus.authority,
      durable: storageStatus.durable,
      provider: storageStatus.provider,
      canConnect: storageStatus.canConnect,
      warning: storageStatus.warning,
    },
  };
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const latest = await readLatestBatchSummary(args.input ?? null);
  const liveGate = await loadLiveGate();
  const setupRegistry = buildSetupRegistry(latest.payload);
  const storageStatus = await getStorageStatus();
  const report = {
    generatedAt: new Date().toISOString(),
    ...activeStrategy,
    sourcePath: latest.path,
    summary: latest.payload,
    setupRegistry,
    liveGate,
    verdict: deriveVerdict({ proof: latest.payload.proof, liveGate }),
    storageStatus,
  };
  const markdown = toMarkdown({
    sourcePath: latest.path,
    summary: latest.payload,
    liveGate,
  });

  await fs.writeFile(path.join(RESULTS_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(RESULTS_DIR, 'report.md'), markdown);

  const snapshotId = `proof:${new Date(report.generatedAt).toISOString()}`;
  const compactSnapshot = buildCompactProofSnapshot({
    sourcePath: latest.path,
    report,
    setupRegistry,
    liveGate,
    storageStatus,
  });
  await writeProofSnapshot({
    id: snapshotId,
    strategyVersion: activeStrategy.strategyVersion,
    riskModel: activeStrategy.riskModel,
    signalLogicVersion: activeStrategy.signalLogicVersion,
    activatedAt: activeStrategy.activatedAt,
    verdict: report.verdict,
    generatedAt: report.generatedAt,
    approvedSetupCount: setupRegistry.counts.approved,
    collectingDataSetupCount: setupRegistry.counts.collectingData,
    rejectedSetupCount: setupRegistry.counts.rejected,
    storageStatus: storageStatus.code,
    sourceBatchFilename: path.basename(latest.path),
    sourceReportFilename: 'report.json',
    payloadJson: compactSnapshot,
    createdAt: report.generatedAt,
    updatedAt: report.generatedAt,
  });

  await Promise.all(
    setupRegistry.entries.map((entry) =>
      writeSetupApproval({
        id: `approval:${entry.symbolKey}:${report.generatedAt}`,
        pair: entry.pair,
        timeframe: entry.timeframe,
        proofStatus: entry.proofStatus,
        setupStatus: entry.setupStatus,
        recommendation: entry.recommendation,
        sourceReportId: snapshotId,
        strategyVersion: activeStrategy.strategyVersion,
        riskModel: activeStrategy.riskModel,
        signalLogicVersion: activeStrategy.signalLogicVersion,
        activatedAt: activeStrategy.activatedAt,
        createdAt: report.generatedAt,
        updatedAt: report.generatedAt,
      }),
    ),
  );

  console.log(
    JSON.stringify(
      {
        reportJson: path.join(RESULTS_DIR, 'report.json'),
        reportMarkdown: path.join(RESULTS_DIR, 'report.md'),
        verdict: report.verdict,
        storage: storageStatus.code,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
