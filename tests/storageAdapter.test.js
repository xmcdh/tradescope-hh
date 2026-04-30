import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createStorageAdapter } from '../src/lib/storageAdapter.js';
import { classifySignalForPaper, SETUP_STATUS } from '../src/lib/setupRegistry.js';
import { inspectDatabaseSchema } from '../src/scripts/checkDatabase.js';

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
              'id','pair','timeframe','direction','signal','signal_validity','setup_status','proof_status','candle_timestamp','entry','stop_loss','take_profit','rr','score','result','exit_price','exit_timestamp','realized_r','r_result','btc_context','blocked_reason','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        if (values[0] === 'paper_trades') {
          return {
            rows: [
              'id','pair','timeframe','direction','signal','signal_validity','setup_status','proof_status','paper_category','is_approved_paper_trade','rejection_reason','entry','stop_loss','take_profit','rr','score','opened_at','closed_at','status','exit_price','exit_timestamp','realized_r','r_result','btc_context','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        if (values[0] === 'proof_snapshots') {
          return {
            rows: [
              'id','verdict','generated_at','approved_setup_count','collecting_data_setup_count','rejected_setup_count','storage_status','source_batch_filename','source_report_filename','payload_json','created_at','updated_at',
            ].map((column_name) => ({ column_name })),
          };
        }
        return {
          rows: [
            'id','pair','timeframe','proof_status','setup_status','recommendation','source_report_id','created_at','updated_at',
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
  assert.doesNotMatch(JSON.stringify(status), /super-secret/);
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
