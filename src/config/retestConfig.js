export const DEFAULT_RETEST_CONFIG = {
  enabled: true,
  maxRetestWaitCandles: 6,
  retestTolerancePercent: 0.5,
  retestToleranceAtrMultiplier: 0.25,
  confirmationCloseRequired: true,
  confirmationLevel: 'breakoutLevel',
  allowMarginalConfirmation: false,
  marginalConfirmationMinimumScore: 7,
  invalidationRule: 'wick-breach',
};

export function normalizeRetestConfig(config = {}) {
  const merged = {
    ...DEFAULT_RETEST_CONFIG,
    ...(config ?? {}),
  };

  return {
    enabled: merged.enabled !== false,
    maxRetestWaitCandles: Number.isFinite(Number(merged.maxRetestWaitCandles))
      ? Math.max(1, Math.round(Number(merged.maxRetestWaitCandles)))
      : DEFAULT_RETEST_CONFIG.maxRetestWaitCandles,
    retestTolerancePercent: Number.isFinite(Number(merged.retestTolerancePercent))
      ? Math.max(0, Number(merged.retestTolerancePercent))
      : DEFAULT_RETEST_CONFIG.retestTolerancePercent,
    retestToleranceAtrMultiplier: Number.isFinite(Number(merged.retestToleranceAtrMultiplier))
      ? Math.max(0, Number(merged.retestToleranceAtrMultiplier))
      : DEFAULT_RETEST_CONFIG.retestToleranceAtrMultiplier,
    confirmationCloseRequired: merged.confirmationCloseRequired !== false,
    confirmationLevel: ['breakoutLevel', 'retestArea'].includes(merged.confirmationLevel)
      ? merged.confirmationLevel
      : DEFAULT_RETEST_CONFIG.confirmationLevel,
    allowMarginalConfirmation: merged.allowMarginalConfirmation === true,
    marginalConfirmationMinimumScore: Number.isFinite(Number(merged.marginalConfirmationMinimumScore))
      ? Math.max(0, Number(merged.marginalConfirmationMinimumScore))
      : DEFAULT_RETEST_CONFIG.marginalConfirmationMinimumScore,
    invalidationRule: merged.invalidationRule ?? DEFAULT_RETEST_CONFIG.invalidationRule,
  };
}
