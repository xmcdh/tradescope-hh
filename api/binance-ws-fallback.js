import { fetchBinanceBatchPrices } from '../server/binanceProxy.js';

export default async function handler(req, res) {
  const { symbols } = req.query;

  if (!symbols) {
    return res.status(400).json({ error: 'Missing symbols' });
  }

  const symbolList = symbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  try {
    const results = await fetchBinanceBatchPrices(symbolList);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
