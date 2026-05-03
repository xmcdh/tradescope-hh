import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRegimeDependencyAnalysis,
  regimeDependencyAnalysisToMarkdown,
} from '../lib/regimeDependencyAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const EXPERIMENT_ID = 'v1.5-trailing-after-1r';
const PAIR_TOKEN = 'SOL-USDT';
const TIMEFRAME = '1h';
const FOCUS_FROM = '2021-07-01';
const FOCUS_TO = '2024-07-01';
const COMPARISON_FILE = path.join(RESULTS_DIR, 'sol-usdt-1h-exit-geometry-comparison.json');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.5-trailing-regime-analysis.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.5-trailing-regime-analysis.md');

async function latestRunFile() {
  const prefix = `${EXPERIMENT_ID}-${PAIR_TOKEN}-${TIMEFRAME}-${FOCUS_FROM}-to-${FOCUS_TO}-`;
  const files = await fs.readdir(RESULTS_DIR);
  const matches = await Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  const match = matches.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!match) {
    throw new Error(`No ${EXPERIMENT_ID} run file found for ${PAIR_TOKEN} ${TIMEFRAME} ${FOCUS_FROM} to ${FOCUS_TO}.`);
  }

  return match.filePath;
}

async function comparisonRun() {
  try {
    const comparison = JSON.parse(await fs.readFile(COMPARISON_FILE, 'utf8'));
    const range = (comparison.ranges ?? []).find((item) => item.range?.from === FOCUS_FROM && item.range?.to === FOCUS_TO);
    const variant = range?.variants?.find((item) => item.experimentId === EXPERIMENT_ID) ?? null;
    return variant?.runs?.find((run) => run.from === FOCUS_FROM && run.to === FOCUS_TO) ?? variant ?? null;
  } catch {
    return null;
  }
}

export async function generateSol1hV15RegimeAnalysis() {
  const sourcePath = await latestRunFile();
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const analysis = buildRegimeDependencyAnalysis(payload, await comparisonRun());
  analysis.sourceFile = path.basename(sourcePath);

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(analysis, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, regimeDependencyAnalysisToMarkdown(analysis));

  return {
    outputJson: OUTPUT_JSON,
    outputMarkdown: OUTPUT_MD,
    analysis,
  };
}

export async function main() {
  const result = await generateSol1hV15RegimeAnalysis();
  console.log(
    JSON.stringify(
      {
        outputJson: result.outputJson,
        outputMarkdown: result.outputMarkdown,
        promotionStatus: result.analysis.headlineMetrics.promotionStatus,
        topMonth: result.analysis.headlineMetrics.topMonth,
        topQuarter: result.analysis.headlineMetrics.topQuarter,
        candidateFilters: result.analysis.regimeFilterCandidates.length,
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
