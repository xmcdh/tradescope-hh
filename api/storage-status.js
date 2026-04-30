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
      hasStorageModeEnv: status.envDiagnostics?.hasStorageModeEnv ?? false,
      rawStorageModeLength: status.envDiagnostics?.rawStorageModeLength ?? 0,
      storageModeTrimmed: status.envDiagnostics?.storageModeTrimmed ?? '',
      hasDatabaseUrlEnv: status.envDiagnostics?.hasDatabaseUrlEnv ?? false,
      databaseUrlLength: status.envDiagnostics?.databaseUrlLength ?? 0,
      nodeEnv: status.envDiagnostics?.nodeEnv ?? '',
      vercelEnv: status.envDiagnostics?.vercelEnv ?? '',
      deploymentRegion: status.envDiagnostics?.deploymentRegion ?? '',
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
      hasStorageModeEnv: typeof process.env.STORAGE_MODE === 'string',
      rawStorageModeLength: typeof process.env.STORAGE_MODE === 'string' ? process.env.STORAGE_MODE.length : 0,
      storageModeTrimmed: typeof process.env.STORAGE_MODE === 'string' ? process.env.STORAGE_MODE.trim() : '',
      hasDatabaseUrlEnv: typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0,
      databaseUrlLength: typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.length : 0,
      nodeEnv: process.env.NODE_ENV ?? '',
      vercelEnv: process.env.VERCEL_ENV ?? '',
      deploymentRegion: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? '',
    });
  }
}
