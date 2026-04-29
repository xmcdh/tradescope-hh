import { buildAIPrompt } from '../lib/formatAIPrompt';

export default function PromptCopy({ symbol, exchange, timeframe, indicators, setup, mode, onCopied }) {
  async function handleCopy() {
    const prompt = buildAIPrompt({
      symbol: symbol.replace(/USDT$/i, ''),
      exchange,
      timeframe,
      indicators,
      setup,
      mode,
    });
    if (!prompt) {
      return;
    }

    await navigator.clipboard.writeText(prompt);
    onCopied?.(prompt);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent transition hover:border-accent hover:bg-accent/15"
    >
      Copy AI Prompt
    </button>
  );
}
