import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './runBacktest.js';
import { loadLiveGate } from '../lib/liveGate.js';
import { buildSetupRegistry } from '../lib/setupRegistry.js';
import { getStorageStatus, writeProofSnapshot, writeSetupApproval } from '../lib/storageAdapter.js';

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

export function deriveVerdict({ proof, liveGate }) {
  if (!liveGate?.storage?.durable) {
    return 'NOT READY';
  }

  const paperReady = liveGate?.paperGatePassed;
  const durationPassed = liveGate?.paperDurationPassed;
  const durable = liveGate?.storage?.durable;

  if (proof.status === 'PROVEN_READY_FOR_PAPER' && paperReady && durationPassed && durable) {
    return 'READY FOR SMALL LIVE TEST';
  }

  if (proof.status === 'PROVEN_READY_FOR_PAPER' && !paperReady) {
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
  const warnings = summary.results
    .filter((item) => (item.backtest?.actionableClosedTradeCount ?? 0) < 50)
    .map((item) => `- ${item.pair} ${item.timeframe}: only ${item.backtest?.actionableClosedTradeCount ?? 0} closed actionable trades`);

  const lines = [
    '# TradeScope Backtest Proof Report',
    '',
    `Source summary: \`${path.basename(sourcePath)}\``,
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Executive Summary',
    `- Final verdict: **${deriveVerdict({ proof, liveGate })}**`,
    `- Proof status: **${proof.status}**`,
    `- Tested setups: ${summary.results.length}`,
    `- Successes / failures: ${summary.metadata.successCount} / ${summary.metadata.failureCount}`,
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
    '',
    '## Actionable Metrics',
    `- Closed actionable trades: ${proof.overall.closedActionableTrades}`,
    `- Proven setups: ${proof.overall.provenSetups}/${proof.overall.setupCount}`,
    `- Dominant pair dependence: ${(proof.overall.pairDependence * 100).toFixed(2)}%${proof.overall.dominantPair ? ` (${proof.overall.dominantPair})` : ''}`,
    '',
    '## OOS / Walk-Forward',
    ...summary.results.map((item) => {
      const validation = item.validation ?? {};
      return `- ${item.pair} ${item.timeframe}: flags=${(validation.flags ?? []).join(', ') || 'none'}, walkForward=${validation.walkForward?.pass ? 'pass' : 'fail'}, OOS degradation=${validation.comparison?.oosDegradation ?? 'n/a'}`;
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

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const latest = await readLatestBatchSummary(args.input ?? null);
  const liveGate = await loadLiveGate();
  const setupRegistry = buildSetupRegistry(latest.payload);
  const storageStatus = await getStorageStatus();
  const report = {
    generatedAt: new Date().toISOString(),
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
  await writeProofSnapshot({
    id: snapshotId,
    verdict: report.verdict,
    generatedAt: report.generatedAt,
    approvedSetupCount: setupRegistry.counts.approved,
    collectingDataSetupCount: setupRegistry.counts.collectingData,
    rejectedSetupCount: setupRegistry.counts.rejected,
    storageStatus: storageStatus.code,
    sourceBatchFilename: path.basename(latest.path),
    sourceReportFilename: 'report.json',
    payloadJson: report,
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
