import { fetchBinanceEndpoint } from '../../server/binanceProxy.js';
import { getValidatedSymbol, rejectNonGet, sendHandlerError, sendProxyResult } from '../../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  const symbol = getValidatedSymbol(req, res, 'binance_futures', 'klines');
  if (!symbol) {
    return;
  }

  try {
    const result = await fetchBinanceEndpoint('klines', {
      symbol,
      interval: String(req.query.interval ?? '15m'),
      limit: String(req.query.limit ?? '250'),
    });

    return sendProxyResult(res, result);
  } catch (error) {
    return sendHandlerError(res, { endpoint: 'klines', symbol, error });
  }
}
