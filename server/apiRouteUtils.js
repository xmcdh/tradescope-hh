import { ERROR_TYPES, buildErrorPayload } from './binanceProxy.js';

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

export function rejectNonGet(req, res) {
  if (req.method === 'GET') {
    return false;
  }

  setCors(res);
  res.setHeader('Allow', 'GET');
  res.status(405).json({
    ok: false,
    errorType: 'METHOD_NOT_ALLOWED',
    message: 'Only GET is supported for this endpoint',
    signalAllowed: false,
  });
  return true;
}

export function getValidatedSymbol(req, res, source = 'binance_futures', endpoint = 'unknown') {
  const symbol = String(req.query.symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();

  if (!symbol || symbol.length < 6 || symbol.length > 24) {
    setCors(res);
    res.status(400).json(
      buildErrorPayload({
        source,
        endpoint,
        symbol: symbol || null,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: 'Invalid or missing symbol',
        upstream: null,
      }),
    );
    return null;
  }

  return symbol;
}

export function sendProxyResult(res, result) {
  setCors(res);
  res.setHeader('Content-Type', result.contentType);
  if (result.upstream) {
    res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
  }
  return res.status(result.status).send(result.text);
}

export function sendHandlerError(res, { source = 'binance_futures', endpoint, symbol, error }) {
  setCors(res);
  return res.status(500).json(
    buildErrorPayload({
      source,
      endpoint,
      symbol,
      errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
      message: error.message,
      upstream: null,
    }),
  );
}
