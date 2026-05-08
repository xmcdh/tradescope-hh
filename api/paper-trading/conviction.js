import { closeConvictionTrade, logConvictionTrade, readConvictionTrades } from '../../src/lib/paperTrader.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const trades = await readConvictionTrades();
    return res.status(200).json({ trades });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body ?? {};
      if (body.action === 'close') {
        if (!body.id || !body.status) {
          return res.status(400).json({ error: 'Missing id or status.' });
        }
        await closeConvictionTrade(body.id, body.status);
        const trades = await readConvictionTrades();
        return res.status(200).json({ ok: true, trades });
      }

      const trade = await logConvictionTrade(body);
      const trades = await readConvictionTrades();
      return res.status(200).json({ ok: true, trade, trades });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
