import {
  getStorageStatus,
  readSignalLogs,
  updateSignalLog,
  writeSignalLog,
} from './storageAdapter.js';
import { strategyMetadata, strategyVersion } from '../config/strategyVersion.js';

const EXPIRY_MS = 48 * 60 * 60 * 1000;

function normalizeTimestamp(value) {
  if (!Number.isFinite(value)) {
    return Date.now();
  }

  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function signalId({ pair, timeframe, direction, timestamp }) {
  return `${strategyVersion}:${pair}:${timeframe}:${direction}:${timestamp}`;
}

export async function readSignalLog() {
  const parsed = await readSignalLogs();
  return Array.isArray(parsed) ? parsed : [];
}

function entryFromSignal({ pair, timeframe, setup }) {
  const timestamp = normalizeTimestamp(setup?.lastUpdate ?? Date.now());
  const direction = setup?.selectedDirection ?? setup?.signal ?? null;

  if (!['LONG', 'SHORT'].includes(direction)) {
    return null;
  }

  return {
    id: signalId({ pair, timeframe, direction, timestamp }),
    timestamp,
    candleTimestamp: timestamp,
    pair,
    timeframe,
    ...strategyMetadata(),
    direction,
    entry: setup?.entry1 ?? null,
    stopLoss: setup?.sl ?? null,
    takeProfit: setup?.tp1 ?? null,
    sl: setup?.sl ?? null,
    tp: setup?.tp1 ?? null,
    rr: setup?.rr ?? setup?.rrRatio ?? null,
    score: setup?.confidenceScore ?? setup?.score ?? 0,
    signalValidity: setup?.signalValidity ?? 'VALID',
    setupStatus: setup?.setupStatus ?? 'UNKNOWN',
    proofStatus: setup?.proofStatus ?? 'UNKNOWN',
    btcContext: {
      bias: setup?.btcBias ?? null,
      confirmation: setup?.btcConfirmation ?? false,
      note: setup?.btcNote ?? null,
    },
    status: 'OPEN',
    result: 'OPEN',
    exitPrice: null,
    exitTimestamp: null,
    realizedR: null,
    rResult: null,
    blockedReason: setup?.blockedReason ?? [],
    createdAt: new Date(timestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
  };
}

function candleAfterEntry(candle, timestamp) {
  const candleTimestamp = normalizeTimestamp(candle?.time ?? candle?.timestamp);
  return candleTimestamp > timestamp;
}

function settleAgainstCandles(entry, candles) {
  if (entry.status !== 'OPEN') {
    return null;
  }

  const futureCandles = candles.filter((candle) => candleAfterEntry(candle, entry.timestamp));
  const expiryTimestamp = entry.timestamp + EXPIRY_MS;

  for (const candle of futureCandles) {
    const candleTimestamp = normalizeTimestamp(candle?.time ?? candle?.timestamp);
    if (candleTimestamp > expiryTimestamp) {
      break;
    }

    const hitTp = entry.direction === 'LONG' ? candle.high >= entry.tp : candle.low <= entry.tp;
    const hitSl = entry.direction === 'LONG' ? candle.low <= entry.sl : candle.high >= entry.sl;

    if (hitTp && hitSl) {
      return {
        status: 'LOSS',
        result: 'LOSS',
        exitPrice: entry.sl,
        exitTimestamp: candleTimestamp,
        realizedR: -1,
        rResult: -1,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }

    if (hitSl) {
      return {
        status: 'LOSS',
        result: 'LOSS',
        exitPrice: entry.sl,
        exitTimestamp: candleTimestamp,
        realizedR: -1,
        rResult: -1,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }

    if (hitTp) {
      const realizedR = Number.isFinite(entry.rr) ? entry.rr : 1;
      return {
        status: 'WIN',
        result: 'WIN',
        exitPrice: entry.tp,
        exitTimestamp: candleTimestamp,
        realizedR,
        rResult: realizedR,
        updatedAt: new Date(candleTimestamp).toISOString(),
      };
    }
  }

  const lastCandle = candles.at(-1);
  const lastTimestamp = normalizeTimestamp(lastCandle?.time ?? lastCandle?.timestamp ?? Date.now());
  if (lastTimestamp >= expiryTimestamp) {
    return {
      status: 'EXPIRED',
      result: 'EXPIRED',
      exitPrice: lastCandle?.close ?? entry.entry,
      exitTimestamp: expiryTimestamp,
      realizedR: 0,
      rResult: 0,
      updatedAt: new Date(expiryTimestamp).toISOString(),
    };
  }

  return null;
}

export async function syncSignalLog({ pair, timeframe, setup, candles }) {
  const entries = await readSignalLog();
  const toUpdate = entries
    .filter((entry) => entry.pair === pair && entry.timeframe === timeframe && entry.strategyVersion === strategyVersion)
    .map((entry) => ({
      id: entry.id,
      updates: settleAgainstCandles(entry, candles ?? []),
    }))
    .filter((item) => item.updates);

  await Promise.all(toUpdate.map((item) => updateSignalLog(item.id, item.updates)));

  const newEntry = entryFromSignal({ pair, timeframe, setup });
  if (newEntry && !entries.some((entry) => entry.id === newEntry.id)) {
    await writeSignalLog(newEntry);
    const newEntryUpdates = settleAgainstCandles(newEntry, candles ?? []);
    if (newEntryUpdates) {
      await updateSignalLog(newEntry.id, newEntryUpdates);
    }
  }

  return readSignalLog();
}

export async function getSignalLogPath() {
  const status = await getStorageStatus();
  return status.filePaths?.signalLogs ?? null;
}

export async function getSignalLogStorageStatus() {
  return getStorageStatus();
}
