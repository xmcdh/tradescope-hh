import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { executeBacktestRun, outputName, parseArgs } from './runBacktest.js';
import { evaluateProfitabilityProof } from '../lib/profitabilityProof.js';

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
          writeFile: true,
        });

        results.push({
          pair: payload.metadata.pair,
          timeframe: payload.metadata.timeframe,
          outputPath: payload.outputPath,
          metadata: payload.metadata,
          integrity: payload.integrity,
          backtest: payload.backtest,
          validation: payload.validation,
          warnings: payload.warnings ?? [],
        });
        console.log(`[ok] ${pair} ${timeframe} -> ${path.basename(payload.outputPath ?? outputName({ pair, timeframe, from, to }))}`);
      } catch (error) {
        const failure = {
          pair,
          timeframe,
          from,
          to,
          error: error.message,
        };
        failures.push(failure);
        console.error(`[skip] ${pair} ${timeframe} -> ${error.message}`);
      }
    }
  }

  const proof = evaluateProfitabilityProof(results);
  const summary = {
    generatedAt: new Date().toISOString(),
    metadata: {
      from,
      to,
      marketType,
      signalMode,
      pairs,
      timeframes,
      runCount: pairs.length * timeframes.length,
      successCount: results.length,
      failureCount: failures.length,
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
