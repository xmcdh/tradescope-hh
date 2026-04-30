export const OFFICIAL_PAPER_TRACKING_START_DATE = '2026-04-30';
export const OFFICIAL_PAPER_TRACKING_MIN_DAYS = 28;

export const OFFICIAL_PAPER_SETUPS = [
  {
    pair: 'BTC/USDT',
    timeframe: '1h',
    proofStatus: 'PROVEN_READY_FOR_PAPER',
    setupStatus: 'APPROVED_FOR_PAPER',
    recommendation: 'Continue official paper trading',
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

export function calculatePaperTrackingCountdown(nowMs = Date.now()) {
  const startTimestamp = officialPaperTrackingStartTimestamp();
  const elapsedDays = Math.max(0, Math.floor((nowMs - startTimestamp) / (24 * 60 * 60 * 1000)));
  const remainingDays = Math.max(0, OFFICIAL_PAPER_TRACKING_MIN_DAYS - elapsedDays);

  return {
    officialPaperTrackingStartDate: OFFICIAL_PAPER_TRACKING_START_DATE,
    startTimestamp,
    minDays: OFFICIAL_PAPER_TRACKING_MIN_DAYS,
    elapsedDays,
    remainingDays,
  };
}
