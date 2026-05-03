import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHistoryLengthComparison,
  historyLengthComparisonToMarkdown,
} from '../lib/historyLengthComparison.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');

const DEFAULT_RANGES = [
  ['2024-01-01', '2024-07-01'],
  ['2023-07-01', '2024-07-01'],
  ['2023-01-01', '2024-07-01'],
];

async function latestSummaryForRange(from, to) {
  const files = (await fs.readdir(RESULTS_DIR))
    .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
    .map((file) => path.join(RESULTS_DIR, file));
  const matches = [];

  for (const file of files) {
    try {
      const payload = JSON.parse(await fs.readFile(file, 'utf8'));
      if (payload.metadata?.from === from && payload.metadata?.to === to) {
        matches.push({
          file,
          stat: await fs.stat(file),
          payload: {
            ...payload,
            sourceFile: path.basename(file),
          },
        });
      }
    } catch {
      // Ignore partial or invalid summaries.
    }
  }

  if (!matches.length) {
    return null;
  }

  return matches.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0].payload;
}

export async function generateHistoryLengthComparison() {
  const summaries = [];

  for (const [from, to] of DEFAULT_RANGES) {
    const summary = await latestSummaryForRange(from, to);
    if (summary) {
      summaries.push(summary);
    }
  }

  if (!summaries.length) {
    throw new Error('No matching batch summaries found for history-length comparison.');
  }

  const comparison = buildHistoryLengthComparison(summaries);
  const jsonPath = path.join(RESULTS_DIR, 'history-length-comparison.json');
  const markdownPath = path.join(RESULTS_DIR, 'history-length-comparison.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await fs.writeFile(markdownPath, historyLengthComparisonToMarkdown(comparison));

  return {
    jsonPath,
    markdownPath,
    comparison,
  };
}

export async function main() {
  const result = await generateHistoryLengthComparison();

  console.log(
    JSON.stringify(
      {
        comparisonJson: result.jsonPath,
        comparisonMarkdown: result.markdownPath,
        anySetupEligibleForApproval: result.comparison.conclusion.anySetupEligibleForApproval,
        sparseUnderCurrentRules: result.comparison.conclusion.sparseUnderCurrentRules,
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
