import { useMemo, useState } from 'react';
import { useWatchlistScanner } from '../hooks/useWatchlistScanner';
import { buildBatchAIPrompt } from '../lib/formatBatchAIPrompt';
import { DEFAULT_SYMBOLS, WATCHLIST_STORAGE_KEY, normalizeSymbol } from '../lib/marketData';

function loadWatchlist() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]');
    return [...new Set((stored.length ? stored : DEFAULT_SYMBOLS).map((item) => normalizeSymbol(String(item))).filter(Boolean))];
  } catch { return DEFAULT_SYMBOLS; }
}
function fmt(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: digits }) : '--'; }
function trendTone(trend) { return trend === 'BULLISH' ? 'text-emerald-400' : trend === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'; }
function qualityTone(score) { return score >= 85 ? 'text-emerald-400' : score >= 75 ? 'text-yellow-300' : score >= 65 ? 'text-orange-300' : 'text-zinc-500'; }

export default function ScannerDashboard() {
  const [symbols, setSymbols] = useState(loadWatchlist);
  const [mode, setMode] = useState('all');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const { scans } = useWatchlistScanner(symbols, 'conservative', refreshToken);
  const filtered = useMemo(() => scans.filter((scan) => mode === '4h' ? scan.htf?.trend !== 'NEUTRAL' : mode === '15m' ? scan.setup?.trend !== 'NEUTRAL' : true), [mode, scans]);
  const lastDataAt = useMemo(() => { const times = scans.map((scan) => scan.updatedAt).filter(Boolean); return times.length ? new Date(Math.max(...times)).toLocaleTimeString() : '--'; }, [scans]);

  async function copyAll() {
    const text = buildBatchAIPrompt(filtered, { mode, timestamp: new Date().toISOString() });
    await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }
  function addSymbol() {
    const symbol = normalizeSymbol(input); if (!symbol || symbols.includes(symbol)) return;
    const next = [...symbols, symbol]; setSymbols(next); window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next)); setInput('');
  }
  function removeSymbol(symbol) {
    const next = symbols.filter((item) => item !== symbol); const saved = next.length ? next : DEFAULT_SYMBOLS;
    setSymbols(saved); window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(saved));
  }

  return (
    <main className="min-h-screen bg-[#09090b] px-3 py-4 text-zinc-100 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-2xl md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">BINANCE FUTURES</div><h1 className="mt-1 text-2xl font-bold tracking-tight">交易机会排行</h1><p className="mt-1 text-xs text-zinc-500">程序只负责客观数据与排序，最终交易判断交给 AI 和你。</p></div>
            <div className="flex flex-wrap gap-2">
              {[['all', '全部'], ['4h', '4H短线'], ['15m', '15M超短线']].map(([value, label]) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${mode === value ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>{label}</button>)}
              <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300">立即刷新</button>
              <button type="button" onClick={copyAll} className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-300">{copied ? '已复制' : '复制全部AI数据'}</button>
            </div>
          </div>
        </header>
        <section className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />实时行情约10秒更新 · 技术/衍生品约2分钟更新 · 数据 {lastDataAt}</div>
          <div className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addSymbol()} placeholder="添加币种，例如 HYPE" className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs outline-none placeholder:text-zinc-600" /><button type="button" onClick={addSymbol} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300">添加</button></div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80"><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-left text-xs"><thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">币种</th><th className="px-4 py-3">评分</th><th className="px-4 py-3">方向</th><th className="px-4 py-3">4H</th><th className="px-4 py-3">15M</th><th className="px-4 py-3">OI Δ1H</th><th className="px-4 py-3">Taker</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th></tr></thead><tbody>
          {filtered.map((scan) => { const oi = scan.derivatives?.openInterest ?? {}; const taker = scan.derivatives?.taker ?? {}; return <tr key={scan.symbol} className="border-b border-zinc-900 hover:bg-zinc-900/70"><td className="px-4 py-3 font-mono text-zinc-600">{scan.ranking.rank}</td><td className="px-4 py-3"><div className="font-bold">{scan.symbol.replace('USDT', '')}</div><div className="font-mono text-[10px] text-zinc-600">${fmt(scan.price, 6)}</div></td><td className={`px-4 py-3 font-mono text-base font-bold ${qualityTone(scan.ranking.score)}`}>{scan.ranking.score}</td><td className={`px-4 py-3 font-semibold ${trendTone(scan.ranking.direction)}`}>{scan.ranking.direction === 'BULLISH' ? '↑ 做多偏向' : scan.ranking.direction === 'BEARISH' ? '↓ 做空偏向' : '→ 中性'}</td><td className={`px-4 py-3 font-semibold ${trendTone(scan.htf.trend)}`}>{scan.htf.trend}</td><td className={`px-4 py-3 font-semibold ${trendTone(scan.setup.trend)}`}>{scan.setup.trend}</td><td className="px-4 py-3 font-mono text-zinc-300">{fmt(oi.change1hPct)}%</td><td className="px-4 py-3 font-mono text-zinc-300">{fmt(taker.buySellRatio)}</td><td className="px-4 py-3">{scan.dataQuality === 'GOOD' ? <span className="text-emerald-400">正常</span> : <span className="text-orange-300">{scan.dataQuality}</span>}</td><td className="px-4 py-3"><button type="button" onClick={() => removeSymbol(scan.symbol)} className="text-zinc-600 hover:text-red-400">移除</button></td></tr>; })}
        </tbody></table></div></section>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs text-zinc-500"><div className="font-semibold text-zinc-300">评分组成</div><div className="mt-2 grid gap-2 md:grid-cols-3"><div>4H趋势 20 · 4H结构 15</div><div>15M结构 20 · 动量 10 · 成交量 10</div><div>OI 8 · Taker/CVD 7 · Funding 5 · BTC 5</div></div><div className="mt-2">评分仅用于排序，不直接产生下单信号。数据缺失时标记 PARTIAL/INVALID，AI 导出不会补造数据。</div></section>
      </div>
    </main>
  );
}
