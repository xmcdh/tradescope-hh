function clean(value) { if (value === null || value === undefined || value === '') return '--'; if (typeof value === 'number' && !Number.isFinite(value)) return '--'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
function formatScan(scan, mode) {
  const h = scan?.htf ?? {}, s = scan?.setup ?? {}, d = scan?.derivatives ?? {}, oi = d.openInterest ?? {}, ls = d.longShort ?? {}, taker = d.taker ?? {}, r = scan?.ranking ?? {};
  const score = mode === '4h' ? r.score4h : mode === '15m' ? r.score15m : r.score;
  return [
    `### ${clean(scan?.symbol)} | Selected score ${clean(score)}/100`,
    `Price: ${clean(scan?.price)} | Data quality: ${clean(scan?.dataQuality)}`,
    `4H score: ${clean(r.score4h)}/100 | 15M score: ${clean(r.score15m)}/100`,
    '', '4H CONTEXT',
    `Trend: ${clean(h.trend)} | Structure: ${clean(h.structure)} | BOS: ${clean(h.bos)}`,
    `EMA20/50/200: ${clean(h.ema20)} / ${clean(h.ema50)} / ${clean(h.ema200)}`,
    `RSI14: ${clean(h.rsi14)} | MACD: ${clean(h.macd)} | ATR14: ${clean(h.atr14)}`,
    `Support / Resistance: ${clean(h.support)} / ${clean(h.resistance)}`,
    '', '15M SETUP',
    `Trend: ${clean(s.trend)} | Structure: ${clean(s.structure)} | BOS: ${clean(s.bos)}`,
    `EMA20/50/200: ${clean(s.ema20)} / ${clean(s.ema50)} / ${clean(s.ema200)}`,
    `RSI14: ${clean(s.rsi14)} | MACD: ${clean(s.macd)} | ATR14: ${clean(s.atr14)}`,
    `Volume ratio: ${clean(s.volumeRatio)}x | Retest: ${clean(s.retest)} | Sweep: ${clean(s.liquiditySweep)}`,
    `Failed retest: ${clean(s.failedRetest)} | Support / Resistance: ${clean(s.support)} / ${clean(s.resistance)}`,
    '', 'DERIVATIVES',
    `Funding: ${clean(d.fundingRate ?? d.funding)} | OI: ${clean(oi.current)}`,
    `OI Δ1H / Δ4H: ${clean(oi.change1hPct)}% / ${clean(oi.change4hPct)}%`,
    `Long/Short ratio: ${clean(ls.longShortRatio)} | Long% / Short%: ${clean(ls.longAccount)} / ${clean(ls.shortAccount)}`,
    `Taker buy/sell ratio: ${clean(taker.buySellRatio)} | Delta: ${clean(taker.delta)} | CVD: ${clean(taker.cvd)}`,
  ].join('\n');
}
export function buildBatchAIPrompt(scans = [], options = {}) {
  const mode = options.mode === '15m' ? '15M超短线' : options.mode === '4h' ? '4H短线' : '综合';
  const timestamp = options.timestamp ?? new Date().toISOString();
  const key = options.mode === '4h' ? 'score4h' : options.mode === '15m' ? 'score15m' : 'score';
  const ordered = [...scans].sort((a, b) => (b?.ranking?.[key] ?? 0) - (a?.ranking?.[key] ?? 0));
  return [
    'BINANCE FUTURES MARKET SCAN', `Snapshot time: ${timestamp}`, `Analysis mode: ${mode}`, '',
    'IMPORTANT:',
    '程序评分只用于客观排序，不是交易信号。必须根据原始数据独立判断。',
    '数据缺失、过期或矛盾时，优先 WAIT / NO_TRADE。绝对不要编造缺失数据、价格、入场、止损或止盈。',
    '', 'TASK:',
    '1. 按当前模式对整个自选列表从高到低重新排名。',
    '2. 每个币独立判断 LONG / SHORT / WAIT / NO_TRADE。',
    '3. 4H短线重点看4H趋势、结构、EMA、动量和关键位置；15M只负责寻找更好的入场时机。',
    '4. 15M超短线重点看15M结构、BOS、retest、liquidity sweep/reclaim、成交量、taker flow和OI；4H只作为方向背景。',
    '5. 不追已经明显延伸的价格，不因为排名高就强行交易。',
    '6. 只有证据充分时才给入场区域、SL、TP1、TP2和RR，否则明确等待条件。',
    '7. 识别高度相关的重复仓位风险。',
    '', 'OUTPUT:',
    'A. 完整排名：Rank | Symbol | Direction | Confidence | 核心理由',
    'B. TOP 3：Symbol | Direction | Entry zone | SL | TP1 | TP2 | RR | Trigger | Invalidation',
    'C. 最佳4H短线机会', 'D. 最佳15M超短线机会', 'E. NO_TRADE / AVOID及原因', 'F. 当前整体市场风险',
    '', 'MARKET DATA:', ordered.map((scan) => formatScan(scan, options.mode)).join('\n\n'),
  ].join('\n');
}
export default buildBatchAIPrompt;
