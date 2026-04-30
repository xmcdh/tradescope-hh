import {
  getStorageStatus,
  readPaperTradesStorage,
  updatePaperTrade,
  writePaperTrade,
} from './storageAdapter.js';
import { classifySignalForPaper, loadSetupRegistry, lookupSetupEntry } from './setupRegistry.js';

const EXPIRY_MS = 48 * 60 * 60 * 1000;
const REQUIRED_PAPER_TRADE_FIELDS = [
  'pair',
  'timeframe',
  'direction',
  'signalValidity',
  'setupStatus',
  'proofStatus',
  'paperCategory',
  'isApprovedPaperTrade',
  'openedAt',
  'entry',
  'stopLoss',
  'takeProfit',
];

function normalizeTimestamp(value) {
  if (!Number.isFinite(value)) {
    return Date.now();
  }

  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

export async function readPaperTrades() {
  const parsed = await readPaperTradesStorage();
  return Array.isArray(parsed) ? parsed : [];
}

function isMissing(value) {
  return value == null || value === '';
}

function isRejectedSetupStatus(setupStatus) {
  return String(setupStatus ?? '').startsWith('REJECTED') || setupStatus === 'DISABLED_MANUAL';
}

export function validatePaperTradeRecord(record, registryEntry = null) {
  const issues = [];

  REQUIRED_PAPER_TRADE_FIELDS.forEach((field) => {
    if (isMissing(record?.[field])) {
      issues.push(`MISSING_${field}`);
    }
  });

  if (record?.openedAt && !Number.isFinite(Date.parse(record.openedAt))) {
    issues.push('INVALID_openedAt');
  }

  if (record?.direction && !['LONG', 'SHORT'].includes(record.direction)) {
    issues.push('INVALID_direction');
  }

  if (registryEntry?.setupStatus && record?.setupStatus !== registryEntry.setupStatus) {
    issues.push('SETUP_STATUS_MISMATCH');
  }

  if (record?.signalValidity === 'BLOCKED' && record?.isApprovedPaperTrade === true) {
    issues.push('BLOCKED_APPROVED');
  }

  if (isRejectedSetupStatus(record?.setupStatus) && record?.isApprovedPaperTrade === true) {
    issues.push('REJECTED_SETUP_APPROVED');
  }

  if (record?.isApprovedPaperTrade === true) {
    if (record.paperCategory !== 'PAPER_ELIGIBLE') {
      issues.push('APPROVED_CATEGORY_MISMATCH');
    }
    if (record.signalValidity !== 'VALID') {
      issues.push('APPROVED_SIGNAL_NOT_VALID');
    }
    if (record.setupStatus !== 'APPROVED_FOR_PAPER') {
      issues.push('APPROVED_SETUP_NOT_APPROVED');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function createPaperTradeRecord({ pair, timeframe, setup, candles, registryEntry }) {
  const signalCandle = candles?.[candles.length - 1] ?? null;
  const timestamp = normalizeTimestamp(signalCandle?.time ?? setup?.lastUpdate ?? Date.now());
  const direction = setup?.selectedDirection ?? setup?.signal ?? null;
  const approval = classifySignalForPaper({
    setupStatus: registryEntry?.setupStatus ?? setup?.setupStatus ?? 'UNKNOWN',
    signalValidity: setup?.signalValidity ?? 'MARGINAL',
    signal: setup?.signal,
    proofStatus: registryEntry?.proofStatus ?? setup?.proofStatus ?? 'UNKNOWN',
    rejectionReason: registryEntry?.rejectionReason ?? setup?.setupRejectionReason ?? '',
  });

  const record = {
    id: `paper:${pair}:${timeframe}:${direction ?? setup?.signal ?? 'NONE'}:${timestamp}`,
    timestamp,
    pair,
    timeframe,
    direction,
    signal: setup?.signal ?? 'NO_TRADE',
    entry: signalCandle?.close ?? setup?.entry1 ?? null,
    stopLoss: setup?.sl ?? null,
    takeProfit: setup?.tp1 ?? null,
    sl: setup?.sl ?? null,
    tp: setup?.tp1 ?? null,
    rr: setup?.rr ?? setup?.rrRatio ?? null,
    score: setup?.confidenceScore ?? setup?.score ?? 0,
    signalValidity: setup?.signalValidity ?? 'MARGINAL',
    setupStatus: approval.setupStatus,
    proofStatus: approval.proofStatus,
    paperCategory: approval.paperCategory,
    isApprovedPaperTrade: approval.isApprovedPaperTrade,
    rejectionReason: approval.rejectionReason,
    btcContext: {
      bias: setup?.btcBias ?? null,
      confirmation: setup?.btcConfirmation ?? false,
      note: setup?.btcNote ?? null,
    },
    status: approval.shouldTrackOutcome ? 'OPEN' : 'SKIPPED',
    openedAt: new Date(timestamp).toISOString(),
    closedAt: null,
    exitPrice: null,
    exitTimestamp: null,
    realizedR: null,
    rResult: null,
    createdAt: new Date(timestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
  };

  const validation = validatePaperTradeRecord(record, registryEntry);
  if (!validation.valid && record.isApprovedPaperTrade) {
    record.isApprovedPaperTrade = false;
    record.status = 'SKIPPED';
    record.rejectionReason = validation.issues.join(' | ');
  }

  return {
    ...record,
    recordQuality: validation.valid ? 'VALID' : 'INVALID',
    recordIssues: validation.issues,
  };
}

function settleTrade(trade, candles) {
  if (trade.status !== 'OPEN') {
    return null;
  }

  const expiryTimestamp = trade.timestamp + EXPIRY_MS;
  const futureCandles = candles.filter((candle) => normalizeTimestamp(candle.time) > trade.timestamp);

  for (const candle of futureCandles) {
    const candleTimestamp = normalizeTimestamp(candle.time);
    if (candleTimestamp > expiryTimestamp) {
      break;
    }

    const hitTp = trade.direction === 'LONG' ? candle.high >= trade.tp : candle.low <= trade.tp;
    const hitSl = trade.direction === 'LONG' ? candle.low <= trade.sl : candle.high >= trade.sl;

    if (hitTp && hitSl) {
      return {
        status: 'LOSS',
        closedAt: new Date(candleTimestamp).toISOString(),
        exitPrice: trade.sl,
        exitTimestamp: candleTimestamp,
        realizedR: -1,
        rResult: -1,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }

    if (hitSl) {
      return {
        status: 'LOSS',
        closedAt: new Date(candleTimestamp).toISOString(),
        exitPrice: trade.sl,
        exitTimestamp: candleTimestamp,
        realizedR: -1,
        rResult: -1,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }

    if (hitTp) {
      const realizedR = Number.isFinite(trade.rr) ? trade.rr : 1;
      return {
        status: 'WIN',
        closedAt: new Date(candleTimestamp).toISOString(),
        exitPrice: trade.tp,
        exitTimestamp: candleTimestamp,
        realizedR,
        rResult: realizedR,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }
  }

  const lastCandle = candles.at(-1);
  const lastTimestamp = normalizeTimestamp(lastCandle?.time ?? Date.now());
  if (lastTimestamp >= expiryTimestamp) {
    return {
      status: 'EXPIRED',
      closedAt: new Date(expiryTimestamp).toISOString(),
      exitPrice: lastCandle?.close ?? trade.entry,
      exitTimestamp: expiryTimestamp,
      realizedR: 0,
      rResult: 0,
      updatedAt: new Date(expiryTimestamp).toISOString(),
    };
  }

  return null;
}

export async function syncPaperTrades({ pair, timeframe, setup, candles }) {
  const trades = await readPaperTrades();
  const registry = await loadSetupRegistry();
  const registryEntry = lookupSetupEntry(registry, pair, timeframe);
  const updates = trades
    .filter((trade) => trade.pair === pair && trade.timeframe === timeframe)
    .map((trade) => ({
      id: trade.id,
      updates: settleTrade(trade, candles ?? []),
    }))
    .filter((item) => item.updates);

  await Promise.all(updates.map((item) => updatePaperTrade(item.id, item.updates)));

  const newTrade = createPaperTradeRecord({ pair, timeframe, setup, candles, registryEntry });
  if (newTrade && !trades.some((trade) => trade.id === newTrade.id)) {
    await writePaperTrade(newTrade);
    const immediateSettlement = settleTrade(newTrade, candles ?? []);
    if (immediateSettlement) {
      await updatePaperTrade(newTrade.id, immediateSettlement);
    }
  }

  return readPaperTrades();
}

export async function getPaperTradesPath() {
  const status = await getStorageStatus();
  return status.filePaths?.paperTrades ?? null;
}

export async function getPaperTradeStorageStatus() {
  return getStorageStatus();
}
