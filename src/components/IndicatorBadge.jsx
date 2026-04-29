export default function IndicatorBadge({ label, value, tone = 'neutral' }) {
  const tones = {
    positive: 'border-long/30 bg-long/10 text-long',
    negative: 'border-short/30 bg-short/10 text-short',
    warning: 'border-amber/30 bg-amber/10 text-amber',
    neutral: 'border-line bg-white/5 text-muted',
  };

  return (
    <div className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${tones[tone]}`}>
      <span>{label}</span>
      <span className="ml-2 font-mono text-[11px] normal-case tracking-normal">{value}</span>
    </div>
  );
}
