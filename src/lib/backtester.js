import { buildEmaLineSeries, calculateIndicators } from './indicators.js';
import { buildSignalSetup } from './signalLogic.js';
import { extractRegimeFeatures } from './regimeFeatures.js';
import { strategyMetadata } from '../config/strategyVersion.js';
import { normalizeRetestConfig } from '../config/retestConfig.js';

export const DEFAULT_MIN_LOOKBACK = 200;
const EXECUTABLE_SIGNALS = new Set(['LONG', 'SHORT']);
const CLOSED_OUTCOMES = new Set(['WIN', 'LOSS', 'BREAKEVEN']);
const UNRESOLVED_OUTCOMES = new Set(['OPEN', 'OPEN_WIN', 'OPEN_LOSS']);

function toSeconds(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function incrementCounter(map, key, amount = 1) {
  if (!key) {
    return;
  }

  map[key] = (map[key] ?? 0) + amount;
}

function withinPercent(value, level, percent) {
  if (!Number.isFinite(value) || !Number.isFinite(level) || level === 0) {
    return false;
  }

  return Math.abs(((value - level) / level) * 100) <= percent;
}

function aggregateCandlesByTimeframe(candles, targetTimeframe) {
  const targetMs = timeframeToMs(targetTimeframe);
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    return [];
  }

  const bucketSeconds = targetMs / 1000;
  const buckets = new Map();

  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...candle, time: bucket });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }

  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function deriveTrendFromIndicators(indicators) {
  if (!indicators || indicators.valid === false) {
    return 'UNAVAILABLE';
  }

  const { price, ema20, ema50, ema200 } = indicators;
  if ([price, ema20, ema50, ema200].some((value) => !Number.isFinite(value))) {
    return 'UNAVAILABLE';
  }

  if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
    return 'BULLISH';
  }

  if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

function buildHigherTimeframeContextLookup({ candles, timeframe, experimentConfig }) {
  const mapping = experimentConfig?.signalLogic?.qualityFilters?.htfAlignment?.mapping;
  const targetTimeframe = mapping?.[timeframe];
  if (!targetTimeframe) {
    return null;
  }

  const targetMs = timeframeToMs(targetTimeframe);
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    return {
      timeframe: targetTimeframe,
      contextForCandle: () => ({
        timeframe: targetTimeframe,
        trend: 'UNAVAILABLE',
        candleCount: 0,
        reason: 'invalid_htf_timeframe',
      }),
    };
  }

  const aggregated = aggregateCandlesByTimeframe(candles, targetTimeframe);
  const ema20ByTime = new Map(buildEmaLineSeries(aggregated, 20).map((item) => [item.time, item.value]));
  const ema50ByTime = new Map(buildEmaLineSeries(aggregated, 50).map((item) => [item.time, item.value]));
  const ema200ByTime = new Map(buildEmaLineSeries(aggregated, 200).map((item) => [item.time, item.value]));
  const contexts = aggregated.map((candle, index) => {
    const indicators = {
      valid: index + 1 >= 200,
      price: candle.close,
      ema20: ema20ByTime.get(candle.time) ?? null,
      ema50: ema50ByTime.get(candle.time) ?? null,
      ema200: ema200ByTime.get(candle.time) ?? null,
    };

    return {
      time: candle.time,
      timeframe: targetTimeframe,
      trend: deriveTrendFromIndicators(indicators),
      candleCount: index + 1,
      price: indicators.price,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
    };
  });

  return {
    timeframe: targetTimeframe,
    contextForCandle(candle) {
      const candleBucket = Math.floor((candle.time * 1000) / targetMs) * (targetMs / 1000);
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        if (contexts[index].time < candleBucket) {
          return contexts[index];
        }
      }

      return {
        timeframe: targetTimeframe,
        trend: 'UNAVAILABLE',
        candleCount: contexts[0]?.candleCount ?? 0,
        reason: 'insufficient_completed_htf_data',
      };
    },
  };
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

function signalRecord({ candle, pair, timeframe, setup, strategy, regimeFeatures = null }) {
  const entry = Number(setup?.entry1 ?? setup?.entryPrice ?? setup?.entry);
  const sl = Number(setup?.sl ?? setup?.slPrice ?? setup?.stopLoss);
  const tp = Number(setup?.tp1 ?? setup?.tp1Price ?? setup?.takeProfit ?? setup?.tp);
  const tp2 = Number(setup?.tp2 ?? setup?.tp2Price);
  const tradeLevelFields = {
    entry,
    sl,
    tp,
    tp2,
  };
  const executable = EXECUTABLE_SIGNALS.has(setup?.signal);
  const missingTradeLevels = executable && ![entry, sl, tp].every(Number.isFinite);
  let actionabilityReason = '';

  if (!executable) {
    actionabilityReason = `Signal ${setup?.signal ?? 'UNKNOWN'} is not executable; backtester opens LONG/SHORT only.`;
  } else if (setup?.signalValidity !== 'VALID') {
    actionabilityReason = `Signal validity ${setup?.signalValidity ?? 'UNKNOWN'} is not actionable.`;
  } else if (missingTradeLevels) {
    actionabilityReason = 'Missing entry/sl/tp fields for trade simulation.';
  }

  return {
    timestamp: candle.time * 1000,
    pair,
    timeframe,
    ...strategy,
    direction: setup?.selectedDirection ?? (EXECUTABLE_SIGNALS.has(setup?.signal) ? setup.signal : null),
    signal: setup?.signal ?? 'NO_SIGNAL',
    score: setup?.score ?? 0,
    confidenceScore: setup?.confidenceScore ?? setup?.score ?? 0,
    signalValidity: setup?.signalValidity ?? 'MARGINAL',
    blockedReason: Array.isArray(setup?.blockedReason) ? setup.blockedReason : [],
    entry: Number.isFinite(entry) ? entry : null,
    entryPrice: Number.isFinite(entry) ? entry : null,
    sl: Number.isFinite(sl) ? sl : null,
    stopLoss: Number.isFinite(sl) ? sl : null,
    slPrice: Number.isFinite(sl) ? sl : null,
    tp: Number.isFinite(tp) ? tp : null,
    takeProfit: Number.isFinite(tp) ? tp : null,
    tp1Price: Number.isFinite(tp) ? tp : null,
    tp2Price: Number.isFinite(tp2) ? tp2 : null,
    rr: setup?.rr ?? setup?.rrRatio ?? null,
    rrRatio: setup?.rrRatio ?? setup?.rr ?? null,
    atr: Number.isFinite(Number(setup?.atr)) ? Number(setup.atr) : null,
    rrWarning: setup?.rrWarning ?? null,
    levelWarning: setup?.levelWarning ?? null,
    warnings: Array.isArray(setup?.warnings) ? setup.warnings : [],
    hardBlock: setup?.hardBlock ?? null,
    entryContext: setup?.entryContext ?? null,
    entryAdvice: setup?.entryAdvice ?? null,
    action: setup?.action ?? null,
    watchLevels: setup?.watchLevels ?? null,
    plannedLevels: setup?.plannedLevels ?? null,
    selectedDirection: setup?.selectedDirection ?? (EXECUTABLE_SIGNALS.has(setup?.signal) ? setup.signal : null),
    rejectionReasons: Array.isArray(setup?.rejectionReasons) ? setup.rejectionReasons : [],
    signalDiagnostics: setup?.signalDiagnostics ?? null,
    regimeFeatures,
    regimeFilter: setup?.regimeFilter ?? null,
    executableSignal: executable,
    actionableEligible: executable && setup?.signalValidity === 'VALID' && !missingTradeLevels,
    actionabilityReason,
    missingTradeLevels,
    tradeLevelFields,
  };
}

function evaluateRegimeFilter(regimeFilter = null, regimeFeatures = null) {
  if (!regimeFilter?.enabled) {
    return {
      enabled: false,
      passed: true,
      filterId: regimeFilter?.filterId ?? null,
      reason: 'No regime filter configured.',
    };
  }

  const reasons = [];
  const missing = [];
  const features = regimeFeatures ?? {};

  for (const feature of regimeFilter.requiredFeatures ?? []) {
    const value = features?.[feature];
    if (value === null || value === undefined || value === '') {
      missing.push(feature);
    }
  }

  if (missing.length) {
    reasons.push(`Missing regime features: ${missing.join(', ')}.`);
  }

  const impulse = Number(features.impulseSizeAtr);
  if (Number.isFinite(Number(regimeFilter.minImpulseSizeAtr)) && (!Number.isFinite(impulse) || impulse < Number(regimeFilter.minImpulseSizeAtr))) {
    reasons.push(`impulseSizeAtr ${Number.isFinite(impulse) ? impulse.toFixed(2) : '--'} below ${Number(regimeFilter.minImpulseSizeAtr)}.`);
  }

  const atrPercentile = Number(features.atrPercentile);
  if (Number.isFinite(Number(regimeFilter.minAtrPercentile)) && (!Number.isFinite(atrPercentile) || atrPercentile < Number(regimeFilter.minAtrPercentile))) {
    reasons.push(`atrPercentile ${Number.isFinite(atrPercentile) ? atrPercentile.toFixed(2) : '--'} below ${Number(regimeFilter.minAtrPercentile)}.`);
  }
  if (Number.isFinite(Number(regimeFilter.maxAtrPercentile)) && (!Number.isFinite(atrPercentile) || atrPercentile > Number(regimeFilter.maxAtrPercentile))) {
    reasons.push(`atrPercentile ${Number.isFinite(atrPercentile) ? atrPercentile.toFixed(2) : '--'} above ${Number(regimeFilter.maxAtrPercentile)}.`);
  }

  if (Array.isArray(regimeFilter.allowedVolatilityRegimes) && regimeFilter.allowedVolatilityRegimes.length) {
    const regime = features.volatilityRegime;
    if (!regimeFilter.allowedVolatilityRegimes.includes(regime)) {
      reasons.push(`volatilityRegime ${regime ?? 'UNKNOWN'} not in ${regimeFilter.allowedVolatilityRegimes.join('/')}.`);
    }
  }

  if (Array.isArray(regimeFilter.allowedTrendRegimes) && regimeFilter.allowedTrendRegimes.length) {
    const regime = features.trendRegime;
    if (!regimeFilter.allowedTrendRegimes.includes(regime)) {
      reasons.push(`trendRegime ${regime ?? 'UNKNOWN'} not in ${regimeFilter.allowedTrendRegimes.join('/')}.`);
    }
  }

  const trendStrength = Number(features.trendStrengthScore);
  if (Number.isFinite(Number(regimeFilter.minTrendStrengthScore)) && (!Number.isFinite(trendStrength) || trendStrength < Number(regimeFilter.minTrendStrengthScore))) {
    reasons.push(`trendStrengthScore ${Number.isFinite(trendStrength) ? trendStrength.toFixed(2) : '--'} below ${Number(regimeFilter.minTrendStrengthScore)}.`);
  }

  const chopScore = Number(features.chopScore);
  if (Number.isFinite(Number(regimeFilter.maxChopScore)) && (!Number.isFinite(chopScore) || chopScore > Number(regimeFilter.maxChopScore))) {
    reasons.push(`chopScore ${Number.isFinite(chopScore) ? chopScore.toFixed(2) : '--'} above ${Number(regimeFilter.maxChopScore)}.`);
  }

  return {
    enabled: true,
    filterId: regimeFilter.filterId ?? 'regime-filter',
    passed: reasons.length === 0,
    reason: reasons.length ? reasons.join(' ') : `Regime filter ${regimeFilter.filterId ?? 'regime-filter'} passed.`,
    features: {
      impulseSizeAtr: features.impulseSizeAtr ?? null,
      volatilityRegime: features.volatilityRegime ?? null,
      trendRegime: features.trendRegime ?? null,
      atrPercentile: features.atrPercentile ?? null,
      trendStrengthScore: features.trendStrengthScore ?? null,
      chopScore: features.chopScore ?? null,
    },
  };
}

function applyRegimeFilterToSetup(setup, regimeFeatures, experimentConfig = null) {
  const filter = experimentConfig?.regimeFilter;
  const result = evaluateRegimeFilter(filter, regimeFeatures);
  if (!result.enabled) {
    return setup;
  }

  const withMetadata = {
    ...setup,
    regimeFilter: result,
  };

  if (result.passed || !EXECUTABLE_SIGNALS.has(setup?.signal)) {
    return withMetadata;
  }

  const direction = setup?.selectedDirection ?? setup?.signal ?? null;
  return {
    ...withMetadata,
    signal: 'WAIT',
    selectedDirection: direction,
    signalValidity: 'BLOCKED',
    blockedReason: [
      ...(Array.isArray(setup?.blockedReason) ? setup.blockedReason : []),
      `Regime filter blocked entry: ${result.reason}`,
    ],
    hardBlock: `Regime filter blocked entry: ${result.reason}`,
    warnings: [
      ...(Array.isArray(setup?.warnings) ? setup.warnings : []),
      `Regime filter blocked entry: ${result.reason}`,
    ],
    rejectionReasons: [
      ...(Array.isArray(setup?.rejectionReasons) ? setup.rejectionReasons : []),
      `Regime filter blocked entry: ${result.reason}`,
    ],
    tradeLevelsVisible: false,
  };
}

function directionR({ signal, entry, exit, risk }) {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(risk) || risk <= 0) {
    return 0;
  }

  return signal === 'LONG' ? (exit - entry) / risk : (entry - exit) / risk;
}

function resolveTradeCore(signal) {
  const entry = Number(signal.entry ?? signal.entryPrice);
  const sl = Number(signal.sl ?? signal.slPrice ?? signal.stopLoss);
  const tp1 = Number(signal.tp ?? signal.tp1Price ?? signal.takeProfit);
  const tp2 = Number(signal.tp2Price);
  const rr1 = Number(signal.rr ?? signal.rrRatio);

  if (!EXECUTABLE_SIGNALS.has(signal.signal) || !Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp1)) {
    return null;
  }

  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) {
    return null;
  }

  return {
    signal: signal.signal,
    entry,
    sl,
    tp1,
    tp2: Number.isFinite(tp2) ? tp2 : null,
    rr1: Number.isFinite(rr1) ? rr1 : directionR({ signal: signal.signal, entry, exit: tp1, risk }),
    risk,
    atr: Number(signal.atr),
  };
}

function hitTargetPrice(direction, candle, target) {
  if (!Number.isFinite(target)) {
    return false;
  }

  return direction === 'LONG' ? candle.high >= target : candle.low <= target;
}

function hitStopPrice(direction, candle, stop) {
  if (!Number.isFinite(stop)) {
    return false;
  }

  return direction === 'LONG' ? candle.low <= stop : candle.high >= stop;
}

function sameCandleOutcome({ sameCandlePolicy, stopOutcome, targetOutcome }) {
  return sameCandlePolicy === 'sl-first' ? stopOutcome : targetOutcome;
}

function openOutcome({ direction, entry, risk, lastClose, exitTimestamp, realizedR = 0, remainingWeight = 1, meta = {} }) {
  if (!Number.isFinite(lastClose)) {
    return {
      outcome: 'OPEN',
      exit: null,
      exitTimestamp: null,
      r: round(realizedR),
      ...meta,
    };
  }

  const floatingR = directionR({ signal: direction, entry, exit: lastClose, risk });
  const totalR = realizedR + remainingWeight * floatingR;

  return {
    outcome: totalR >= 0 ? 'OPEN_WIN' : 'OPEN_LOSS',
    exit: lastClose,
    exitTimestamp,
    r: round(totalR),
    ...meta,
  };
}

function determineClosedOutcome(totalR) {
  if (totalR > 0) {
    return 'WIN';
  }

  if (totalR < 0) {
    return 'LOSS';
  }

  return 'BREAKEVEN';
}

function simulateSingleTargetOutcome(core, futureCandles, options = {}, targetPrice = core.tp1) {
  const sameCandlePolicy = options.sameCandlePolicy ?? 'sl-first';
  const targetR = directionR({ signal: core.signal, entry: core.entry, exit: targetPrice, risk: core.risk });

  for (const candle of futureCandles) {
    const hitTp = hitTargetPrice(core.signal, candle, targetPrice);
    const hitSl = hitStopPrice(core.signal, candle, core.sl);

    if (hitTp && hitSl) {
      return sameCandleOutcome({
        sameCandlePolicy,
        stopOutcome: {
          outcome: 'LOSS',
          exit: core.sl,
          exitTimestamp: candle.time * 1000,
          r: -1,
          exitMode: 'single-target',
          targetPrice,
        },
        targetOutcome: {
          outcome: 'WIN',
          exit: targetPrice,
          exitTimestamp: candle.time * 1000,
          r: round(targetR),
          exitMode: 'single-target',
          targetPrice,
        },
      });
    }

    if (hitSl) {
      return {
        outcome: 'LOSS',
        exit: core.sl,
        exitTimestamp: candle.time * 1000,
        r: -1,
        exitMode: 'single-target',
        targetPrice,
      };
    }

    if (hitTp) {
      return {
        outcome: 'WIN',
        exit: targetPrice,
        exitTimestamp: candle.time * 1000,
        r: round(targetR),
        exitMode: 'single-target',
        targetPrice,
      };
    }
  }

  const last = futureCandles.at(-1);
  return openOutcome({
    direction: core.signal,
    entry: core.entry,
    risk: core.risk,
    lastClose: last?.close ?? null,
    exitTimestamp: last?.time ? last.time * 1000 : null,
    meta: {
      exitMode: 'single-target',
      targetPrice,
    },
  });
}

function simulatePartialRunnerOutcome(core, futureCandles, exitGeometry = {}, options = {}) {
  const sameCandlePolicy = options.sameCandlePolicy ?? 'sl-first';
  const firstWeight = Math.min(0.95, Math.max(0.05, Number(exitGeometry.firstWeight) || 0.5));
  const runnerWeight = 1 - firstWeight;
  const tp1 = core.tp1;
  const tp2 = Number.isFinite(core.tp2) ? core.tp2 : core.tp1;
  const rr1 = directionR({ signal: core.signal, entry: core.entry, exit: tp1, risk: core.risk });
  const rr2 = directionR({ signal: core.signal, entry: core.entry, exit: tp2, risk: core.risk });
  let runnerActive = false;
  let realizedR = 0;
  let runnerStop = core.sl;
  const exitEvents = [];

  for (const candle of futureCandles) {
    if (!runnerActive) {
      const hitTp1 = hitTargetPrice(core.signal, candle, tp1);
      const hitSl = hitStopPrice(core.signal, candle, core.sl);

      if (hitTp1 && hitSl) {
        return sameCandleOutcome({
          sameCandlePolicy,
          stopOutcome: {
            outcome: 'LOSS',
            exit: core.sl,
            exitTimestamp: candle.time * 1000,
            r: -1,
            exitMode: 'partial-runner',
            exitEvents,
          },
          targetOutcome: {
            outcome: 'WIN',
            exit: tp1,
            exitTimestamp: candle.time * 1000,
            r: round(realizedR + runnerWeight * rr1 + firstWeight * rr1),
            exitMode: 'partial-runner',
            exitEvents,
          },
        });
      }

      if (hitSl) {
        return {
          outcome: 'LOSS',
          exit: core.sl,
          exitTimestamp: candle.time * 1000,
          r: -1,
          exitMode: 'partial-runner',
          exitEvents,
        };
      }

      if (hitTp1) {
        realizedR += firstWeight * rr1;
        runnerActive = true;
        if (exitGeometry.moveStopToBreakevenAfterFirstTarget) {
          runnerStop = core.entry;
        }
        exitEvents.push({
          type: 'PARTIAL_TP1',
          timestamp: candle.time * 1000,
          price: tp1,
          weight: firstWeight,
          realizedR: round(firstWeight * rr1),
        });
        continue;
      }

      continue;
    }

    const hitTp2 = hitTargetPrice(core.signal, candle, tp2);
    const hitRunnerStop = hitStopPrice(core.signal, candle, runnerStop);
    const runnerStopR = directionR({ signal: core.signal, entry: core.entry, exit: runnerStop, risk: core.risk });

    if (hitTp2 && hitRunnerStop) {
      return sameCandleOutcome({
        sameCandlePolicy,
        stopOutcome: {
          outcome: determineClosedOutcome(realizedR + runnerWeight * runnerStopR),
          exit: runnerStop,
          exitTimestamp: candle.time * 1000,
          r: round(realizedR + runnerWeight * runnerStopR),
          exitMode: 'partial-runner',
          exitEvents: [
            ...exitEvents,
            {
              type: 'RUNNER_STOP',
              timestamp: candle.time * 1000,
              price: runnerStop,
              weight: runnerWeight,
              realizedR: round(runnerWeight * runnerStopR),
            },
          ],
        },
        targetOutcome: {
          outcome: 'WIN',
          exit: tp2,
          exitTimestamp: candle.time * 1000,
          r: round(realizedR + runnerWeight * rr2),
          exitMode: 'partial-runner',
          exitEvents: [
            ...exitEvents,
            {
              type: 'RUNNER_TP2',
              timestamp: candle.time * 1000,
              price: tp2,
              weight: runnerWeight,
              realizedR: round(runnerWeight * rr2),
            },
          ],
        },
      });
    }

    if (hitRunnerStop) {
      return {
        outcome: determineClosedOutcome(realizedR + runnerWeight * runnerStopR),
        exit: runnerStop,
        exitTimestamp: candle.time * 1000,
        r: round(realizedR + runnerWeight * runnerStopR),
        exitMode: 'partial-runner',
        exitEvents: [
          ...exitEvents,
          {
            type: 'RUNNER_STOP',
            timestamp: candle.time * 1000,
            price: runnerStop,
            weight: runnerWeight,
            realizedR: round(runnerWeight * runnerStopR),
          },
        ],
      };
    }

    if (hitTp2) {
      return {
        outcome: 'WIN',
        exit: tp2,
        exitTimestamp: candle.time * 1000,
        r: round(realizedR + runnerWeight * rr2),
        exitMode: 'partial-runner',
        exitEvents: [
          ...exitEvents,
          {
            type: 'RUNNER_TP2',
            timestamp: candle.time * 1000,
            price: tp2,
            weight: runnerWeight,
            realizedR: round(runnerWeight * rr2),
          },
        ],
      };
    }
  }

  const last = futureCandles.at(-1);
  return openOutcome({
    direction: core.signal,
    entry: core.entry,
    risk: core.risk,
    lastClose: last?.close ?? null,
    exitTimestamp: last?.time ? last.time * 1000 : null,
    realizedR,
    remainingWeight: runnerActive ? runnerWeight : 1,
    meta: {
      exitMode: 'partial-runner',
      exitEvents,
    },
  });
}

function simulateBreakevenOrTrailingOutcome(core, futureCandles, exitGeometry = {}, options = {}) {
  const sameCandlePolicy = options.sameCandlePolicy ?? 'sl-first';
  const triggerR = Math.max(0.5, Number(exitGeometry.triggerR) || 1);
  const targetPrice =
    exitGeometry.finalTarget === 'tp2' && Number.isFinite(core.tp2)
      ? core.tp2
      : core.tp1;
  const targetR = directionR({ signal: core.signal, entry: core.entry, exit: targetPrice, risk: core.risk });
  const triggerPrice =
    core.signal === 'LONG'
      ? core.entry + core.risk * triggerR
      : core.entry - core.risk * triggerR;
  const trailAtrMultiplier = Math.max(0.5, Number(exitGeometry.trailAtrMultiplier) || 1);
  const atrDistance = Number.isFinite(core.atr) && core.atr > 0 ? core.atr * trailAtrMultiplier : null;
  let stop = core.sl;
  let armed = false;
  let bestExtreme = core.entry;
  const exitMode = exitGeometry.mode === 'trailing-after-1r' ? 'trailing-after-1r' : 'breakeven-after-1r';
  const exitEvents = [];

  for (const candle of futureCandles) {
    const hitTarget = hitTargetPrice(core.signal, candle, targetPrice);
    const hitStop = hitStopPrice(core.signal, candle, stop);
    const hitTrigger = hitTargetPrice(core.signal, candle, triggerPrice);

    if (!armed && hitTarget && hitStop) {
      return sameCandleOutcome({
        sameCandlePolicy,
        stopOutcome: {
          outcome: 'LOSS',
          exit: stop,
          exitTimestamp: candle.time * 1000,
          r: -1,
          exitMode,
          exitEvents,
        },
        targetOutcome: {
          outcome: 'WIN',
          exit: targetPrice,
          exitTimestamp: candle.time * 1000,
          r: round(targetR),
          exitMode,
          exitEvents,
        },
      });
    }

    if (hitStop) {
      const totalR = directionR({ signal: core.signal, entry: core.entry, exit: stop, risk: core.risk });
      return {
        outcome: determineClosedOutcome(totalR),
        exit: stop,
        exitTimestamp: candle.time * 1000,
        r: round(totalR),
        exitMode,
        exitEvents,
      };
    }

    if (hitTarget) {
      return {
        outcome: 'WIN',
        exit: targetPrice,
        exitTimestamp: candle.time * 1000,
        r: round(targetR),
        exitMode,
        exitEvents,
      };
    }

    if (!armed && hitTrigger) {
      armed = true;
      stop = core.entry;
      bestExtreme = core.signal === 'LONG' ? candle.high : candle.low;
      exitEvents.push({
        type: 'TRIGGER_1R',
        timestamp: candle.time * 1000,
        price: triggerPrice,
      });
      continue;
    }

    if (armed && exitGeometry.mode === 'trailing-after-1r' && Number.isFinite(atrDistance)) {
      bestExtreme = core.signal === 'LONG'
        ? Math.max(bestExtreme, candle.high)
        : Math.min(bestExtreme, candle.low);
      const candidateStop =
        core.signal === 'LONG'
          ? Math.max(core.entry, bestExtreme - atrDistance)
          : Math.min(core.entry, bestExtreme + atrDistance);

      if ((core.signal === 'LONG' && candidateStop > stop) || (core.signal === 'SHORT' && candidateStop < stop)) {
        stop = candidateStop;
        exitEvents.push({
          type: 'TRAIL_UPDATE',
          timestamp: candle.time * 1000,
          price: round(stop),
        });
      }
    }
  }

  const last = futureCandles.at(-1);
  return openOutcome({
    direction: core.signal,
    entry: core.entry,
    risk: core.risk,
    lastClose: last?.close ?? null,
    exitTimestamp: last?.time ? last.time * 1000 : null,
    meta: {
      exitMode,
      exitEvents,
    },
  });
}

export function simulateTradeOutcome(signal, futureCandles, options = {}) {
  const core = resolveTradeCore(signal);
  if (!core) {
    return null;
  }

  const exitGeometry = options.experimentConfig?.exitGeometry ?? null;
  if (!exitGeometry?.mode) {
    return simulateSingleTargetOutcome(core, futureCandles, options, core.tp1);
  }

  switch (exitGeometry.mode) {
    case 'full-target': {
      const targetPrice =
        exitGeometry.target === 'tp2' && Number.isFinite(core.tp2)
          ? core.tp2
          : core.tp1;
      return simulateSingleTargetOutcome(core, futureCandles, options, targetPrice);
    }
    case 'partial-runner':
      return simulatePartialRunnerOutcome(core, futureCandles, exitGeometry, options);
    case 'breakeven-after-1r':
    case 'trailing-after-1r':
      return simulateBreakevenOrTrailingOutcome(core, futureCandles, exitGeometry, options);
    default:
      return simulateSingleTargetOutcome(core, futureCandles, options, core.tp1);
  }
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

function createDiagnostics() {
  return {
    totalCandlesEvaluated: 0,
    rawSignalCount: 0,
    longSignalCount: 0,
    shortSignalCount: 0,
    noTradeCount: 0,
    waitCount: 0,
    waitRetestCount: 0,
    validCount: 0,
    marginalCount: 0,
    blockedCount: 0,
    validExecutableSignalCount: 0,
    validNonExecutableSignalCount: 0,
    hardBlockReasonBreakdown: {},
    rrWarningCount: 0,
    levelWarningCount: 0,
    missingTradeLevelCount: 0,
    missingAtrCount: 0,
    simulatedTradeOpenedCount: 0,
    simulatedTradeClosedCount: 0,
    expiredTradeCount: 0,
    unresolvedTradeCount: 0,
    pendingRetestCreatedCount: 0,
    pendingRetestConfirmedCount: 0,
    pendingRetestExpiredCount: 0,
    pendingRetestInvalidatedCount: 0,
    experimentPromotedMarginalConfirmationCount: 0,
    confirmedLongCount: 0,
    confirmedShortCount: 0,
    nonActionableReasonBreakdown: {},
    v2Breakout: {
      compressionZoneDetectedCount: 0,
      breakoutCandidateCount: 0,
      volumeExpansionPassCount: 0,
      rangeAtrExpansionPassCount: 0,
      bodyQualityPassCount: 0,
      rejectionWickFailureCount: 0,
      opposingLevelRoomFailureCount: 0,
      rrFailureCount: 0,
      validExecutableLongCount: 0,
      validExecutableShortCount: 0,
      blockedReasonBreakdown: {},
      primaryBlockedReasonBreakdown: {},
    },
  };
}

function updateV2BreakoutDiagnostics(diagnostics, record) {
  const selected = record.signalDiagnostics?.strategyType === 'breakoutVolumeExpansion'
    ? record.signalDiagnostics.selected
    : null;

  if (!selected) {
    return;
  }

  if (selected.compressionDetected) {
    diagnostics.v2Breakout.compressionZoneDetectedCount += 1;
  }
  if (selected.breakoutCandidate) {
    diagnostics.v2Breakout.breakoutCandidateCount += 1;
  }
  if (selected.volumeExpansionPass) {
    diagnostics.v2Breakout.volumeExpansionPassCount += 1;
  }
  if (selected.rangeExpansionPass) {
    diagnostics.v2Breakout.rangeAtrExpansionPassCount += 1;
  }
  if (selected.bodyQualityPass) {
    diagnostics.v2Breakout.bodyQualityPassCount += 1;
  }
  if (selected.rejectionWickFailure) {
    diagnostics.v2Breakout.rejectionWickFailureCount += 1;
  }
  if (selected.opposingLevelRoomFailure) {
    diagnostics.v2Breakout.opposingLevelRoomFailureCount += 1;
  }
  if (selected.rrFailure) {
    diagnostics.v2Breakout.rrFailureCount += 1;
  }

  if (record.actionableEligible && record.signal === 'LONG') {
    diagnostics.v2Breakout.validExecutableLongCount += 1;
  }
  if (record.actionableEligible && record.signal === 'SHORT') {
    diagnostics.v2Breakout.validExecutableShortCount += 1;
  }

  const reasonCodes = Array.isArray(selected.blockReasonCodes) ? selected.blockReasonCodes : [];
  if (record.signalValidity !== 'VALID' || !record.actionableEligible) {
    reasonCodes.forEach((reason) => incrementCounter(diagnostics.v2Breakout.blockedReasonBreakdown, reason));
    incrementCounter(diagnostics.v2Breakout.primaryBlockedReasonBreakdown, selected.primaryBlockReason ?? 'OTHER');
  }
}

function updateDiagnostics(diagnostics, record) {
  diagnostics.totalCandlesEvaluated += 1;
  diagnostics.rawSignalCount += 1;
  switch (record.signal) {
    case 'LONG':
      diagnostics.longSignalCount += 1;
      break;
    case 'SHORT':
      diagnostics.shortSignalCount += 1;
      break;
    case 'WAIT':
      diagnostics.waitCount += 1;
      break;
    case 'WAIT_RETEST':
      diagnostics.waitRetestCount += 1;
      break;
    case 'NO_TRADE':
    default:
      diagnostics.noTradeCount += 1;
      break;
  }
  if (record.signalValidity === 'VALID') {
    diagnostics.validCount += 1;
  } else if (record.signalValidity === 'MARGINAL') {
    diagnostics.marginalCount += 1;
  } else if (record.signalValidity === 'BLOCKED') {
    diagnostics.blockedCount += 1;
  }

  if (record.rrWarning) {
    diagnostics.rrWarningCount += 1;
  }

  if (record.levelWarning) {
    diagnostics.levelWarningCount += 1;
  }

  if (!Number.isFinite(record.atr)) {
    diagnostics.missingAtrCount += 1;
  }

  if (record.missingTradeLevels) {
    diagnostics.missingTradeLevelCount += 1;
  }

  const blockedReasons = Array.isArray(record.blockedReason) ? record.blockedReason : [];
  blockedReasons.forEach((reason) => incrementCounter(diagnostics.hardBlockReasonBreakdown, reason));

  if (record.actionableEligible) {
    diagnostics.validExecutableSignalCount += 1;
  } else if (record.signalValidity === 'VALID') {
    diagnostics.validNonExecutableSignalCount += 1;
  }

  if (record.actionabilityReason) {
    incrementCounter(diagnostics.nonActionableReasonBreakdown, record.actionabilityReason);
  }

  updateV2BreakoutDiagnostics(diagnostics, record);
}

function recordTradeOutcome(diagnostics, outcome) {
  diagnostics.simulatedTradeOpenedCount += 1;

  if (CLOSED_OUTCOMES.has(outcome.outcome)) {
    diagnostics.simulatedTradeClosedCount += 1;
    return;
  }

  if (outcome.outcome === 'EXPIRED') {
    diagnostics.expiredTradeCount += 1;
    return;
  }

  if (UNRESOLVED_OUTCOMES.has(outcome.outcome)) {
    diagnostics.unresolvedTradeCount += 1;
  }
}

function resolveTradeLevels(setup = {}, candleClose = null) {
  const planned = setup?.plannedLevels ?? {};
  const entry = Number(
    planned.entry1 ??
      setup?.entry1 ??
      setup?.entryPrice ??
      setup?.entry ??
      candleClose,
  );
  const sl = Number(planned.sl ?? setup?.sl ?? setup?.slPrice ?? setup?.stopLoss);
  const tp1 = Number(planned.tp1 ?? setup?.tp1 ?? setup?.tp1Price ?? setup?.takeProfit ?? setup?.tp);
  const tp2 = Number(planned.tp2 ?? setup?.tp2 ?? setup?.tp2Price);

  return {
    entry: Number.isFinite(entry) ? entry : null,
    sl: Number.isFinite(sl) ? sl : null,
    tp1: Number.isFinite(tp1) ? tp1 : null,
    tp2: Number.isFinite(tp2) ? tp2 : null,
  };
}

function createPendingRetest({ record, setup, candle, pair, timeframe, strategy, index, retestConfig, pendingId }) {
  const breakoutLevel = Number(record.watchLevels?.breakoutLevel);
  const retestArea = Number(record.watchLevels?.retestArea);
  const invalidation = Number(record.watchLevels?.invalidation);
  const levels = resolveTradeLevels(setup, candle.close);
  const confirmationRequirement =
    record.direction === 'LONG'
      ? `Wait for price to retest ${Number.isFinite(breakoutLevel) ? breakoutLevel : 'breakout level'} and close back above it.`
      : `Wait for price to retest ${Number.isFinite(breakoutLevel) ? breakoutLevel : 'breakout level'} and close back below it.`;

  return {
    id: `${pair}-${timeframe}-${record.timestamp}-${record.direction ?? 'UNKNOWN'}-${pendingId}`,
    pair,
    timeframe,
    timestamp: record.timestamp,
    createdIndex: index,
    createdAt: record.timestamp,
    direction: record.direction ?? setup?.selectedDirection ?? null,
    signalValidity: record.signalValidity,
    confidenceScore: record.confidenceScore,
    breakoutLevel: Number.isFinite(breakoutLevel) ? breakoutLevel : null,
    retestArea: Number.isFinite(retestArea) ? retestArea : null,
    invalidation: Number.isFinite(invalidation) ? invalidation : null,
    atr: Number.isFinite(record.atr) ? record.atr : null,
    rrRatio: Number.isFinite(Number(record.rrRatio)) ? Number(record.rrRatio) : null,
    entryCandidate: levels.entry,
    slPrice: levels.sl,
    tp1Price: levels.tp1,
    tp2Price: levels.tp2,
    reasonWaiting: record.entryAdvice ?? 'Waiting for retest confirmation.',
    confirmationRequirement,
    confirmationCloseRequired: retestConfig.confirmationCloseRequired,
    maxRetestWaitCandles: retestConfig.maxRetestWaitCandles,
    actionableOnCreate: record.signalValidity === 'VALID' && !(record.blockedReason ?? []).length,
    status: 'PENDING',
    candlesUntilConfirmation: null,
    candlesUntilResolution: null,
    confirmationOccurred: false,
    confirmationSignal: null,
    confirmationSignalValidity: null,
    confirmationTimestamp: null,
    confirmationEntry: null,
    confirmationReason: null,
    expiredAt: null,
    invalidatedAt: null,
    invalidationReason: null,
    becameActionableTrade: false,
    tradeSignalTimestamp: null,
    tradeActionabilityReason: null,
    notes: [],
    strategyVersion: strategy.strategyVersion,
  };
}

function updateRetestPendingCounters(diagnostics, pending, outcome) {
  if (outcome === 'confirmed') {
    diagnostics.pendingRetestConfirmedCount += 1;
    if (pending.experimentPromotedMarginalConfirmation) {
      diagnostics.experimentPromotedMarginalConfirmationCount += 1;
    }
    if (pending.direction === 'LONG') {
      diagnostics.confirmedLongCount += 1;
    }
    if (pending.direction === 'SHORT') {
      diagnostics.confirmedShortCount += 1;
    }
    return;
  }

  if (outcome === 'expired') {
    diagnostics.pendingRetestExpiredCount += 1;
    return;
  }

  if (outcome === 'invalidated') {
    diagnostics.pendingRetestInvalidatedCount += 1;
  }
}

function buildConfirmedRetestRecord({
  pending,
  candle,
  pair,
  timeframe,
  setup,
  strategy,
  signalValidityOverride = null,
  regimeFeatures = null,
}) {
  const planned = setup?.plannedLevels ?? {};
  const syntheticSetup = {
    ...setup,
    signal: pending.direction,
    selectedDirection: pending.direction,
    signalValidity: signalValidityOverride ?? setup?.signalValidity,
    entry1: planned.entry1 ?? setup?.entry1 ?? candle.close,
    sl: planned.sl ?? setup?.sl ?? setup?.slPrice ?? setup?.stopLoss,
    tp1: planned.tp1 ?? setup?.tp1 ?? setup?.tp1Price ?? setup?.takeProfit ?? setup?.tp,
    tp2: planned.tp2 ?? setup?.tp2 ?? setup?.tp2Price,
  };

  const record = signalRecord({
    candle,
    pair,
    timeframe,
    setup: syntheticSetup,
    strategy,
    regimeFeatures,
  });

  return {
    ...record,
    signalSource: 'RETEST_CONFIRMATION',
    pendingRetestId: pending.id,
  };
}

function marginalConfirmationAllowed({ pending, setup, retestConfig }) {
  if (!retestConfig.allowMarginalConfirmation) {
    return false;
  }

  if (setup?.signalValidity !== 'MARGINAL') {
    return false;
  }

  if (Array.isArray(setup?.blockedReason) && setup.blockedReason.length) {
    return false;
  }

  const score = Number(setup?.confidenceScore ?? setup?.score ?? 0);
  if (!Number.isFinite(score) || score < retestConfig.marginalConfirmationMinimumScore) {
    return false;
  }

  const originalScore = Number(pending.confidenceScore ?? 0);
  if (!Number.isFinite(originalScore) || originalScore < retestConfig.marginalConfirmationMinimumScore) {
    return false;
  }

  return true;
}

function evaluatePendingRetest({
  pending,
  candle,
  index,
  setup,
  pair,
  timeframe,
  strategy,
  retestConfig,
  regimeFeatures,
}) {
  if (pending.status !== 'PENDING') {
    return { resolution: null, tradeRecord: null };
  }

  const age = index - pending.createdIndex;
  const level =
    retestConfig.confirmationLevel === 'retestArea' && Number.isFinite(pending.retestArea)
      ? pending.retestArea
      : pending.breakoutLevel;
  const invalidation = pending.invalidation;
  const atrTolerance = Number.isFinite(pending.atr) ? pending.atr * retestConfig.retestToleranceAtrMultiplier : null;
  const touchedLevel = Number.isFinite(level) && candle.low <= level && candle.high >= level;
  const nearLevel =
    Number.isFinite(level) &&
    (withinPercent(candle.low, level, retestConfig.retestTolerancePercent) ||
      withinPercent(candle.high, level, retestConfig.retestTolerancePercent) ||
      (Number.isFinite(atrTolerance) &&
        (Math.abs(candle.low - level) <= atrTolerance || Math.abs(candle.high - level) <= atrTolerance)));
  const touchedOrNear = touchedLevel || nearLevel;
  const invalidatedByLevel =
    Number.isFinite(invalidation) &&
    ((pending.direction === 'LONG' && candle.low < invalidation) ||
      (pending.direction === 'SHORT' && candle.high > invalidation));

  const resolve = (status, extra = {}) => {
    const { tradeRecord, ...rest } = extra;
    pending.status = status;
    pending.candlesUntilResolution = age;
    Object.assign(pending, rest);
    return { resolution: status, tradeRecord: tradeRecord ?? null };
  };

  if (invalidatedByLevel && !touchedOrNear) {
    return resolve('INVALIDATED', {
      invalidatedAt: candle.time * 1000,
      invalidationReason: `Price breached invalidation level ${invalidation} before retest confirmation.`,
    });
  }

  if (touchedOrNear && Number.isFinite(level)) {
    const bullishConfirm = candle.close > level;
    const bearishConfirm = candle.close < level;
    const bullishFail = candle.close < level;
    const bearishFail = candle.close > level;
    const directionConfirmed =
      pending.direction === 'LONG'
        ? retestConfig.confirmationCloseRequired
          ? bullishConfirm
          : true
        : retestConfig.confirmationCloseRequired
          ? bearishConfirm
          : true;
    const failed =
      pending.direction === 'LONG'
        ? bullishFail && retestConfig.confirmationCloseRequired
        : bearishFail && retestConfig.confirmationCloseRequired;

    if (directionConfirmed) {
      pending.confirmationOccurred = true;
      pending.confirmationTimestamp = candle.time * 1000;
      pending.candlesUntilConfirmation = age;
      pending.confirmationSignal = setup?.signal ?? null;
      pending.confirmationSignalValidity = setup?.signalValidity ?? null;
      pending.confirmationReason = pending.confirmationRequirement;

      const marginalAllowed = marginalConfirmationAllowed({ pending, setup, retestConfig });
      const confirmationAllowed =
        pending.actionableOnCreate &&
        setup?.signalValidity === 'VALID' &&
        !(Array.isArray(setup?.blockedReason) ? setup.blockedReason.length : 0) &&
        (setup?.selectedDirection ?? pending.direction) === pending.direction;
      const experimentConfirmationAllowed =
        marginalAllowed &&
        (setup?.selectedDirection ?? pending.direction) === pending.direction;

      if (!confirmationAllowed && !experimentConfirmationAllowed) {
        return resolve('CONFIRMED', {
          tradeActionabilityReason:
            setup?.signalValidity !== 'VALID'
              ? `Retest confirmed, but confirmation candle validity is ${setup?.signalValidity ?? 'UNKNOWN'}.`
              : 'Retest confirmed, but confirmation candle is not actionable under current signal rules.',
        });
      }

      const tradeRecord = buildConfirmedRetestRecord({
        pending,
        candle,
        pair,
        timeframe,
        setup,
        strategy,
        signalValidityOverride: experimentConfirmationAllowed ? 'VALID' : null,
        regimeFeatures,
      });

      pending.becameActionableTrade = tradeRecord.actionableEligible;
      pending.tradeSignalTimestamp = tradeRecord.timestamp;
      pending.tradeActionabilityReason = tradeRecord.actionabilityReason || null;
      pending.experimentPromotedMarginalConfirmation = experimentConfirmationAllowed;

      return resolve('CONFIRMED', {
        confirmationEntry: tradeRecord.entry,
        tradeRecord: tradeRecord.actionableEligible ? tradeRecord : null,
        tradeActionabilityReason:
          tradeRecord.actionableEligible
            ? null
            : tradeRecord.actionabilityReason || 'Retest confirmed, but trade levels were incomplete.',
      });
    }

    if (failed) {
      return resolve('INVALIDATED', {
        invalidatedAt: candle.time * 1000,
        invalidationReason:
          pending.direction === 'LONG'
            ? `Retest touched ${level} but candle closed back below the level.`
            : `Retest touched ${level} but candle closed back above the level.`,
      });
    }
  }

  if (age >= retestConfig.maxRetestWaitCandles) {
    return resolve('EXPIRED', {
      expiredAt: candle.time * 1000,
      invalidationReason: `Retest did not confirm within ${retestConfig.maxRetestWaitCandles} candles.`,
    });
  }

  return { resolution: null, tradeRecord: null };
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
  const strategy = strategyMetadata();

  return {
    ...calculatePerformance([], {}, {}),
    diagnostics: createDiagnostics(),
    retestDiagnostics: [],
    signals: [],
    trades: [],
    pair,
    timeframe,
    candleCount,
    integrity,
    ...strategy,
  };
}

export function runBacktest(candles, pair, timeframe, options = {}) {
  const minLookback = Math.max(DEFAULT_MIN_LOOKBACK, options.minLookback ?? DEFAULT_MIN_LOOKBACK);
  const integrity = validateCandleIntegrity(candles, timeframe, { minLookback });
  const normalizedCandles = integrity.normalizedCandles;
  const startIndex = Math.max(minLookback - 1, options.startIndex ?? minLookback - 1);
  const endIndex = Math.min(normalizedCandles.length - 1, options.endIndex ?? normalizedCandles.length - 1);
  const signalMode = options.signalMode ?? 'conservative';
  const strategy = strategyMetadata(options.strategyMetadata ?? {});
  const retestConfig = normalizeRetestConfig(options.retestConfig);
  const indicatorCalculator = options.calculateIndicators ?? calculateIndicators;
  const signalBuilder = options.buildSignalSetup ?? buildSignalSetup;
  const higherTimeframeLookup = buildHigherTimeframeContextLookup({
    candles: normalizedCandles,
    timeframe,
    experimentConfig: options.experimentConfig ?? null,
  });
  const signalBreakdown = {};
  const signalValidityBreakdown = {};
  const signals = [];
  const trades = [];
  const diagnostics = createDiagnostics();
  const retestDiagnostics = [];
  const pendingRetests = [];
  let pendingRetestId = 0;

  if (normalizedCandles.length < minLookback || startIndex > endIndex) {
    return baseEmptyResult(pair, timeframe, normalizedCandles.length, integrity);
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    const window = normalizedCandles.slice(index - minLookback + 1, index + 1);
    const indicators = indicatorCalculator(window, timeframe);

    if (!indicators) {
      continue;
    }

    const higherTimeframeTrend = higherTimeframeLookup?.contextForCandle(normalizedCandles[index]) ?? null;

    const setup = signalBuilder(
      {
        ...indicators,
        higherTimeframeTrend,
        stale: false,
        feedStale: false,
        dataError: '',
      },
      {
        symbol: pair,
        signalMode,
        btcContext: options.btcContext ?? null,
        experimentConfig: options.experimentConfig ?? null,
      },
    );

    if (!setup) {
      continue;
    }

    const regimeFeatures = extractRegimeFeatures({
      candles: window,
      indicators,
      setup,
      timeframe,
    });
    const filteredSetup = applyRegimeFilterToSetup(setup, regimeFeatures, options.experimentConfig ?? null);

    const record = signalRecord({
      candle: normalizedCandles[index],
      pair,
      timeframe,
      setup: filteredSetup,
      strategy,
      regimeFeatures,
    });

    signals.push(record);
    signalBreakdown[record.signal] = (signalBreakdown[record.signal] ?? 0) + 1;
    signalValidityBreakdown[record.signalValidity] = (signalValidityBreakdown[record.signalValidity] ?? 0) + 1;
    updateDiagnostics(diagnostics, record);

    if (retestConfig.enabled && pendingRetests.length) {
      for (const pending of pendingRetests) {
        if (pending.status !== 'PENDING') {
          continue;
        }

        const { resolution, tradeRecord } = evaluatePendingRetest({
          pending,
          candle: normalizedCandles[index],
          index,
          setup: filteredSetup,
          pair,
          timeframe,
          strategy,
          retestConfig,
          regimeFeatures,
        });

        if (!resolution) {
          continue;
        }

        updateRetestPendingCounters(diagnostics, pending, resolution.toLowerCase());

        if (tradeRecord) {
          const outcome = simulateTradeOutcome(tradeRecord, normalizedCandles.slice(index + 1), options);
          if (!outcome) {
            continue;
          }

          recordTradeOutcome(diagnostics, outcome);
          trades.push({
            ...tradeRecord,
            ...outcome,
            result: outcome.outcome,
            rResult: outcome.r,
          });
        }
      }
    }

    if (retestConfig.enabled && record.signal === 'WAIT_RETEST') {
      const pending = createPendingRetest({
        record,
        setup: filteredSetup,
        candle: normalizedCandles[index],
        pair,
        timeframe,
        strategy,
        index,
        retestConfig,
        pendingId: ++pendingRetestId,
      });
      pendingRetests.push(pending);
      retestDiagnostics.push(pending);
      diagnostics.pendingRetestCreatedCount += 1;
    }

    if (!record.actionableEligible) {
      continue;
    }

    const outcome = simulateTradeOutcome(record, normalizedCandles.slice(index + 1), options);
    if (!outcome) {
      continue;
    }
    recordTradeOutcome(diagnostics, outcome);

    trades.push({
      ...record,
      ...outcome,
      result: outcome.outcome,
      rResult: outcome.r,
    });
  }

  return {
    ...calculatePerformance(trades, signalBreakdown, signalValidityBreakdown),
    diagnostics,
    retestDiagnostics,
    signals,
    trades,
    pair,
    timeframe,
    candleCount: normalizedCandles.length,
    integrity,
    ...strategy,
  };
}
