import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { executeBacktestRun, outputName, parseArgs } from './runBacktest.js';
import { evaluateProfitabilityProof } from '../lib/profitabilityProof.js';
import { strategyMetadata } from '../config/strategyVersion.js';
import { getExperimentFamily, getStrategyExperiment } from '../config/strategyExperiments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
const DEFAULT_TIMEFRAMES = ['15m', '1h', '4h'];

function isoDate(daysAgo = 0) {
  const now = new Date();
  const target = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

async function writeSummary(payload) {
  const outputDir = path.join(PROJECT_ROOT, 'backtest-results');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `batch-summary-${stamp}.json`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

function compactBacktest(backtest) {
  if (!backtest) {
    return backtest;
  }

  const {
    retestDiagnostics,
    signals,
    trades,
    ...rest
  } = backtest;
  const diagnostics = rest.diagnostics
    ? {
        ...rest.diagnostics,
        hardBlockReasonBreakdown: {},
      }
    : rest.diagnostics;

  return {
    ...rest,
    diagnostics,
  };
}

function compactValidation(validation) {
  if (!validation) {
    return validation;
  }

  const {
    inSample,
    outOfSample,
    ...rest
  } = validation;

  return {
    ...rest,
    inSample: compactBacktest(inSample),
    outOfSample: compactBacktest(outOfSample),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pairs = String(args.pairs ?? DEFAULT_PAIRS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const timeframes = String(args.timeframes ?? DEFAULT_TIMEFRAMES.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const from = args.from ?? isoDate(180);
  const to = args.to ?? isoDate(0);
  const marketType = args.market ?? 'future';
  const signalMode = args.mode ?? 'conservative';
  const dataSource = args['data-source'] ?? args.dataSource ?? 'ccxt-binance';
  const fallbackDataSource = args['fallback-data-source'] ?? args.fallbackDataSource ?? '';
  const writeCache = args['write-cache'] ?? args.writeCache ?? false;
  const cacheDir = args['cache-dir'] ?? args.cacheDir;
  const file = args.file ?? '';
  const proxyBaseUrl = args['proxy-base-url'] ?? args.proxyBaseUrl;
  const experimentId = args.experiment ?? args.experimentId ?? '';
  const dumpSignals = args['dump-signals'] ?? args.dumpSignals ?? 0;
  const debugOb = args['debug-ob'] === true || args.debugOb === true || args['debug-ob'] === 'true' || args.debugOb === 'true';
  const experiment = getStrategyExperiment(experimentId);

  if (experimentId && !experiment) {
    throw new Error(`Unknown --experiment ${experimentId}.`);
  }

  const results = [];
  const failures = [];

  for (const pair of pairs) {
    for (const timeframe of timeframes) {
      try {
        const payload = await executeBacktestRun({
          pair,
          timeframe,
          from,
          to,
          marketType,
          signalMode,
          dataSource,
          fallbackDataSource,
          writeCache,
          cacheDir,
          file,
          proxyBaseUrl,
          experimentId,
          dumpSignals,
          debugOb,
          writeFile: true,
        });

        results.push({
          pair: payload.metadata.pair,
          timeframe: payload.metadata.timeframe,
          outputPath: payload.outputPath,
          metadata: payload.metadata,
          integrity: payload.integrity,
          backtest: compactBacktest(payload.backtest),
          validation: compactValidation(payload.validation),
          warnings: payload.warnings ?? [],
        });
        console.log(`[ok] ${pair} ${timeframe} [${payload.metadata.dataSource}] -> ${path.basename(payload.outputPath ?? outputName({ pair, timeframe, from, to }))}`);
      } catch (error) {
        const failure = {
          pair,
          timeframe,
          from,
          to,
          requestedDataSource: dataSource,
          fallbackDataSource,
          error: error.message,
        };
        failures.push(failure);
        console.error(`[skip] ${pair} ${timeframe} -> ${error.message}`);
      }
    }
  }

  const strategy = experiment
    ? {
        ...strategyMetadata(),
        strategyVersion: experiment.strategyVersion,
        experimentId: experiment.experimentId,
        experimentLabel: experiment.label,
        experimentFamily: getExperimentFamily(experiment.experimentId),
        candidateOnly: true,
        backtestOnly: true,
        liveGateEligible: false,
        paperGateEligible: false,
      }
    : strategyMetadata();
  const proof = evaluateProfitabilityProof(results, { strategyVersion: strategy.strategyVersion });
  const summary = {
    generatedAt: new Date().toISOString(),
    metadata: {
      ...strategy,
      from,
      to,
      marketType,
      signalMode,
      dataSource,
      fallbackDataSource,
      writeCache: writeCache === true || writeCache === 'true',
      dumpSignals: Number(dumpSignals) || 0,
      pairs,
      timeframes,
      runCount: pairs.length * timeframes.length,
      successCount: results.length,
      failureCount: failures.length,
      experimentId: experiment?.experimentId ?? null,
      experimentLabel: experiment?.label ?? null,
      experimentFamily: strategy.experimentFamily ?? null,
      candidateOnly: Boolean(experiment),
      backtestOnly: Boolean(experiment),
      activeProductionStrategyVersion: experiment ? strategyMetadata().strategyVersion : strategy.strategyVersion,
    },
    proof,
    results,
    failures,
  };
  const summaryPath = await writeSummary(summary);

  console.log(
    JSON.stringify(
      {
        summaryPath,
        status: proof.status,
        successCount: results.length,
        failureCount: failures.length,
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
