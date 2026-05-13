const DEFAULT_ALLOWED_ORIGINS = ['https://tradescope-lyart.vercel.app'];

function configuredOrigins() {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function allowedOrigins() {
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins()])];
}

function isDevelopment() {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1';
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (isDevelopment() && /^http:\/\/localhost:\d+$/.test(origin)) {
    return true;
  }

  return allowedOrigins().includes(origin);
}

export function setSecureCors(req, res, methods = 'GET,OPTIONS') {
  const origin = req.headers?.origin;
  const allowOrigin = isAllowedOrigin(origin) ? origin || DEFAULT_ALLOWED_ORIGINS[0] : DEFAULT_ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-TradeScope-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBearerToken(req) {
  const header = req.headers?.authorization ?? '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function readRequestToken(req) {
  return String(req.headers?.['x-tradescope-token'] ?? readBearerToken(req) ?? '').trim();
}

export function requireWriteToken(req, res) {
  const expected = String(process.env.API_WRITE_TOKEN ?? '').trim();

  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'WRITE_TOKEN_NOT_CONFIGURED',
      message: 'Write endpoints are disabled until API_WRITE_TOKEN is configured.',
    });
  }

  const received = readRequestToken(req);
  if (received !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid write token.',
    });
  }

  return null;
}

export function handleOptions(req, res, methods = 'GET,OPTIONS') {
  setSecureCors(req, res, methods);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
