import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBacktest, validateCandleIntegrity } from '../lib/backtester.js';
import { validateBacktest } from '../lib/backtestValidator.js';
import { strategyMetadata } from '../config/strategyVersion.js';
import { fetchBacktestOhlcv, normalizePair } from '../lib/backtestDataSource.js';

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

async function buildVersionMetadata() {
  const strategyFiles = [
    path.join(PROJECT_ROOT, 'src/lib/backtester.js'),
    path.join(PROJECT_ROOT, 'src/lib/backtestValidator.js'),
    path.join(PROJECT_ROOT, 'src/lib/indicators.js'),
    path.join(PROJECT_ROOT, 'src/lib/signalLogic.js'),
  ];

  return {
    ...strategyMetadata(),
    strategyFingerprint: await hashFiles(strategyFiles),
    signalLogicVersion: await hashFiles([path.join(PROJECT_ROOT, 'src/lib/signalLogic.js')]),
  };
}

async function writeJsonOutput(payload, filename) {
  const outputDir = path.join(PROJECT_ROOT, 'backtest-results');
  const outputPath = path.join(outputDir, filename);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
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
}) {
  const normalizedPair = normalizePair(pair);
  const fromMs = requiredDate(from, 'from');
  const toMs = requiredDate(to, 'to');

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

  const strategyMeta = await buildVersionMetadata();
  const pairKey = normalizedPair.replace('/', '');
  const backtest = runBacktest(fetched.candles, pairKey, timeframe, { signalMode });
  const validation = validateBacktest(fetched.candles, pairKey, timeframe, { signalMode });
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
      ...strategyMeta,
    },
    integrity,
    backtest,
    validation,
  };

  if (integrity.issues.length) {
    payload.warnings = integrity.issues;
  }

  if (writeFile) {
    payload.outputPath = await writeJsonOutput(payload, outputName({ pair: normalizedPair, timeframe, from, to }));
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
    });

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
