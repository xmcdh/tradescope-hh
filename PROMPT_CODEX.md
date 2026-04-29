# PROMPT UNTUK CLAUDE CODE / CODEX
## Versi TradeScope tanpa API AI

---

## STEP 1 — Jalankan agent coding

```bash
npx claude
```

---

## STEP 2 — Paste prompt ini

```text
Build a personal crypto futures signal dashboard called TradeScope from scratch.

Tech stack:
- React + Vite + TailwindCSS
- Binance public WebSocket + REST API for real-time price and klines
- Bybit REST fallback for pairs not available on Binance
- npm package "technicalindicators" for EMA, RSI, MACD
- lightweight-charts for mini candlestick charts

Do NOT use Claude API, Anthropic SDK, or any paid AI API.
Do NOT create a .env file.

Project structure to create:
TradeScope/
├── src/
│   ├── components/
│   │   ├── WatchlistPanel.jsx
│   │   ├── SignalCard.jsx
│   │   ├── IndicatorBadge.jsx
│   │   ├── ConfidenceBar.jsx
│   │   ├── TelegramCopy.jsx
│   │   └── PromptCopy.jsx
│   ├── hooks/
│   │   ├── useMarketData.js
│   │   ├── useIndicators.js
│   │   └── useSignalEngine.js
│   ├── lib/
│   │   ├── indicators.js
│   │   ├── signalLogic.js
│   │   ├── formatSignal.js
│   │   ├── formatAIPrompt.js
│   │   └── marketData.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── package.json
└── vite.config.js

=== CORE FEATURES TO BUILD ===

1. MARKET DATA
- Default timeframe: 15m
- Fetch 200 candles from Binance REST first
- Subscribe to Binance kline stream for live updates when pair exists
- If Binance symbol is unavailable, fall back to Bybit linear market klines
- Show exchange badge on each card: Binance or Bybit
- Store candles as array of { time, open, high, low, close, volume }

2. INDICATOR ENGINE
Calculate:
- EMA(20), EMA(50), EMA(200)
- RSI(14)
- MACD(12,26,9) => { macd, signal, histogram }
- Volume spike when current volume > 1.5x average of last 20 candles
- Support = lowest low of last 20 candles
- Resistance = highest high of last 20 candles

3. SIGNAL ENGINE
3-layer confluence:

Layer 1 - Trend:
  BULLISH if price > EMA20 > EMA50 > EMA200
  BEARISH if price < EMA20 < EMA50 < EMA200
  else NEUTRAL

Layer 2 - Momentum:
  LONG if RSI between 45-65 and MACD > signal and histogram > 0
  SHORT if RSI between 35-55 and MACD < signal and histogram < 0

Layer 3 - Level:
  LONG if price is within 1.5% above support
  SHORT if price is within 1.5% below resistance

Confidence score = count satisfied layers (0-3)
Signal:
  score >= 2 and trend BULLISH => LONG
  score >= 2 and trend BEARISH => SHORT
  else WAIT

Auto-calculate setup:
  LONG:
    entry1 = current price
    entry2 = support
    tp1 = entry1 * 1.025
    tp2 = entry1 * 1.06
    sl = support * 0.985
  SHORT:
    entry1 = current price
    entry2 = resistance
    tp1 = entry1 * 0.975
    tp2 = entry1 * 0.94
    sl = resistance * 1.015

4. UI DASHBOARD
Dark trading-terminal style layout:
- Left sidebar: watchlist and add/remove pair input
- Main area: responsive signal card grid
- Each signal card must show:
  * Pair name
  * Exchange source badge
  * Current price live update
  * Signal badge LONG / SHORT / WAIT
  * Confidence bar score/3
  * Entry zone, TP1, TP2, SL
  * EMA / RSI / MACD / Volume badges
  * Two buttons: "Copy AI Prompt" and "Copy Signal"
  * Mini candlestick chart using lightweight-charts

5. COPY SIGNAL
When "Copy Signal" is clicked, copy this format:

🚨 TRADESCOPE SIGNAL

Pair: {PAIR}/USDT
Type: {LONG/SHORT/WAIT} | Leverage: 20X
Confidence: {emoji label}

📍 ENTRY ZONE:
1) {entry1}
2) {entry2}

🎯 TARGETS:
🥇 {tp1} (Close 80%)
🥈 {tp2} (Close 20%)

🛑 STOP LOSS: {sl}

📊 Basis:
{indicator summary}

⚠️ Personal analysis only. Not financial advice.

6. COPY AI PROMPT
Replace any "AI Analyze" feature with "Copy AI Prompt".
When clicked, generate a complete analysis prompt in Indonesian and copy it to clipboard.
The prompt must include:
- Pair, exchange, timeframe, current price
- EMA20/50/200 with bullish/bearish interpretation
- RSI value and interpretation
- MACD state and histogram state
- Volume spike status
- Support and resistance
- Signal type, confidence, entry1, entry2, tp1, tp2, sl
- Four questions:
  1. Apakah setup ini valid secara teknikal?
  2. Ada risiko yang perlu diperhatikan?
  3. Level entry mana yang lebih aman?
  4. Saran manajemen posisi?
- Closing line: "Jawab singkat dan objektif. Ini untuk analisis pribadi."

7. WATCHLIST
- Default pairs: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT
- Allow user to add symbols like UBUSDT, BASUSDT, CHIPUSDT
- Persist watchlist in localStorage

8. HISTORY
- Save copy actions to localStorage
- Track whether user copied signal or AI prompt
- Show recent history in a simple panel

=== STYLING ===
Use TailwindCSS with a distinctive dark theme:
- background: #070b14
- surface: #0f1726
- border: #1c2840
- text primary: #e5f0ff
- text muted: #7f8da9
- long accent: #22c55e
- short accent: #f43f5e
- neutral accent: #94a3b8
- secondary accent: #38bdf8

Make it feel like a focused personal trading tool, not a template dashboard.

After creating files, run:
1. npm install
2. npm run build
```

---

## STEP 3 — Pair tambahan yang sering perlu fallback

Jika pair seperti `UB`, `BAS`, atau `CHIP` tidak tersedia di Binance, gunakan prompt tambahan ini:

```text
Improve the market data layer so Binance is tried first, but if REST or websocket setup fails for a symbol, the app automatically switches that symbol to Bybit polling mode. Keep the same UI and indicator logic. Add a visible fallback notice on the card when polling instead of streaming is being used.
```

---

## STEP 4 — Prompt revisi tombol

Jika hasil awal masih punya tombol `AI Analyze`, gunakan ini:

```text
Replace every AI Analyze button, label, handler, and component with Copy AI Prompt. Remove any API integration and instead generate a ready-to-paste Indonesian prompt string that includes all current technical data from the card, then copy it to the clipboard.
```

---

## Catatan

1. Tidak perlu `.env`.
2. Tidak perlu API key.
3. Versi ini sengaja pakai flow manual copy-paste ke AI gratis.
4. Nama aplikasi harus selalu `TradeScope`, bukan `SigmaEdge`.
