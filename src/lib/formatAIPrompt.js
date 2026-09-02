function value(v, fallback = 'N/A') {
  return v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? fallback : String(v);
}
function fixed(v, digits = 4) {
  return v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toFixed(digits);
}
function pct(v, digits = 2) {
  return v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v).toFixed(digits)}%`;
}
function directionBlock(title, data) {
  return [
    title,
    `Trend: ${value(data?.trend)}`,
    `Structure: ${value(data?.structure)}`,
    `EMA20 / EMA50 / EMA200: ${fixed(data?.ema20)} / ${fixed(data?.ema50)} / ${fixed(data?.ema200)}`,
    `RSI14: ${fixed(data?.rsi14, 1)}`,
    `MACD: ${data?.macd ? `MACD ${fixed(data.macd.MACD, 6)}, signal ${fixed(data.macd.signal, 6)}, histogram ${fixed(data.macd.histogram, 6)}` : 'N/A'}`,
    `ATR14: ${fixed(data?.atr14)}`,
    `Support / Resistance: ${fixed(data?.support)} / ${fixed(data?.resistance)}`,
    `BOS: ${data?.bos ? value(data.bos.direction) : 'N/A'}`,
  ].join('\n');
}
function derivativesBlock(d = {}) {
  const oi = d.openInterest ?? {};
  const taker = d.taker ?? {};
  return [
    'Derivatives',
    `Funding: ${value(d.funding ?? d.fundingRate)}`,
    `Open Interest: ${value(oi.current ?? d.openInterest)}`,
    `OI Δ1H / Δ4H: ${pct(oi.change1hPct ?? d.oiChange1h)} / ${pct(oi.change4hPct ?? d.oiChange4h)}`,
    `Long/Short ratio: ${value(d.longShortRatio ?? d.longShort?.ratio)}`,
    `Taker buy / sell: ${value(taker.buyVolume)} / ${value(taker.sellVolume)}`,
    `Taker delta / CVD: ${value(taker.delta ?? d.takerDelta)} / ${value(taker.cvd)}`,
  ].join('\n');
}
function setupBlock(setup) {
  return [
    directionBlock('15M Ultra-short-term Setup', setup),
    `Volume ratio: ${setup?.volumeRatio == null ? 'N/A' : `${Number(setup.volumeRatio).toFixed(2)}x`}`,
    `Retest: ${setup?.retest?.complete ? 'CONFIRMED' : setup?.retest ? 'DETECTED' : 'N/A'}`,
    `Liquidity sweep: ${setup?.liquiditySweep?.detected ? 'DETECTED' : 'N/A'}`,
    `Failed retest: ${setup?.failedRetest?.detected ? 'YES' : 'NO'}`,
  ].join('\n');
}
function buildPrompt(scan, mode = 'all') {
  const ranking = scan?.ranking ?? {};
  const selected = mode === '4h' ? ranking.score4h : mode === '15m' ? ranking.score15m : ranking.score;
  const focus = mode === '4h' ? '4H短线' : mode === '15m' ? '15M超短线' : '综合';
  return [
    '你是独立的加密永续合约交易分析员。以下数据来自程序化市场扫描器。',
    '程序评分只用于排序辅助，不是交易信号。必须根据原始数据独立判断，不得为了给出交易而强行给 LONG/SHORT。',
    '数据缺失、过期、矛盾或结构不成立时，明确给出 WAIT 或 NO_TRADE。不要编造任何缺失数据。',
    '',
    `分析重点: ${focus}`,
    `Symbol: ${value(scan?.symbol)}`,
    `Price: ${value(scan?.price)}`,
    `Selected scanner score: ${value(selected)}/100`,
    `4H scanner score: ${value(ranking.score4h)}/100`,
    `15M scanner score: ${value(ranking.score15m)}/100`,
    `Scanner direction: ${value(ranking.direction)}`,
    `Data quality: ${value(scan?.dataQuality)}`,
    '',
    directionBlock('4H Short-term Context', scan?.htf),
    '',
    setupBlock(scan?.setup),
    '',
    derivativesBlock(scan?.derivatives),
    '',
    `BTC context: ${scan?.btcContext ? JSON.stringify(scan.btcContext) : 'N/A'}`,
    '',
    '请输出：',
    '1. LONG / SHORT / WAIT / NO_TRADE',
    '2. 选择 4H短线 或 15M超短线，并说明为什么',
    '3. 当前结构：趋势、HH/HL或LH/LL、BOS、回踩、流动性扫单、reclaim',
    '4. 多空双方最关键的证据，分别列出',
    '5. 是否追价，还是等待回踩/确认',
    '6. 如果可以交易，给出合理的入场区域、止损失效位、TP1、TP2和估算RR。没有足够依据就不要编造价格',
    '7. 最大风险和最重要的NO_TRADE条件',
    '8. 最终置信度：HIGH / MEDIUM / LOW',
    '',
    '对于15M超短线，优先关注最近结构、BOS/retest/sweep/reclaim、成交量、taker flow和OI变化。',
    '对于4H短线，优先关注4H趋势、结构、EMA排列、动量、关键支撑阻力，再用15M作为入场时机参考。',
    '这是人工交易辅助分析，不执行任何自动下单。',
    '回答简洁、客观、可执行，不要重复数据表。',
  ].join('\n');
}

export function buildAIPrompt(scan, options = {}) {
  if (!scan?.htf && !scan?.setup) return '';
  return buildPrompt(scan, options.mode ?? 'all');
}
