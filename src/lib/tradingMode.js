const DEFAULT_MODE = 'scanner';
const MODES = new Set(['scanner', 'paper', 'live']);

function normalizeMode(value) {
  const mode = String(value ?? DEFAULT_MODE).toLowerCase();
  return MODES.has(mode) ? mode : DEFAULT_MODE;
}

export function getClientTradingMode() {
  return normalizeMode(import.meta.env?.VITE_TRADING_MODE ?? import.meta.env?.TRADING_MODE);
}

export function getServerTradingMode() {
  return normalizeMode(process.env.TRADING_MODE ?? process.env.VITE_TRADING_MODE);
}
