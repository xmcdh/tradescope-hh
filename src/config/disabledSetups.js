export const DISABLED_SETUPS = [];

export function normalizeSetupConfigKey(pair, timeframe) {
  return `${String(pair ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()}:${String(timeframe ?? '').toLowerCase()}`;
}
