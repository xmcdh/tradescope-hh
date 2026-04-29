import express from 'express';
import fetch from 'node-fetch';
import { fetchBinanceBatchPrices, fetchBinanceEndpoint } from './server/binanceProxy.js';

const app = express();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

app.get('/api/binance', async (req, res) => {
  const { endpoint, ...params } = req.query;

  try {
    const result = await fetchBinanceEndpoint(endpoint, params, fetch);

    setCors(res);
    res.setHeader('Content-Type', result.contentType);
    if (result.upstream) {
      res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
    }
    res.status(result.status).send(result.text);
  } catch (error) {
    setCors(res);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/binance-ws-fallback', async (req, res) => {
  const { symbols } = req.query;

  if (!symbols) {
    setCors(res);
    return res.status(400).json({ error: 'Missing symbols' });
  }

  const symbolList = String(symbols)
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  try {
    const results = await fetchBinanceBatchPrices(symbolList, fetch);

    setCors(res);
    res.json(results);
  } catch (error) {
    setCors(res);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => {
  console.log('Dev proxy running on port 3001');
});
