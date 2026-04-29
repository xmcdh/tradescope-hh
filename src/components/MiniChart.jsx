import { CandlestickSeries, createChart } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

export default function MiniChart({ candles, signal }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles?.length) {
      return undefined;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 180,
      layout: {
        background: { color: 'transparent' },
        textColor: '#7f8da9',
        fontFamily: 'IBM Plex Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(56, 189, 248, 0.08)' },
        horzLines: { color: 'rgba(56, 189, 248, 0.08)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(127, 141, 169, 0.2)',
      },
      timeScale: {
        borderColor: 'rgba(127, 141, 169, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(56, 189, 248, 0.35)' },
        horzLine: { color: 'rgba(56, 189, 248, 0.35)' },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: signal === 'SHORT' ? '#94a3b8' : '#22c55e',
      downColor: signal === 'LONG' ? '#94a3b8' : '#f43f5e',
      borderVisible: false,
      wickUpColor: signal === 'SHORT' ? '#94a3b8' : '#22c55e',
      wickDownColor: signal === 'LONG' ? '#94a3b8' : '#f43f5e',
    });

    series.setData(candles.slice(-50));
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [candles, signal]);

  return <div ref={containerRef} className="chart-shell h-[180px] w-full overflow-hidden rounded-2xl border border-line bg-ink/60" />;
}
