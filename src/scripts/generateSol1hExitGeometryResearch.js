import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v15ExitGeometryExperiments } from '../config/strategyExperiments.js';
import {
  buildExitGeometryComparison,
  buildExitGeometryMetrics,
  buildExitGeometryPlan,
  exitGeometryComparisonToMarkdown,
  exitGeometryPlanToMarkdown,
  EXIT_GEOMETRY_RANGES,
} from '../lib/exitGeometryResearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
const PLAN_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-exit-geometry-plan.json');
const PLAN_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-exit-geometry-plan.md');
const COMPARISON_JSON = path.join(RESULTS_DIR, 'sol-usdt-1h-exit-geometry-comparison.json');
const COMPARISON_MD = path.join(RESULTS_DIR, 'sol-usdt-1h-exit-geometry-comparison.md');
const BASELINE_EXPERIMENT_ID = 'v1.4-chop-avoidance-filter';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function latestRunFile({ experimentId, from, to }) {
  const files = await fs.readdir(RESULTS_DIR);
  const prefix = `${experimentId}-SOL-USDT-1h-${from}-to-${to}-`;
  const matches = await Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(RESULTS_DIR, file);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  return matches.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

async function loadRunMetrics(experimentId, baselineMetricsByRange = new Map()) {
  const runs = [];

  for (const range of EXIT_GEOMETRY_RANGES) {
    const filePath = await latestRunFile({
      experimentId,
      from: range.from,
      to: range.to,
    });

    if (!filePath) {
      runs.push({
        experimentId,
        from: range.from,
        to: range.to,
        missing: true,
        status: 'NOT_RUN',
        fragilityWarnings: ['RUN_FILE_NOT_FOUND'],
      });
      continue;
    }

    const payload = await readJson(filePath);
    const baselineMetrics = baselineMetricsByRange.get(`${range.from}:${range.to}`) ?? null;
    const metrics = buildExitGeometryMetrics(payload, baselineMetrics);
    runs.push({
      ...metrics,
      sourceFile: path.basename(filePath),
    });
  }

  return runs;
}

async function main() {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  const plan = buildExitGeometryPlan(v15ExitGeometryExperiments);
  await fs.writeFile(PLAN_JSON, `${JSON.stringify(plan, null, 2)}\n`);
  await fs.writeFile(PLAN_MD, exitGeometryPlanToMarkdown(plan));

  const baselineRuns = (await loadRunMetrics(BASELINE_EXPERIMENT_ID)).filter((run) => !run.missing);
  const baselineMetricsByRange = new Map(
    baselineRuns.map((run) => [`${run.from}:${run.to}`, run]),
  );
  const variants = [];

  for (const experiment of v15ExitGeometryExperiments) {
    variants.push({
      experimentId: experiment.experimentId,
      label: experiment.label,
      strategyVersion: experiment.strategyVersion,
      exitGeometry: experiment.exitGeometry,
      runs: await loadRunMetrics(experiment.experimentId, baselineMetricsByRange),
    });
  }

  const comparison = buildExitGeometryComparison({
    baseline: baselineRuns,
    variants,
  });

  await fs.writeFile(COMPARISON_JSON, `${JSON.stringify(comparison, null, 2)}\n`);
  await fs.writeFile(COMPARISON_MD, exitGeometryComparisonToMarkdown(comparison));

  console.log(
    JSON.stringify(
      {
        planJson: PLAN_JSON,
        planMd: PLAN_MD,
        comparisonJson: COMPARISON_JSON,
        comparisonMd: COMPARISON_MD,
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
