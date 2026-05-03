import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRegimeFeatureAudit,
  regimeFeatureAuditToMarkdown,
} from '../lib/regimeFeatureAudit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const EXPERIMENT_ID = 'v1.5-trailing-after-1r';
const PREFIX = `${EXPERIMENT_ID}-SOL-USDT-1h-2021-07-01-to-2024-07-01-`;
const OUTPUT_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.5-regime-feature-audit.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-v1.5-regime-feature-audit.md');

async function latestRunFile() {
  const files = await fs.readdir(RESULTS_DIR);
  const matches = await Promise.all(
    files
      .filter((file) => file.startsWith(PREFIX) && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  const latest = matches.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) {
    throw new Error(`No ${EXPERIMENT_ID} SOL/USDT 1h run file found for regime feature audit.`);
  }

  return latest.filePath;
}

export async function generateRegimeFeatureAudit() {
  const sourcePath = await latestRunFile();
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const audit = buildRegimeFeatureAudit(payload);
  audit.sourceFile = path.basename(sourcePath);

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(audit, null, 2)}\n`);
  await fs.writeFile(OUTPUT_MD, regimeFeatureAuditToMarkdown(audit));

  return {
    outputJson: OUTPUT_JSON,
    outputMarkdown: OUTPUT_MD,
    audit,
  };
}

export async function main() {
  const result = await generateRegimeFeatureAudit();

  console.log(
    JSON.stringify(
      {
        outputJson: result.outputJson,
        outputMarkdown: result.outputMarkdown,
        tradesAnalyzed: result.audit.summary.trades,
        candidateFilters: result.audit.candidateFilters.length,
        v15Status: result.audit.conclusion.v15Status,
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
