export const strategyVersion = 'v1.1-atr-risk';
export const strategyName = 'TradeScope Futures ATR Risk';
export const riskModel = 'ATR-based TP/SL';
export const activatedAt = '2026-04-30T05:26:46.000Z';
export const officialPaperTrackingStartDate = null;
export const signalLogicVersion = '47d3e09-atr-risk';

export const activeStrategy = {
  strategyVersion,
  strategyName,
  riskModel,
  activatedAt,
  officialPaperTrackingStartDate,
  signalLogicVersion,
};

export function strategyMetadata(overrides = {}) {
  return {
    ...activeStrategy,
    ...overrides,
  };
}

export function isActiveStrategyRecord(record, activeVersion = strategyVersion) {
  return record?.strategyVersion === activeVersion;
}
