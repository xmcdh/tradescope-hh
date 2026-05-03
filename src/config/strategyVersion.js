export const strategyVersion = 'v1.1-atr-risk';
export const strategyName = 'TradeScope Futures ATR Risk';
export const riskModel = 'ATR-based TP/SL';
export const activatedAt = '2026-04-30T05:26:46.000Z';
export const officialPaperTrackingStartDate = null;
export const signalLogicVersion = '47d3e09-atr-risk';
export const macdBugFixedAt = '2026-05-02';
export const macdBugNote = 'macd.macd was lowercase, always undefined. Fixed to macd.MACD.';
export const postFixBestSetup = 'ETH/USDT 1h';
export const postFixBestExpectancy = 0.1979;
export const postFixBestWinRate = 0.4792;
export const postFixBestMaxDD = 0.0923;
export const postFixVerdict = 'NOT_READY';
export const postFixBlocker = 'expectancy_below_0.3R_all_setups';
export const nextResearchPhase = 'v2-liquidity-sweep-reclaim';

export const activeStrategy = {
  strategyVersion,
  strategyName,
  riskModel,
  activatedAt,
  officialPaperTrackingStartDate,
  signalLogicVersion,
  macdBugFixedAt,
  macdBugNote,
  postFixBestSetup,
  postFixBestExpectancy,
  postFixBestWinRate,
  postFixBestMaxDD,
  postFixVerdict,
  postFixBlocker,
  nextResearchPhase,
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
