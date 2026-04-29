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

  if (signal === 'NO_TRADE' || signal === 'AVOID') {
    return 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]';
  }

  return 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]';
}

function statusLabel(signal) {
  if (signal === 'LONG') {
    return 'LONG';
  }

  if (signal === 'SHORT') {
    return 'SHORT';
  }

  if (signal === 'AVOID') {
    return 'AVOID — Monitor only';
  }

  if (signal === 'NO_TRADE') {
    return 'NO TRADE — Conditions not met';
  }

  if (signal === 'WAIT_RETEST') {
    return 'WAIT RETEST — No entry yet';
  }

  return 'WAIT — Setup forming';
}

function scoreDots(earned, max) {
  return Array.from({ length: max }).map((_, index) => (
    <span
      key={index}
      className={`h-2 w-2 rounded-full ${index < earned ? 'bg-[var(--accent-green)]' : 'bg-[var(--border)]'}`}
    />
  ));
}

function scoreRows(setup) {
  const items = setup?.scoreBreakdown?.items;
  if (items?.length) {
    return items.map((item) => [item.label, item.points, item.max, item.reason]);
  }

  const breakdown = setup?.scoreBreakdown?.breakdown ?? {};

  return [
    ['Trend', breakdown.trend ?? 0, 2],
    ['RSI Momentum', breakdown.rsiMomentum ?? 0, 1],
    ['MACD', breakdown.macd ?? 0, 1],
    ['Market Structure', breakdown.marketStructure ?? 0, 1],
    ['Key Level', breakdown.keyLevel ?? 0, 1],
    ['Volume', breakdown.volume ?? 0, 1],
    ['R:R Ratio', breakdown.rrRatio ?? 0, 1],
  ];
}

function btcBadgeTone(bias) {
  if (bias === 'BULLISH') {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]';
  }

  if (bias === 'BEARISH') {
    return 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]';
  }

  return 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]';
}

function btcBadgeLabel(bias) {
  if (bias === 'BULLISH') {
    return 'BTC ↑';
  }

  if (bias === 'BEARISH') {
    return 'BTC ↓';
  }

  return 'BTC —';
}

function uniqueWarnings(items) {
  return [...new Set(items.filter(Boolean))];
}

function shouldShowBtcNote(note) {
  return note && !['BTC confirmed.', 'BTC context skipped for BTC itself.'].includes(note);
}

function WarningIcon() {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-yellow)]" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2L19 18H1L10 2Z" fill="currentColor" opacity="0.18" />
      <path d="M10 2L19 18H1L10 2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 7V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 14H10.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
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

function macdState(macd) {
  if (!macd) {
    return 'unavailable';
  }

  if (macd.macd > macd.signal && macd.histogram > 0) {
    return 'bullish';
  }

  if (macd.macd < macd.signal && macd.histogram < 0) {
    return 'bearish';
  }

  return 'mixed';
}

function DebugBlock({ symbol, snapshot }) {
  if (!import.meta.env.DEV) {
    return null;
  }

  const setup = snapshot?.setup;
  const indicators = snapshot?.indicators;
  const data = {
    symbol,
    source: snapshot?.exchange,
    dataFresh: Boolean(snapshot?.updatedAt && Date.now() - snapshot.updatedAt < DATA_FRESH_MS && !snapshot?.error),
    stale: Boolean(setup?.stale),
    candleCount: snapshot?.candles?.length ?? 0,
    timeframe: snapshot?.timeframe,
    marketRegime: setup?.marketRegime,
    technicalScore: setup?.scoreBreakdown?.technicalTotal,
    btcAdjustment: setup?.btcAdjustment,
    fundingOiAdjustment: setup?.fundingOiAdjustment,
    finalScore: setup?.score,
    status: setup?.signal,
    hardBlocks: setup?.hardBlock ? [setup.hardBlock] : [],
    rejectionReasons: setup?.rejectionReasons ?? [],
    warningReasons: setup?.warnings ?? [],
    emaState: `${formatPrice(indicators?.ema20)} / ${formatPrice(indicators?.ema50)} / ${formatPrice(indicators?.ema200)}`,
    rsi: Number.isFinite(indicators?.rsi) ? indicators.rsi.toFixed(1) : null,
    macd: macdState(indicators?.macd),
    volume: indicators?.averageVolume ? `${(indicators.currentVolume / indicators.averageVolume).toFixed(2)}x avg` : null,
    atr: formatPrice(indicators?.atr),
    rrTp1: setup?.rrTp1,
    rrTp2: setup?.rrTp2,
    fundingRate: setup?.fundingRate,
    openInterest: setup?.openInterest,
    btcConfirmation: setup?.btcNote,
  };

  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-[var(--accent-yellow)]/20 bg-[var(--bg-primary)] p-3 text-[10px] leading-4 text-[var(--text-secondary)]">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function SignalCard({ symbol, snapshot, selected, onSelect, onCopyAction, debugMode = false }) {
  const liveIndicators = snapshot?.indicators ?? null;
  const setup = snapshot?.setup ?? null;
  const exchange = snapshot?.exchange ?? 'Binance via Proxy';
  const mode = snapshot?.mode ?? 'polling';
  const timeframe = snapshot?.timeframe ?? '15m';
  const updatedAt = snapshot?.updatedAt ?? null;
  const loading = snapshot?.loading ?? true;
  const error = snapshot?.error ?? '';
  const warning = snapshot?.warning ?? '';
  const showBtcBias = symbol.toUpperCase() !== 'BTCUSDT' && setup?.btcBias;
  const executable = ['LONG', 'SHORT'].includes(setup?.signal);
  const waitLike = ['WAIT', 'WAIT_RETEST'].includes(setup?.signal);
  const noTrade = ['NO_TRADE', 'AVOID'].includes(setup?.signal);
  const warningItems = uniqueWarnings([
    ...(setup?.warnings ?? []),
    setup?.rrWarning,
    setup?.levelWarning,
    shouldShowBtcNote(setup?.btcNote) ? setup.btcNote : null,
    setup?.hardBlock,
    warning,
    error,
  ]);
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
      className={`group flex h-full w-full max-w-full flex-col rounded-2xl border bg-[var(--bg-card)] p-3 text-left transition md:rounded-3xl md:p-4 ${
        selected
          ? 'border-[var(--accent-blue)] shadow-[0_0_0_1px_rgba(68,138,255,0.15)]'
          : 'border-[var(--border)] hover:border-[var(--text-muted)]'
      } ${cardHoverClass(setup?.signal)} ${flash}`}
    >
      <div className="grid gap-3 md:flex md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{pairLabel}</div>
            <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              {exchange}
            </span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:tracking-[0.18em]">
            {mode === 'polling' ? '10s price poll / 5m candles' : mode}
          </div>
          <div className="mt-2 font-mono text-lg text-[var(--text-primary)] md:text-right">{liveIndicators?.price ? formatPrice(liveIndicators.price) : '--'}</div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 md:max-w-[210px] md:items-end">
          <div className="flex flex-wrap gap-1.5 md:justify-end">
            <span
              className={`rounded-full border px-2.5 py-1 text-left text-[10px] font-medium uppercase tracking-[0.04em] md:px-3 md:text-right md:tracking-[0.08em] ${signalTone(setup?.signal)} ${
                setup?.score >= 8 && ['LONG', 'SHORT'].includes(setup?.signal) ? 'signal-pulse' : ''
              }`}
            >
              {statusLabel(setup?.signal)}
            </span>
            {showBtcBias ? (
              <span
                title={setup?.btcNote}
                className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${btcBadgeTone(setup.btcBias)}`}
              >
                {btcBadgeLabel(setup.btcBias)}
              </span>
            ) : null}
          </div>
          {setup?.entryContext || setup?.entryAdvice ? (
            <div className="w-full rounded-2xl border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--accent-blue)] bg-[var(--bg-primary)] px-3 py-2 text-left md:text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-primary)] md:tracking-[0.12em]">{setup?.entryContext ?? '--'}</div>
              <div className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">{setup?.entryAdvice ?? '--'}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 md:mt-4">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:tracking-[0.18em]">
          <span>Score Breakdown</span>
          <span className="font-mono text-[var(--text-primary)]">{setup?.score ?? 0}/{setup?.scoreMax ?? 10}</span>
        </div>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:tracking-[0.18em]">
          <span>Regime</span>
          <span className="font-mono text-[var(--text-primary)]">{setup?.marketRegime ?? '--'}</span>
        </div>
        <div className="space-y-1.5">
          {scoreRows(setup).map(([label, earned, max, reason]) => (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 text-xs md:gap-2">
              <span className="truncate text-[var(--text-secondary)]" title={reason}>{label}</span>
              <span className="flex items-center gap-1">{scoreDots(earned, max)}</span>
              <span className="font-mono text-[11px] text-[var(--text-primary)]">({earned}/{max})</span>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
          {(setup?.scoreBreakdown?.adjustments ?? []).map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[var(--text-secondary)]" title={item.reason}>{item.label}</span>
              <span className={`font-mono ${item.points < 0 ? 'text-[var(--accent-red)]' : item.points > 0 ? 'text-[var(--accent-green)]' : 'text-[var(--text-primary)]'}`}>
                {item.points > 0 ? '+' : ''}{item.points}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-xs">
          <span className="uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Tech {setup?.scoreBreakdown?.technicalTotal ?? 0} + Adj {setup?.scoreBreakdown?.adjustmentTotal ?? 0}
          </span>
          <span className="font-mono text-[var(--text-primary)]">{setup?.score ?? 0}/{setup?.scoreMax ?? 10}</span>
        </div>
      </div>

      {noTrade ? (
        <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3 text-xs leading-5 text-[var(--text-secondary)] md:mt-4">
          <div className="font-medium text-[var(--text-primary)]">No entry recommended.</div>
          <div className="mt-2 space-y-1">
            {(setup?.rejectionReasons?.length ? setup.rejectionReasons.slice(0, 4) : ['No clear trading edge.']).map((item) => (
              <div key={item}>✗ {item}</div>
            ))}
          </div>
          <div className="mt-2 text-[var(--text-primary)]">{setup?.action ?? 'Wait for stronger confirmation.'}</div>
        </div>
      ) : waitLike ? (
        <div className="mt-3 grid grid-cols-1 gap-2 text-right min-[390px]:grid-cols-3 md:mt-4">
          {[
            ['Breakout', formatPrice(setup?.watchLevels?.breakoutLevel)],
            ['Retest', formatPrice(setup?.watchLevels?.retestArea)],
            ['Invalid', formatPrice(setup?.watchLevels?.invalidation)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</div>
              <div className="mt-1 font-mono text-xs text-[var(--text-primary)]">{value}</div>
            </div>
          ))}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-left text-xs text-[var(--text-secondary)] min-[390px]:col-span-3">
            {setup?.action ?? 'No entry yet.'}
          </div>
        </div>
      ) : executable ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-right min-[390px]:grid-cols-4 md:mt-4">
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
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2 min-[390px]:grid-cols-2 md:mt-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            copySignal();
          }}
          className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-primary)] transition hover:border-[var(--accent-blue)] md:tracking-[0.18em]"
        >
          📋 {feedback ? feedback : noTrade ? 'Copy No-Trade Summary' : waitLike ? 'Copy Wait Summary' : 'Copy Signal'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            copyPrompt();
          }}
          className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-primary)] transition hover:border-[var(--accent-blue)] md:tracking-[0.18em]"
        >
          🤖 {feedback ? feedback : 'Copy AI Prompt'}
        </button>
      </div>

      <div className="mt-auto pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:tracking-[0.18em]">
          <span className="inline-flex items-center gap-1.5">
            <span className={feedState.dotClass}>●</span>
            <span>{feedState.label}</span>
          </span>
          <span>{timeframe} · {feedState.detail}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:tracking-[0.18em]">
          <span>Updated {relativeAge(updatedAt, now)}</span>
          <span>{formatUpdateTime(updatedAt)}</span>
        </div>
      </div>

      {loading ? <div className="mt-3 text-xs text-[var(--text-muted)]">Loading market data...</div> : null}
      {warningItems.length ? (
        <div className="mt-3 space-y-2">
          {warningItems.map((item) => (
            <div
              key={item}
              className="flex items-start gap-2 rounded-2xl border border-[var(--accent-yellow)]/20 bg-[var(--accent-yellow)]/10 px-3 py-2 text-xs leading-5 text-[var(--accent-yellow)]"
            >
              <WarningIcon />
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : null}

      {debugMode ? <DebugBlock symbol={symbol} snapshot={snapshot} /> : null}
    </button>
  );
}
