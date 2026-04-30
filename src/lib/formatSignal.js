import { confidenceMeta, buildSignalSetup } from './signalLogic';
import { formatPrice } from './indicators';

export function signalTone(signal) {
  if (signal === 'LONG') {
    return 'LONG';
  }

  if (signal === 'SHORT') {
    return 'SHORT';
  }

  if (signal === 'AVOID') {
    return 'AVOID';
  }

  if (signal === 'NO_TRADE') {
    return 'NO_TRADE';
  }

  return signal === 'WAIT_RETEST' ? 'WAIT_RETEST' : 'WAIT';
}

function pairLabel(symbol) {
  return `${String(symbol).replace(/USDT$/i, '')}/USDT`;
}

function basisSummary(setup) {
  return (setup.basis ?? [])
    .filter((item) => !['btc', 'fundingOi'].includes(item.key))
    .map((item) => `${item.passed ? '✅' : '⚪'} ${item.label}`)
    .join('\n');
}

function reasons(setup) {
  const items = setup.rejectionReasons?.length ? setup.rejectionReasons : setup.warnings ?? [];
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- No clear technical edge';
}

function scoreLine(setup) {
  return `${setup.score}/${setup.scoreMax ?? 10}`;
}

function waitText(symbol, setup, timeframe) {
  const watch = setup.watchLevels ?? {};
  return [
    '⏳ TRADESCOPE WAIT',
    '',
    `Pair: ${pairLabel(symbol)}`,
    `Timeframe: ${timeframe}`,
    `Status: ${signalTone(setup.signal)}`,
    `Score: ${scoreLine(setup)}`,
    `Market Regime: ${setup.marketRegime ?? '-'}`,
    '',
    'No entry yet.',
    '',
    'Watch:',
    `- Breakout level: ${formatPrice(watch.breakoutLevel)}`,
    `- Retest area: ${formatPrice(watch.retestArea)}`,
    `- Invalidation: ${formatPrice(watch.invalidation)}`,
    '',
    'Action:',
    setup.action ?? 'Wait for candle close confirmation before considering entry.',
    '',
    'Personal analysis only. Not financial advice.',
  ].join('\n');
}

function noTradeText(symbol, setup, timeframe) {
  return [
    setup.signal === 'AVOID' ? '🚫 TRADESCOPE AVOID' : '🚫 TRADESCOPE NO_TRADE',
    '',
    `Pair: ${pairLabel(symbol)}`,
    `Timeframe: ${timeframe}`,
    `Status: ${setup.marketRegime ?? signalTone(setup.signal)}`,
    `Score: ${scoreLine(setup)}`,
    '',
    'No entry recommended.',
    '',
    setup.signal === 'AVOID' ? 'Why avoid:' : 'Why no trade:',
    reasons(setup),
    '',
    'Action:',
    setup.action ?? 'Wait for breakout, retest, or stronger trend confirmation.',
    '',
    'Personal analysis only. Not financial advice.',
  ].join('\n');
}

function tradeText(symbol, setup, timeframe) {
  const meta = setup.confidence ?? confidenceMeta(setup.score);
  const directionWord = setup.signal === 'LONG' ? 'below' : 'above';

  return [
    '🚨 TRADESCOPE FUTURES SETUP',
    '',
    `Pair: ${pairLabel(symbol)}`,
    `Timeframe: ${timeframe}`,
    `Type: ${setup.signal}`,
    `Confidence: ${meta.label}`,
    `Score: ${scoreLine(setup)}`,
    'Leverage Suggestion: 5x - 10x',
    '',
    '📍 ENTRY ZONE:',
    `1) Entry: ${formatPrice(setup.entry1)}`,
    `2) Pullback: ${formatPrice(setup.entry2)}`,
    '',
    '🎯 TARGETS:',
    `TP1: ${formatPrice(setup.tp1)}`,
    `TP2: ${formatPrice(setup.tp2)}`,
    '',
    '🛑 STOP LOSS:',
    `SL: ${formatPrice(setup.sl)}`,
    `ATR: ${formatPrice(setup.atr)}`,
    `R:R TP1: ${Number.isFinite(setup.rrRatio) ? `${setup.rrRatio.toFixed(2)}:1` : '--'}`,
    setup.rrWarning ? `RR Warning: ${setup.rrWarning}` : '',
    setup.levelWarning ? `Level Warning: ${setup.levelWarning}` : '',
    '',
    '📊 Basis Setup:',
    basisSummary(setup),
    '',
    '⚠️ Invalid if:',
    `- 15m candle closes ${directionWord} invalidation level`,
    '- BTC moves strongly against setup',
    '- Breakout/retest fails',
    '',
    '📌 Management:',
    '- Use max 0.5%-1% risk per trade',
    '- Close 60%-80% at TP1',
    '- Move SL to breakeven after TP1',
    '- Do not add if invalidated',
    '',
    'Personal analysis only. Not financial advice.',
  ].join('\n');
}

export function buildSignalText({ symbol, indicators, setup, timeframe = indicators?.timeframe ?? '15m' }) {
  const finalSetup = setup ?? buildSignalSetup(indicators);
  if (!finalSetup) {
    return '';
  }

  if (['LONG', 'SHORT'].includes(finalSetup.signal)) {
    return tradeText(symbol, finalSetup, timeframe);
  }

  if (['WAIT', 'WAIT_RETEST'].includes(finalSetup.signal)) {
    return waitText(symbol, finalSetup, timeframe);
  }

  return noTradeText(symbol, finalSetup, timeframe);
}
