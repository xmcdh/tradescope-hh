import { handleOptions } from '../server/security.js';
import { getStorageStatus } from '../src/lib/storageAdapter.js';

export default async function handler(_req, res) {
  if (handleOptions(_req, res, 'GET,OPTIONS')) {
    return;
  }

  if (_req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const status = await getStorageStatus();

    return res.status(200).json({
      storageMode: status.mode,
      requestedMode: status.requestedMode,
      authority: status.authority,
      isDurable: status.durable,
      provider: status.provider,
      canConnect: status.canConnect,
      code: status.code,
      warning: status.warning,
      lastCheckedAt: status.lastCheckedAt,
    });
  } catch (error) {
    return res.status(500).json({
      storageMode: 'local-json',
      authority: 'LOCAL_ONLY',
      isDurable: false,
      provider: null,
      canConnect: false,
      code: 'NON_DURABLE_STORAGE',
      warning: 'Unable to load storage status.',
      lastCheckedAt: new Date().toISOString(),
    });
  }
}
