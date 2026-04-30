# TradeScope — Personal Crypto Futures Signal Dashboard
## Project Plan v2.0

---

## Tujuan Proyek

Dashboard trading pribadi untuk memantau pair futures crypto secara real-time dan menghasilkan setup:
- Pair, Type (LONG/SHORT/WAIT), confidence score
- Entry Zone, Target (TP1, TP2), Stop Loss
- Format signal siap copy ke Telegram
- Prompt AI siap copy ke Claude.ai / ChatGPT / Gemini tanpa API berbayar

**Untuk analisis pribadi. Bukan layanan sinyal publik.**

---

## Arsitektur

```text
┌──────────────────────────────────────────────┐
│              TradeScope Frontend             │
│          React + Vite + TailwindCSS          │
│                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Watchlist│  │ Signal Grid│  │ History  │ │
│  │  Panel   │  │ + MiniChart│  │  Panel   │ │
│  └──────────┘  └────────────┘  └──────────┘ │
└───────────────┬───────────────────────┬──────┘
                │                       │
      ┌─────────▼─────────┐   ┌────────▼────────┐
      │ Binance Public API │   │ Bybit Fallback  │
      │ WS + REST klines   │   │ REST klines     │
      │ - ticker / kline   │   │ - custom pairs  │
      └─────────┬──────────┘   └────────┬────────┘
                │                       │
                └──────────┬────────────┘
                           │
                  ┌────────▼────────┐
                  │ Indicator Engine │
                  │ EMA / RSI / MACD │
                  │ Volume / S-R     │
                  │ Signal Confluence│
                  └──────────────────┘
```

---

## Struktur Folder

```text
TradeScope/
├── public/
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
```

---

## Logic Sinyal

### Layer 1 — Trend Filter (EMA)

```text
BULLISH: Harga > EMA20 > EMA50 > EMA200
BEARISH: Harga < EMA20 < EMA50 < EMA200
NEUTRAL: Alignment tidak jelas
```

### Layer 2 — Momentum (RSI + MACD)

```text
LONG trigger:
  - RSI 45-65
  - MACD line > signal line
  - Histogram positif

SHORT trigger:
  - RSI 35-55
  - MACD line < signal line
  - Histogram negatif
```

### Layer 3 — Level Kunci (Support / Resistance)

```text
- Support: Low 20 candle terakhir
- Resistance: High 20 candle terakhir
- LONG valid jika harga <= 1.5% di atas support
- SHORT valid jika harga <= 1.5% di bawah resistance
```

### Confidence Score

```text
Setiap layer yang terpenuhi = +1 poin
Score 3/3 = HIGH
Score 2/3 = MEDIUM
Score 0-1/3 = LOW
```

### Output Setup

```text
LONG:
  entry1 = harga sekarang
  entry2 = support
  tp1 = entry1 * 1.025
  tp2 = entry1 * 1.06
  sl = support * 0.985

SHORT:
  entry1 = harga sekarang
  entry2 = resistance
  tp1 = entry1 * 0.975
  tp2 = entry1 * 0.94
  sl = resistance * 1.015
```

---

## Flow Baru: Copy AI Prompt

Tombol `AI Analyze` dihapus dan diganti menjadi `Copy AI Prompt`.

Flow:

```text
Dashboard deteksi sinyal
       ↓
Klik "Copy AI Prompt"
       ↓
Sistem generate prompt lengkap berisi data market terbaru
       ↓
User paste ke Claude.ai / ChatGPT / Gemini
       ↓
AI memberi second opinion tanpa integrasi API
```

### Isi Prompt yang Di-generate

Prompt berisi:
- Pair, exchange source, timeframe, harga sekarang
- Status EMA20/50/200
- RSI, MACD, histogram, volume spike
- Support / resistance
- Setup terdeteksi: signal, confidence, entry, TP, SL
- Empat pertanyaan evaluasi teknikal singkat

---

## Format Output Sinyal

```text
🚨 TRADESCOPE SIGNAL

Pair: UB/USDT
Type: LONG | Leverage: 20X
Confidence: 🔥 HIGH (3/3)

📍 ENTRY ZONE:
1) 0.06400
2) 0.06230

🎯 TARGETS:
🥇 0.06600 (Close 80%)
🥈 0.07300 (Close 20%)

🛑 STOP LOSS: 0.06050

📊 Basis:
✅ EMA Bullish Alignment
✅ RSI Momentum Up
✅ MACD Cross Confirmed

⚠️ Personal analysis only. Not financial advice.
```

---

## Tech Stack

| Layer | Technology | Alasan |
|---|---|---|
| Frontend | React + Vite | Build ringan dan cepat |
| Styling | TailwindCSS | Utility-first, dark theme |
| Charts | lightweight-charts | Mini candlestick chart |
| Data | Binance public WS + REST | Realtime tanpa API key |
| Fallback | Bybit REST | Pair non-Binance seperti UB/BAS/CHIP |
| Indicators | technicalindicators | Kalkulasi teknikal siap pakai |
| Storage | localStorage | Watchlist dan history copy |

---

## Tahapan Build

### Phase 1 — Foundation
- [ ] Init Vite + React + Tailwind
- [ ] Fetch historical klines
- [ ] Stream harga real-time dari Binance
- [ ] Fallback Bybit untuk pair yang tidak tersedia di Binance

### Phase 2 — Signal Engine
- [ ] Implementasi EMA / RSI / MACD / Volume
- [ ] Confluence score 3-layer
- [ ] Auto support / resistance
- [ ] Generate LONG / SHORT / WAIT

### Phase 3 — UI Dashboard
- [ ] Layout dark theme
- [ ] Watchlist add/remove pair
- [ ] Signal card + mini chart
- [ ] Copy Signal + Copy AI Prompt

### Phase 4 — Quality of Life
- [ ] History log copy actions
- [ ] Exchange badge (Binance / Bybit)
- [ ] Error state untuk pair invalid

---

## Catatan Penting

1. Tidak ada `.env` dan tidak ada API key untuk versi ini.
2. Semua analisis AI dilakukan lewat prompt yang dicopy manual ke AI pilihan user.
3. Pair seperti `UB`, `BAS`, `CHIP` bisa fallback ke Bybit bila Binance tidak punya datanya.
4. Ini alat bantu analisis pribadi dan tetap butuh validasi manual serta manajemen risiko.

## Official Paper Trading Phase

Official Paper Tracking Day 1: 2026-04-30

Authoritative storage is now active:
- Storage Mode: database
- Provider: postgres
- Can Connect: true
- Authority: AUTHORITATIVE
- Durable: true

Only these trades count toward the 28-day paper gate:
- APPROVED_FOR_PAPER setup
- VALID signal
- LONG or SHORT direction
- stored in durable Postgres database
- opened after Official Paper Tracking Day 1

Current setup status:
- BTC/USDT 1h: PAPER ELIGIBLE
- ETH/USDT 1h: OBSERVATION ONLY / COLLECT_MORE_DATA
- SOL/USDT 15m: REJECTED_OOS_FAILURE

Global verdict remains NOT READY until:
- 28 days of authoritative approved paper trading are complete
- minimum closed trade requirement passes
- paper win rate > 45%
- paper expectancy > 0.3R
- paper max drawdown < 15%
- paper vs backtest divergence is acceptable
- backtest proof / OOS / walk-forward gates remain valid

Live execution remains stubbed.

### Daily Operator Routine

- Check `/api/storage-status`
- Check `/api/paper-health`
- Open `/proof`
- Open `/paper-trading`
- Run `npm run proof:snapshot`
- Run `npm run paper:report`
- Confirm storage remains AUTHORITATIVE
- Confirm live execution remains stubbed
- Confirm global verdict remains NOT READY until all gates pass

Authoritative paper tracking only counts approved durable trades after 2026-04-30. Observation-only, rejected, blocked, marginal, local-json, and pre-authoritative records do not count toward the 28-day live-readiness gate.
