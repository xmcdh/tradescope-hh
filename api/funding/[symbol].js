import { ERROR_TYPES, buildErrorPayload, fetchBinanceFunding } from '../../server/binanceProxy.js';
import { getValidatedSymbol, rejectNonGet, sendHandlerError, sendProxyResult, setCors } from '../../server/apiRouteUtils.js';

export default async function handler(req, res) {
  if (rejectNonGet(req, res)) {
    return;
  }

  const symbol = getValidatedSymbol(req, res, 'binance_futures', 'premiumIndex');
  if (!symbol) {
    return;
  }

  try {
    const result = await fetchBinanceFunding(symbol);
    setCors(res);

    if (result.status < 200 || result.status >= 300) {
      return sendProxyResult(res, result);
    }

    let payload;
    try {
      payload = JSON.parse(result.text);
    } catch (error) {
      return res.status(502).json(
        buildErrorPayload({
          endpoint: 'premiumIndex',
          symbol,
          errorType: ERROR_TYPES.INVALID_JSON,
          message: error.message,
          upstream: result.upstream,
        }),
      );
    }

    if (result.upstream) {
      res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
    }
    return res.status(result.status).json({
      symbol: payload.symbol,
      fundingRate: payload.lastFundingRate,
      markPrice: payload.markPrice,
      nextFundingTime: payload.nextFundingTime,
    });
  } catch (error) {
    return sendHandlerError(res, { endpoint: 'premiumIndex', symbol, error });
  }
}
