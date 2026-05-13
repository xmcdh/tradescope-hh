export const CLIENT_SIGNAL_JOURNAL_KEY = 'tradescope:client-signal-journal:v1';

function safeRead() {
  try {
    const raw = window.localStorage.getItem(CLIENT_SIGNAL_JOURNAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(entries) {
  try {
    window.localStorage.setItem(CLIENT_SIGNAL_JOURNAL_KEY, JSON.stringify(entries.slice(0, 500)));
  } catch {}
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Date.now();
  }

  return number > 10_000_000_000 ? Math.floor(number) : Math.floor(number * 1000);
}

export function readClientSignalJournal() {
  if (typeof window === 'undefined') {
    return [];
  }

  return safeRead();
}

export function recordClientSignalJournal({ pair, timeframe, setup, candles }) {
  if (typeof window === 'undefined') {
    return [];
  }

  const direction = setup?.selectedDirection ?? setup?.signal;
  if (!['LONG', 'SHORT'].includes(direction)) {
    return safeRead();
  }

  const lastCandle = candles?.at?.(-1) ?? null;
  const timestamp = normalizeTimestamp(lastCandle?.time ?? setup?.lastUpdate ?? Date.now());
  const id = `client:${pair}:${timeframe}:${direction}:${timestamp}`;
  const current = safeRead();

  if (current.some((entry) => entry.id === id)) {
    return current;
  }

  const nextEntry = {
    id,
    timestamp,
    candleTimestamp: timestamp,
    pair,
    timeframe,
    direction,
    entry: setup?.entry1 ?? lastCandle?.close ?? null,
    stopLoss: setup?.sl ?? null,
    takeProfit: setup?.tp1 ?? null,
    sl: setup?.sl ?? null,
    tp: setup?.tp1 ?? null,
    rr: setup?.rr ?? setup?.rrRatio ?? null,
    score: setup?.confidenceScore ?? setup?.score ?? 0,
    signalValidity: setup?.signalValidity ?? 'VALID',
    setupStatus: setup?.setupStatus ?? 'UNKNOWN',
    proofStatus: setup?.proofStatus ?? 'UNKNOWN',
    status: 'OPEN',
    result: 'OPEN',
    exitPrice: null,
    exitTimestamp: null,
    realizedR: null,
    rResult: null,
    source: 'browser-local',
    createdAt: new Date(timestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
  };
  const next = [nextEntry, ...current].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  safeWrite(next);
  return next;
}

export function mergeSignalJournals(primary = [], fallback = []) {
  const byId = new Map();
  [...fallback, ...primary].forEach((entry) => {
    if (entry?.id) {
      byId.set(entry.id.replace(/^client:/, ''), entry);
    }
  });

  return [...byId.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}
