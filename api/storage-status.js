import { getStorageStatus } from '../src/lib/storageAdapter.js';

export default async function handler(_req, res) {
  try {
    const status = await getStorageStatus();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      storageMode: status.mode,
      requestedMode: status.requestedMode,
      authority: status.authority,
      isDurable: status.durable,
      provider: status.provider,
      canConnect: status.canConnect,
      error: status.error || '',
      lastCheckedAt: status.lastCheckedAt,
      code: status.code,
      warning: status.warning,
    });
  } catch (error) {
    return res.status(500).json({
      storageMode: 'local-json',
      authority: 'LOCAL_ONLY',
      isDurable: false,
      provider: null,
      canConnect: false,
      error: error.message,
      lastCheckedAt: new Date().toISOString(),
      code: 'NON_DURABLE_STORAGE',
    });
  }
}
