import express from 'express';
import fetch from 'node-fetch';

const ALLOWED = new Set(['klines', 'ticker/24hr', 'ticker/price']);

const app = express();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

app.get('/api/binance', async (req, res) => {
  const { endpoint, ...params } = req.query;

  if (!endpoint || !ALLOWED.has(endpoint)) {
    setCors(res);
    return res.status(400).json({ error: 'Endpoint not allowed' });
  }

  const query = new URLSearchParams(params).toString();
  const url = `https://api.binance.com/api/v3/${endpoint}?${query}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TradeScope/1.0' },
    });
    const text = await response.text();

    setCors(res);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.status(response.status).send(text);
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
    const results = await Promise.all(
      symbolList.map(async (symbol) => {
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'TradeScope/1.0' },
        });

        if (!response.ok) {
          return { symbol, error: `HTTP ${response.status}` };
        }

        return response.json();
      }),
    );

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
