import { useEffect, useRef, useState } from 'react';
import { buildAIPrompt } from '../lib/formatAIPrompt';
import { formatPrice } from '../lib/indicators';
import { DATA_FRESH_MS } from '../lib/marketData';
import { buildSignalText } from '../lib/formatSignal';

function signalTone(signal) {
  if (signal === 'LONG') {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/12 text-[var(--accent-green)]';
  }

  if (signal === 'SHORT') {
    return 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/12 text-[var(--accent-red)]';
  }

  if (signal === 'NO_TRADE') {
    return 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]';
  }

  return 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]';
}

function confidenceDots(score) {
  return [0, 1, 2, 3, 4].map((index) => (
    <span
      key={index}
      className={`h-2 w-2 rounded-full ${index < Math.ceil(score / 2) ? 'bg-[var(--accent-green)]' : 'bg-[var(--border)]'}`}
    />
  ));
}

function badgeTone(passed) {
  return passed ? 'border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'border-[var(--border)] text-[var(--text-secondary)]';
}

function cardHoverClass(signal) {
  if (signal === 'LONG') {
    return 'hover:shadow-[0_0_12px_rgba(0,230,118,0.15)]';
  }

  if (signal === 'SHORT') {
    return 'hover:shadow-[0_0_12px_rgba(255,23,68,0.15)]';
  }

  return 'hover:shadow-[0_0_12px_rgba(68,138,255,0.1)]';
}

function formatUpdateTime(updatedAt) {
  if (!updatedAt) {
    return '--';
  }

  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(updatedAt);
}

function relativeAge(updatedAt, now) {
  if (!updatedAt) {
    return '--';
  }

  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  return `${seconds}s ago`;
}

function freshnessState(updatedAt, error, now) {
  if (error) {
    return {
      dotClass: 'text-[var(--accent-red)]',
      label: 'Feed failed',
      detail: 'Check proxy',
    };
  }

  if (!updatedAt) {
    return {
      dotClass: 'text-[var(--accent-orange)]',
      label: 'Waiting for price',
      detail: 'Bootstrapping',
    };
  }

  const age = now - updatedAt;
  if (age < DATA_FRESH_MS) {
    return {
      dotClass: 'text-[var(--accent-green)]',
      label: 'Fresh data',
      detail: '<15s',
    };
  }

  return {
    dotClass: 'text-[var(--accent-orange)]',
    label: 'Stale data',
    detail: '>15s',
  };
}

export default function SignalCard({ symbol, snapshot, selected, onSelect, onCopyAction }) {
  const liveIndicators = snapshot?.indicators ?? null;
  const setup = snapshot?.setup ?? null;
  const exchange = snapshot?.exchange ?? 'Binance via Proxy';
  const mode = snapshot?.mode ?? 'polling';
  const timeframe = snapshot?.timeframe ?? '15m';
  const updatedAt = snapshot?.updatedAt ?? null;
  const loading = snapshot?.loading ?? true;
  const error = snapshot?.error ?? '';
  const warning = snapshot?.warning ?? '';
  const [feedback, setFeedback] = useState('');
  const [flash, setFlash] = useState('');
  const [now, setNow] = useState(Date.now());
  const lastPriceRef = useRef(null);
  const feedState = freshnessState(updatedAt, error, now);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!liveIndicators?.price || lastPriceRef.current === null) {
      lastPriceRef.current = liveIndicators?.price ?? null;
      return;
    }

    if (liveIndicators.price !== lastPriceRef.current) {
      setFlash(liveIndicators.price > lastPriceRef.current ? 'flash-up' : 'flash-down');
      window.setTimeout(() => setFlash(''), 320);
      lastPriceRef.current = liveIndicators.price;
    }
  }, [liveIndicators?.price]);

  function pulseFeedback(message) {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 1500);
  }

  async function copySignal() {
    if (!setup || !liveIndicators) {
      return;
    }

    const payload = buildSignalText({
      symbol: symbol.replace(/USDT$/i, ''),
      indicators: liveIndicators,
      setup,
    });
    await navigator.clipboard.writeText(payload);
    pulseFeedback('Copied!');
    onCopyAction?.({
      symbol,
      action: 'Copy Signal',
      signal: setup.signal,
      payload,
    });
  }

  async function copyPrompt() {
    if (!setup || !liveIndicators) {
      return;
    }

    const payload = buildAIPrompt({
      symbol: symbol.replace(/USDT$/i, ''),
      exchange,
      timeframe,
      indicators: liveIndicators,
      setup,
      mode,
    });
    await navigator.clipboard.writeText(payload);
    pulseFeedback('Copied!');
    onCopyAction?.({
      symbol,
      action: 'Copy AI Prompt',
      signal: setup.signal,
      payload,
    });
  }

  const pairLabel = `${symbol.replace(/USDT$/i, '')}/USDT`;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(symbol)}
      className={`group flex h-full flex-col rounded-3xl border bg-[var(--bg-card)] p-4 text-left transition ${
        selected
          ? 'border-[var(--accent-blue)] shadow-[0_0_0_1px_rgba(68,138,255,0.15)]'
          : 'border-[var(--border)] hover:border-[var(--text-muted)]'
      } ${cardHoverClass(setup?.signal)} ${flash}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{pairLabel}</div>
            <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              {exchange}
            </span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {mode === 'polling' ? '10s price poll / 5m candles' : mode}
          </div>
          <div className="mt-2 font-mono text-right text-lg text-[var(--text-primary)]">{liveIndicators?.price ? formatPrice(liveIndicators.price) : '--'}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] ${signalTone(setup?.signal)} ${
              setup?.score >= 8 && ['LONG', 'SHORT'].includes(setup?.signal) ? 'signal-pulse' : ''
            }`}
          >
            {setup?.signal ?? 'WAIT'}
          </span>
          <div className="flex items-center gap-1" title={`${setup?.score ?? 0}/${setup?.scoreMax ?? 10}`}>
            {confidenceDots(setup?.score ?? 0)}
          </div>
          <div className="max-w-[160px] text-right text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {setup?.entryContext ?? '--'}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-right">
        {[
          ['Entry', formatPrice(setup?.entry1)],
          ['TP1', formatPrice(setup?.tp1)],
          ['TP2', formatPrice(setup?.tp2)],
          ['SL', formatPrice(setup?.sl)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 font-mono text-xs text-[var(--text-primary)]">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${badgeTone(setup?.basis?.[0]?.passed)}`}>
          EMA {setup?.basis?.[0]?.passed ? '✓' : '✗'}
        </span>
        <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          RSI: {liveIndicators?.rsi ? liveIndicators.rsi.toFixed(0) : '--'}
        </span>
        <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${badgeTone(setup?.basis?.[1]?.passed)}`}>
          MACD {setup?.basis?.[1]?.passed ? '✓' : '✗'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            copySignal();
          }}
          className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-primary)] transition hover:border-[var(--accent-blue)]"
        >
          📋 {feedback ? feedback : 'Copy Signal'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            copyPrompt();
          }}
          className="rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-primary)] transition hover:border-[var(--accent-blue)]"
        >
          🤖 {feedback ? feedback : 'Copy AI Prompt'}
        </button>
      </div>

      <div className="mt-auto pt-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className={feedState.dotClass}>●</span>
            <span>{feedState.label}</span>
          </span>
          <span>{timeframe} · {feedState.detail}</span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          <span>Updated {relativeAge(updatedAt, now)}</span>
          <span>{formatUpdateTime(updatedAt)}</span>
        </div>
      </div>

      {loading ? <div className="mt-3 text-xs text-[var(--text-muted)]">Loading market data...</div> : null}
      {setup?.entryAdvice ? <div className="mt-2 text-xs text-[var(--text-muted)]">{setup.entryAdvice}</div> : null}
      {setup?.hardBlock ? <div className="mt-2 text-xs text-[var(--accent-red)]">{setup.hardBlock}</div> : null}
      {warning ? <div className="mt-2 text-xs text-[var(--accent-yellow)]">{warning}</div> : null}
      {error ? <div className="mt-2 text-xs text-[var(--accent-yellow)]">{error}</div> : null}
    </button>
  );
}
