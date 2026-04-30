import { handleMarketDataRequest } from '../server/marketDataRoute.js';
import { rejectNonGet, sendHandlerError, sendProxyResult } from '../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  try {
    const result = await handleMarketDataRequest(req.query);
    return sendProxyResult(res, result);
  } catch (error) {
    return sendHandlerError(res, {
      source: String(req.query.provider ?? 'market_data'),
      endpoint: String(req.query.type ?? 'market-data'),
      symbol: req.query.symbol,
      error,
    });
  }
}
