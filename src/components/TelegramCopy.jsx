import { buildSignalText } from '../lib/formatSignal';

export default function TelegramCopy({ symbol, indicators, setup, onCopied }) {
  async function handleCopy() {
    const text = buildSignalText({ symbol: symbol.replace(/USDT$/i, ''), indicators, setup });
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    onCopied?.(text);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-2xl border border-line bg-white/5 px-4 py-3 text-sm font-semibold text-text transition hover:border-accent/60 hover:bg-accent/10"
    >
      Copy Signal
    </button>
  );
}
