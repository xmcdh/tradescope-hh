import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createStorageAdapter, inspectStorageEnv } from '../src/lib/storageAdapter.js';
import { classifySignalForPaper, SETUP_STATUS } from '../src/lib/setupRegistry.js';
import { inspectDatabaseSchema } from '../src/scripts/checkDatabase.js';
import { paperProofReportMarkdown } from '../src/lib/paperProofReport.js';
import { calculateSnapshotFreshness, summarizePaperHealth } from '../src/lib/paperHealth.js';
import {
  detectPaperAuditAnomalies,
  formatDailyPaperCheck,
  weeklyPaperAuditMarkdown,
} from '../src/lib/paperAudit.js';
import liveExecutionHandler from '../api/live-execution.js';
import { activeStrategy } from '../src/config/strategyVersion.js';

function healthyPoolFactory() {
  return {
    async query(text, values = []) {
      if (/information_schema\.tables/i.test(text)) {
        return {
          rows: [
            { table_name: 'signal_logs' },
            { table_name: 'paper_trades' },
            { table_name: 'proof_snapshots' },
            { table_name: 'setup_approvals' },
          ],
        };
      }

      if (/information_schema\.columns/i.test(text)) {
        if (values[0] === 'signal_logs') {
          return {
            rows: [
              'id','pair','timeframe','strategy_version','risk_model','signal_logic_version','activated_at','direction','signal','signal_validity','setup_status','proof_status','candle_timestamp','entry','stop_loss','take_profit','rr','score','result','exit_price','exit_timestamp','realized_r','r_result','btc_context','blocked_reason','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        if (values[0] === 'paper_trades') {
          return {
            rows: [
              'id','pair','timeframe','strategy_version','risk_model','signal_logic_version','activated_at','direction','signal','signal_validity','setup_status','proof_status','paper_category','is_approved_paper_trade','rejection_reason','entry','stop_loss','take_profit','rr','score','opened_at','closed_at','status','exit_price','exit_timestamp','realized_r','r_result','btc_context','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        if (values[0] === 'proof_snapshots') {
          return {
            rows: [
              'id','verdict','strategy_version','risk_model','signal_logic_version','activated_at','generated_at','approved_setup_count','collecting_data_setup_count','rejected_setup_count','storage_status','source_batch_filename','source_report_filename','payload_json','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        return {
          rows: [
            'id','pair','timeframe','strategy_version','risk_model','signal_logic_version','activated_at','proof_status','setup_status','recommendation','source_report_id','created_at','updated_at',
          ].map((column_name) => ({ column_name })),
        };
      }

      return { rows: [{ ok: 1 }] };
    },
  };
}

function failingPoolFactory() {
  return {
    async query() {
      throw new Error('connect ECONNREFUSED');
    },
  };
}

test('storageAdapter local-json mode is non-authoritative and can persist local collections', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-local-${Date.now()}`);
  const adapter = createStorageAdapter({
    mode: 'local-json',
    dataDir,
    fallbackDir: dataDir,
  });

  const status = await adapter.getStorageStatus();
  assert.equal(status.mode, 'local-json');
  assert.equal(status.authoritative, false);
  assert.equal(status.code, 'NON_DURABLE_STORAGE');

  await adapter.writePaperTrade({
    id: 'paper-1',
    pair: 'BTCUSDT',
    timeframe: '1h',
    signalValidity: 'VALID',
    setupStatus: 'APPROVED_FOR_PAPER',
    proofStatus: 'PROVEN_READY_FOR_PAPER',
    paperCategory: 'PAPER_ELIGIBLE',
    isApprovedPaperTrade: true,
    rejectionReason: '',
    status: 'OPEN',
  });

  const trades = await adapter.readPaperTrades();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].setupStatus, 'APPROVED_FOR_PAPER');
  assert.equal(trades[0].isApprovedPaperTrade, true);
});

test('storageAdapter detects durable database mode when database URL is present', async () => {
  const adapter = createStorageAdapter({
    mode: 'database',
    databaseUrl: 'postgres://example:test@localhost:5432/tradescope',
    poolFactory: healthyPoolFactory,
  });

  const status = await adapter.getStorageStatus();
  assert.equal(status.mode, 'database');
  assert.equal(status.durable, true);
  assert.equal(status.authoritative, true);
  assert.equal(status.canConnect, true);
  assert.equal(await adapter.isDurableStorageConfigured(), true);
});

test('storageAdapter missing STORAGE_MODE defaults to local-json with safe diagnostics', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-missing-env-${Date.now()}`);
  const adapter = createStorageAdapter({
    env: {},
    dataDir,
    fallbackDir: dataDir,
  });

  const status = await adapter.getStorageStatus();

  assert.equal(status.requestedMode, 'local-json');
  assert.equal(status.mode, 'local-json');
  assert.equal(status.envDiagnostics.hasStorageModeEnv, false);
  assert.equal(status.envDiagnostics.hasDatabaseUrlEnv, false);
});

test('storageAdapter reads STORAGE_MODE=database from process-style env', async () => {
  const adapter = createStorageAdapter({
    env: {
      STORAGE_MODE: 'database',
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: 'postgres://example:test@localhost:5432/tradescope',
    },
    poolFactory: healthyPoolFactory,
  });

  const status = await adapter.getStorageStatus();

  assert.equal(status.requestedMode, 'database');
  assert.equal(status.mode, 'database');
  assert.equal(status.provider, 'postgres');
  assert.equal(status.canConnect, true);
  assert.equal(status.envDiagnostics.hasStorageModeEnv, true);
  assert.equal(status.envDiagnostics.hasDatabaseUrlEnv, true);
});

test('storageAdapter trims STORAGE_MODE before normalization', async () => {
  const adapter = createStorageAdapter({
    env: {
      STORAGE_MODE: 'database ',
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: 'postgres://example:test@localhost:5432/tradescope',
    },
    poolFactory: healthyPoolFactory,
  });

  const status = await adapter.getStorageStatus();

  assert.equal(status.requestedMode, 'database');
  assert.equal(status.mode, 'database');
  assert.equal(status.envDiagnostics.storageModeTrimmed, 'database');
});

test('storageAdapter reports invalid STORAGE_MODE clearly', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-invalid-env-${Date.now()}`);
  const adapter = createStorageAdapter({
    env: {
      STORAGE_MODE: 'postgres',
      DATABASE_URL: 'postgres://example:test@localhost:5432/tradescope',
    },
    dataDir,
    fallbackDir: dataDir,
  });

  const status = await adapter.getStorageStatus();

  assert.equal(status.requestedMode, 'local-json');
  assert.equal(status.code, 'INVALID_STORAGE_MODE');
  assert.match(status.warning, /Invalid STORAGE_MODE/);
  assert.equal(status.envDiagnostics.hasStorageModeEnv, true);
  assert.equal(status.envDiagnostics.storageModeTrimmed, 'postgres');
});

test('storageAdapter requested database mode falls back to non-authoritative local mode when URL is missing', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-fallback-${Date.now()}`);
  const adapter = createStorageAdapter({
    mode: 'database',
    dataDir,
    fallbackDir: dataDir,
  });

  const status = await adapter.getStorageStatus();
  assert.equal(status.requestedMode, 'database');
  assert.equal(status.mode, 'local-json');
  assert.equal(status.authoritative, false);
});

test('storageAdapter database mode connection failure falls back to non-authoritative local mode', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-db-fail-${Date.now()}`);
  const adapter = createStorageAdapter({
    mode: 'database',
    databaseUrl: 'postgres://example:test@localhost:5432/tradescope',
    dataDir,
    fallbackDir: dataDir,
    poolFactory: failingPoolFactory,
  });

  const status = await adapter.getStorageStatus();
  assert.equal(status.requestedMode, 'database');
  assert.equal(status.mode, 'local-json');
  assert.equal(status.canConnect, false);
  assert.match(status.warning, /cannot connect/i);
});

test('proof snapshots can be written and read through storage adapter', async () => {
  const dataDir = path.join('/tmp', `tradescope-storage-proof-${Date.now()}`);
  const adapter = createStorageAdapter({
    mode: 'local-json',
    dataDir,
    fallbackDir: dataDir,
  });

  await adapter.writeProofSnapshot({
    id: 'proof-1',
    ...activeStrategy,
    verdict: 'NOT READY',
    generatedAt: '2026-04-29T00:00:00.000Z',
    approvedSetupCount: 1,
    collectingDataSetupCount: 1,
    rejectedSetupCount: 1,
    storageStatus: 'NON_DURABLE_STORAGE',
    payloadJson: { ok: true },
  });

  const snapshots = await adapter.readProofSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].verdict, 'NOT READY');
  assert.equal(snapshots[0].strategyVersion, 'v1.1-atr-risk');
});

test('rejected setup cannot become approved even if durable storage is configured', () => {
  const approval = classifySignalForPaper({
    setupStatus: SETUP_STATUS.REJECTED_OOS_FAILURE,
    signalValidity: 'VALID',
    signal: 'LONG',
    proofStatus: 'FAILED_OOS',
    rejectionReason: 'OOS failed',
  });

  assert.equal(approval.isApprovedPaperTrade, false);
  assert.equal(approval.paperCategory, 'REJECTED_SETUP');
});

test('storage status does not expose secrets', async () => {
  const adapter = createStorageAdapter({
    mode: 'database',
    databaseUrl: 'postgres://secret-user:super-secret@localhost:5432/tradescope',
    poolFactory: failingPoolFactory,
  });

  const status = await adapter.getStorageStatus();
  assert.equal('databaseUrl' in status, false);
  assert.equal(status.databaseUrlPresent, true);
  assert.equal(status.envDiagnostics.hasDatabaseUrlEnv, false);
  assert.doesNotMatch(JSON.stringify(status), /super-secret/);
});

test('inspectStorageEnv reports URL presence as boolean and length only', () => {
  const diagnostics = inspectStorageEnv({
    STORAGE_MODE: 'database ',
    DATABASE_URL: 'postgres://secret-user:super-secret@localhost:5432/tradescope',
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    VERCEL_REGION: 'sin1',
  });

  assert.equal(diagnostics.hasStorageModeEnv, true);
  assert.equal(diagnostics.rawStorageModeLength, 'database '.length);
  assert.equal(diagnostics.storageModeTrimmed, 'database');
  assert.equal(diagnostics.hasDatabaseUrlEnv, true);
  assert.equal(diagnostics.databaseUrlLength, 'postgres://secret-user:super-secret@localhost:5432/tradescope'.length);
  assert.equal('databaseUrl' in diagnostics, false);
  assert.doesNotMatch(JSON.stringify(diagnostics), /super-secret/);
});

test('db:check reports missing tables and columns', async () => {
  const result = await inspectDatabaseSchema({
    databaseUrl: 'postgres://example:test@localhost:5432/tradescope',
    poolFactory: () => ({
      async query(text) {
        if (/SELECT 1 AS ok/i.test(text)) {
          return { rows: [{ ok: 1 }] };
        }
        if (/information_schema\.tables/i.test(text)) {
          return { rows: [{ table_name: 'signal_logs' }] };
        }
        return { rows: [{ column_name: 'id' }] };
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.canConnect, true);
  assert.ok(result.tables.some((table) => table.exists === false || table.missingColumns.length > 0));
});

test('paper proof report markdown includes official start and non-gate categories', () => {
  const markdown = paperProofReportMarkdown({
    generatedAt: '2026-04-30T00:00:00.000Z',
    ...activeStrategy,
    officialPaperTrackingStartDate: null,
    officialPaperTrackingStatus: 'PENDING_SETUP_APPROVAL',
    previousPaperHistoryExcluded: true,
    excludedHistoricalCount: 4,
    finalVerdict: 'NOT READY',
    storage: {
      mode: 'database',
      provider: 'postgres',
      canConnect: true,
      authority: 'AUTHORITATIVE',
      durable: true,
    },
    snapshotId: 'daily-paper-proof:2026-04-30',
    source: 'manual',
    currentDate: '2026-04-30',
    nextRequiredMilestone: 'Complete 28 more day(s) of authoritative approved-only paper tracking.',
    paperHealth: {
      lastApprovedPaperTradeAt: null,
      lastObservationSignalAt: '2026-04-30T01:00:00.000Z',
      lastSnapshotAt: null,
      snapshotFreshness: 'MISSING',
      liveExecutionStatus: 'STUBBED',
    },
    eligibleSetups: [
      {
        pair: 'BTC/USDT',
        timeframe: '1h',
        setupStatus: 'APPROVED_FOR_PAPER',
        recommendation: 'Continue official paper trading',
      },
    ],
    approvedOnlyMetrics: {
      durationDays: 0,
      remainingDays: 28,
      open: 0,
      closed: 0,
      winRate: 0,
      expectancy: 0,
      maxDrawdown: 0,
    },
    countdown: {
      minDays: 28,
    },
    categoryBreakdown: {
      observationOnly: { total: 2 },
      rejected: { total: 1 },
      blocked: { total: 3 },
      historical: { total: 4 },
    },
    whyNotReady: ['MIN_CLOSED_TRADES (0/30)'],
  });

  assert.match(markdown, /Official Paper Tracking Day 1: PENDING_SETUP_APPROVAL/);
  assert.match(markdown, /Official Paper Tracking Status: PENDING_SETUP_APPROVAL/);
  assert.match(markdown, /Active Strategy Version: v1\.1-atr-risk/);
  assert.match(markdown, /Risk Model: ATR-based TP\/SL/);
  assert.match(markdown, /Historical excluded total: 4/);
  assert.match(markdown, /Snapshot ID: daily-paper-proof:2026-04-30/);
  assert.match(markdown, /Next required milestone:/);
  assert.match(markdown, /BTC\/USDT 1h: APPROVED_FOR_PAPER/);
  assert.match(markdown, /Observation-only total: 2/);
  assert.match(markdown, /Snapshot freshness: MISSING/);
  assert.match(markdown, /Final verdict: NOT READY/);
});

test('paper health aggregates approved, observation, rejected, blocked, and snapshot timestamps', () => {
  const health = summarizePaperHealth({
    now: new Date('2026-05-01T00:00:00.000Z'),
    storage: { authority: 'AUTHORITATIVE', mode: 'database', durable: true },
    liveGate: {
      ready: false,
      paperGatePassed: false,
      paperDurationPassed: false,
      failedCriteria: ['PAPER_DURATION (1/28 days)'],
    },
    snapshots: [{ id: 'snap', ...activeStrategy, generatedAt: '2026-04-30T23:00:00.000Z' }],
    trades: [
      {
        id: 'approved-open',
        ...activeStrategy,
        pair: 'BTCUSDT',
        timeframe: '1h',
        direction: 'LONG',
        signalValidity: 'VALID',
        setupStatus: 'APPROVED_FOR_PAPER',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        status: 'OPEN',
        openedAt: '2026-04-30T02:00:00.000Z',
      },
      {
        id: 'approved-closed',
        ...activeStrategy,
        pair: 'BTCUSDT',
        timeframe: '1h',
        direction: 'SHORT',
        signalValidity: 'VALID',
        setupStatus: 'APPROVED_FOR_PAPER',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        status: 'WIN',
        openedAt: '2026-04-30T03:00:00.000Z',
      },
      { id: 'obs', ...activeStrategy, paperCategory: 'OBSERVATION_ONLY', openedAt: '2026-04-30T04:00:00.000Z' },
      { id: 'rej', ...activeStrategy, paperCategory: 'REJECTED_SETUP', openedAt: '2026-04-30T05:00:00.000Z' },
      { id: 'block', ...activeStrategy, paperCategory: 'BLOCKED_SIGNAL', openedAt: '2026-04-30T06:00:00.000Z' },
      { id: 'old', strategyVersion: 'v1.0', paperCategory: 'PAPER_ELIGIBLE', openedAt: '2026-04-30T07:00:00.000Z' },
    ],
  });

  assert.equal(health.storageAuthority, 'AUTHORITATIVE');
  assert.equal(health.daysElapsed, 0);
  assert.equal(health.daysRemaining, 28);
  assert.equal(health.currentDay, 0);
  assert.equal(health.officialPaperTrackingStartDate, null);
  assert.equal(health.officialPaperTrackingStatus, 'PENDING_SETUP_APPROVAL');
  assert.equal(health.approvedSetupCount, 0);
  assert.equal(health.approvedOpenTrades, 1);
  assert.equal(health.approvedClosedTrades, 1);
  assert.equal(health.excludedHistoricalCount, 1);
  assert.equal(health.observationOnlyCount, 1);
  assert.equal(health.rejectedSetupCount, 1);
  assert.equal(health.blockedSignalCount, 1);
  assert.equal(health.lastApprovedPaperTradeAt, '2026-04-30T03:00:00.000Z');
  assert.equal(health.lastObservationSignalAt, '2026-04-30T04:00:00.000Z');
  assert.equal(health.lastSnapshotAt, '2026-04-30T23:00:00.000Z');
  assert.equal(health.snapshotFreshness, 'STALE');
  assert.equal(health.liveExecutionStatus, 'STUBBED');
  assert.equal(health.globalVerdict, 'NOT READY');
});

test('snapshot freshness reports missing, stale, and fresh', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');
  assert.equal(calculateSnapshotFreshness({ now }), 'MISSING');
  assert.equal(calculateSnapshotFreshness({ now, lastSnapshotAt: '2026-04-30T23:59:59.000Z' }), 'STALE');
  assert.equal(calculateSnapshotFreshness({ now, lastSnapshotAt: '2026-05-01T00:00:00.000Z' }), 'FRESH');
});

test('daily paper check output summarizes empty day one state', () => {
  const output = formatDailyPaperCheck({
    storageAuthority: 'AUTHORITATIVE',
    storageDurable: true,
    currentDay: 0,
    minimumDays: 28,
    daysElapsed: 0,
    daysRemaining: 28,
    approvedClosedTrades: 0,
    approvedOpenTrades: 0,
    observationOnlyCount: 0,
    rejectedSetupCount: 0,
    blockedSignalCount: 0,
    lastApprovedPaperTradeAt: null,
    lastObservationSignalAt: null,
    lastSnapshotAt: null,
    snapshotFreshness: 'MISSING',
    liveExecutionStatus: 'STUBBED',
    globalVerdict: 'NOT READY',
    ...activeStrategy,
  });

  assert.match(output, /Storage: AUTHORITATIVE/);
  assert.match(output, /Active Strategy: v1\.1-atr-risk/);
  assert.match(output, /Risk Model: ATR-based TP\/SL/);
  assert.match(output, /Official Paper Status: PENDING_SETUP_APPROVAL/);
  assert.match(output, /Paper Day: 0 \/ 28/);
  assert.match(output, /Approved Closed Trades: 0 \/ 30/);
  assert.match(output, /Verdict: NOT READY/);
  assert.match(output, /Run npm run proof:snapshot/);
});

test('weekly audit detects paper counting anomalies', () => {
  const anomalies = detectPaperAuditAnomalies({
    storage: { authoritative: true, durable: true },
    paperHealth: { snapshotFreshness: 'MISSING' },
    liveExecutionStatus: 'UNKNOWN',
    trades: [
      {
        id: 'eth-approved',
        ...activeStrategy,
        pair: 'ETH/USDT',
        timeframe: '1h',
        direction: 'LONG',
        signalValidity: 'VALID',
        setupStatus: 'APPROVED_FOR_PAPER',
        proofStatus: 'INSUFFICIENT_SAMPLE',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        openedAt: '2026-04-30T01:00:00.000Z',
        entry: 100,
        stopLoss: 98,
        takeProfit: 104,
      },
      {
        id: 'sol-approved',
        ...activeStrategy,
        pair: 'SOL/USDT',
        timeframe: '15m',
        direction: 'SHORT',
        signalValidity: 'VALID',
        setupStatus: 'REJECTED_OOS_FAILURE',
        proofStatus: 'FAILED_OOS',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        openedAt: '2026-04-30T01:00:00.000Z',
        entry: 100,
        stopLoss: 102,
        takeProfit: 96,
      },
      {
        id: 'blocked-approved',
        ...activeStrategy,
        pair: 'BTC/USDT',
        timeframe: '1h',
        direction: 'LONG',
        signalValidity: 'BLOCKED',
        setupStatus: 'APPROVED_FOR_PAPER',
        proofStatus: 'PROVEN_READY_FOR_PAPER',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        openedAt: '2026-04-30T01:00:00.000Z',
        entry: 100,
        stopLoss: 98,
        takeProfit: 104,
      },
      {
        id: 'pre-start',
        ...activeStrategy,
        pair: 'BTC/USDT',
        timeframe: '1h',
        direction: 'LONG',
        signalValidity: 'VALID',
        setupStatus: 'APPROVED_FOR_PAPER',
        proofStatus: 'PROVEN_READY_FOR_PAPER',
        paperCategory: 'PAPER_ELIGIBLE',
        isApprovedPaperTrade: true,
        openedAt: '2026-04-29T23:00:00.000Z',
        entry: 100,
        stopLoss: 98,
        takeProfit: 104,
      },
    ],
  });
  const codes = anomalies.map((item) => item.code);

  assert.ok(codes.includes('ETH_OBSERVATION_COUNTED_APPROVED'));
  assert.ok(codes.includes('SOL_REJECTED_COUNTED_APPROVED'));
  assert.ok(codes.includes('REJECTED_SETUP_COUNTED_APPROVED'));
  assert.ok(codes.includes('BLOCKED_SIGNAL_COUNTED_APPROVED'));
  assert.ok(codes.includes('PRE_START_TRADE_COUNTED'));
  assert.ok(codes.includes('SNAPSHOT_NOT_FRESH'));
  assert.ok(codes.includes('LIVE_EXECUTION_NOT_STUBBED'));
});

test('weekly audit markdown includes anomalies and next action', () => {
  const markdown = weeklyPaperAuditMarkdown({
    generatedAt: '2026-04-30T00:00:00.000Z',
    dateRange: { from: '2026-04-24', to: '2026-04-30' },
    storage: { authority: 'AUTHORITATIVE' },
    ...activeStrategy,
    officialPaperTrackingStartDate: null,
    officialPaperTrackingStatus: 'PENDING_SETUP_APPROVAL',
    daysElapsed: 0,
    daysRemaining: 28,
    minimumDays: 28,
    globalVerdict: 'NOT READY',
    approvedSetupList: [{ pair: 'BTC/USDT', timeframe: '1h', setupStatus: 'APPROVED_FOR_PAPER' }],
    approvedOnlyMetrics: { open: 0, closed: 0, winRate: 0, expectancy: 0, maxDrawdown: 0 },
    nonGateCounts: { observationOnly: 0, rejectedSetup: 0, blockedSignal: 0 },
    gateChecklist: ['MIN_CLOSED_TRADES (0/30)'],
    anomalies: [{ code: 'SNAPSHOT_NOT_FRESH', message: 'No proof snapshot exists.', tradeId: null }],
    nextRecommendedAction: 'Review anomalies before relying on paper data.',
  });

  assert.match(markdown, /TradeScope Weekly Paper Audit/);
  assert.match(markdown, /SNAPSHOT_NOT_FRESH/);
  assert.match(markdown, /Next recommended action:/);
});

test('live execution endpoint remains stubbed', async () => {
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };

  await liveExecutionHandler({ method: 'POST', body: { test: true } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.executed, false);
  assert.match(response.body.message, /stub/i);
});
