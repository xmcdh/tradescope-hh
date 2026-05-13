import { handleOptions } from '../server/security.js';
import { fetchBinanceEndpoint } from '../server/binanceProxy.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET,OPTIONS')) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { endpoint, ...params } = req.query;

  try {
    const result = await fetchBinanceEndpoint(endpoint, params);

    res.setHeader('Content-Type', result.contentType);
    if (result.upstream) {
      res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
    }
    res.status(result.status).send(result.text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
