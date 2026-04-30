import { readSignalLog, syncSignalLog } from '../src/lib/signalLogger.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const entries = await readSignalLog();
    return res.status(200).json(entries);
  }

  if (req.method === 'POST') {
    const { pair, timeframe, setup, candles } = req.body ?? {};

    if (!pair || !timeframe || !setup || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'Missing pair, timeframe, setup, or candles.' });
    }

    const entries = await syncSignalLog({ pair, timeframe, setup, candles });
    return res.status(200).json({ ok: true, total: entries.length });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
