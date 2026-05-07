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

### Strategy Versioning

ATR-based TP/SL is treated as a new strategy/risk logic version:

```text
Active Strategy Version: v1.1-atr-risk
Strategy Name: TradeScope Futures ATR Risk
Risk Model: ATR-based TP/SL
Activated At: 2026-04-30T05:26:46.000Z
Official Paper Day 1: PENDING_SETUP_APPROVAL for v1.1 until fresh ATR proof approves at least one setup
```

The v1.0 paper phase is archived/superseded. Old records remain historical, but they do not count toward the current ATR proof gate. v1.1 must produce fresh ATR-based backtest, OOS validation, walk-forward validation, setup approval, and official paper proof before any live-readiness verdict can improve. Official v1.1 paper Day 1 starts only after a v1.1 setup is approved for paper trading. Live execution remains stubbed.

Backtest data can be sourced from `ccxt-binance`, `vercel-market-data-proxy`, `local-cache`, or `local-file`. Historical OHLCV cache files live under `data/ohlcv-cache/` and are not part of the official proof unless candle integrity passes.

### v1.1 Retest Audit / Longer History Commands

Current BTC/USDT 1h retest diagnostics show confirmed retests that still fail the executable LONG/SHORT gate. Audit them before changing strategy thresholds:

```bash
npm run backtest:retest-audit -- --pair BTC/USDT --timeframe 1h
```

Longer-history experiments are allowed only to measure sample size, not to approve automatically:

```bash
npm run backtest:batch -- --from 2023-07-01 --to 2024-07-01 --data-source vercel-market-data-proxy --fallback-data-source local-cache --write-cache true
npm run backtest:batch -- --from 2023-01-01 --to 2024-07-01 --data-source vercel-market-data-proxy --fallback-data-source local-cache --write-cache true
```

Approval remains strict: no setup with fewer than 50 closed actionable trades can become `APPROVED_FOR_PAPER`, and OOS/walk-forward pass cannot override insufficient sample. Official v1.1 Paper Day 1 remains `PENDING_SETUP_APPROVAL` until at least one setup passes the full proof gate.

### Research Cost Sensitivity Requirement

All future strategy experiments must report cost-adjusted expectancy, not just raw expectancy.

Minimum research output:

```text
- raw expectancy
- adjusted expectancy at -0.02R
- adjusted expectancy at -0.05R
- adjusted expectancy at -0.10R
- promotion decision after costs
```

If a candidate fails after small execution costs, it is not promotable even if the raw backtest looks close.

### Strategy Research Decision v1.1-v1.6

Current research closeout after v1.1 through v1.6:

```text
Global verdict: NOT READY
Approved setups: 0
Paper Day 1: PENDING_SETUP_APPROVAL
Live execution: STUBBED
Active production strategy: v1.1-atr-risk
Next research path recommendation: REDESIGN_EDGE_HYPOTHESIS
```

No setup is approved after v1.1-v1.6. v1.6 regime filters improved average trade quality on SOL/USDT 1h, but no v1.6 variant preserved at least 50 closed trades, and walk-forward/profit concentration still failed. The best v1.6 result, `v1.6-impulse-filter-medium`, remains `CANDIDATE_ONLY` with 22 closed trades and is not eligible for paper approval.

Gates remain unchanged. Do not start Paper Day 1, enable live execution, promote an experiment, weaken gates, or make any v1.2-v1.6 experiment active in production without a separate explicit approval artifact.

### v2 Strategy Design Phase

v1.1-v1.6 research is closed with no approved setup. The next phase is v2 strategy design, documented in `docs/V2_STRATEGY_DESIGN.md`, before any implementation.

v2 design candidates:
- `v2-breakout-volume-expansion`
- `v2-liquidity-sweep-reclaim`
- `v2-funding-oi-momentum`

First recommended v2 candidate: `v2-breakout-volume-expansion`, because it has the clearest objective edge definition, lowest dependency complexity, and can be validated with existing OHLCV/ATR/volume data.

Operational status remains unchanged:
- Paper Day 1 remains `PENDING_SETUP_APPROVAL`.
- Global verdict remains `NOT READY`.
- Live execution remains `STUBBED`.
- Active production strategy remains `v1.1-atr-risk`.
- No v2 strategy is implemented, approved, or active in production yet.

### v2 Breakout Volume Expansion Backtest Result

`v2-breakout-volume-expansion` has been implemented as a backtest-only experiment and evaluated on BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, and XRP/USDT across 15m, 1h, and 4h from 2023-01-01 to 2024-07-01.

Report files:
- `backtest-results/v2-breakout-volume-expansion-report.md`
- `backtest-results/v2-breakout-volume-expansion-report.json`

Result summary:

```text
Experiment ID: v2-breakout-volume-expansion
Strategy version: v2-breakout-volume-expansion
Final status: NOT_READY
Promotion candidates: 0
Setups with >=50 closed trades: none
Best setup by report ranking: BNB/USDT 1h
Best setup closed trades: 4
Best setup raw expectancy: 0.25R
Best setup expectancy after -0.02R cost: 0.23R
Best setup walk-forward: FAIL
```

No v2 setup passed strict gates. The first pass is primarily blocked by insufficient sample, with weak expectancy/cost sensitivity and walk-forward failures across the tested universe. `v2-breakout-volume-expansion` remains `CANDIDATE_ONLY` / backtest-only and is not approved for paper.

Operational status remains unchanged after the v2 first pass:
- Approved setups remain `0`.
- Paper Day 1 remains `PENDING_SETUP_APPROVAL`.
- Global verdict remains `NOT READY`.
- Live execution remains `STUBBED`.
- Active production strategy remains `v1.1-atr-risk`.
- `setupRegistry`, `paperGate`, and `liveGate` are not changed by this experiment.

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
- Run `npm run paper:daily-check`
- Confirm storage remains AUTHORITATIVE
- Confirm live execution remains stubbed
- Confirm global verdict remains NOT READY until all gates pass

Authoritative paper tracking only counts approved durable trades after 2026-04-30. Observation-only, rejected, blocked, marginal, local-json, and pre-authoritative records do not count toward the 28-day live-readiness gate.

### Weekly Operator Routine

- Run `npm run paper:weekly-audit`
- Review anomalies in `paper-results/weekly-audit.md`
- Do not promote to live unless all gates pass after 28 days of authoritative approved-only paper tracking

---

## Research Decision Log

### 2026-05-03 - Post MACD Fix Assessment

**Root cause fixed:** macd.macd field was always undefined (should be macd.MACD). All prior v1.x results are invalid because MACD never evaluated.

**Post-fix best result:**
- Setup: ETH/USDT 1h, v1.1-atr-risk
- Trades: 48, WinRate: 47.92%
- Expectancy: 0.1979R, MaxDD: 9.23%
- OOS degradation: 22.09% (fails 15% gate)
- Verdict: NOT_READY

**All v1.x and v2 candidates tested:**
- v1.1 standard (BTC/ETH/SOL/BNB/XRP): NOT_READY
- v1.1 new pairs (LINK/AVAX/OP/ARB): NOT_READY
- v1.5 trailing-after-1r: NOT_READY
- v2-breakout-volume-expansion: NOT_READY
- v2-liquidity-sweep-reclaim: NOT_READY
- v2-funding-oi-momentum: DATA_UNAVAILABLE

**Decision: REDESIGN_EDGE_HYPOTHESIS**

Gate 0.3R expectancy is correct and will not be lowered. The problem is not the gate - the problem is no tested hypothesis produces enough edge with payoff 1.5:1 and win rate 45-48%.

Next phase: v3 edge redesign.
Constraint: must be fundamentally different from trend-following and sweep/reclaim patterns.

### 2026-05-03 — V3-B Session Breakout Closed

Best result: BTC/USDT 1h with retest confirmation
- Trades: 149, WinRate: 36.91%, Exp: 0.1074R
- False breakout rate: 42.86% within 3 candles
- TP2 (3.5R) never reached in 180 trades
- All tuning variants: No-Go

Main blocker: institutional session boundaries do not apply cleanly to 24/7 crypto markets. False breakout rate too high to overcome with volume or retest filters alone.

Decision: close V3-B, proceed to V3-C FVG.

### 2026-05-03 — V3-C Fair Value Gap Closed

Best result: ETH/USDT 1h
- Trades: 123, WinRate: 32.52%, Exp: -0.02R
- FVG fill rate: only 26-28%
- BTC worst: WR 15.66%, Exp -0.53R

Main blocker: in crypto 1h, FVG zones are penetrated rather than respected as reversal zones. Price delivery mechanics differ from forex/equities where FVG works better.

Decision: close V3-C, proceed to V3-D Order Block.


### 2026-05-07 — V3-D Order Block Closed

OB detection: 81%, but OB return rate: 31% (threshold requires >50%).
Top blocker: EMA50 slope filter (8,279 blocks).
In choppy crypto 1h, EMA50 rarely has clean slope direction when OB forms.
Decision: close V3-D, not retesting with looser EMA — core hypothesis unvalidated (return rate too low).

### Research Guardrails (Do Not Violate)

These rules apply to all future research:

1. Gates never change without explicit approval artifact
   - >= 50 closed actionable trades
   - Win rate > 45%
   - Expectancy > 0.3R
   - Expectancy after -0.02R cost > 0.3R
   - Max DD < 15%
   - OOS degradation <= 15%
   - Walk-forward 4/5 windows pass
   - No profit concentration

2. Never start Paper Day 1 without approved setup

3. Never enable live execution before 28-day paper gate passes

4. All new strategy experiments must be:
   - candidateOnly: true
   - backtest-only path
   - Not touching v1.1 production config

5. Cost sensitivity required for every candidate:
   Report at -0.02R, -0.05R, -0.10R

6. No automatic approval from longer history alone
