import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBacktest, validateCandleIntegrity } from '../lib/backtester.js';
import { validateBacktest } from '../lib/backtestValidator.js';

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

export function normalizePair(pair) {
  if (pair.includes('/')) {
    return pair.toUpperCase();
  }

  const upper = pair.toUpperCase();
  if (upper.endsWith('USDT')) {
    return `${upper.slice(0, -4)}/USDT`;
  }

  return upper;
}

export function outputName({ pair, timeframe, from, to, prefix = '' }) {
  const safePair = pair.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}${safePair}-${timeframe}-${from}-to-${to}-${stamp}.json`;
}

async function loadCcxt() {
  try {
    return await import('ccxt');
  } catch {
    throw new Error('CCXT is required for backtesting. Install it with `npm install ccxt`.');
  }
}

function classifyFetchError(error) {
  const message = String(error?.message ?? error ?? '');
  const lower = message.toLowerCase();

  if (lower.includes('exchangeinfo') || lower.includes('ddosprotection') || lower.includes('cloudflare')) {
    return 'Binance provider blocking detected while loading markets. Try a different network or a local residential connection.';
  }

  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('enotfound')) {
    return 'Network fetch failed while requesting Binance candles. Check connectivity or provider blocking.';
  }

  if (lower.includes('bad symbol') || lower.includes('not supported')) {
    return 'Requested pair or timeframe is unavailable on the selected Binance market type.';
  }

  return message || 'Unknown backtest fetch error.';
}

export async function fetchOhlcv({ pair, timeframe, fromMs, toMs, marketType }) {
  const ccxt = await loadCcxt();
  const useUsdm = ['future', 'futures', 'swap', 'usdm'].includes(String(marketType).toLowerCase());
  const ExchangeClass = useUsdm && ccxt.binanceusdm ? ccxt.binanceusdm : ccxt.binance;
  const exchange = new ExchangeClass({
    enableRateLimit: true,
    options: {
      defaultType: marketType,
    },
  });

  try {
    await exchange.loadMarkets();
  } catch (error) {
    throw new Error(classifyFetchError(error));
  }

  const limit = 1000;
  const rows = [];
  let since = fromMs;
  const marketSymbol = exchange.markets[pair] ? pair : exchange.markets[`${pair}:USDT`] ? `${pair}:USDT` : pair;

  while (since < toMs) {
    let batch;

    try {
      batch = await exchange.fetchOHLCV(marketSymbol, timeframe, since, limit);
    } catch (error) {
      throw new Error(classifyFetchError(error));
    }

    if (!batch.length) {
      break;
    }

    for (const row of batch) {
      if (row[0] >= toMs) {
        break;
      }
      rows.push(row);
    }

    const lastTimestamp = batch[batch.length - 1][0];
    const nextSince = lastTimestamp + 1;
    if (nextSince <= since) {
      break;
    }
    since = nextSince;
  }

  if (!rows.length) {
    throw new Error('No OHLCV data returned by Binance for the requested range.');
  }

  return {
    exchangeId: exchange.id,
    marketSymbol,
    candles: rows.map(([timestamp, open, high, low, close, volume]) => ({
      time: Math.floor(timestamp / 1000),
      open,
      high,
      low,
      close,
      volume,
    })),
  };
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
    strategyVersion: await hashFiles(strategyFiles),
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
  writeFile = true,
}) {
  const normalizedPair = normalizePair(pair);
  const fromMs = requiredDate(from, 'from');
  const toMs = requiredDate(to, 'to');

  if (toMs <= fromMs) {
    throw new Error('--to must be after --from.');
  }

  const fetched = await fetchOhlcv({
    pair: normalizedPair,
    timeframe,
    fromMs,
    toMs,
    marketType,
  });

  const strategyMeta = await buildVersionMetadata();
  const integrity = validateCandleIntegrity(fetched.candles, timeframe);
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
