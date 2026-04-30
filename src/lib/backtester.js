import { calculateIndicators } from './indicators.js';
import { buildSignalSetup } from './signalLogic.js';

export const DEFAULT_MIN_LOOKBACK = 200;
const EXECUTABLE_SIGNALS = new Set(['LONG', 'SHORT']);
const CLOSED_OUTCOMES = new Set(['WIN', 'LOSS']);

function toSeconds(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

export function timeframeToMs(timeframe) {
  const match = String(timeframe ?? '').trim().match(/^(\d+)(m|h|d|w)$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000,
    w: 7 * 24 * 60 * 60_000,
  };

  return value * multipliers[unit];
}

function normalizeCandle(candle) {
  if (Array.isArray(candle)) {
    const [timestamp, open, high, low, close, volume] = candle;
    return {
      time: toSeconds(Number(timestamp)),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume ?? 0),
    };
  }

  const timestamp = candle.time ?? candle.timestamp ?? candle.openTime;
  return {
    time: toSeconds(Number(timestamp)),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume ?? 0),
  };
}

export function normalizeCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .map(normalizeCandle)
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .sort((left, right) => left.time - right.time);
}

export function validateCandleIntegrity(candles, timeframe, options = {}) {
  const minLookback = Math.max(DEFAULT_MIN_LOOKBACK, options.minLookback ?? DEFAULT_MIN_LOOKBACK);
  const timeframeMs = timeframeToMs(timeframe);
  const normalizedCandles = normalizeCandles(candles);
  const issues = [];
  const duplicateTimestamps = [];
  const missingCandles = [];
  let outOfOrderCount = 0;

  const rawList = Array.isArray(candles) ? candles : [];
  for (let index = 1; index < rawList.length; index += 1) {
    const current = normalizeCandle(rawList[index]);
    const previous = normalizeCandle(rawList[index - 1]);
    if (Number.isFinite(current.time) && Number.isFinite(previous.time) && current.time < previous.time) {
      outOfOrderCount += 1;
    }
  }

  for (let index = 1; index < normalizedCandles.length; index += 1) {
    const previous = normalizedCandles[index - 1];
    const current = normalizedCandles[index];
    if (current.time === previous.time) {
      duplicateTimestamps.push(current.time * 1000);
      continue;
    }

    if (timeframeMs) {
      const deltaMs = (current.time - previous.time) * 1000;
      if (deltaMs > timeframeMs) {
        missingCandles.push({
          from: previous.time * 1000,
          to: current.time * 1000,
          missing: Math.max(1, Math.round(deltaMs / timeframeMs) - 1),
        });
      }
    }
  }

  if (outOfOrderCount > 0) {
    issues.push(`OUT_OF_ORDER_CANDLES (${outOfOrderCount})`);
  }

  if (duplicateTimestamps.length) {
    issues.push(`DUPLICATE_TIMESTAMPS (${duplicateTimestamps.length})`);
  }

  if (missingCandles.length) {
    issues.push(`MISSING_CANDLES (${missingCandles.length} gaps)`);
  }

  if (normalizedCandles.length < minLookback) {
    issues.push(`INSUFFICIENT_LOOKBACK (${normalizedCandles.length}/${minLookback})`);
  }

  return {
    normalizedCandles,
    valid: issues.length === 0,
    issues,
    summary: {
      timeframeMs,
      candleCount: normalizedCandles.length,
      duplicateCount: duplicateTimestamps.length,
      missingGapCount: missingCandles.length,
      outOfOrderCount,
      minLookback,
    },
    details: {
      duplicateTimestamps,
      missingCandles,
    },
  };
}

function signalRecord({ candle, pair, timeframe, setup }) {
  return {
    timestamp: candle.time * 1000,
    pair,
    timeframe,
    signal: setup?.signal ?? 'NO_SIGNAL',
    score: setup?.score ?? 0,
    confidenceScore: setup?.confidenceScore ?? setup?.score ?? 0,
    signalValidity: setup?.signalValidity ?? 'MARGINAL',
    blockedReason: Array.isArray(setup?.blockedReason) ? setup.blockedReason : [],
    entry: setup?.entry1 ?? null,
    sl: setup?.sl ?? null,
    tp: setup?.tp1 ?? null,
    rr: setup?.rr ?? setup?.rrRatio ?? null,
  };
}

function directionR({ signal, entry, exit, risk }) {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(risk) || risk <= 0) {
    return 0;
  }

  return signal === 'LONG' ? (exit - entry) / risk : (entry - exit) / risk;
}

export function simulateTradeOutcome(signal, futureCandles, options = {}) {
  const sameCandlePolicy = options.sameCandlePolicy ?? 'sl-first';
  const entry = Number(signal.entry);
  const sl = Number(signal.sl);
  const tp = Number(signal.tp);
  const rr = Number(signal.rr);

  if (!EXECUTABLE_SIGNALS.has(signal.signal) || !Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
    return null;
  }

  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) {
    return null;
  }

  for (const candle of futureCandles) {
    const hitTp = signal.signal === 'LONG' ? candle.high >= tp : candle.low <= tp;
    const hitSl = signal.signal === 'LONG' ? candle.low <= sl : candle.high >= sl;

    if (hitTp && hitSl) {
      const conservativeStop = sameCandlePolicy === 'sl-first';
      return {
        outcome: conservativeStop ? 'LOSS' : 'WIN',
        exit: conservativeStop ? sl : tp,
        exitTimestamp: candle.time * 1000,
        r: conservativeStop ? -1 : Number.isFinite(rr) ? rr : directionR({ signal: signal.signal, entry, exit: tp, risk }),
      };
    }

    if (hitSl) {
      return {
        outcome: 'LOSS',
        exit: sl,
        exitTimestamp: candle.time * 1000,
        r: -1,
      };
    }

    if (hitTp) {
      return {
        outcome: 'WIN',
        exit: tp,
        exitTimestamp: candle.time * 1000,
        r: Number.isFinite(rr) ? rr : directionR({ signal: signal.signal, entry, exit: tp, risk }),
      };
    }
  }

  const last = futureCandles.at(-1);
  if (!last) {
    return {
      outcome: 'OPEN',
      exit: null,
      exitTimestamp: null,
      r: 0,
    };
  }

  const r = directionR({ signal: signal.signal, entry, exit: last.close, risk });
  return {
    outcome: r >= 0 ? 'OPEN_WIN' : 'OPEN_LOSS',
    exit: last.close,
    exitTimestamp: last.time * 1000,
    r,
  };
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) {
    return 0;
  }

  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function maxDrawdownAbsolute(returns) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;

  returns.forEach((value) => {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  });

  return drawdown;
}

function maxDrawdownRatio(returns) {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;

  returns.forEach((value) => {
    equity *= 1 + value * 0.01;
    peak = Math.max(peak, equity);
    if (peak > 0) {
      drawdown = Math.max(drawdown, (peak - equity) / peak);
    }
  });

  return drawdown;
}

function profitFactorFromReturns(returns) {
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (grossLoss === 0) {
    return grossProfit > 0 ? Infinity : 0;
  }
  return grossProfit / grossLoss;
}

function buildTradeMetrics(trades) {
  const closedTrades = trades.filter((trade) => CLOSED_OUTCOMES.has(trade.outcome));
  const returns = closedTrades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = closedTrades.filter((trade) => trade.outcome === 'WIN').length;
  const avgR = mean(returns);
  const std = standardDeviation(returns);
  const profitFactor = profitFactorFromReturns(returns);

  return {
    totalTrades: trades.length,
    closedTradeCount: closedTrades.length,
    openTradeCount: trades.length - closedTrades.length,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
    expectancy: avgR,
    avgR,
    maxDrawdown: maxDrawdownAbsolute(returns),
    maxDrawdownPct: maxDrawdownRatio(returns),
    sharpe: std > 0 ? (avgR / std) * Math.sqrt(returns.length) : 0,
    profitFactor,
    closedTrades,
    returns,
  };
}

function buildActionableMetrics(trades) {
  const actionableTrades = trades.filter((trade) => trade.signalValidity === 'VALID');
  const actionableClosedTrades = actionableTrades.filter((trade) => CLOSED_OUTCOMES.has(trade.outcome));
  const returns = actionableClosedTrades.map((trade) => Number(trade.r)).filter(Number.isFinite);
  const wins = actionableClosedTrades.filter((trade) => trade.outcome === 'WIN').length;

  return {
    actionableTradeCount: actionableTrades.length,
    actionableClosedTradeCount: actionableClosedTrades.length,
    actionableOpenTradeCount: actionableTrades.length - actionableClosedTrades.length,
    actionableWinRate: actionableClosedTrades.length ? (wins / actionableClosedTrades.length) * 100 : 0,
    actionableExpectancy: mean(returns),
    actionableAvgR: mean(returns),
    actionableMaxDrawdown: maxDrawdownRatio(returns),
    actionableSharpe: (() => {
      const std = standardDeviation(returns);
      return std > 0 ? (mean(returns) / std) * Math.sqrt(returns.length) : 0;
    })(),
    actionableProfitFactor: profitFactorFromReturns(returns),
    actionableNetR: returns.reduce((sum, value) => sum + value, 0),
  };
}

export function calculatePerformance(trades, signalBreakdown = {}, signalValidityBreakdown = {}) {
  const base = buildTradeMetrics(trades);
  const actionable = buildActionableMetrics(trades);
  const allDetectedSetups =
    (signalValidityBreakdown.VALID ?? 0) + (signalValidityBreakdown.BLOCKED ?? 0) + (signalValidityBreakdown.MARGINAL ?? 0);

  return {
    totalTrades: base.totalTrades,
    closedTradeCount: base.closedTradeCount,
    openTradeCount: base.openTradeCount,
    winRate: round(base.winRate, 2),
    expectancy: round(base.expectancy),
    avgR: round(base.avgR),
    maxDrawdown: round(base.maxDrawdown),
    maxDrawdownPct: round(base.maxDrawdownPct),
    sharpe: round(base.sharpe),
    profitFactor: Number.isFinite(base.profitFactor) ? round(base.profitFactor) : base.profitFactor,
    allDetectedSetups,
    validSignalCount: signalValidityBreakdown.VALID ?? 0,
    blockedSignalCount: signalValidityBreakdown.BLOCKED ?? 0,
    marginalSignalCount: signalValidityBreakdown.MARGINAL ?? 0,
    actionableTradeCount: actionable.actionableTradeCount,
    actionableClosedTradeCount: actionable.actionableClosedTradeCount,
    actionableOpenTradeCount: actionable.actionableOpenTradeCount,
    actionableWinRate: round(actionable.actionableWinRate, 2),
    actionableExpectancy: round(actionable.actionableExpectancy),
    actionableAvgR: round(actionable.actionableAvgR),
    actionableMaxDrawdown: round(actionable.actionableMaxDrawdown),
    actionableSharpe: round(actionable.actionableSharpe),
    actionableProfitFactor: Number.isFinite(actionable.actionableProfitFactor)
      ? round(actionable.actionableProfitFactor)
      : actionable.actionableProfitFactor,
    actionableNetR: round(actionable.actionableNetR),
    signalBreakdown,
    signalValidityBreakdown,
  };
}

function baseEmptyResult(pair, timeframe, candleCount, integrity) {
  return {
    ...calculatePerformance([], {}, {}),
    signals: [],
    trades: [],
    pair,
    timeframe,
    candleCount,
    integrity,
  };
}

export function runBacktest(candles, pair, timeframe, options = {}) {
  const minLookback = Math.max(DEFAULT_MIN_LOOKBACK, options.minLookback ?? DEFAULT_MIN_LOOKBACK);
  const integrity = validateCandleIntegrity(candles, timeframe, { minLookback });
  const normalizedCandles = integrity.normalizedCandles;
  const startIndex = Math.max(minLookback - 1, options.startIndex ?? minLookback - 1);
  const endIndex = Math.min(normalizedCandles.length - 1, options.endIndex ?? normalizedCandles.length - 1);
  const signalMode = options.signalMode ?? 'conservative';
  const signalBreakdown = {};
  const signalValidityBreakdown = {};
  const signals = [];
  const trades = [];

  if (normalizedCandles.length < minLookback || startIndex > endIndex) {
    return baseEmptyResult(pair, timeframe, normalizedCandles.length, integrity);
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    const window = normalizedCandles.slice(index - minLookback + 1, index + 1);
    const indicators = calculateIndicators(window, timeframe);

    if (!indicators) {
      continue;
    }

    const setup = buildSignalSetup(
      {
        ...indicators,
        stale: false,
        feedStale: false,
        dataError: '',
      },
      {
        symbol: pair,
        signalMode,
        btcContext: options.btcContext ?? null,
      },
    );

    if (!setup) {
      continue;
    }

    const record = signalRecord({
      candle: normalizedCandles[index],
      pair,
      timeframe,
      setup,
    });

    signals.push(record);
    signalBreakdown[record.signal] = (signalBreakdown[record.signal] ?? 0) + 1;
    signalValidityBreakdown[record.signalValidity] = (signalValidityBreakdown[record.signalValidity] ?? 0) + 1;

    if (!EXECUTABLE_SIGNALS.has(record.signal)) {
      continue;
    }

    const outcome = simulateTradeOutcome(record, normalizedCandles.slice(index + 1), options);
    if (!outcome) {
      continue;
    }

    trades.push({
      ...record,
      ...outcome,
    });
  }

  return {
    ...calculatePerformance(trades, signalBreakdown, signalValidityBreakdown),
    signals,
    trades,
    pair,
    timeframe,
    candleCount: normalizedCandles.length,
    integrity,
  };
}
