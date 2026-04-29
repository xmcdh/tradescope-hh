import { confidenceMeta, buildSignalSetup } from './signalLogic';
import { formatPrice } from './indicators';

export function signalTone(signal) {
  if (signal === 'LONG') {
    return 'LONG';
  }

  if (signal === 'SHORT') {
    return 'SHORT';
  }

  if (signal === 'NO_TRADE') {
    return 'NO TRADE';
  }

  return 'WAIT';
}

function indicatorSummary(setup) {
  return setup.basis
    .map((item) => `${item.passed ? '✅' : '⚪'} ${item.label}`)
    .join('\n');
}

export function buildSignalText({ symbol, indicators, setup }) {
  const finalSetup = setup ?? buildSignalSetup(indicators);
  if (!finalSetup) {
    return '';
  }

  const meta = finalSetup.confidence ?? confidenceMeta(finalSetup.score);

  return [
    '🚨 TRADESCOPE SIGNAL',
    '',
    `Pair: ${symbol}/USDT`,
    `Type: ${signalTone(finalSetup.signal)} | Leverage: 20X`,
    `Confidence: ${meta.emoji} ${meta.label} (${finalSetup.score}/${finalSetup.scoreMax ?? 10})`,
    `Hard Block: ${finalSetup.hardBlock ?? 'None'}`,
    '',
    '📍 ENTRY ZONE:',
    `1) ${formatPrice(finalSetup.entry1)}`,
    `2) ${formatPrice(finalSetup.entry2)}`,
    '',
    '🎯 TARGETS:',
    `🥇 ${formatPrice(finalSetup.tp1)} (Close 80%)`,
    `🥈 ${formatPrice(finalSetup.tp2)} (Close 20%)`,
    '',
    `🛑 STOP LOSS: ${formatPrice(finalSetup.sl)}`,
    '',
    '📊 Basis:',
    indicatorSummary(finalSetup),
    '',
    '⚠️ Personal analysis only. Not financial advice.',
  ].join('\n');
}
