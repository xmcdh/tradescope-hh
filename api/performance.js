import { readSignalLog } from '../src/lib/signalLogger.js';
import { computePerformanceStats } from '../src/lib/performanceStats.js';
import { getStorageStatus } from '../src/lib/storageAdapter.js';

export default async function handler(_req, res) {
  try {
    const entries = await readSignalLog();
    const stats = computePerformanceStats(entries);
    const storage = await getStorageStatus();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      entries,
      stats,
      storage,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
