export const strategyExperimentStatus = {
  activeStrategyVersion: 'v1.1-atr-risk',
  experimentsActiveInProduction: false,
  liveGateEligible: false,
  paperGateEligible: false,
  note: 'Experimental configs are backtest-only until explicitly promoted through proof gates.',
};

const BASE_TREND_PULLBACK_SIGNAL_LOGIC = {
  strategyType: 'trendPullbackContinuation',
  entryScore: 7,
  atrStopMultiplier: 1.45,
  tp1RTarget: 1.5,
  tp2RTarget: 2.4,
  rrTp1Min: 1.5,
  rrTp2Min: 2,
  pullbackTolerancePercent: 0.85,
  minRoomToLevelPercent: 0.9,
  minVolumeRatio: 0.85,
  maxSlAtrMultiple: 2.4,
};

const BASE_V14_CHOP_SIGNAL_LOGIC = {
  ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
  qualityFilters: {
    chopAvoidance: {
      enabled: true,
      minEmaSeparationPercent: 0.2,
      minRecentRangeAtrMultiple: 3.2,
      maxRsiNeutralCandles: 5,
    },
  },
};

const COMMON_UNCHANGED_GATES = [
  'stale/error data cannot generate LONG/SHORT',
  'AVOID remains blocked',
  'minimum 50 closed actionable trades per setup',
  'expectancy > 0.3R',
  'win rate > 45%',
  'max drawdown < 15%',
  'OOS degradation <= 15%',
  'walk-forward acceptable',
  'no profit concentration',
  'no liveGate or paperGate eligibility',
];

export function getExperimentFamily(experimentId = '') {
  if (String(experimentId).startsWith('v3-')) {
    return 'v3-edge-redesign';
  }

  if (String(experimentId).startsWith('v2-') || String(experimentId).startsWith('v2.')) {
    return 'v2-edge-redesign';
  }

  if (String(experimentId).startsWith('v1.6-')) {
    return 'v1.6-regime-filter';
  }

  if (String(experimentId).startsWith('v1.5-')) {
    return 'v1.5-exit-geometry';
  }

  if (String(experimentId).startsWith('v1.4-')) {
    return 'v1.4-quality-filter';
  }

  if (String(experimentId).startsWith('v1.3-')) {
    return 'v1.3-strategy-redesign';
  }

  return 'v1.2-atr-retest-calibration';
}

export const v12AtrRetestCalibrationExperiments = [
  {
    experimentId: 'v1.2-confirmation-score',
    strategyVersion: 'v1.2-confirmation-score',
    label: 'Retest confirmation score calibration',
    candidateOnly: true,
    retestConfig: {
      marginalConfirmationMinimumScore: 6,
      allowMarginalConfirmation: true,
    },
    changedParameters: {
      retestConfirmationScoreFloor: 6,
      marginalConfirmationTreatment:
        'promote only unblocked MARGINAL retest confirmations that reach the conservative score floor during backtest',
    },
    unchangedGates: [
      'minimum 50 closed actionable trades per setup',
      'expectancy > 0.3R',
      'win rate > 45%',
      'max drawdown < 15%',
      'OOS degradation <= 15%',
      'walk-forward acceptable',
      'no profit concentration',
    ],
  },
  {
    experimentId: 'v1.2-retest-window',
    strategyVersion: 'v1.2-retest-window',
    label: 'Retest wait window calibration',
    candidateOnly: true,
    retestConfig: {
      maxRetestWaitCandles: 10,
    },
    changedParameters: {
      maxRetestWaitCandles: 10,
    },
    unchangedGates: [
      'stale/error data cannot generate LONG/SHORT',
      'AVOID remains blocked',
      'minimum proof gates unchanged',
    ],
  },
  {
    experimentId: 'v1.2-retest-tolerance',
    strategyVersion: 'v1.2-retest-tolerance',
    label: 'Retest tolerance calibration',
    candidateOnly: true,
    retestConfig: {
      retestTolerancePercent: 0.75,
      retestToleranceAtrMultiplier: 0.35,
    },
    changedParameters: {
      retestTolerancePercent: 0.75,
      retestToleranceAtrMultiplier: 0.35,
    },
    unchangedGates: [
      'confirmation still required',
      'RR hard floor remains enforced',
      'proof gates unchanged',
    ],
  },
  {
    experimentId: 'v1.2-atr-geometry',
    strategyVersion: 'v1.2-atr-geometry',
    label: 'ATR SL/TP geometry calibration',
    candidateOnly: true,
    signalLogic: {
      atrStopMultiplier: 1.35,
      tp1RTarget: 1.3,
      tp2RTarget: 2,
      rrTp1Min: 1.3,
      rrTp2Min: 2,
    },
    changedParameters: {
      atrStopMultiplier: 1.35,
      tp1RTarget: 1.3,
      tp2RTarget: 2,
    },
    unchangedGates: [
      'RR < 1.2 remains hard blocked',
      'max drawdown gate unchanged',
      'OOS/walk-forward gates unchanged',
    ],
  },
  {
    experimentId: 'v1.2-confirmation-close',
    strategyVersion: 'v1.2-confirmation-close',
    label: 'Confirmation close rule calibration',
    candidateOnly: true,
    retestConfig: {
      confirmationLevel: 'retestArea',
    },
    changedParameters: {
      confirmationCloseRule: 'close beyond retest area instead of breakout/breakdown level',
    },
    unchangedGates: [
      'no wick-only confirmation promotion without separate metrics',
      'no liveGate or paperGate eligibility',
      'proof gates unchanged',
    ],
  },
];

export const v13StrategyRedesignExperiments = [
  {
    experimentId: 'v1.3-trend-pullback-continuation',
    strategyVersion: 'v1.3-trend-pullback-continuation',
    label: 'Trend pullback continuation',
    candidateOnly: true,
    signalLogic: {
      ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
    },
    changedParameters: {
      strategyModel: 'trend pullback continuation instead of breakout/retest confirmation',
      entryTrigger: 'trend-aligned pullback into EMA/value zone followed by continuation candle',
      retestStateMachine: 'not required for this experiment',
      atrStopMultiplier: 1.45,
      tp1RTarget: 1.5,
      minVolumeRatio: 0.85,
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
];

export const v14QualityFilterExperiments = [
  {
    experimentId: 'v1.4-trend-strength-filter',
    strategyVersion: 'v1.4-trend-strength-filter',
    label: 'Trend strength quality filter',
    candidateOnly: true,
    signalLogic: {
      ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
      qualityFilters: {
        trendStrength: {
          enabled: true,
          ema20SlopeLookback: 8,
          minEma20SlopePercent: 0.12,
          minEma20Ema50SeparationPercent: 0.18,
        },
      },
    },
    changedParameters: {
      qualityFilter:
        'Require measurable EMA20 slope and EMA20/EMA50 separation before trend-pullback entry.',
    },
  },
  {
    experimentId: 'v1.4-htf-alignment-filter',
    strategyVersion: 'v1.4-htf-alignment-filter',
    label: 'Higher timeframe alignment quality filter',
    candidateOnly: true,
    signalLogic: {
      ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
      qualityFilters: {
        htfAlignment: {
          enabled: true,
          mapping: {
            '15m': '1h',
            '1h': '4h',
          },
        },
      },
    },
    changedParameters: {
      qualityFilter:
        'Require 15m entries to align with 1h trend and 1h entries to align with 4h trend when HTF data is available.',
    },
  },
  {
    experimentId: 'v1.4-volatility-regime-filter',
    strategyVersion: 'v1.4-volatility-regime-filter',
    label: 'Volatility regime quality filter',
    candidateOnly: true,
    signalLogic: {
      ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
      qualityFilters: {
        volatilityRegime: {
          enabled: true,
          minAtrPercentOfPrice: 0.18,
          maxAtrPercentOfPrice: 4.5,
          maxLastRangeAtrMultiple: 1.45,
        },
      },
    },
    changedParameters: {
      qualityFilter: 'Avoid ultra-low ATR regimes, extreme ATR regimes, and oversized trigger candles.',
    },
  },
  {
    experimentId: 'v1.4-chop-avoidance-filter',
    strategyVersion: 'v1.4-chop-avoidance-filter',
    label: 'Chop avoidance quality filter',
    candidateOnly: true,
    signalLogic: {
      ...BASE_V14_CHOP_SIGNAL_LOGIC,
    },
    changedParameters: {
      qualityFilter: 'Reject EMA compression, tight ATR ranges, and repeated neutral RSI conditions.',
    },
  },
  {
    experimentId: 'v1.4-impulse-quality-filter',
    strategyVersion: 'v1.4-impulse-quality-filter',
    label: 'Impulse quality filter',
    candidateOnly: true,
    signalLogic: {
      ...BASE_TREND_PULLBACK_SIGNAL_LOGIC,
      qualityFilters: {
        impulseQuality: {
          enabled: true,
          lookbackCandles: 10,
          minImpulseAtrMultiple: 1.8,
        },
      },
    },
    changedParameters: {
      qualityFilter: 'Require a directional impulse of at least ATR x 1.8 before accepting the pullback.',
    },
  },
].map((experiment) => ({
  ...experiment,
  unchangedGates: [...COMMON_UNCHANGED_GATES],
}));

export const v15ExitGeometryExperiments = [
  {
    experimentId: 'v1.5-exit-rr2-target',
    strategyVersion: 'v1.5-exit-rr2-target',
    label: 'Single full exit at runner target',
    candidateOnly: true,
    signalLogic: {
      ...BASE_V14_CHOP_SIGNAL_LOGIC,
    },
    exitGeometry: {
      mode: 'full-target',
      target: 'tp2',
    },
    changedParameters: {
      exitRule: 'Hold full position to TP2 instead of taking full profit at TP1.',
      expectedEffect: 'May increase average win above 1.5R, but can reduce win rate and allow more open profit to revert.',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v1.5-partial-tp-runner',
    strategyVersion: 'v1.5-partial-tp-runner',
    label: '50% TP1, 50% runner to TP2',
    candidateOnly: true,
    signalLogic: {
      ...BASE_V14_CHOP_SIGNAL_LOGIC,
    },
    exitGeometry: {
      mode: 'partial-runner',
      firstTarget: 'tp1',
      finalTarget: 'tp2',
      firstWeight: 0.5,
      moveStopToBreakevenAfterFirstTarget: true,
    },
    changedParameters: {
      exitRule: 'Take half at TP1, then let half run to TP2 with stop moved to breakeven after TP1.',
      expectedEffect: 'Should lift average win modestly while containing post-TP1 giveback.',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v1.5-breakeven-after-1r',
    strategyVersion: 'v1.5-breakeven-after-1r',
    label: 'Breakeven after +1R',
    candidateOnly: true,
    signalLogic: {
      ...BASE_V14_CHOP_SIGNAL_LOGIC,
    },
    exitGeometry: {
      mode: 'breakeven-after-1r',
      triggerR: 1,
      finalTarget: 'tp2',
    },
    changedParameters: {
      exitRule: 'Once price reaches +1R, move stop to entry and hold for TP2.',
      expectedEffect: 'Can reduce loss drag after early favorable movement, but may create more breakeven closures.',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v1.5-trailing-after-1r',
    strategyVersion: 'v1.5-trailing-after-1r',
    label: 'ATR trail after +1R',
    candidateOnly: true,
    signalLogic: {
      ...BASE_V14_CHOP_SIGNAL_LOGIC,
    },
    exitGeometry: {
      mode: 'trailing-after-1r',
      triggerR: 1,
      finalTarget: 'tp2',
      trailAtrMultiplier: 1,
    },
    changedParameters: {
      exitRule: 'After +1R, trail stop by 1 ATR from the best excursion while still allowing TP2 completion.',
      expectedEffect: 'Can extend winners beyond TP1 without forcing full giveback, at the cost of more path dependence.',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
];

const V16_BASE_EXPERIMENT = {
  candidateOnly: true,
  signalLogic: {
    ...BASE_V14_CHOP_SIGNAL_LOGIC,
  },
  exitGeometry: {
    mode: 'trailing-after-1r',
    triggerR: 1,
    finalTarget: 'tp2',
    trailAtrMultiplier: 1,
  },
  unchangedGates: [...COMMON_UNCHANGED_GATES],
};

export const v16RegimeFilterExperiments = [
  {
    ...V16_BASE_EXPERIMENT,
    experimentId: 'v1.6-impulse-filter-soft',
    strategyVersion: 'v1.6-impulse-filter-soft',
    label: 'Regime filter: soft impulse quality',
    regimeFilter: {
      enabled: true,
      filterId: 'impulse-filter-soft',
      minImpulseSizeAtr: 1,
      requiredFeatures: ['impulseSizeAtr'],
    },
    changedParameters: {
      baseExperiment: 'v1.5-trailing-after-1r',
      regimeFilter: 'Require impulseSizeAtr >= 1.0 before accepting an entry.',
      overfitRisk: 'medium',
    },
  },
  {
    ...V16_BASE_EXPERIMENT,
    experimentId: 'v1.6-impulse-filter-medium',
    strategyVersion: 'v1.6-impulse-filter-medium',
    label: 'Regime filter: medium impulse quality',
    regimeFilter: {
      enabled: true,
      filterId: 'impulse-filter-medium',
      minImpulseSizeAtr: 1.5,
      requiredFeatures: ['impulseSizeAtr'],
    },
    changedParameters: {
      baseExperiment: 'v1.5-trailing-after-1r',
      regimeFilter: 'Require impulseSizeAtr >= 1.5 before accepting an entry.',
      overfitRisk: 'medium-high',
    },
  },
  {
    ...V16_BASE_EXPERIMENT,
    experimentId: 'v1.6-low-volatility-filter',
    strategyVersion: 'v1.6-low-volatility-filter',
    label: 'Regime filter: low volatility only',
    regimeFilter: {
      enabled: true,
      filterId: 'low-volatility-filter',
      allowedVolatilityRegimes: ['LOW'],
      maxAtrPercentile: 0.25,
      requiredFeatures: ['volatilityRegime', 'atrPercentile'],
    },
    changedParameters: {
      baseExperiment: 'v1.5-trailing-after-1r',
      regimeFilter: 'Allow only LOW volatility regime / ATR percentile <= 0.25.',
      overfitRisk: 'high if sample falls below 50',
    },
  },
  {
    ...V16_BASE_EXPERIMENT,
    experimentId: 'v1.6-bearish-regime-filter',
    strategyVersion: 'v1.6-bearish-regime-filter',
    label: 'Regime filter: bearish trend regime',
    regimeFilter: {
      enabled: true,
      filterId: 'bearish-regime-filter',
      allowedTrendRegimes: ['BEARISH'],
      requiredFeatures: ['trendRegime'],
    },
    changedParameters: {
      baseExperiment: 'v1.5-trailing-after-1r',
      regimeFilter: 'Allow only entries whose objective trendRegime is BEARISH.',
      overfitRisk: 'high if it only preserves one market cluster',
    },
  },
  {
    ...V16_BASE_EXPERIMENT,
    experimentId: 'v1.6-combined-regime-filter',
    strategyVersion: 'v1.6-combined-regime-filter',
    label: 'Regime filter: combined objective regime',
    regimeFilter: {
      enabled: true,
      filterId: 'combined-regime-filter',
      minImpulseSizeAtr: 1,
      allowedVolatilityRegimes: ['LOW', 'NORMAL'],
      minTrendStrengthScore: 8,
      maxChopScore: 25,
      requiredFeatures: ['impulseSizeAtr', 'volatilityRegime', 'trendStrengthScore', 'chopScore'],
    },
    changedParameters: {
      baseExperiment: 'v1.5-trailing-after-1r',
      regimeFilter:
        'Require impulseSizeAtr >= 1.0, LOW/NORMAL volatility, trendStrengthScore >= 8, and chopScore <= 25.',
      overfitRisk: 'medium-high; included only because each component is objective and predeclared',
    },
  },
];

export const v2StrategyRedesignExperiments = [
  {
    experimentId: 'v2-liquidity-sweep-reclaim',
    strategyVersion: 'v2-liquidity-sweep-reclaim',
    label: 'Liquidity sweep and reclaim reversal',
    candidateOnly: true,
    status: 'NOT_READY',
    closedAt: '2026-05-03',
    closedReason: 'insufficient_sample_all_variants',
    bestResult: {
      pair: 'ETH/USDT',
      timeframe: '1h',
      trades: 23,
      winRate: 0.3913,
      expectancy: 0.1739,
      maxDD: 0.0394,
    },
    verdict: 'CANDIDATE_ONLY_NOT_PROMOTABLE',
    nextCandidate: 'v2-funding-oi-momentum',
    signalLogic: {
      strategyType: 'liquiditySweepReclaim',
      entryScore: 7,
      sweepLookback: 20,
      reclaimWindowCandles: 3,
      minSweepWickAtrMultiple: 0.4,
      minReclaimBodyToRange: 0.45,
      maxSweepRangeAtrMultiple: 2.5,
      stopBufferAtrMultiple: 0.15,
      maxSlAtrMultiple: 2.0,
      tp1RTarget: 2.0,
      tp2RTarget: 3.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2.5,
    },
    approvalScope: 'backtest-only',
    changedParameters: {
      strategyModel: 'liquidity sweep below support or above resistance followed by fast reclaim',
      entryTrigger: 'sweep wick through key level, reclaim close with meaningful body, and tight stop beyond sweep extreme',
      invalidation: 'stop beyond sweep low/high with ATR buffer; reject massive sweep candles, weak reclaims, wide stops, and poor RR',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2-breakout-volume-expansion',
    strategyVersion: 'v2-breakout-volume-expansion',
    label: 'Breakout after volume and volatility expansion',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.08,
      minBreakoutBodyAtrMultiple: 0.45,
      minBreakoutBodyToRange: 0.5,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.25,
      minRangeExpansionAtrMultiple: 1.05,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.8,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      strategyModel: 'breakout after recent compression with volume and volatility expansion',
      entryTrigger: 'close beyond recent range high/low with meaningful body, elevated volume, and true-range expansion',
      invalidation: 'ATR stop behind breakout candle/range boundary; reject weak body, rejection wick, exhaustion candle, and nearby opposing level',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2.1-breakout-close-buffer-soft',
    strategyVersion: 'v2.1-breakout-close-buffer-soft',
    label: 'Breakout close buffer soft calibration',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.04,
      minBreakoutBodyAtrMultiple: 0.45,
      minBreakoutBodyToRange: 0.5,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.25,
      minRangeExpansionAtrMultiple: 1.05,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.8,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      baseExperiment: 'v2-breakout-volume-expansion',
      minBreakoutCloseBeyondAtr: '0.08 -> 0.04',
      purpose: 'Measure whether strict close-beyond-range definition is suppressing otherwise clean breakouts.',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2.1-breakout-body-soft',
    strategyVersion: 'v2.1-breakout-body-soft',
    label: 'Breakout body quality soft calibration',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.08,
      minBreakoutBodyAtrMultiple: 0.35,
      minBreakoutBodyToRange: 0.42,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.25,
      minRangeExpansionAtrMultiple: 1.05,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.8,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      baseExperiment: 'v2-breakout-volume-expansion',
      minBreakoutBodyAtrMultiple: '0.45 -> 0.35',
      minBreakoutBodyToRange: '0.50 -> 0.42',
      purpose: 'Test whether body-quality thresholds are discarding acceptable directional breakouts.',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2.1-opposing-room-soft',
    strategyVersion: 'v2.1-opposing-room-soft',
    label: 'Opposing-level room soft calibration',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.08,
      minBreakoutBodyAtrMultiple: 0.45,
      minBreakoutBodyToRange: 0.5,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.25,
      minRangeExpansionAtrMultiple: 1.05,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.45,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      baseExperiment: 'v2-breakout-volume-expansion',
      minRoomToOpposingLevelPercent: '0.80 -> 0.45',
      purpose: 'Measure whether nearby opposing levels are over-blocking range breakouts after compression.',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2.1-volume-expansion-soft',
    strategyVersion: 'v2.1-volume-expansion-soft',
    label: 'Volume and range expansion soft calibration',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.08,
      minBreakoutBodyAtrMultiple: 0.45,
      minBreakoutBodyToRange: 0.5,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.1,
      minRangeExpansionAtrMultiple: 0.95,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.8,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      baseExperiment: 'v2-breakout-volume-expansion',
      minVolumeRatio: '1.25 -> 1.10',
      minRangeExpansionAtrMultiple: '1.05 -> 0.95',
      purpose: 'Check whether volume/range expansion definitions are too strict without removing expansion confirmation.',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v2.1-breakout-structure-balanced',
    strategyVersion: 'v2.1-breakout-structure-balanced',
    label: 'Balanced breakout structure calibration',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'breakoutVolumeExpansion',
      entryScore: 7,
      compressionLookback: 20,
      maxCompressionRangeAtrMultiple: 5.2,
      maxCompressionBodyMedianAtrMultiple: 0.75,
      minBreakoutCloseBeyondAtr: 0.05,
      minBreakoutBodyAtrMultiple: 0.4,
      minBreakoutBodyToRange: 0.5,
      maxRejectionWickToRange: 0.42,
      minVolumeRatio: 1.25,
      minRangeExpansionAtrMultiple: 1.05,
      maxExhaustionRangeAtrMultiple: 2.35,
      minRoomToOpposingLevelPercent: 0.8,
      atrStopMultiplier: 1.25,
      stopBufferAtrMultiple: 0.2,
      maxSlAtrMultiple: 2.4,
      tp1RTarget: 1.5,
      tp2RTarget: 2.5,
      rrTp1Min: 1.5,
      rrTp2Min: 2,
    },
    changedParameters: {
      baseExperiment: 'v2-breakout-volume-expansion',
      minBreakoutCloseBeyondAtr: '0.08 -> 0.05',
      minBreakoutBodyAtrMultiple: '0.45 -> 0.40',
      purpose: 'Conservative paired calibration of breakout definition only, without loosening room or expansion filters.',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
];

export const v3EdgeRedesignExperiments = [
  {
    experimentId: 'v3-session-breakout',
    strategyVersion: 'v3-session-breakout',
    label: 'Session open range breakout',
    candidateOnly: true,
    status: 'NOT_READY',
    closedAt: '2026-05-03',
    closedReason: 'false_breakout_rate_too_high',
    bestResult: {
      pair: 'BTC/USDT',
      timeframe: '1h',
      trades: 149,
      winRate: 0.3691,
      expectancy: 0.1074,
      maxDD: 0.1186,
      variant: 'retest-confirmation',
    },
    verdict: 'NOT_PROMOTABLE',
    mainBlocker: 'win_rate_below_45pct_all_variants',
    nextCandidate: 'v3-fair-value-gap',
    signalLogic: {
      strategyType: 'sessionBreakout',
      sessions: [
        { name: 'asia', startHour: 0, endHour: 4 },
        { name: 'london', startHour: 7, endHour: 11 },
        { name: 'ny', startHour: 13, endHour: 17 },
      ],
      orCandleCount: 4,
      minOrSizeAtr: 0.3,
      maxOrSizeAtr: 3.0,
      breakoutBufferRatio: 0.1,
      minVolumeRatio: 1.3,
      minBodyRatio: 0.5,
      stopBufferAtr: 0.2,
      tp1RTarget: 2.0,
      tp2RTarget: 3.5,
      rrMin: 1.8,
      entryScore: 6,
    },
    approvalScope: 'backtest-only',
    changedParameters: {
      strategyModel: 'session open range breakout with volume confirmation',
      entryTrigger: 'close beyond completed session opening range with buffer, elevated volume, and strong candle body',
      invalidation: 'stop beyond opposite side of opening range with ATR buffer; reject tiny/oversized opening ranges and weak breakouts',
      approvalScope: 'backtest-only; no paperGate or liveGate eligibility',
    },
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v3-fair-value-gap',
    strategyVersion: 'v3-fair-value-gap',
    label: 'Fair Value Gap fill reversal',
    candidateOnly: true,
    status: 'NOT_READY',
    closedAt: '2026-05-03',
    closedReason: 'fvg_fill_rate_too_low_win_rate_negative',
    bestResult: {
      pair: 'ETH/USDT',
      timeframe: '1h',
      trades: 123,
      winRate: 0.3252,
      expectancy: -0.0244,
      maxDD: 0.2099,
    },
    verdict: 'NOT_PROMOTABLE',
    mainBlocker: 'fvg_penetrated_not_filled_crypto_too_volatile',
    nextCandidate: 'v3-order-block',
    signalLogic: {
      strategyType: 'fairValueGap',
      fvgLookback: 50,
      minFvgSizeAtr: 0.3,
      maxFvgSizeAtr: 3.0,
      minCreationBodyRatio: 0.6,
      minCreationVolumeRatio: 1.5,
      maxFvgAgCandles: 30,
      stopBufferAtr: 0.2,
      tp1RTarget: 2.0,
      tp2RTarget: 3.5,
      rrMin: 1.8,
      entryScore: 6,
      emaFilter: true,
      rsiMin: 35,
      rsiMax: 65,
    },
    approvalScope: 'backtest-only',
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
  {
    experimentId: 'v3-order-block',
    strategyVersion: 'v3-order-block',
    label: 'Institutional order block reversal',
    candidateOnly: true,
    signalLogic: {
      strategyType: 'orderBlock',
      obLookback: 100,
      minObSizeAtr: 0.3,
      maxObSizeAtr: 2.5,
      minObBodyRatio: 0.4,
      minImpulseMoveAtr: 1.5,
      impulseWindowCandles: 3,
      maxObAgeCandles: 50,
      minTriggerBodyRatio: 0.4,
      minTriggerVolumeRatio: 0.8,
      stopBufferAtr: 0.15,
      tp1RTarget: 2.0,
      tp2RTarget: 4.0,
      rrMin: 1.8,
      entryScore: 6,
      rsiMin: 35,
      rsiMax: 65,
    },
    approvalScope: 'backtest-only',
    unchangedGates: [...COMMON_UNCHANGED_GATES],
  },
];

export function getBacktestOnlyStrategyExperiments() {
  return [
    ...v12AtrRetestCalibrationExperiments,
    ...v13StrategyRedesignExperiments,
    ...v14QualityFilterExperiments,
    ...v15ExitGeometryExperiments,
    ...v16RegimeFilterExperiments,
    ...v2StrategyRedesignExperiments,
    ...v3EdgeRedesignExperiments,
  ].map((experiment) => ({
    ...experiment,
    backtestOnly: true,
    liveGateEligible: false,
    paperGateEligible: false,
    experimentFamily: getExperimentFamily(experiment.experimentId),
  }));
}

export function getStrategyExperiment(experimentId) {
  if (!experimentId) {
    return null;
  }

  return getBacktestOnlyStrategyExperiments().find((experiment) => experiment.experimentId === experimentId) ?? null;
}
