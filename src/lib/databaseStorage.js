const DEFAULT_PROVIDER = 'postgres';
const GLOBAL_POOL_KEY = '__tradescopePgPools';

const TABLES = {
  signalLogs: {
    name: 'signal_logs',
    orderBy: 'created_at ASC',
    columns: {
      id: 'id',
      pair: 'pair',
      timeframe: 'timeframe',
      strategyVersion: 'strategy_version',
      riskModel: 'risk_model',
      signalLogicVersion: 'signal_logic_version',
      activatedAt: 'activated_at',
      direction: 'direction',
      signal: 'signal',
      signalValidity: 'signal_validity',
      setupStatus: 'setup_status',
      proofStatus: 'proof_status',
      candleTimestamp: 'candle_timestamp',
      entry: 'entry',
      stopLoss: 'stop_loss',
      takeProfit: 'take_profit',
      rr: 'rr',
      score: 'score',
      result: 'result',
      exitPrice: 'exit_price',
      exitTimestamp: 'exit_timestamp',
      realizedR: 'realized_r',
      rResult: 'r_result',
      btcContext: 'btc_context',
      blockedReason: 'blocked_reason',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  paperTrades: {
    name: 'paper_trades',
    orderBy: 'created_at ASC',
    columns: {
      id: 'id',
      pair: 'pair',
      timeframe: 'timeframe',
      strategyVersion: 'strategy_version',
      riskModel: 'risk_model',
      signalLogicVersion: 'signal_logic_version',
      activatedAt: 'activated_at',
      direction: 'direction',
      signal: 'signal',
      signalValidity: 'signal_validity',
      setupStatus: 'setup_status',
      proofStatus: 'proof_status',
      paperCategory: 'paper_category',
      isApprovedPaperTrade: 'is_approved_paper_trade',
      rejectionReason: 'rejection_reason',
      entry: 'entry',
      stopLoss: 'stop_loss',
      takeProfit: 'take_profit',
      rr: 'rr',
      score: 'score',
      openedAt: 'opened_at',
      closedAt: 'closed_at',
      status: 'status',
      exitPrice: 'exit_price',
      exitTimestamp: 'exit_timestamp',
      realizedR: 'realized_r',
      rResult: 'r_result',
      btcContext: 'btc_context',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  convictionTrades: {
    name: 'conviction_trades',
    orderBy: 'date ASC',
    columns: {
      id: 'id',
      portfolioId: 'portfolio_id',
      date: 'date',
      strategy: 'strategy',
      direction: 'direction',
      entry: 'entry',
      sl: 'sl',
      tp1: 'tp1',
      tp2: 'tp2',
      score: 'score',
      status: 'status',
      rOutcome: 'r_outcome',
      notes: 'notes',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  proofSnapshots: {
    name: 'proof_snapshots',
    orderBy: 'created_at ASC',
    columns: {
      id: 'id',
      verdict: 'verdict',
      strategyVersion: 'strategy_version',
      riskModel: 'risk_model',
      signalLogicVersion: 'signal_logic_version',
      activatedAt: 'activated_at',
      generatedAt: 'generated_at',
      approvedSetupCount: 'approved_setup_count',
      collectingDataSetupCount: 'collecting_data_setup_count',
      rejectedSetupCount: 'rejected_setup_count',
      storageStatus: 'storage_status',
      sourceBatchFilename: 'source_batch_filename',
      sourceReportFilename: 'source_report_filename',
      payloadJson: 'payload_json',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  setupApprovals: {
    name: 'setup_approvals',
    orderBy: 'created_at ASC',
    columns: {
      id: 'id',
      pair: 'pair',
      timeframe: 'timeframe',
      strategyVersion: 'strategy_version',
      riskModel: 'risk_model',
      signalLogicVersion: 'signal_logic_version',
      activatedAt: 'activated_at',
      proofStatus: 'proof_status',
      setupStatus: 'setup_status',
      recommendation: 'recommendation',
      sourceReportId: 'source_report_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
};

function toCamelCase(key) {
  return String(key).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [toCamelCase(key), value]));
}

function serializeValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return JSON.stringify(value);
  }

  return value;
}

function buildPayload(tableConfig, payload) {
  const entries = Object.entries(tableConfig.columns)
    .map(([prop, column]) => [column, serializeValue(payload?.[prop])])
    .filter(([, value]) => value !== undefined);

  return {
    columns: entries.map(([column]) => column),
    values: entries.map(([, value]) => value),
  };
}

function getGlobalPools() {
  if (!globalThis[GLOBAL_POOL_KEY]) {
    globalThis[GLOBAL_POOL_KEY] = new Map();
  }

  return globalThis[GLOBAL_POOL_KEY];
}

async function createPool({ databaseUrl, provider, poolFactory = null }) {
  if (poolFactory) {
    return poolFactory();
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error('Database mode requires the `pg` package. Install it before enabling STORAGE_MODE=database.');
  }

  const key = `${provider}:${databaseUrl}`;
  const pools = getGlobalPools();
  if (pools.has(key)) {
    return pools.get(key);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 10_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  pools.set(key, pool);
  return pool;
}

async function query({ databaseUrl, provider, poolFactory, text, values = [] }) {
  const pool = await createPool({ databaseUrl, provider, poolFactory });
  return pool.query(text, values);
}

async function listRows({ databaseUrl, provider, poolFactory, collectionKey }) {
  const table = TABLES[collectionKey];
  const result = await query({
    databaseUrl,
    provider,
    poolFactory,
    text: `SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`,
  });

  return result.rows.map(camelizeRow);
}

async function upsertRow({ databaseUrl, provider, poolFactory, collectionKey, payload }) {
  const table = TABLES[collectionKey];
  const { columns, values } = buildPayload(table, payload);
  if (!columns.length) {
    return;
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');

  await query({
    databaseUrl,
    provider,
    poolFactory,
    text: `
      INSERT INTO ${table.name} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE
      SET ${updates}
    `,
    values,
  });
}

async function updateRow({ databaseUrl, provider, poolFactory, collectionKey, id, updates }) {
  const table = TABLES[collectionKey];
  const { columns, values } = buildPayload(table, updates);
  const mutableColumns = columns.filter((column) => column !== 'id');
  const mutableValues = mutableColumns.map((column) => values[columns.indexOf(column)]);

  if (!mutableColumns.length) {
    return;
  }

  const assignments = mutableColumns.map((column, index) => `${column} = $${index + 2}`);
  await query({
    databaseUrl,
    provider,
    poolFactory,
    text: `
      UPDATE ${table.name}
      SET ${assignments.join(', ')}
      WHERE id = $1
    `,
    values: [id, ...mutableValues],
  });
}

async function checkConnection({ databaseUrl, provider, poolFactory }) {
  try {
    await query({
      databaseUrl,
      provider,
      poolFactory,
      text: 'SELECT 1 AS ok',
    });

    return {
      canConnect: true,
      error: '',
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      canConnect: false,
      error: error.message,
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

export async function checkDatabaseConnection(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const provider = options.provider ?? process.env.DATABASE_PROVIDER ?? DEFAULT_PROVIDER;

  if (!databaseUrl) {
    return {
      canConnect: false,
      error: 'DATABASE_URL is not configured.',
      lastCheckedAt: new Date().toISOString(),
    };
  }

  return checkConnection({
    databaseUrl,
    provider,
    poolFactory: options.poolFactory ?? null,
  });
}

export function createDatabaseStorage(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const provider = options.provider ?? process.env.DATABASE_PROVIDER ?? DEFAULT_PROVIDER;
  const configured = Boolean(databaseUrl);
  const poolFactory = options.poolFactory ?? null;

  return {
    mode: 'database',
    provider,
    configured,

    async healthCheck() {
      return checkDatabaseConnection({
        databaseUrl,
        provider,
        poolFactory,
      });
    },

    async readSignalLogs() {
      if (!configured) {
        return [];
      }

      return listRows({ databaseUrl, provider, poolFactory, collectionKey: 'signalLogs' });
    },

    async writeSignalLog(entry) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await upsertRow({ databaseUrl, provider, poolFactory, collectionKey: 'signalLogs', payload: entry });
    },

    async updateSignalLog(id, updates) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await updateRow({ databaseUrl, provider, poolFactory, collectionKey: 'signalLogs', id, updates });
    },

    async readPaperTrades() {
      if (!configured) {
        return [];
      }

      return listRows({ databaseUrl, provider, poolFactory, collectionKey: 'paperTrades' });
    },

    async writePaperTrade(entry) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await upsertRow({ databaseUrl, provider, poolFactory, collectionKey: 'paperTrades', payload: entry });
    },

    async updatePaperTrade(id, updates) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await updateRow({ databaseUrl, provider, poolFactory, collectionKey: 'paperTrades', id, updates });
    },

    async readConvictionTrades() {
      if (!configured) {
        return [];
      }

      return listRows({ databaseUrl, provider, poolFactory, collectionKey: 'convictionTrades' });
    },

    async writeConvictionTrade(entry) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await upsertRow({ databaseUrl, provider, poolFactory, collectionKey: 'convictionTrades', payload: entry });
    },

    async updateConvictionTrade(id, updates) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await updateRow({ databaseUrl, provider, poolFactory, collectionKey: 'convictionTrades', id, updates });
    },

    async readProofSnapshots() {
      if (!configured) {
        return [];
      }

      return listRows({ databaseUrl, provider, poolFactory, collectionKey: 'proofSnapshots' });
    },

    async writeProofSnapshot(snapshot) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await upsertRow({ databaseUrl, provider, poolFactory, collectionKey: 'proofSnapshots', payload: snapshot });
    },

    async readSetupApprovals() {
      if (!configured) {
        return [];
      }

      return listRows({ databaseUrl, provider, poolFactory, collectionKey: 'setupApprovals' });
    },

    async writeSetupApproval(approval) {
      if (!configured) {
        throw new Error('Database storage is not configured. Set DATABASE_URL before enabling database mode.');
      }

      await upsertRow({ databaseUrl, provider, poolFactory, collectionKey: 'setupApprovals', payload: approval });
    },
  };
}

export const DATABASE_TABLES = Object.fromEntries(
  Object.entries(TABLES).map(([key, value]) => [key, { name: value.name, columns: Object.values(value.columns) }]),
);
