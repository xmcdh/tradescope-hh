import { handleOptions, requireWriteToken } from '../server/security.js';
import { closeConvictionTrade, logConvictionTrade, readConvictionTrades, readPaperTrades, syncPaperTrades } from '../src/lib/paperTrader.js';
import { computePerformanceStats } from '../src/lib/performanceStats.js';
import { loadLiveGate } from '../src/lib/liveGate.js';
import { loadPaperHealth } from '../src/lib/paperHealth.js';
import { getStorageStatus } from '../src/lib/storageAdapter.js';
import { activeStrategy } from '../src/config/strategyVersion.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) {
    return;
  }

  if (req.method === 'GET') {
    if (req.url?.includes('/conviction') || req.query?.type === 'conviction') {
      const trades = await readConvictionTrades();
      return res.status(200).json({ trades });
    }

    const trades = await readPaperTrades();
    const stats = computePerformanceStats(trades);
    const gate = await loadLiveGate();
    const storage = await getStorageStatus();
    const paperHealth = await loadPaperHealth();
    return res.status(200).json({ trades, stats, gate, storage, paperHealth, strategy: activeStrategy });
  }

  if (req.method === 'POST') {
    const authError = requireWriteToken(req, res);
    if (authError) return authError;

    if (req.url?.includes('/conviction') || req.query?.type === 'conviction') {
      try {
        if (req.body?.action === 'close') {
          await closeConvictionTrade(req.body.id, req.body.status);
          const trades = await readConvictionTrades();
          return res.status(200).json({ ok: true, trades });
        }

        const trade = await logConvictionTrade(req.body ?? {});
        const trades = await readConvictionTrades();
        return res.status(200).json({ ok: true, trade, trades });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const { pair, timeframe, setup, candles } = req.body ?? {};
    if (!pair || !timeframe || !setup || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'Missing pair, timeframe, setup, or candles.' });
    }

    const trades = await syncPaperTrades({ pair, timeframe, setup, candles });
    return res.status(200).json({ ok: true, total: trades.length });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
