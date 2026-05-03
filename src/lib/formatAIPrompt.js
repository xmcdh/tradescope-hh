import { formatPrice } from './indicators';

function lineValue(label, value) {
  return `${label}: ${value}`;
}

function macdValue(macd) {
  if (!macd) {
    return 'data unavailable';
  }

  return `${Number(macd.MACD).toFixed(6)} / signal ${Number(macd.signal).toFixed(6)}`;
}

function scoreBreakdown(setup) {
  const technical = (setup.scoreBreakdown?.items ?? [])
    .map((item) => `- ${item.label}: +${item.points}/${item.max} (${item.reason})`)
    .join('\n');
  const adjustments = (setup.scoreBreakdown?.adjustments ?? [])
    .map((item) => `- ${item.label}: ${item.points > 0 ? '+' : ''}${item.points} (${item.reason})`)
    .join('\n');

  return [technical, adjustments ? 'Adjustments:' : '', adjustments].filter(Boolean).join('\n');
}

function rrLine(setup) {
  return `TP1 ${Number.isFinite(setup.rrTp1) ? setup.rrTp1.toFixed(2) : '--'}, TP2 ${
    Number.isFinite(setup.rrTp2) ? setup.rrTp2.toFixed(2) : '--'
  }`;
}

function commonData({ symbol, exchange, timeframe, indicators, setup, mode }) {
  return [
    lineValue('Pair', `${symbol}/USDT (${exchange} ${mode === 'polling' ? 'Polling via proxy' : mode})`),
    lineValue('Timeframe', timeframe),
    lineValue('Harga', formatPrice(indicators.price)),
    lineValue('EMA20', formatPrice(indicators.ema20)),
    lineValue('EMA50', formatPrice(indicators.ema50)),
    lineValue('EMA200', formatPrice(indicators.ema200)),
    lineValue('RSI', Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(1) : '-'),
    lineValue('MACD', macdValue(indicators.macd)),
    lineValue('Histogram', Number.isFinite(indicators.macd?.histogram) ? indicators.macd.histogram.toFixed(6) : '-'),
    lineValue('Volume', `${indicators.currentVolume ?? '-'} / avg20 ${indicators.averageVolume ?? '-'}`),
    lineValue('ATR', formatPrice(indicators.atr)),
    lineValue('Support', formatPrice(indicators.support)),
    lineValue('Resistance', formatPrice(indicators.resistance)),
    lineValue('Funding rate', Number.isFinite(setup.fundingRate) ? `${(setup.fundingRate * 100).toFixed(4)}%` : '-'),
    lineValue('Open interest', Number.isFinite(setup.openInterest) ? setup.openInterest : '-'),
    lineValue('BTC confirmation', `${setup.btcBias ?? '-'} (${setup.btcAdjustment ?? 0})`),
    lineValue('Market regime', setup.marketRegime ?? '-'),
    'Score breakdown:',
    scoreBreakdown(setup),
  ].join('\n');
}

function tradePrompt(args) {
  const { setup } = args;

  return [
    'Analisis setup futures berikut secara objektif.',
    'Jangan memaksakan sinyal.',
    'Jika setup lemah, jawab WAIT atau NO_TRADE.',
    '',
    'Data:',
    commonData(args),
    lineValue('Entry', formatPrice(setup.entry1)),
    lineValue('SL', formatPrice(setup.sl)),
    lineValue('TP1', formatPrice(setup.tp1)),
    lineValue('TP2', formatPrice(setup.tp2)),
    lineValue('RR', rrLine(setup)),
    '',
    'Setup terdeteksi:',
    lineValue('Type', setup.signal),
    lineValue('Confidence', setup.confidence?.label ?? '-'),
    lineValue('Score', `${setup.score}/${setup.scoreMax ?? 10}`),
    '',
    'Tolong jawab:',
    '1. Apakah setup valid?',
    '2. Apakah entry terlalu telat?',
    '3. Apakah RR layak?',
    '4. Apa risiko invalidasi?',
    '5. Entry mana yang paling aman?',
    '6. Apakah lebih baik entry sekarang, tunggu retest, atau NO_TRADE?',
    '7. Saran manajemen posisi.',
    '',
    'Gunakan jawaban singkat, objektif, konservatif.',
  ].join('\n');
}

function noTradePrompt(args) {
  const { setup } = args;
  const rejectionReasons = setup.rejectionReasons?.length
    ? setup.rejectionReasons.map((item) => `- ${item}`).join('\n')
    : '- No clear technical edge';

  return [
    'Analisis kondisi market berikut.',
    `Sistem mendeteksi ${setup.signal === 'AVOID' ? 'AVOID' : 'NO_TRADE'}.`,
    'Jangan membuat sinyal entry kecuali ada alasan teknikal yang sangat kuat.',
    '',
    'Data:',
    commonData(args),
    'Rejection reasons:',
    rejectionReasons,
    '',
    'Tolong jawab:',
    '1. Apakah NO_TRADE ini sudah tepat?',
    '2. Faktor utama yang membuat setup tidak valid?',
    '3. Level apa yang harus ditunggu agar setup berubah menjadi LONG atau SHORT?',
    '4. Apa kondisi konfirmasi yang dibutuhkan?',
    '5. Risiko jika memaksakan entry sekarang?',
    '',
    'Jawab singkat, objektif, dan konservatif.',
  ].join('\n');
}

function waitPrompt(args) {
  const { setup } = args;
  const watch = setup.watchLevels ?? {};

  return [
    'Analisis kondisi futures berikut.',
    `Sistem mendeteksi ${setup.signal}.`,
    'Jangan memberi entry eksekusi sebelum konfirmasi candle close/retest valid.',
    '',
    'Data:',
    commonData(args),
    lineValue('Watch breakout level', formatPrice(watch.breakoutLevel)),
    lineValue('Watch retest area', formatPrice(watch.retestArea)),
    lineValue('Watch invalidation', formatPrice(watch.invalidation)),
    '',
    'Tolong jawab:',
    '1. Apakah WAIT ini konservatif dan tepat?',
    '2. Konfirmasi apa yang dibutuhkan agar setup valid?',
    '3. Level mana yang harus diawasi?',
    '4. Apa risiko jika entry sekarang?',
    '5. Apakah lebih baik tunggu retest atau NO_TRADE?',
    '',
    'Jawab singkat, objektif, dan konservatif.',
  ].join('\n');
}

export function buildAIPrompt(args) {
  if (!args.indicators || !args.setup) {
    return '';
  }

  if (['LONG', 'SHORT'].includes(args.setup.signal)) {
    return tradePrompt(args);
  }

  if (['WAIT', 'WAIT_RETEST'].includes(args.setup.signal)) {
    return waitPrompt(args);
  }

  return noTradePrompt(args);
}
