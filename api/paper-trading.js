import { readPaperTrades, syncPaperTrades } from '../src/lib/paperTrader.js';
import { computePerformanceStats } from '../src/lib/performanceStats.js';
import { loadLiveGate } from '../src/lib/liveGate.js';
import { loadPaperHealth } from '../src/lib/paperHealth.js';
import { getStorageStatus } from '../src/lib/storageAdapter.js';
import { activeStrategy } from '../src/config/strategyVersion.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const trades = await readPaperTrades();
    const stats = computePerformanceStats(trades);
    const gate = await loadLiveGate();
    const storage = await getStorageStatus();
    const paperHealth = await loadPaperHealth();
    return res.status(200).json({ trades, stats, gate, storage, paperHealth, strategy: activeStrategy });
  }

  if (req.method === 'POST') {
    const { pair, timeframe, setup, candles } = req.body ?? {};
    if (!pair || !timeframe || !setup || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'Missing pair, timeframe, setup, or candles.' });
    }

    const trades = await syncPaperTrades({ pair, timeframe, setup, candles });
    return res.status(200).json({ ok: true, total: trades.length });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
