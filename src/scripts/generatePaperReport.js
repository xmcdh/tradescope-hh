import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPaperProofReport, paperProofReportMarkdown } from '../lib/paperProofReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'paper-results');

async function main() {
  const report = await buildPaperProofReport();
  const markdown = paperProofReportMarkdown(report);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(OUTPUT_DIR, 'report.md'), markdown);

  console.log(
    JSON.stringify(
      {
        reportJson: path.join(OUTPUT_DIR, 'report.json'),
        reportMarkdown: path.join(OUTPUT_DIR, 'report.md'),
        verdict: report.finalVerdict,
        storage: report.storage?.code,
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
