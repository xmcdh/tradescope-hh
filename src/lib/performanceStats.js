import { readSignalLog } from './signalLogger.js';

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxDrawdown(values) {
  let equity = 0;
  let peak = 0;
  let max = 0;

  values.forEach((value) => {
    equity += value;
    peak = Math.max(peak, equity);
    max = Math.max(max, peak - equity);
  });

  return max;
}

function summarize(entries) {
  const closed = entries.filter((entry) => ['WIN', 'LOSS', 'EXPIRED'].includes(entry.status));
  const wins = closed.filter((entry) => entry.status === 'WIN');
  const losses = closed.filter((entry) => entry.status === 'LOSS');
  const expired = closed.filter((entry) => entry.status === 'EXPIRED');
  const returns = closed.map((entry) => Number(entry.realizedR ?? 0)).filter(Number.isFinite);

  return {
    totalSignals: entries.length,
    totalTrades: closed.length,
    openSignals: entries.filter((entry) => entry.status === 'OPEN').length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 2) : 0,
    expectancy: round(mean(returns)),
    avgR: round(mean(returns)),
    maxDrawdown: round(maxDrawdown(returns)),
    falsePosRate: closed.length ? round(((losses.length + expired.length) / closed.length) * 100, 2) : 0,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
  };
}

function groupMetrics(entries, key) {
  const groups = new Map();

  entries.forEach((entry) => {
    const value = entry[key] ?? 'UNKNOWN';
    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(entry);
  });

  return Object.fromEntries(
    [...groups.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([group, items]) => [group, summarize(items)]),
  );
}

function buildEquityCurve(entries) {
  let equity = 0;

  return entries
    .filter((entry) => ['WIN', 'LOSS', 'EXPIRED'].includes(entry.status))
    .sort((left, right) => (left.exitTimestamp ?? left.timestamp) - (right.exitTimestamp ?? right.timestamp))
    .map((entry, index) => {
      equity += Number(entry.realizedR ?? 0);
      return {
        index: index + 1,
        equity: round(equity),
        timestamp: entry.exitTimestamp ?? entry.timestamp,
      };
    });
}

export function computePerformanceStats(entries) {
  const list = Array.isArray(entries) ? entries : [];

  return {
    overall: summarize(list),
    perPair: groupMetrics(list, 'pair'),
    perTimeframe: groupMetrics(list, 'timeframe'),
    perSignalValidity: groupMetrics(list, 'signalValidity'),
    equityCurve: buildEquityCurve(list),
  };
}

export async function loadPerformanceStats() {
  const entries = await readSignalLog();
  return computePerformanceStats(entries);
}
