import { handleOptions, requireWriteToken } from '../server/security.js';
import { readSignalLog, syncSignalLog } from '../src/lib/signalLogger.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) {
    return;
  }

  if (req.method === 'GET') {
    const entries = await readSignalLog();
    return res.status(200).json(entries);
  }

  if (req.method === 'POST') {
    const authError = requireWriteToken(req, res);
    if (authError) return authError;

    const { pair, timeframe, setup, candles } = req.body ?? {};

    if (!pair || !timeframe || !setup || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'Missing pair, timeframe, setup, or candles.' });
    }

    const entries = await syncSignalLog({ pair, timeframe, setup, candles });
    return res.status(200).json({ ok: true, total: entries.length });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
