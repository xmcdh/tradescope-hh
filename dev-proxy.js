import express from 'express';
import fetch from 'node-fetch';
import https from 'node:https';
import {
  ERROR_TYPES,
  buildErrorPayload,
  fetchBinanceBatchPrices,
  fetchBinanceEndpoint,
  fetchBinanceFunding,
  fetchBinanceOpenInterest,
  isBlockedHtml,
  isHtmlResponse,
} from './server/binanceProxy.js';
import { handleMarketDataRequest } from './server/marketDataRoute.js';
import { closeConvictionTrade, logConvictionTrade, readConvictionTrades } from './src/lib/paperTrader.js';

const app = express();
app.use(express.json());
const insecureTlsAgent = new https.Agent({ rejectUnauthorized: false });

function isCertificateFailure(error) {
  const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`.toLowerCase();
  return message.includes('certificate') || message.includes('unable to get local issuer');
}

async function fetchWithDevTlsFallback(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (!isCertificateFailure(error)) {
      throw error;
    }

    console.warn(`[TradeScope proxy] TLS verification failed for ${url}. Retrying with dev-only insecure TLS fallback.`);
    return fetch(url, {
      ...options,
      agent: insecureTlsAgent,
    });
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function sendError(res, payload, status = 502) {
  setCors(res);
  res.status(status).json(payload);
}

function forwardProxyResult(res, result) {
  setCors(res);
  res.setHeader('Content-Type', result.contentType);
  if (result.upstream) {
    res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
  }
  res.status(result.status).send(result.text);
}

function parseProxyJsonResult(result, { endpoint, symbol, source = 'binance_futures' }) {
  try {
    return { ok: true, payload: JSON.parse(result.text) };
  } catch {
    return {
      ok: false,
      payload: buildErrorPayload({
        source,
        endpoint,
        symbol,
        errorType: ERROR_TYPES.INVALID_JSON,
        message: `${source} returned invalid JSON payload`,
        upstream: result.upstream,
      }),
    };
  }
}

async function fetchExternalJson({ url, source, endpoint, symbol }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetchWithDevTlsFallback(url, {
      headers: { 'User-Agent': 'TradeScope/1.0' },
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    if (isBlockedHtml(text, contentType)) {
      return {
        status: 502,
        payload: buildErrorPayload({
          source,
          endpoint,
          symbol,
          errorType: ERROR_TYPES.NETWORK_BLOCKED,
          message: `${source} upstream returned blocked HTML instead of market JSON`,
          upstream: url,
        }),
      };
    }

    if (isHtmlResponse(text, contentType)) {
      return {
        status: 502,
        payload: buildErrorPayload({
          source,
          endpoint,
          symbol,
          errorType: ERROR_TYPES.UPSTREAM_HTML_RESPONSE,
          message: `${source} upstream returned HTML instead of market JSON`,
          upstream: url,
        }),
      };
    }

    try {
      const payload = JSON.parse(text);
      if (response.status === 429) {
        return {
          status: 429,
          payload: buildErrorPayload({
            source,
            endpoint,
            symbol,
            errorType: ERROR_TYPES.RATE_LIMITED,
            message: `${source} rate limit reached`,
            upstream: url,
          }),
        };
      }

      if (!response.ok) {
        return {
          status: response.status,
          payload: buildErrorPayload({
            source,
            endpoint,
            symbol,
            errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
            message: `${source} upstream error ${response.status}`,
            upstream: url,
          }),
        };
      }

      return { status: 200, payload };
    } catch {
      return {
        status: 502,
        payload: buildErrorPayload({
          source,
          endpoint,
          symbol,
          errorType: ERROR_TYPES.INVALID_JSON,
          message: `${source} returned invalid JSON payload`,
          upstream: url,
        }),
      };
    }
  } catch (error) {
    const errorType =
      error?.name === 'AbortError'
        ? ERROR_TYPES.UPSTREAM_TIMEOUT
        : isCertificateFailure(error)
          ? ERROR_TYPES.TLS_ERROR
          : ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR;
    return {
      status: 502,
      payload: buildErrorPayload({
        source,
        endpoint,
        symbol,
        errorType,
        message:
          error?.name === 'AbortError'
            ? `${source} request timed out after 8s`
            : `${source} request failed: ${error.message}`,
        upstream: url,
      }),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/api/binance', async (req, res) => {
  const { endpoint, ...params } = req.query;

  try {
    const result = await fetchBinanceEndpoint(endpoint, params, fetchWithDevTlsFallback);

    forwardProxyResult(res, result);
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: String(req.query.endpoint ?? 'unknown'),
        symbol: req.query.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/market-data', async (req, res) => {
  try {
    const result = await handleMarketDataRequest(req.query, fetchWithDevTlsFallback);
    forwardProxyResult(res, result);
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: String(req.query.type ?? 'market-data'),
        symbol: req.query.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
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
    const results = await fetchBinanceBatchPrices(symbolList, fetchWithDevTlsFallback);

    setCors(res);
    res.json(results);
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: 'batch_ticker',
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/paper-trading/conviction', async (req, res) => {
  setCors(res);
  res.json({ trades: await readConvictionTrades() });
});

app.post('/api/paper-trading/conviction', async (req, res) => {
  try {
    if (req.body?.action === 'close') {
      await closeConvictionTrade(req.body.id, req.body.status);
    } else {
      await logConvictionTrade(req.body ?? {});
    }
    setCors(res);
    res.json({ ok: true, trades: await readConvictionTrades() });
  } catch (error) {
    sendError(res, { error: error.message }, 400);
  }
});

app.get('/api/klines/:symbol', async (req, res) => {
  try {
    const result = await fetchBinanceEndpoint(
      'klines',
      {
        symbol: String(req.params.symbol ?? '').toUpperCase(),
        interval: String(req.query.interval ?? '15m'),
        limit: String(req.query.limit ?? '250'),
      },
      fetchWithDevTlsFallback,
    );

    forwardProxyResult(res, result);
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: 'klines',
        symbol: req.params.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/ticker/:symbol', async (req, res) => {
  try {
    const result = await fetchBinanceEndpoint(
      'ticker/price',
      {
        symbol: String(req.params.symbol ?? '').toUpperCase(),
      },
      fetchWithDevTlsFallback,
    );

    forwardProxyResult(res, result);
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: 'ticker/price',
        symbol: req.params.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/funding/:symbol', async (req, res) => {
  try {
    const result = await fetchBinanceFunding(String(req.params.symbol ?? '').toUpperCase(), fetchWithDevTlsFallback);
    if (result.status < 200 || result.status >= 300) {
      return forwardProxyResult(res, result);
    }
    const parsed = parseProxyJsonResult(result, {
      endpoint: 'premiumIndex',
      symbol: String(req.params.symbol ?? '').toUpperCase(),
    });
    if (!parsed.ok) {
      return sendError(res, parsed.payload);
    }
    const payload = parsed.payload;

    setCors(res);
    if (result.upstream) {
      res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
    }
    res.status(result.status).json({
      symbol: payload.symbol,
      fundingRate: payload.lastFundingRate,
      markPrice: payload.markPrice,
    });
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: 'premiumIndex',
        symbol: req.params.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/openinterest/:symbol', async (req, res) => {
  try {
    const result = await fetchBinanceOpenInterest(String(req.params.symbol ?? '').toUpperCase(), fetchWithDevTlsFallback);
    if (result.status < 200 || result.status >= 300) {
      return forwardProxyResult(res, result);
    }
    const parsed = parseProxyJsonResult(result, {
      endpoint: 'openInterest',
      symbol: String(req.params.symbol ?? '').toUpperCase(),
    });
    if (!parsed.ok) {
      return sendError(res, parsed.payload);
    }
    const payload = parsed.payload;

    setCors(res);
    if (result.upstream) {
      res.setHeader('X-TradeScope-Binance-Upstream', result.upstream);
    }
    res.status(result.status).json({
      symbol: payload.symbol,
      openInterest: payload.openInterest,
    });
  } catch (error) {
    sendError(
      res,
      buildErrorPayload({
        endpoint: 'openInterest',
        symbol: req.params.symbol,
        errorType: ERROR_TYPES.UNKNOWN_UPSTREAM_ERROR,
        message: error.message,
      }),
    );
  }
});

app.get('/api/bybit/klines/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol ?? '').toUpperCase();
  const intervalMap = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' };
  const interval = intervalMap[String(req.query.interval ?? '15m')] ?? '15';
  const limit = String(req.query.limit ?? '250');
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const result = await fetchExternalJson({ url, source: 'bybit_futures', endpoint: 'klines', symbol });
  setCors(res);
  res.status(result.status).json(result.payload);
});

app.get('/api/bybit/ticker/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol ?? '').toUpperCase();
  const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`;
  const result = await fetchExternalJson({ url, source: 'bybit_futures', endpoint: 'ticker', symbol });
  setCors(res);
  res.status(result.status).json(result.payload);
});

const server = app.listen(3001, () => {
  console.log('Dev proxy running on port 3001');
});

server.on('error', (error) => {
  console.error(`Dev proxy failed: ${error.message}`);
  process.exitCode = 1;
});
