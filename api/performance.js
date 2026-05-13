import { handleOptions } from '../server/security.js';
import { readSignalLog } from '../src/lib/signalLogger.js';
import { computePerformanceStats } from '../src/lib/performanceStats.js';
import { getStorageStatus } from '../src/lib/storageAdapter.js';

export default async function handler(_req, res) {
  if (handleOptions(_req, res, 'GET,OPTIONS')) {
    return;
  }

  if (_req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const entries = await readSignalLog();
    const stats = computePerformanceStats(entries);
    const storage = await getStorageStatus();

    return res.status(200).json({
      entries,
      stats,
      storage,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
