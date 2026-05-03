export const RETEST_FAILURE_BUCKETS = {
  MARGINAL_SCORE: 'confirmation candle became MARGINAL due to score',
  BLOCKED_RR: 'confirmation candle became BLOCKED due to RR',
  BLOCKED_TREND_CONFLICT: 'confirmation candle became BLOCKED due to trend conflict',
  BLOCKED_INVALID_LEVELS: 'confirmation candle became BLOCKED due to invalid levels',
  MISSING_TRADE_LEVELS: 'confirmation candle had missing trade levels',
  NO_EXECUTABLE_DIRECTION: 'confirmation candle had no executable direction',
  OTHER: 'other',
};

function toIso(timestamp) {
  return Number.isFinite(Number(timestamp)) ? new Date(Number(timestamp)).toISOString() : null;
}

function hasAnyReason(texts, patterns) {
  const joined = texts.filter(Boolean).join(' | ').toLowerCase();
  return patterns.some((pattern) => joined.includes(pattern));
}

export function classifyRetestFailure({ pending = {}, confirmationSignal = {} } = {}) {
  const blockedReasons = Array.isArray(confirmationSignal.blockedReason) ? confirmationSignal.blockedReason : [];
  const rejectionReasons = Array.isArray(confirmationSignal.rejectionReasons) ? confirmationSignal.rejectionReasons : [];
  const warnings = Array.isArray(confirmationSignal.warnings) ? confirmationSignal.warnings : [];
  const reasonText = [
    pending.tradeActionabilityReason,
    confirmationSignal.rrWarning,
    confirmationSignal.levelWarning,
    confirmationSignal.hardBlock,
    ...blockedReasons,
    ...rejectionReasons,
    ...warnings,
  ];

  if (confirmationSignal.missingTradeLevels) {
    return RETEST_FAILURE_BUCKETS.MISSING_TRADE_LEVELS;
  }

  if (!['LONG', 'SHORT', 'WAIT', 'WAIT_RETEST', 'NO_TRADE'].includes(confirmationSignal.signal)) {
    return RETEST_FAILURE_BUCKETS.NO_EXECUTABLE_DIRECTION;
  }

  if (confirmationSignal.signalValidity === 'MARGINAL') {
    return RETEST_FAILURE_BUCKETS.MARGINAL_SCORE;
  }

  if (confirmationSignal.signalValidity === 'BLOCKED') {
    if (hasAnyReason(reasonText, ['rr', 'r:r', 'risk', 'reward'])) {
      return RETEST_FAILURE_BUCKETS.BLOCKED_RR;
    }

    if (hasAnyReason(reasonText, ['support', 'resistance', 'level', 'missing sl', 'invalid'])) {
      return RETEST_FAILURE_BUCKETS.BLOCKED_INVALID_LEVELS;
    }

    if (hasAnyReason(reasonText, ['trend', 'macd', 'rsi', 'choppy', 'breakout/retest failed'])) {
      return RETEST_FAILURE_BUCKETS.BLOCKED_TREND_CONFLICT;
    }

    return RETEST_FAILURE_BUCKETS.OTHER;
  }

  if (!['LONG', 'SHORT'].includes(confirmationSignal.signal)) {
    return RETEST_FAILURE_BUCKETS.NO_EXECUTABLE_DIRECTION;
  }

  return RETEST_FAILURE_BUCKETS.OTHER;
}

function buildSignalIndex(signals = []) {
  return new Map((Array.isArray(signals) ? signals : []).map((signal) => [signal.timestamp, signal]));
}

export function buildRetestAudit(resultPayload, options = {}) {
  const backtest = resultPayload?.backtest ?? resultPayload;
  const metadata = resultPayload?.metadata ?? {};
  const pair = options.pair ?? metadata.pair ?? backtest?.pair ?? null;
  const timeframe = options.timeframe ?? metadata.timeframe ?? backtest?.timeframe ?? null;
  const signalsByTimestamp = buildSignalIndex(backtest?.signals);
  const confirmedRetests = (backtest?.retestDiagnostics ?? []).filter((item) => item.status === 'CONFIRMED');
  const breakdown = Object.fromEntries(Object.values(RETEST_FAILURE_BUCKETS).map((bucket) => [bucket, 0]));

  const cases = confirmedRetests.map((pending) => {
    const confirmationSignal = signalsByTimestamp.get(pending.confirmationTimestamp) ?? {};
    const failureBucket = classifyRetestFailure({ pending, confirmationSignal });
    breakdown[failureBucket] += 1;

    return {
      pendingRetestId: pending.id,
      pair,
      timeframe,
      originalWaitRetestTimestamp: pending.createdAt,
      originalWaitRetestTime: toIso(pending.createdAt),
      confirmationTimestamp: pending.confirmationTimestamp,
      confirmationTime: toIso(pending.confirmationTimestamp),
      directionBias: pending.direction ?? confirmationSignal.selectedDirection ?? confirmationSignal.direction ?? null,
      retestLevel: pending.retestArea ?? null,
      breakoutLevel: pending.breakoutLevel ?? null,
      entryCandidate: pending.entryCandidate ?? confirmationSignal.entry ?? confirmationSignal.entryPrice ?? null,
      atr: pending.atr ?? confirmationSignal.atr ?? null,
      sl: pending.slPrice ?? confirmationSignal.sl ?? confirmationSignal.stopLoss ?? confirmationSignal.slPrice ?? null,
      tp1: pending.tp1Price ?? confirmationSignal.tp ?? confirmationSignal.takeProfit ?? confirmationSignal.tp1Price ?? null,
      tp2: pending.tp2Price ?? confirmationSignal.tp2Price ?? null,
      rrRatio: pending.rrRatio ?? confirmationSignal.rr ?? confirmationSignal.rrRatio ?? null,
      signalValidityBeforeConfirmation: pending.signalValidity ?? null,
      signalValidityOnConfirmation: confirmationSignal.signalValidity ?? pending.confirmationSignalValidity ?? null,
      signalOnConfirmation: confirmationSignal.signal ?? pending.confirmationSignal ?? null,
      score: confirmationSignal.score ?? confirmationSignal.confidenceScore ?? null,
      confidenceScore: confirmationSignal.confidenceScore ?? confirmationSignal.score ?? null,
      blockedReason: Array.isArray(confirmationSignal.blockedReason) ? confirmationSignal.blockedReason : [],
      rrWarning: confirmationSignal.rrWarning ?? null,
      levelWarning: confirmationSignal.levelWarning ?? null,
      hardBlockReason: confirmationSignal.hardBlock ?? null,
      rejectionReasons: Array.isArray(confirmationSignal.rejectionReasons) ? confirmationSignal.rejectionReasons : [],
      exactReasonTradeWasNotOpened:
        pending.tradeActionabilityReason ??
        confirmationSignal.actionabilityReason ??
        'Retest confirmed, but no actionable trade record was opened.',
      failureBucket,
      actionableOnCreate: pending.actionableOnCreate ?? false,
      becameActionableTrade: pending.becameActionableTrade ?? false,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    pair,
    timeframe,
    strategyVersion: metadata.strategyVersion ?? backtest?.strategyVersion ?? null,
    source: options.source ?? null,
    summary: {
      confirmedRetestCount: cases.length,
      openedTradeCount: cases.filter((item) => item.becameActionableTrade).length,
      failureBreakdown: breakdown,
      dominantFailureReason:
        Object.entries(breakdown)
          .filter(([, count]) => count > 0)
          .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
    },
    cases,
  };
}

function formatValue(value) {
  if (value == null) {
    return '--';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(value);
}

export function retestAuditToMarkdown(audit) {
  const lines = [
    `# Retest Audit: ${audit.pair} ${audit.timeframe}`,
    '',
    `Generated at: ${audit.generatedAt}`,
    `Source: ${audit.source ? `\`${audit.source}\`` : '--'}`,
    `Strategy version: ${audit.strategyVersion ?? '--'}`,
    '',
    '## Summary',
    `- Confirmed retests: ${audit.summary.confirmedRetestCount}`,
    `- Trades opened from confirmed retests: ${audit.summary.openedTradeCount}`,
    `- Dominant failure reason: ${audit.summary.dominantFailureReason ?? '--'}`,
    '',
    '## Failure Breakdown',
    ...Object.entries(audit.summary.failureBreakdown).map(([reason, count]) => `- ${reason}: ${count}`),
    '',
    '## Confirmed Retest Cases',
  ];

  for (const item of audit.cases) {
    lines.push(
      '',
      `### ${item.originalWaitRetestTime} -> ${item.confirmationTime}`,
      `- Direction bias: ${item.directionBias ?? '--'}`,
      `- Retest level: ${formatValue(item.retestLevel)}`,
      `- Breakout level: ${formatValue(item.breakoutLevel)}`,
      `- Entry candidate: ${formatValue(item.entryCandidate)}`,
      `- ATR: ${formatValue(item.atr)}`,
      `- SL / TP1 / TP2: ${formatValue(item.sl)} / ${formatValue(item.tp1)} / ${formatValue(item.tp2)}`,
      `- RR ratio: ${formatValue(item.rrRatio)}`,
      `- Validity before confirmation: ${item.signalValidityBeforeConfirmation ?? '--'}`,
      `- Confirmation signal / validity: ${item.signalOnConfirmation ?? '--'} / ${item.signalValidityOnConfirmation ?? '--'}`,
      `- Score / confidenceScore: ${formatValue(item.score)} / ${formatValue(item.confidenceScore)}`,
      `- Blocked reason: ${item.blockedReason.length ? item.blockedReason.join(' | ') : 'none'}`,
      `- RR warning: ${item.rrWarning ?? 'none'}`,
      `- Level warning: ${item.levelWarning ?? 'none'}`,
      `- Hard block reason: ${item.hardBlockReason ?? 'none'}`,
      `- Failure bucket: ${item.failureBucket}`,
      `- Exact reason trade was not opened: ${item.exactReasonTradeWasNotOpened}`,
    );
  }

  return `${lines.join('\n')}\n`;
}
