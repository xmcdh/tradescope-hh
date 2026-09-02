function clean(value) {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'number' && !Number.isFinite(value)) return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatScan(scan) {
  const h = scan?.htf ?? {};
  const s = scan?.setup ?? {};
  const d = scan?.derivatives ?? {};
  const oi = d?.openInterest ?? {};
  const ls = d?.longShort ?? {};
  const taker = d?.taker ?? {};
  const r = scan?.ranking ?? {};
  const flowBase = Number(taker?.buyVolume) + Number(taker?.sellVolume);
  const takerDeltaRatio = Number.isFinite(taker?.delta) && flowBase > 0 ? taker.delta / flowBase : null;
  return [
    `### ${clean(scan?.symbol)}`,
    `Price: ${clean(scan?.price)}`,
    `System ranking score: ${clean(r.score)}/100 (ranking only, NOT a trade instruction)`,
    `System direction context: ${clean(r.direction)}`,
    `Data quality: ${clean(scan?.dataQuality)}`,
    '',
    '4H CONTEXT',
    `Trend: ${clean(h.trend)}`,
    `Structure: ${clean(h.structure)}`,
    `EMA20/50/200: ${clean(h.ema20)} / ${clean(h.ema50)} / ${clean(h.ema200)}`,
    `RSI14: ${clean(h.rsi14)}`,
    `MACD: ${clean(h.macd)}`,
    `ATR14: ${clean(h.atr14)}`,
    `Support / Resistance: ${clean(h.support)} / ${clean(h.resistance)}`,
    `BOS: ${clean(h.bos)}`,
    '',
    '15M SETUP',
    `Trend: ${clean(s.trend)}`,
    `Structure: ${clean(s.structure)}`,
    `EMA20/50/200: ${clean(s.ema20)} / ${clean(s.ema50)} / ${clean(s.ema200)}`,
    `RSI14: ${clean(s.rsi14)}`,
    `MACD: ${clean(s.macd)}`,
    `ATR14: ${clean(s.atr14)}`,
    `Volume ratio: ${clean(s.volumeRatio)}x`,
    `BOS: ${clean(s.bos)}`,
    `Retest: ${clean(s.retest)}`,
    `Failed retest: ${clean(s.failedRetest)}`,
    `Liquidity sweep: ${clean(s.liquiditySweep)}`,
    `Support / Resistance: ${clean(s.support)} / ${clean(s.resistance)}`,
    '',
    'DERIVATIVES',
    `Funding: ${clean(d.fundingRate ?? d.funding)}`,
    `Open interest: ${clean(oi.current)}`,
    `OI change 1H: ${clean(oi.change1hPct)}%`,
    `OI change 4H: ${clean(oi.change4hPct)}%`,
    `Long/Short ratio: ${clean(ls.longShortRatio)}`,
    `Long account % / Short account %: ${clean(ls.longAccount)} / ${clean(ls.shortAccount)}`,
    `Taker buy/sell ratio: ${clean(taker.buySellRatio)}`,
    `Taker delta: ${clean(taker.delta)}`,
    `Taker delta ratio: ${clean(takerDeltaRatio)}`,
    `Windowed CVD: ${clean(taker.cvd)}`,
  ].join('\n');
}

export function buildBatchAIPrompt(scans = [], options = {}) {
  const mode = options.mode === '15m' ? '15M ultra-short-term' : options.mode === '4h' ? '4H short-term' : '4H context + 15M setup';
  const timestamp = options.timestamp ?? new Date().toISOString();
  const ordered = [...scans].sort((a, b) => (b?.ranking?.score ?? 0) - (a?.ranking?.score ?? 0));

  return [
    'BINANCE FUTURES MARKET SCAN',
    `Snapshot time: ${timestamp}`,
    `Analysis mode: ${mode}`,
    '',
    'IMPORTANT:',
    'The system score is an objective ranking aid only. Do not treat it as a pre-generated LONG or SHORT signal.',
    'Analyze the raw market facts independently. If the data is incomplete or contradictory, prefer WAIT/NO TRADE.',
    'Do not invent missing prices, indicators, derivatives data, entries, stops, targets, or liquidity events.',
    '',
    'TASK:',
    '1. Rank the entire watchlist from best to worst opportunity.',
    '2. Independently determine LONG, SHORT, WAIT, or NO TRADE for each relevant candidate.',
    '3. Separate 4H directional context from the 15M execution setup.',
    '4. Identify trend alignment, BOS, retest, liquidity sweep/reclaim, momentum, volume, OI, funding and taker-flow confluence.',
    '5. Reject chasing when price is extended or too close to opposing support/resistance.',
    '6. For actionable candidates, provide an entry zone, invalidation/SL, TP1, TP2, expected RR and the exact condition that invalidates the setup.',
    '7. Prefer the few highest-quality trades rather than recommending correlated positions across many coins.',
    '8. Explicitly flag stale, partial, or invalid data.',
    '',
    'OUTPUT FORMAT:',
    'A. FULL RANKING TABLE: Rank | Symbol | LONG/SHORT/WAIT/NO TRADE | Confidence | Main reason',
    'B. TOP 3 SETUPS: Symbol | Direction | Entry zone | SL | TP1 | TP2 | RR | Trigger | Invalidation',
    'C. BEST 4H SHORT-TERM IDEA',
    'D. BEST 15M ULTRA-SHORT-TERM IDEA',
    'E. NO-TRADE / AVOID LIST with reasons',
    'F. MARKET RISK: BTC context, broad volatility, and major conflicts in the watchlist.',
    '',
    'MARKET DATA:',
    ordered.map(formatScan).join('\n\n'),
  ].join('\n');
}

export default buildBatchAIPrompt;
