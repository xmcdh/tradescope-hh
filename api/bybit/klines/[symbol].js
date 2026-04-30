import { fetchBybitKlines } from '../../../server/bybitProxy.js';
import { getValidatedSymbol, rejectNonGet, setCors } from '../../../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  const symbol = getValidatedSymbol(req, res, 'bybit_futures', 'klines');
  if (!symbol) {
    return;
  }

  const result = await fetchBybitKlines(symbol, String(req.query.interval ?? '15m'), String(req.query.limit ?? '250'));

  setCors(res);
  return res.status(result.status).json(result.payload);
}
