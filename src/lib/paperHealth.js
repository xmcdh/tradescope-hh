import {
  OFFICIAL_PAPER_SETUPS,
  calculatePaperTrackingCountdown,
} from '../config/paperTrackingConfig.js';
import { loadLiveGate } from './liveGate.js';
import { readPaperTrades } from './paperTrader.js';
import { readProofSnapshots } from './storageAdapter.js';

function timestampOf(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function tradeTimestamp(trade) {
  const openedAt = timestampOf(trade?.openedAt);
  if (Number.isFinite(openedAt)) {
    return openedAt;
  }

  const createdAt = timestampOf(trade?.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return Number.isFinite(trade?.timestamp) ? trade.timestamp : null;
}

function latestIso(items, selector) {
  const latest = items
    .map(selector)
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];

  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

export function calculateSnapshotFreshness({ lastSnapshotAt, now = new Date() } = {}) {
  if (!lastSnapshotAt) {
    return 'MISSING';
  }

  const snapshotTimestamp = Date.parse(lastSnapshotAt);
  if (!Number.isFinite(snapshotTimestamp)) {
    return 'MISSING';
  }

  const today = now.toISOString().slice(0, 10);
  const snapshotDay = new Date(snapshotTimestamp).toISOString().slice(0, 10);
  return snapshotDay === today ? 'FRESH' : 'STALE';
}

function isApprovedPaperTrade(trade) {
  return (
    trade?.isApprovedPaperTrade === true &&
    trade?.paperCategory === 'PAPER_ELIGIBLE' &&
    trade?.signalValidity === 'VALID' &&
    trade?.setupStatus === 'APPROVED_FOR_PAPER' &&
    ['LONG', 'SHORT'].includes(trade?.direction) &&
    trade?.recordQuality !== 'INVALID'
  );
}

export function summarizePaperHealth({
  trades = [],
  snapshots = [],
  liveGate = null,
  storage = null,
  now = new Date(),
} = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const snapshotList = Array.isArray(snapshots) ? snapshots : [];
  const countdown = calculatePaperTrackingCountdown(now.getTime());
  const approvedTrades = list.filter(isApprovedPaperTrade);
  const observationOnly = list.filter((trade) => trade.paperCategory === 'OBSERVATION_ONLY');
  const rejected = list.filter((trade) => trade.paperCategory === 'REJECTED_SETUP');
  const blocked = list.filter((trade) => trade.paperCategory === 'BLOCKED_SIGNAL');
  const storageInfo = storage ?? liveGate?.storage ?? {};
  const currentDay = now.getTime() >= countdown.startTimestamp ? countdown.elapsedDays + 1 : 0;
  const lastSnapshotAt = latestIso(snapshotList, (snapshot) => timestampOf(snapshot.generatedAt ?? snapshot.createdAt ?? snapshot.updatedAt));

  return {
    storageAuthority: storageInfo.authority ?? (storageInfo.durable ? 'AUTHORITATIVE' : 'LOCAL_ONLY'),
    storageMode: storageInfo.mode ?? null,
    storageDurable: Boolean(storageInfo.durable),
    officialPaperTrackingStartDate: countdown.officialPaperTrackingStartDate,
    currentDay,
    daysElapsed: countdown.elapsedDays,
    daysRemaining: countdown.remainingDays,
    minimumDays: countdown.minDays,
    approvedSetupCount: OFFICIAL_PAPER_SETUPS.filter((setup) => setup.setupStatus === 'APPROVED_FOR_PAPER').length,
    approvedOpenTrades: approvedTrades.filter((trade) => trade.status === 'OPEN').length,
    approvedClosedTrades: approvedTrades.filter((trade) => ['WIN', 'LOSS', 'EXPIRED'].includes(trade.status)).length,
    observationOnlyCount: observationOnly.length,
    rejectedSetupCount: rejected.length,
    blockedSignalCount: blocked.length,
    lastApprovedPaperTradeAt: latestIso(approvedTrades, tradeTimestamp),
    lastObservationSignalAt: latestIso(observationOnly, tradeTimestamp),
    lastSnapshotAt,
    snapshotFreshness: calculateSnapshotFreshness({ lastSnapshotAt, now }),
    liveExecutionStatus: 'STUBBED',
    liveGateStatus: {
      ready: Boolean(liveGate?.ready),
      paperGatePassed: Boolean(liveGate?.paperGatePassed),
      paperDurationPassed: Boolean(liveGate?.paperDurationPassed),
      failedCriteria: liveGate?.failedCriteria ?? [],
    },
    globalVerdict: liveGate?.ready ? 'READY FOR SMALL LIVE TEST' : 'NOT READY',
    message: 'Collecting authoritative paper data. Only approved BTC/USDT 1h trades count right now.',
  };
}

export async function loadPaperHealth({ now = new Date() } = {}) {
  const [trades, snapshots, liveGate] = await Promise.all([
    readPaperTrades(),
    readProofSnapshots(),
    loadLiveGate(),
  ]);

  return summarizePaperHealth({
    trades,
    snapshots,
    liveGate,
    storage: liveGate.storage,
    now,
  });
}
