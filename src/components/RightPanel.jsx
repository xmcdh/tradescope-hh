import { useMemo, useState } from 'react';
import { buildAIPrompt } from '../lib/formatAIPrompt';
import { formatPrice } from '../lib/indicators';
import { DATA_FRESH_MS } from '../lib/marketData';
import { buildSignalText } from '../lib/formatSignal';

function CopyButton({ label, kind = 'ghost', onClick, feedback }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-medium transition ${
        kind === 'primary'
          ? 'bg-[var(--accent-green)] text-[var(--bg-primary)] hover:brightness-110'
          : 'border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent-blue)]'
      }`}
    >
      {feedback || label}
    </button>
  );
}

function IndicatorRail({ label, value, width, color }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        <span>{label}</span>
        <span className="font-mono text-[var(--text-primary)]">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-primary)]">
        <div className="h-2 rounded-full" style={{ width, backgroundColor: color }} />
      </div>
    </div>
  );
}

function rsiGauge(rsi) {
  const safe = Number.isFinite(rsi) ? Math.max(0, Math.min(100, rsi)) : 0;
  return `conic-gradient(from 180deg, var(--accent-red) 0deg 54deg, var(--accent-yellow) 54deg 126deg, var(--accent-green) 126deg 180deg, #1a1a22 180deg 360deg), conic-gradient(from 180deg, transparent 0deg ${safe * 1.8}deg, rgba(20,20,24,0.9) ${safe * 1.8}deg 360deg)`;
}

function macdBarClass(value) {
  return value >= 0 ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]';
}

function freshnessLabel(snapshot) {
  if (snapshot?.error) {
    return 'failed';
  }

  if (!snapshot?.updatedAt) {
    return 'waiting';
  }

  return Date.now() - snapshot.updatedAt < DATA_FRESH_MS ? 'fresh' : 'stale';
}

export default function RightPanel({ open, selectedSymbol, snapshot, history, onClose, onCopyAction }) {
  const [feedback, setFeedback] = useState('');

  const metrics = useMemo(() => {
    if (!snapshot?.setup || !snapshot?.indicators) {
      return null;
    }

    const { setup, indicators } = snapshot;
    const reward = setup.entry1 ? ((setup.tp1 - setup.entry1) / setup.entry1) * 100 : null;
    const risk = setup.entry1 ? (Math.abs(setup.entry1 - setup.sl) / setup.entry1) * 100 : null;
    const rr = reward && risk ? reward / risk : null;
    const supportDistance = indicators.support ? ((indicators.price - indicators.support) / indicators.support) * 100 : null;
    const resistanceDistance = indicators.resistance ? ((indicators.resistance - indicators.price) / indicators.resistance) * 100 : null;

    return {
      reward,
      risk,
      rr,
      supportDistance,
      resistanceDistance,
    };
  }, [snapshot]);

  async function copySignal() {
    if (!snapshot?.setup || !snapshot?.indicators || !selectedSymbol) {
      return;
    }

    const text = buildSignalText({
      symbol: selectedSymbol.replace(/USDT$/i, ''),
      indicators: snapshot.indicators,
      setup: snapshot.setup,
    });
    await navigator.clipboard.writeText(text);
    setFeedback('Signal copied');
    window.setTimeout(() => setFeedback(''), 1500);
    onCopyAction?.({
      symbol: selectedSymbol,
      action: 'Copy Signal',
      signal: snapshot.setup.signal,
      payload: text,
    });
  }

  async function copyPrompt() {
    if (!snapshot?.setup || !snapshot?.indicators || !selectedSymbol) {
      return;
    }

    const text = buildAIPrompt({
      symbol: selectedSymbol.replace(/USDT$/i, ''),
      exchange: snapshot.exchange,
      timeframe: snapshot.timeframe,
      indicators: snapshot.indicators,
      setup: snapshot.setup,
      mode: snapshot.mode,
    });
    await navigator.clipboard.writeText(text);
    setFeedback('Prompt copied');
    window.setTimeout(() => setFeedback(''), 1500);
    onCopyAction?.({
      symbol: selectedSymbol,
      action: 'Copy AI Prompt',
      signal: snapshot.setup.signal,
      payload: text,
    });
  }

  async function recopy(payload) {
    if (!payload) {
      return;
    }

    await navigator.clipboard.writeText(payload);
    setFeedback('Re-copied');
    window.setTimeout(() => setFeedback(''), 1500);
  }

  const panelClass = open
    ? 'translate-x-0 opacity-100'
    : 'pointer-events-none translate-x-8 opacity-0 2xl:pointer-events-auto 2xl:translate-x-0 2xl:opacity-100';

  return (
    <>
      <div
        className={`right-panel fixed inset-y-0 right-0 z-40 w-[320px] overflow-y-auto overflow-x-hidden border-l border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[0_24px_48px_rgba(0,0,0,0.45)] transition-all duration-200 2xl:relative 2xl:inset-auto 2xl:z-0 2xl:h-screen 2xl:w-[280px] 2xl:translate-x-0 2xl:opacity-100 2xl:shadow-none ${panelClass}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Selected Signal</div>
            <div className="mt-1 font-medium text-[var(--text-primary)]">{selectedSymbol?.replace(/USDT$/i, '') || 'No pair'}/USDT</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] 2xl:hidden"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 pb-8">
          <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Setup</div>
              <div className="rounded-full border border-[var(--border)] px-3 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                {snapshot?.setup?.signal ?? 'WAIT'}
              </div>
            </div>

            <div className="mt-4">
              <IndicatorRail
                label="Confidence"
                value={`${snapshot?.setup?.score ?? 0}/3`}
                width={`${((snapshot?.setup?.score ?? 0) / 3) * 100}%`}
                color={
                  snapshot?.setup?.signal === 'LONG'
                    ? '#00e676'
                    : snapshot?.setup?.signal === 'SHORT'
                      ? '#ff1744'
                      : '#ffc400'
                }
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Entry</div>
                <div className="mt-1 font-mono text-right text-[var(--text-primary)]">{formatPrice(snapshot?.setup?.entry1)}</div>
                <div className="font-mono text-right text-[var(--text-secondary)]">{formatPrice(snapshot?.setup?.entry2)}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Targets</div>
                <div className="mt-1 font-mono text-right text-[var(--text-primary)]">{formatPrice(snapshot?.setup?.tp1)}</div>
                <div className="font-mono text-right text-[var(--text-secondary)]">{formatPrice(snapshot?.setup?.tp2)}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Stop Loss</div>
                <div className="mt-1 font-mono text-right text-[var(--accent-red)]">{formatPrice(snapshot?.setup?.sl)}</div>
                <div className="text-right text-[11px] text-[var(--text-secondary)]">
                  {metrics?.risk ? `${metrics.risk.toFixed(2)}% risk` : '--'}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Risk / Reward</div>
                <div className="mt-1 font-mono text-right text-[var(--text-primary)]">{metrics?.rr ? metrics.rr.toFixed(2) : '--'}</div>
                <div className="text-right text-[11px] text-[var(--text-secondary)]">
                  {metrics?.reward ? `${metrics.reward.toFixed(2)}% reward` : '--'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              <CopyButton label="Copy Signal" kind="primary" onClick={copySignal} feedback={feedback === 'Signal copied' ? 'Copied!' : ''} />
              <CopyButton label="Copy AI Prompt" onClick={copyPrompt} feedback={feedback === 'Prompt copied' ? 'Copied!' : ''} />
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Indicators</div>
            <div className="mt-4 space-y-4">
              <IndicatorRail label="EMA20" value={formatPrice(snapshot?.indicators?.ema20)} width="100%" color="#448aff" />
              <IndicatorRail label="EMA50" value={formatPrice(snapshot?.indicators?.ema50)} width="78%" color="#ff6d00" />
              <IndicatorRail label="EMA200" value={formatPrice(snapshot?.indicators?.ema200)} width="58%" color="#aa44ff" />

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">RSI Gauge</div>
                <div className="mt-4 flex items-center justify-center">
                  <div
                    className="relative h-28 w-28 rounded-full"
                    style={{ background: rsiGauge(snapshot?.indicators?.rsi) }}
                  >
                    <div className="absolute inset-[16px] flex items-center justify-center rounded-full bg-[var(--bg-primary)] font-mono text-lg text-[var(--text-primary)]">
                      {snapshot?.indicators?.rsi ? snapshot.indicators.rsi.toFixed(0) : '--'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">MACD Histogram</div>
                <div className="flex h-16 items-end gap-1">
                  {(snapshot?.indicators?.macdSeriesTail ?? []).map((bar) => (
                    <div
                      key={`${bar.index}-${bar.histogram}`}
                      className={`flex-1 rounded-t ${macdBarClass(bar.histogram)}`}
                      style={{ height: `${Math.max(10, Math.abs(bar.histogram) * 100000)}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <div className="uppercase tracking-[0.18em] text-[var(--text-muted)]">Volume</div>
                  <div className="mt-2 inline-flex rounded-full border border-[var(--border)] px-3 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                    {snapshot?.indicators?.volumeSpike ? 'SPIKE' : 'NORMAL'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <div className="uppercase tracking-[0.18em] text-[var(--text-muted)]">Support</div>
                  <div className="mt-2 font-mono text-[var(--text-primary)]">{formatPrice(snapshot?.indicators?.support)}</div>
                  <div className="text-[var(--text-secondary)]">
                    {metrics?.supportDistance ? `${metrics.supportDistance.toFixed(2)}% away` : '--'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <div className="uppercase tracking-[0.18em] text-[var(--text-muted)]">Resistance</div>
                  <div className="mt-2 font-mono text-[var(--text-primary)]">{formatPrice(snapshot?.indicators?.resistance)}</div>
                  <div className="text-[var(--text-secondary)]">
                    {metrics?.resistanceDistance ? `${metrics.resistanceDistance.toFixed(2)}% away` : '--'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <div className="uppercase tracking-[0.18em] text-[var(--text-muted)]">Feed</div>
                  <div className="mt-2 font-mono text-[var(--text-primary)]">{snapshot?.exchange ?? '--'}</div>
                  <div className="text-[var(--text-secondary)]">
                    {(snapshot?.mode ?? '--')} · {freshnessLabel(snapshot)}
                  </div>
                </div>
              </div>

              {snapshot?.warning ? (
                <div className="rounded-2xl border border-[var(--accent-yellow)]/20 bg-[var(--accent-yellow)]/10 px-3 py-3 text-xs text-[var(--accent-yellow)]">
                  {snapshot.warning}
                </div>
              ) : null}

              {snapshot?.error ? (
                <div className="rounded-2xl border border-[var(--accent-yellow)]/20 bg-[var(--accent-yellow)]/10 px-3 py-3 text-xs text-[var(--accent-yellow)]">
                  {snapshot.error}
                </div>
              ) : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Copy History</div>
              <div className="text-[11px] text-[var(--text-secondary)]">Last 5</div>
            </div>

            <div className="space-y-2">
              {history.length ? (
                history.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs text-[var(--text-primary)]">
                        {item.time} | {item.symbol.replace(/USDT$/i, '')}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">{item.signal}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => recopy(item.payload)}
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]"
                    >
                      ⧉
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--text-muted)]">
                  No copied signals yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {open ? <div className="fixed inset-0 z-30 bg-black/50 2xl:hidden" onClick={onClose} /> : null}
    </>
  );
}
