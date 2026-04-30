import { getServerTradingMode } from '../src/lib/tradingMode.js';

export default function handler(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    tradingMode: getServerTradingMode(),
  });
}
