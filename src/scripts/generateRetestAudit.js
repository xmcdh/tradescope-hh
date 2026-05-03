import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRetestAudit, retestAuditToMarkdown } from '../lib/retestAudit.js';
import { parseArgs } from './runBacktest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');

function normalizeFileToken(value) {
  return String(value ?? '').replace('/', '-').replace(/[^\w-]+/g, '-');
}

async function findLatestBacktestFile(pair, timeframe) {
  const pairToken = normalizeFileToken(pair);
  const timeframeToken = normalizeFileToken(timeframe);
  const files = (await fs.readdir(RESULTS_DIR))
    .filter((file) => file.startsWith(`${pairToken}-${timeframeToken}-`) && file.endsWith('.json'))
    .filter((file) => !file.startsWith('retest-audit-'))
    .map((file) => path.join(RESULTS_DIR, file));

  if (!files.length) {
    throw new Error(`No backtest result found for ${pair} ${timeframe}.`);
  }

  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      stat: await fs.stat(file),
    })),
  );

  return withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0].file;
}

export async function generateRetestAudit({
  pair = 'BTC/USDT',
  timeframe = '1h',
  input = null,
  outputPrefix = null,
} = {}) {
  const sourcePath = input ? path.resolve(input) : await findLatestBacktestFile(pair, timeframe);
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const audit = buildRetestAudit(payload, {
    pair,
    timeframe,
    source: path.basename(sourcePath),
  });
  const safePair = normalizeFileToken(pair);
  const prefix = outputPrefix ?? path.join(RESULTS_DIR, `retest-audit-${safePair}-${timeframe}`);
  const jsonPath = `${prefix}.json`;
  const markdownPath = `${prefix}.md`;

  await fs.writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`);
  await fs.writeFile(markdownPath, retestAuditToMarkdown(audit));

  return {
    jsonPath,
    markdownPath,
    audit,
  };
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await generateRetestAudit({
    pair: args.pair ?? 'BTC/USDT',
    timeframe: args.timeframe ?? '1h',
    input: args.input ?? null,
    outputPrefix: args.outputPrefix ?? null,
  });

  console.log(
    JSON.stringify(
      {
        auditJson: result.jsonPath,
        auditMarkdown: result.markdownPath,
        confirmedRetests: result.audit.summary.confirmedRetestCount,
        dominantFailureReason: result.audit.summary.dominantFailureReason,
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
