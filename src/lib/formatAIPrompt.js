import { formatPrice } from './indicators';

function trendLine(price, value, label) {
  if (!Number.isFinite(price) || !Number.isFinite(value)) {
    return `- ${label}: data belum siap`;
  }

  return `- ${label}: ${formatPrice(value)} → Harga ${price >= value ? 'DI ATAS' : 'DI BAWAH'} ${label} ${price >= value ? '✅' : '⚠️'}`;
}

function describeRsi(rsi) {
  if (!Number.isFinite(rsi)) {
    return 'data belum siap';
  }

  if (rsi >= 70) {
    return 'overbought, rawan pullback';
  }

  if (rsi >= 55) {
    return 'momentum bullish, belum overbought';
  }

  if (rsi <= 30) {
    return 'oversold, rawan rebound';
  }

  if (rsi <= 45) {
    return 'momentum bearish, belum oversold';
  }

  return 'netral';
}

function describeMacd(macd) {
  if (!macd) {
    return 'data belum siap';
  }

  if (macd.macd > macd.signal && macd.histogram > 0) {
    return 'Bullish cross, histogram positif ✅';
  }

  if (macd.macd < macd.signal && macd.histogram < 0) {
    return 'Bearish cross, histogram negatif ✅';
  }

  return 'sinyal campuran ⚠️';
}

function yesNo(value) {
  return value ? 'YA ✅' : 'TIDAK';
}

export function buildAIPrompt({ symbol, exchange, timeframe, indicators, setup, mode }) {
  if (!indicators || !setup) {
    return '';
  }

  const supportDistance =
    indicators.support > 0 ? ((indicators.price - indicators.support) / indicators.support) * 100 : null;
  const isNearSupport = Number.isFinite(supportDistance) ? supportDistance <= 1.5 : false;

  return [
    'Analisis setup trading crypto futures berikut dan beri pendapatmu:',
    '',
    `Pair: ${symbol}/USDT (${exchange} ${mode === 'polling' ? 'Polling' : 'Real-time'})`,
    `Timeframe: ${timeframe}`,
    `Harga sekarang: ${formatPrice(indicators.price)}`,
    '',
    '📊 Indikator Teknikal:',
    trendLine(indicators.price, indicators.ema20, 'EMA20'),
    trendLine(indicators.price, indicators.ema50, 'EMA50'),
    trendLine(indicators.price, indicators.ema200, 'EMA200'),
    `- RSI(14): ${indicators.rsi?.toFixed(1) ?? '-'} → ${describeRsi(indicators.rsi)} ${indicators.rsi >= 55 && indicators.rsi < 70 ? '✅' : ''}`.trim(),
    `- MACD: ${describeMacd(indicators.macd)}`,
    `- Volume: ${indicators.volumeSpike ? `Spike terdeteksi (${(indicators.currentVolume / Math.max(indicators.averageVolume, 1)).toFixed(1)}x rata-rata) ✅` : 'Normal ⚪'}`,
    '',
    '📍 Level Kunci:',
    `- Support: ${formatPrice(indicators.support)}`,
    `- Resistance: ${formatPrice(indicators.resistance)}`,
    `- Harga dekat support: ${yesNo(isNearSupport)}`,
    '',
    '🎯 Setup yang terdeteksi:',
    `- Signal: ${setup.signal}`,
    `- Confidence: ${setup.score}/3 (${setup.confidence.label})`,
    `- Entry Zone: ${formatPrice(setup.entry1)} / ${formatPrice(setup.entry2)}`,
    `- TP1: ${formatPrice(setup.tp1)}`,
    `- TP2: ${formatPrice(setup.tp2)}`,
    `- Stop Loss: ${formatPrice(setup.sl)}`,
    '',
    'Pertanyaan:',
    '1. Apakah setup ini valid secara teknikal?',
    '2. Ada risiko yang perlu diperhatikan?',
    '3. Level entry mana yang lebih aman?',
    '4. Saran manajemen posisi?',
    '',
    'Jawab singkat dan objektif. Ini untuk analisis pribadi.',
  ].join('\n');
}
