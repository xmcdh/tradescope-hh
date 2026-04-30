import {
  activeStrategy,
  officialPaperTrackingStartDate,
  strategyVersion,
} from './strategyVersion.js';

export const OFFICIAL_PAPER_TRACKING_START_DATE = officialPaperTrackingStartDate;
export const OFFICIAL_PAPER_TRACKING_MIN_DAYS = 28;
export const ACTIVE_STRATEGY_VERSION = strategyVersion;

export const PAPER_TRACKING_PHASES = [
  {
    strategyVersion: 'v1.0',
    status: 'ARCHIVED_SUPERSEDED',
    officialPaperTrackingStartDate: '2026-04-30',
    note: 'Superseded by ATR-based TP/SL risk model. Historical only; excluded from current proof gate.',
  },
  {
    ...activeStrategy,
    status: 'ACTIVE',
    note: 'ATR TP/SL changed the active risk model. Current official proof gate counts this strategy version only.',
  },
];

export const OFFICIAL_PAPER_SETUPS = [
  {
    pair: 'BTC/USDT',
    timeframe: '1h',
    proofStatus: 'REQUIRES_FRESH_ATR_BACKTEST',
    setupStatus: 'COLLECT_MORE_DATA',
    recommendation: 'Run fresh ATR backtest, OOS, and walk-forward validation before official paper approval.',
  },
  {
    pair: 'ETH/USDT',
    timeframe: '1h',
    proofStatus: 'INSUFFICIENT_SAMPLE',
    setupStatus: 'COLLECT_MORE_DATA',
    recommendation: 'Observation only / collect more data',
  },
  {
    pair: 'SOL/USDT',
    timeframe: '15m',
    proofStatus: 'FAILED_OOS',
    setupStatus: 'REJECTED_OOS_FAILURE',
    recommendation: 'Rejected from official paper proof',
  },
];

export function officialPaperTrackingStartTimestamp() {
  return Date.parse(`${OFFICIAL_PAPER_TRACKING_START_DATE}T00:00:00.000Z`);
}

export function activePaperTrackingPhase() {
  return PAPER_TRACKING_PHASES.find((phase) => phase.strategyVersion === ACTIVE_STRATEGY_VERSION);
}

export function calculatePaperTrackingCountdown(nowMs = Date.now()) {
  const startTimestamp = officialPaperTrackingStartTimestamp();
  const elapsedDays = Math.max(0, Math.floor((nowMs - startTimestamp) / (24 * 60 * 60 * 1000)));
  const remainingDays = Math.max(0, OFFICIAL_PAPER_TRACKING_MIN_DAYS - elapsedDays);

  return {
    strategyVersion: ACTIVE_STRATEGY_VERSION,
    riskModel: activeStrategy.riskModel,
    activatedAt: activeStrategy.activatedAt,
    officialPaperTrackingStartDate: OFFICIAL_PAPER_TRACKING_START_DATE,
    startTimestamp,
    minDays: OFFICIAL_PAPER_TRACKING_MIN_DAYS,
    elapsedDays,
    remainingDays,
  };
}
