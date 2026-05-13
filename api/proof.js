import { handleOptions } from '../server/security.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadLiveGate } from '../src/lib/liveGate.js';
import { loadPaperHealth } from '../src/lib/paperHealth.js';
import { buildSetupRegistry } from '../src/lib/setupRegistry.js';
import { activeStrategy } from '../src/config/strategyVersion.js';

async function readLatestBatchSummary() {
  const directory = path.resolve(process.cwd(), 'backtest-results');
  try {
    const files = (await fs.readdir(directory))
      .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
      .map((file) => path.join(directory, file));

    if (!files.length) {
      return null;
    }

    const withStats = await Promise.all(
      files.map(async (file) => ({
        file,
        stat: await fs.stat(file),
      })),
    );

    const latest = withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    return JSON.parse(await fs.readFile(latest.file, 'utf8'));
  } catch {
    return null;
  }
}

function deriveVerdict(proof, liveGate) {
  if (!liveGate?.storage?.durable) {
    return 'NOT READY';
  }

  if (
    proof?.strategyVersion === activeStrategy.strategyVersion &&
    proof?.status === 'PROVEN_READY_FOR_PAPER' &&
    liveGate?.paperGatePassed &&
    liveGate?.paperDurationPassed &&
    liveGate?.storage?.durable
  ) {
    return 'READY FOR SMALL LIVE TEST';
  }

  if (proof?.strategyVersion === activeStrategy.strategyVersion && proof?.status === 'PROVEN_READY_FOR_PAPER') {
    return 'READY FOR PAPER TRADING';
  }

  if (!proof && (liveGate?.stats?.totalClosedTrades ?? 0) > 0) {
    return 'COLLECTING DATA';
  }

  return 'NOT READY';
}

export default async function handler(_req, res) {
  if (handleOptions(_req, res, 'GET,OPTIONS')) {
    return;
  }

  if (_req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const summary = await readLatestBatchSummary();
    const liveGate = await loadLiveGate();
    const paperHealth = await loadPaperHealth();
    const summaryVersion = summary?.metadata?.strategyVersion ?? summary?.strategyVersion ?? summary?.proof?.strategyVersion ?? null;
    const summaryMatchesActive = summaryVersion === activeStrategy.strategyVersion;
    const proof = summaryMatchesActive ? summary?.proof ?? null : null;
    const setupRegistry = buildSetupRegistry(summary);
    const verdict = deriveVerdict(proof, liveGate);

    return res.status(200).json({
      verdict,
      strategy: activeStrategy,
      proof,
      setupRegistry,
      summary,
      summaryMatchesActive,
      staleSummaryStrategyVersion: summaryMatchesActive ? null : summaryVersion,
      liveGate,
      paperHealth,
      readyForLive: verdict === 'READY FOR SMALL LIVE TEST',
      whyNotReady: [
        ...(summaryMatchesActive ? [] : [`Fresh ATR backtest proof required for ${activeStrategy.strategyVersion}. Latest summary belongs to ${summaryVersion ?? 'no strategy version'}.`]),
        ...(proof?.failedCriteria ?? []),
        ...(liveGate?.failedCriteria ?? []),
        ...(liveGate?.storage?.warning ? [liveGate.storage.warning] : []),
        'Only approved setups are eligible for paper trading. Passing one setup does not approve the entire strategy.',
      ],
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
