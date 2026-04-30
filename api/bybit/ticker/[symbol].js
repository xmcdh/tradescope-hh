import { fetchBybitTicker } from '../../../server/bybitProxy.js';
import { getValidatedSymbol, rejectNonGet, setCors } from '../../../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  const symbol = getValidatedSymbol(req, res, 'bybit_futures', 'ticker');
  if (!symbol) {
    return;
  }

  const result = await fetchBybitTicker(symbol);

  setCors(res);
  return res.status(result.status).json(result.payload);
}
