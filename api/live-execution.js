import { handleOptions, requireWriteToken } from '../server/security.js';
import { getServerTradingMode } from '../src/lib/tradingMode.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'POST,OPTIONS')) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const authError = requireWriteToken(req, res);
  if (authError) return authError;

  return res.status(200).json({
    ok: true,
    mode: getServerTradingMode(),
    executed: false,
    message: 'Live execution webhook stub only. Connect exchange adapter before enabling production trading.',
    payload: req.body ?? null,
  });
}
