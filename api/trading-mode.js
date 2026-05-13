import { handleOptions } from '../server/security.js';
import { getServerTradingMode } from '../src/lib/tradingMode.js';

export default function handler(_req, res) {
  if (handleOptions(_req, res, 'GET,OPTIONS')) {
    return;
  }
  return res.status(200).json({
    tradingMode: getServerTradingMode(),
  });
}
