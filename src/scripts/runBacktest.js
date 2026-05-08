import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBacktest, validateCandleIntegrity } from '../lib/backtester.js';
import { validateBacktest } from '../lib/backtestValidator.js';
import { strategyMetadata } from '../config/strategyVersion.js';
import { getExperimentFamily, getStrategyExperiment } from '../config/strategyExperiments.js';
import { fetchBacktestOhlcv, normalizePair } from '../lib/backtestDataSource.js';
import { pairToSymbol } from '../lib/backtestDataSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? next : true;
    if (args[key] === next) {
      index += 1;
    }
  }

  return args;
}

function requiredDate(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Missing or invalid --${label} date. Use YYYY-MM-DD.`);
  }

  return timestamp;
}

export function outputName({ pair, timeframe, from, to, prefix = '' }) {
  const safePair = pair.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}${safePair}-${timeframe}-${from}-to-${to}-${stamp}.json`;
}

async function hashFiles(filePaths) {
  const hash = crypto.createHash('sha256');

  for (const filePath of filePaths) {
    const content = await fs.readFile(filePath);
    hash.update(content);
  }

  return hash.digest('hex').slice(0, 12);
}

async function buildVersionMetadata(experiment = null) {
  const strategyFiles = [
    path.join(PROJECT_ROOT, 'src/lib/backtester.js'),
    path.join(PROJECT_ROOT, 'src/lib/backtestValidator.js'),
    path.join(PROJECT_ROOT, 'src/lib/indicators.js'),
    path.join(PROJECT_ROOT, 'src/lib/signalLogic.js'),
  ];

  const base = {
    ...strategyMetadata(),
    strategyFingerprint: await hashFiles(strategyFiles),
    signalLogicVersion: await hashFiles([path.join(PROJECT_ROOT, 'src/lib/signalLogic.js')]),
  };

  if (!experiment) {
    return base;
  }

  return {
    ...base,
    strategyVersion: experiment.strategyVersion,
    experimentId: experiment.experimentId,
    experimentLabel: experiment.label,
    experimentFamily: getExperimentFamily(experiment.experimentId),
    candidateOnly: true,
    backtestOnly: true,
    liveGateEligible: false,
    paperGateEligible: false,
    activeProductionStrategyVersion: base.strategyVersion,
  };
}

async function writeJsonOutput(payload, filename) {
  const outputDir = path.join(PROJECT_ROOT, 'backtest-results');
  const outputPath = path.join(outputDir, filename);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

async function writeDebugSignalDump({ pair, timeframe, signals, retestDiagnostics = [], limit = 10 }) {
  const outputDir = path.join(PROJECT_ROOT, 'backtest-results');
  const safePair = pair.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const outputPath = path.join(outputDir, `debug-signals-${safePair}-${timeframe}.json`);
  const retestByTimestamp = new Map(
    (retestDiagnostics ?? []).map((item) => [item.createdAt, item]),
  );
  const payload = (signals ?? [])
    .filter((signal) => signal.signal !== 'NO_TRADE')
    .slice(0, Math.max(0, Number(limit) || 0));
  const enriched = payload.map((signal) => {
    const pending = retestByTimestamp.get(signal.timestamp);
    if (!pending) {
      return signal;
    }

    return {
      ...signal,
      retestStatus: pending.status,
      confirmationRequirement: pending.confirmationRequirement,
      confirmationOccurred: pending.confirmationOccurred,
      confirmationTimestamp: pending.confirmationTimestamp,
      candlesUntilConfirmation: pending.candlesUntilConfirmation,
      candlesUntilResolution: pending.candlesUntilResolution,
      confirmationSignal: pending.confirmationSignal,
      confirmationSignalValidity: pending.confirmationSignalValidity,
      becameActionableTrade: pending.becameActionableTrade,
      tradeActionabilityReason: pending.tradeActionabilityReason,
      invalidationReason: pending.invalidationReason,
    };
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
  return outputPath;
}

function compactStoredSignalsForV2(signals = [], limit = 250) {
  return (signals ?? [])
    .filter((signal) => signal.signalDiagnostics?.strategyType === 'breakoutVolumeExpansion' && signal.signal !== 'NO_TRADE')
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((signal) => ({
      timestamp: signal.timestamp,
      pair: signal.pair,
      timeframe: signal.timeframe,
      signal: signal.signal,
      signalValidity: signal.signalValidity,
      direction: signal.direction,
      score: signal.score,
      blockedReason: signal.blockedReason,
      rejectionReasons: signal.rejectionReasons,
      actionableEligible: signal.actionableEligible,
      actionabilityReason: signal.actionabilityReason,
      entry: signal.entry,
      sl: signal.sl,
      tp: signal.tp,
      rrRatio: signal.rrRatio,
      signalDiagnostics: signal.signalDiagnostics,
    }));
}

async function loadFundingCacheForPair(pair) {
  const symbol = pairToSymbol(pair);
  const filePath = path.join(PROJECT_ROOT, 'data/funding-cache', `${symbol}_funding.json`);
  try {
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(payload.records) ? { [symbol]: payload.records } : {};
  } catch {
    return {};
  }
}

export async function executeBacktestRun({
  pair,
  timeframe,
  from,
  to,
  marketType = 'future',
  signalMode = 'conservative',
  dataSource = 'ccxt-binance',
  fallbackDataSource = '',
  writeCache = false,
  cacheDir = undefined,
  file = '',
  proxyBaseUrl = undefined,
  writeFile = true,
  dumpSignals = 0,
  experimentId = '',
  debugOb = false,
}) {
  const normalizedPair = normalizePair(pair);
  const fromMs = requiredDate(from, 'from');
  const toMs = requiredDate(to, 'to');
  const experiment = getStrategyExperiment(experimentId);

  if (experimentId && !experiment) {
    throw new Error(`Unknown --experiment ${experimentId}.`);
  }

  if (toMs <= fromMs) {
    throw new Error('--to must be after --from.');
  }

  const sources = [
    dataSource,
    ...String(fallbackDataSource ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  const attempts = [];
  let fetched;

  for (const source of sources) {
    try {
      fetched = await fetchBacktestOhlcv({
        pair: normalizedPair,
        timeframe,
        from,
        to,
        marketType,
        dataSource: source,
        writeCache,
        cacheDir,
        file,
        proxyBaseUrl,
      });
      attempts.push({ source, ok: true, candleCount: fetched.candles.length });
      break;
    } catch (error) {
      attempts.push({ source, ok: false, error: error.message });
    }
  }

  if (!fetched) {
    const messages = attempts.map((attempt) => `${attempt.source}: ${attempt.error}`).join(' | ');
    throw new Error(`All backtest data sources failed. ${messages}`);
  }

  const integrity = validateCandleIntegrity(fetched.candles, timeframe);
  if (!integrity.valid) {
    throw new Error(`Backtest candle integrity failed: ${integrity.issues.join(' | ')}`);
  }

  const strategyMeta = await buildVersionMetadata(experiment);
  const pairKey = normalizedPair.replace('/', '');
  const fundingCache = await loadFundingCacheForPair(normalizedPair);
  const previousFundingCache = globalThis.__TRADESCOPE_FUNDING_CACHE__;
  globalThis.__TRADESCOPE_FUNDING_CACHE__ = {
    ...(previousFundingCache ?? {}),
    ...fundingCache,
  };
  const backtestOptions = {
    signalMode,
    experimentConfig: experiment,
    retestConfig: experiment?.retestConfig,
    strategyMetadata: strategyMeta,
  };
  const backtest = runBacktest(fetched.candles, pairKey, timeframe, backtestOptions);
  const validation = validateBacktest(fetched.candles, pairKey, timeframe, backtestOptions);
  const payload = {
    generatedAt: new Date().toISOString(),
    metadata: {
      pair: normalizedPair,
      timeframe,
      from,
      to,
      candleCount: fetched.candles.length,
      sourceExchange: fetched.exchangeId,
      marketSymbol: fetched.marketSymbol,
      marketType,
      dataSource: fetched.source,
      requestedDataSource: dataSource,
      dataSourceAttempts: attempts,
      cachePath: fetched.cachePath ?? null,
      experimentId: experiment?.experimentId ?? null,
      experimentLabel: experiment?.label ?? null,
      experimentFamily: strategyMeta.experimentFamily ?? null,
      regimeFilter: experiment?.regimeFilter ?? null,
      exitGeometry: experiment?.exitGeometry ?? null,
      candidateOnly: Boolean(experiment),
      backtestOnly: Boolean(experiment),
      liveGateEligible: false,
      paperGateEligible: false,
      ...strategyMeta,
    },
    integrity,
    backtest,
    validation,
  };

  if (Number(dumpSignals) > 0) {
    payload.debugSignalDumpPath = await writeDebugSignalDump({
      pair: normalizedPair,
      timeframe,
      signals: backtest.signals,
      retestDiagnostics: backtest.retestDiagnostics,
      limit: Number(dumpSignals),
    });
  }

  if (debugOb) {
    console.log(
      JSON.stringify(
        {
          pair: normalizedPair,
          timeframe,
          orderBlock: backtest.diagnostics?.orderBlock ?? null,
        },
        null,
        2,
      ),
    );
  }

  if (integrity.issues.length) {
    payload.warnings = integrity.issues;
  }

  if (writeFile) {
    const storedPayload =
      experiment?.signalLogic?.strategyType === 'breakoutVolumeExpansion'
        ? {
            ...payload,
            backtest: {
              ...payload.backtest,
              signals: compactStoredSignalsForV2(payload.backtest.signals, Math.max(Number(dumpSignals) || 0, 250)),
            },
          }
        : payload;

    payload.outputPath = await writeJsonOutput(
      storedPayload,
      outputName({
        pair: normalizedPair,
        timeframe,
        from,
        to,
        prefix: experiment ? `${experiment.experimentId}-` : '',
      }),
    );
  }

  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const payload = await executeBacktestRun({
      pair: args.pair ?? args.symbol ?? 'BTC/USDT',
      timeframe: args.timeframe ?? '15m',
      from: args.from ?? null,
      to: args.to ?? null,
      marketType: args.market ?? 'future',
      signalMode: args.mode ?? 'conservative',
      dataSource: args['data-source'] ?? args.dataSource ?? 'ccxt-binance',
      fallbackDataSource: args['fallback-data-source'] ?? args.fallbackDataSource ?? '',
      writeCache: args['write-cache'] ?? args.writeCache ?? false,
      cacheDir: args['cache-dir'] ?? args.cacheDir,
      file: args.file ?? '',
      proxyBaseUrl: args['proxy-base-url'] ?? args.proxyBaseUrl,
      writeFile: true,
      dumpSignals: args['dump-signals'] ?? args.dumpSignals ?? 0,
      experimentId: args.experiment ?? args.experimentId ?? '',
      debugOb: args['debug-ob'] === true || args.debugOb === true || args['debug-ob'] === 'true' || args.debugOb === 'true',
    });

    const debugSignals = args['debug-signals'] === true || args.debugSignals === true || args['debug-signals'] === 'true' || args.debugSignals === 'true';
    console.log(
      JSON.stringify(
        {
          outputPath: payload.outputPath,
          metadata: payload.metadata,
          warnings: payload.warnings ?? [],
          actionableTradeCount: payload.backtest.actionableTradeCount,
          actionableClosedTradeCount: payload.backtest.actionableClosedTradeCount,
          actionableWinRate: payload.backtest.actionableWinRate,
          actionableExpectancy: payload.backtest.actionableExpectancy,
          oosFlags: payload.validation.flags,
          diagnostics: debugSignals ? payload.backtest.diagnostics : undefined,
          debugSignalDumpPath: payload.debugSignalDumpPath ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main();
}
