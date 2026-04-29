const ALLOWED = new Set(['klines', 'ticker/24hr', 'ticker/price']);

export default async function handler(req, res) {
  const { endpoint, ...params } = req.query;

  if (!endpoint || !ALLOWED.has(endpoint)) {
    return res.status(400).json({ error: 'Endpoint not allowed' });
  }

  const query = new URLSearchParams(params).toString();
  const url = `https://api.binance.com/api/v3/${endpoint}?${query}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TradeScope/1.0' },
    });
    const text = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
