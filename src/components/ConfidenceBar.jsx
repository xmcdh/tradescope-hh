export default function ConfidenceBar({ score }) {
  const width = `${Math.min(Math.max(score, 0), 3) * 33.3333}%`;
  const tone = score >= 3 ? 'bg-long' : score === 2 ? 'bg-amber' : 'bg-short';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
        <span>Confidence</span>
        <span className="font-mono text-text">{score}/3</span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className={`h-2 rounded-full transition-all ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
