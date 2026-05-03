import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExperimentComparison,
  experimentComparisonToMarkdown,
} from '../lib/experimentComparison.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

async function main() {
  const outputDir = path.join(PROJECT_ROOT, 'backtest-results');
  const comparison = await buildExperimentComparison({ resultsDir: outputDir });
  const jsonPath = path.join(outputDir, 'v1.2-experiment-comparison.json');
  const markdownPath = path.join(outputDir, 'v1.2-experiment-comparison.md');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await fs.writeFile(markdownPath, experimentComparisonToMarkdown(comparison));

  console.log(JSON.stringify({
    jsonPath,
    markdownPath,
    variants: comparison.variants.map((variant) => ({
      experimentId: variant.experimentId,
      tested: variant.tested,
      proofStatus: variant.proofStatus ?? null,
      antiOverfittingFlags: variant.antiOverfittingFlags,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
