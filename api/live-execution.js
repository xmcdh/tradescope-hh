import { getServerTradingMode } from '../src/lib/tradingMode.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  return res.status(200).json({
    ok: true,
    mode: getServerTradingMode(),
    executed: false,
    message: 'Live execution webhook stub only. Connect exchange adapter before enabling production trading.',
    payload: req.body ?? null,
  });
}
