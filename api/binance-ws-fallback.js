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

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
