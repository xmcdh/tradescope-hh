import { handleOptions, requireWriteToken } from '../../server/security.js';
import { closeConvictionTrade, logConvictionTrade, readConvictionTrades } from '../../src/lib/paperTrader.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) {
    return;
  }

  if (req.method === 'GET') {
    const trades = await readConvictionTrades();
    return res.status(200).json({ trades });
  }

  if (req.method === 'POST') {
    const authError = requireWriteToken(req, res);
    if (authError) return authError;

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
