import fs from 'node:fs/promises';
import path from 'node:path';
import { checkDatabaseConnection, createDatabaseStorage } from './databaseStorage.js';

const PRIMARY_DATA_DIR = path.resolve(process.cwd(), 'data');
const FALLBACK_DATA_DIR = '/tmp/tradescope-data';
const NON_DURABLE_STORAGE_WARNING =
  'Paper trading results are not authoritative because durable database storage is not configured. Configure a database before using paper results for live-readiness.';
const DATABASE_CONNECTION_WARNING =
  'Database mode is configured but the app cannot connect. Paper results are not authoritative until the database connection is healthy.';
const COLLECTION_FILES = {
  signalLogs: 'signal-log.json',
  paperTrades: 'paper-trades.json',
  proofSnapshots: 'proof-snapshots.json',
  setupApprovals: 'setup-approvals.json',
};

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function normalizeMode(value) {
  const mode = String(value ?? 'local-json').toLowerCase();
  return ['database', 'memory', 'local-json'].includes(mode) ? mode : 'local-json';
}

function normalizeCollectionValue(value) {
  return Array.isArray(value) ? value : [];
}

function buildStatus({
  requestedMode,
  activeMode,
  databaseUrl = '',
  provider = null,
  filePaths = {},
  canConnect = false,
  connectionError = '',
  lastCheckedAt = new Date().toISOString(),
}) {
  const requested = normalizeMode(requestedMode);
  const mode = normalizeMode(activeMode);
  const durable = mode === 'database' && Boolean(databaseUrl) && canConnect;
  const authoritative = durable;
  const connectionIssue = requested === 'database' && Boolean(databaseUrl) && !canConnect;

  return {
    requestedMode: requested,
    mode,
    runtime: isProductionRuntime() ? 'production' : 'development',
    configured: durable,
    durable,
    authoritative,
    authority: authoritative ? 'AUTHORITATIVE' : 'LOCAL_ONLY',
    code: authoritative ? 'DURABLE_STORAGE' : 'NON_DURABLE_STORAGE',
    provider: requested === 'database' ? provider ?? 'postgres' : null,
    databaseUrlPresent: Boolean(databaseUrl),
    canConnect: Boolean(canConnect),
    error: connectionError || '',
    lastCheckedAt,
    filePaths,
    warning: authoritative
      ? ''
      : connectionIssue
        ? DATABASE_CONNECTION_WARNING
        : NON_DURABLE_STORAGE_WARNING,
  };
}

export function getStorageEnvironmentStatus(filePath, options = {}) {
  return buildStatus({
    requestedMode: options.mode ?? 'local-json',
    activeMode: options.mode ?? 'local-json',
    provider: options.provider ?? null,
    databaseUrl: options.databaseUrl ?? '',
    filePaths: filePath ? { default: filePath } : {},
    canConnect: false,
    connectionError: '',
  });
}

function createMemoryStorage(options = {}) {
  const state = {
    signalLogs: [...(options.seed?.signalLogs ?? [])],
    paperTrades: [...(options.seed?.paperTrades ?? [])],
    proofSnapshots: [...(options.seed?.proofSnapshots ?? [])],
    setupApprovals: [...(options.seed?.setupApprovals ?? [])],
  };

  function upsert(collection, entry) {
    const list = state[collection];
    const index = list.findIndex((item) => item.id === entry.id);
    if (index === -1) {
      list.push(entry);
    } else {
      list[index] = { ...list[index], ...entry };
    }
  }

  function update(collection, id, updates) {
    const list = state[collection];
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    list[index] = { ...list[index], ...updates };
  }

  return {
    async getStatus() {
      return buildStatus({
        requestedMode: 'memory',
        activeMode: 'memory',
        canConnect: false,
      });
    },
    async readSignalLogs() {
      return [...state.signalLogs];
    },
    async writeSignalLog(entry) {
      upsert('signalLogs', entry);
    },
    async updateSignalLog(id, updates) {
      update('signalLogs', id, updates);
    },
    async readPaperTrades() {
      return [...state.paperTrades];
    },
    async writePaperTrade(entry) {
      upsert('paperTrades', entry);
    },
    async updatePaperTrade(id, updates) {
      update('paperTrades', id, updates);
    },
    async readProofSnapshots() {
      return [...state.proofSnapshots];
    },
    async writeProofSnapshot(entry) {
      upsert('proofSnapshots', entry);
    },
    async readSetupApprovals() {
      return [...state.setupApprovals];
    },
    async writeSetupApproval(entry) {
      upsert('setupApprovals', entry);
    },
  };
}

function createLocalJsonStorage(options = {}) {
  const preferredDir = options.dataDir ?? PRIMARY_DATA_DIR;
  const fallbackDir = options.fallbackDir ?? FALLBACK_DATA_DIR;
  const filePaths = {};

  async function ensureFile(collectionName) {
    const filename = COLLECTION_FILES[collectionName];

    for (const directory of [preferredDir, fallbackDir]) {
      const nextPath = path.join(directory, filename);

      try {
        await fs.mkdir(directory, { recursive: true });
        try {
          await fs.access(nextPath);
        } catch {
          await fs.writeFile(nextPath, '[]\n');
        }
        filePaths[collectionName] = nextPath;
        return nextPath;
      } catch {
        continue;
      }
    }

    throw new Error(`Unable to initialize storage for ${filename}.`);
  }

  async function readCollection(collectionName) {
    const filePath = await ensureFile(collectionName);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizeCollectionValue(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  async function writeCollection(collectionName, items) {
    const filePath = await ensureFile(collectionName);
    await fs.writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`);
    return filePath;
  }

  async function upsertCollectionItem(collectionName, entry) {
    const items = await readCollection(collectionName);
    const index = items.findIndex((item) => item.id === entry.id);
    if (index === -1) {
      items.push(entry);
    } else {
      items[index] = { ...items[index], ...entry };
    }
    await writeCollection(collectionName, items);
  }

  async function updateCollectionItem(collectionName, id, updates) {
    const items = await readCollection(collectionName);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    items[index] = { ...items[index], ...updates };
    await writeCollection(collectionName, items);
  }

  return {
    async getStatus(requestedMode = 'local-json', provider = null, databaseUrl = '', connectionError = '') {
      await Promise.all(Object.keys(COLLECTION_FILES).map((key) => ensureFile(key)));
      return buildStatus({
        requestedMode,
        activeMode: 'local-json',
        provider,
        databaseUrl,
        filePaths: { ...filePaths },
        canConnect: false,
        connectionError,
      });
    },
    readCollection,
    upsertCollectionItem,
    updateCollectionItem,
  };
}

export function createStorageAdapter(options = {}) {
  const requestedMode = normalizeMode(options.mode ?? process.env.STORAGE_MODE ?? 'local-json');
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const provider = options.provider ?? process.env.DATABASE_PROVIDER ?? 'postgres';
  const local = createLocalJsonStorage(options);
  const memory = requestedMode === 'memory' ? createMemoryStorage(options) : null;
  const database = requestedMode === 'database'
    ? createDatabaseStorage({
        databaseUrl,
        provider,
        poolFactory: options.poolFactory ?? null,
      })
    : null;

  async function getDatabaseHealth() {
    if (!database) {
      return {
        canConnect: false,
        error: databaseUrl ? 'Database mode is not active.' : 'DATABASE_URL is not configured.',
        lastCheckedAt: new Date().toISOString(),
      };
    }

    return database.healthCheck();
  }

  async function resolveBackend() {
    if (memory) {
      return {
        backend: memory,
        status: await memory.getStatus(),
      };
    }

    if (requestedMode === 'database') {
      if (!databaseUrl) {
        return {
          backend: local,
          status: await local.getStatus(requestedMode, provider, databaseUrl, 'DATABASE_URL is not configured.'),
        };
      }

      const health = await getDatabaseHealth();
      if (health.canConnect) {
        return {
          backend: database,
          status: buildStatus({
            requestedMode,
            activeMode: 'database',
            provider,
            databaseUrl,
            canConnect: true,
            connectionError: '',
            lastCheckedAt: health.lastCheckedAt,
          }),
        };
      }

      return {
        backend: local,
        status: await local.getStatus(requestedMode, provider, databaseUrl, health.error),
      };
    }

    return {
      backend: local,
      status: await local.getStatus(requestedMode, provider, databaseUrl, ''),
    };
  }

  return {
    async getStorageStatus() {
      const { status } = await resolveBackend();
      return status;
    },

    async isDurableStorageConfigured() {
      const status = await this.getStorageStatus();
      return status.durable;
    },

    async readSignalLogs() {
      const { backend } = await resolveBackend();
      return backend.readSignalLogs
        ? backend.readSignalLogs()
        : backend.readCollection('signalLogs');
    },

    async writeSignalLog(entry) {
      const { backend } = await resolveBackend();
      return backend.writeSignalLog
        ? backend.writeSignalLog(entry)
        : backend.upsertCollectionItem('signalLogs', entry);
    },

    async updateSignalLog(id, updates) {
      const { backend } = await resolveBackend();
      return backend.updateSignalLog
        ? backend.updateSignalLog(id, updates)
        : backend.updateCollectionItem('signalLogs', id, updates);
    },

    async readPaperTrades() {
      const { backend } = await resolveBackend();
      return backend.readPaperTrades
        ? backend.readPaperTrades()
        : backend.readCollection('paperTrades');
    },

    async writePaperTrade(entry) {
      const { backend } = await resolveBackend();
      return backend.writePaperTrade
        ? backend.writePaperTrade(entry)
        : backend.upsertCollectionItem('paperTrades', entry);
    },

    async updatePaperTrade(id, updates) {
      const { backend } = await resolveBackend();
      return backend.updatePaperTrade
        ? backend.updatePaperTrade(id, updates)
        : backend.updateCollectionItem('paperTrades', id, updates);
    },

    async readProofSnapshots() {
      const { backend } = await resolveBackend();
      return backend.readProofSnapshots
        ? backend.readProofSnapshots()
        : backend.readCollection('proofSnapshots');
    },

    async writeProofSnapshot(entry) {
      const { backend } = await resolveBackend();
      return backend.writeProofSnapshot
        ? backend.writeProofSnapshot(entry)
        : backend.upsertCollectionItem('proofSnapshots', entry);
    },

    async readSetupApprovals() {
      const { backend } = await resolveBackend();
      return backend.readSetupApprovals
        ? backend.readSetupApprovals()
        : backend.readCollection('setupApprovals');
    },

    async writeSetupApproval(entry) {
      const { backend } = await resolveBackend();
      return backend.writeSetupApproval
        ? backend.writeSetupApproval(entry)
        : backend.upsertCollectionItem('setupApprovals', entry);
    },
  };
}

let defaultStorageAdapter = createStorageAdapter();

export function getStorageAdapter() {
  return defaultStorageAdapter;
}

export function setStorageAdapterForTests(adapter) {
  defaultStorageAdapter = adapter;
}

export async function getStorageStatus() {
  return defaultStorageAdapter.getStorageStatus();
}

export async function isDurableStorageConfigured() {
  return defaultStorageAdapter.isDurableStorageConfigured();
}

export async function readSignalLogs() {
  return defaultStorageAdapter.readSignalLogs();
}

export async function writeSignalLog(entry) {
  return defaultStorageAdapter.writeSignalLog(entry);
}

export async function updateSignalLog(id, updates) {
  return defaultStorageAdapter.updateSignalLog(id, updates);
}

export async function readPaperTradesStorage() {
  return defaultStorageAdapter.readPaperTrades();
}

export async function writePaperTrade(entry) {
  return defaultStorageAdapter.writePaperTrade(entry);
}

export async function updatePaperTrade(id, updates) {
  return defaultStorageAdapter.updatePaperTrade(id, updates);
}

export async function readProofSnapshots() {
  return defaultStorageAdapter.readProofSnapshots();
}

export async function writeProofSnapshot(snapshot) {
  return defaultStorageAdapter.writeProofSnapshot(snapshot);
}

export async function readSetupApprovals() {
  return defaultStorageAdapter.readSetupApprovals();
}

export async function writeSetupApproval(approval) {
  return defaultStorageAdapter.writeSetupApproval(approval);
}

export { NON_DURABLE_STORAGE_WARNING, DATABASE_CONNECTION_WARNING };
