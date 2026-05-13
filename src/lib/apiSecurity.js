export const API_WRITE_TOKEN_STORAGE_KEY = 'tradescope:api-write-token';

export function getApiWriteHeaders() {
  if (typeof window === 'undefined') {
    return {};
  }

  const token = window.localStorage.getItem(API_WRITE_TOKEN_STORAGE_KEY)?.trim();
  return token ? { 'X-TradeScope-Token': token } : {};
}

export function buildJsonWriteHeaders() {
  return {
    'Content-Type': 'application/json',
    ...getApiWriteHeaders(),
  };
}
