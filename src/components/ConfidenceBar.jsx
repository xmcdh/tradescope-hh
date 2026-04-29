export default function ConfidenceBar({ score }) {
  const width = `${Math.min(Math.max(score, 0), 10) * 10}%`;
  const tone = score >= 8 ? 'bg-long' : score >= 6 ? 'bg-amber' : 'bg-short';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
        <span>Confidence</span>
        <span className="font-mono text-text">{score}/10</span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className={`h-2 rounded-full transition-all ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
