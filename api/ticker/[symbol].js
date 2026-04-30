import { fetchBinanceEndpoint } from '../../server/binanceProxy.js';
import { getValidatedSymbol, rejectNonGet, sendHandlerError, sendProxyResult } from '../../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  const symbol = getValidatedSymbol(req, res, 'binance_futures', 'ticker/price');
  if (!symbol) {
    return;
  }

  try {
    const result = await fetchBinanceEndpoint('ticker/price', { symbol });

    return sendProxyResult(res, result);
  } catch (error) {
    return sendHandlerError(res, { endpoint: 'ticker/price', symbol, error });
  }
}
