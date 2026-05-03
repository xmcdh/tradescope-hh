# V3 Candidate B — Session Open Range Breakout

## Status
Design phase. Not implemented. Not approved.
candidateOnly: true
backtest-only path

## Hypothesis
The first 4 candles (4 hours) of three major sessions define an Opening Range (OR):
- Asia session: 00:00-04:00 UTC
- London session: 07:00-11:00 UTC
- NY session: 13:00-17:00 UTC

Price breaking out of this range WITH volume confirmation has high follow-through probability because institutional participants are entering positions at session open, creating directional momentum before retail catches on.

This is NOT momentum chasing after a pump.
This IS catching the beginning of institutional directional flow.

## Why This Is Different From V1.x

V1.x used EMA/RSI/MACD combinations that are:
- Lagging indicators
- Widely known = edge eroded
- Payoff limited to 1.5:1

Session Breakout uses:
- Time-based structural edge (session opens)
- Volume confirmation (institutional participation)
- Fixed RR by design (2:1 minimum)
- Entry at breakout = tight SL inside range

## Entry Rules (Objective)

### Step 1 — Define Opening Range (OR)
For each session:
- OR High = highest high of first 4 candles
- OR Low = lowest low of first 4 candles
- OR Size = OR High - OR Low
- Minimum OR size: > 0.3 ATR
  (too small = choppy, not meaningful)
- Maximum OR size: < 3.0 ATR
  (too large = already volatile, skip)

### Step 2 — Breakout Confirmation
LONG breakout:
- Current candle closes ABOVE OR High
- Close > OR High + (OR Size * 0.1) as buffer
  (avoid false breakouts at the edge)
- Volume >= 1.3x average volume of last 20 candles
- Candle body >= 50% of candle range
  (strong close, not just wick)

SHORT breakout:
- Current candle closes BELOW OR Low
- Close < OR Low - (OR Size * 0.1) as buffer
- Volume >= 1.3x average volume
- Candle body >= 50% of candle range

### Step 3 — Additional Filters
- EMA20 > EMA50 for LONG (trend aligned)
- EMA20 < EMA50 for SHORT (trend aligned)
- RSI not extreme: LONG RSI < 72, SHORT RSI > 28
- BTC bias not strongly opposed (no -2 adj)
- Not within 30 min of a major news event
  (not implementable in backtest, skip for now)

### Step 4 — Entry and Levels
Entry: close of breakout candle
SL: opposite side of OR + 0.2 ATR buffer
  LONG SL = OR Low - (ATR * 0.2)
  SHORT SL = OR High + (ATR * 0.2)

Risk = entry - SL (LONG) or SL - entry (SHORT)

TP1 = entry + (Risk * 2.0)   → RR 2:1
TP2 = entry + (Risk * 3.5)   → RR 3.5:1

This produces payoff 2:1 minimum by design.

## Falsification Criteria
This hypothesis is FALSE if after 50+ trades:
- Win rate < 38%
  (2:1 RR needs only 34% WR to breakeven,
   38% gives margin above breakeven)
- Expectancy < 0.3R after costs
- MaxDD > 15%
- Results concentrated in one session type only
  (Asia only, or London only = not robust)

## Signal Mode Mapping
CONSERVATIVE: all filters pass + volume >= 1.5x
BALANCED:     all filters pass + volume >= 1.3x
AGGRESSIVE:   breakout confirmed + volume >= 1.1x
              (EMA alignment optional)

## Test Universe
Priority 1: BTC/USDT, ETH/USDT, SOL/USDT 1h
Priority 2: BNB/USDT, XRP/USDT 1h
Priority 3: All pairs 4h

## Gates (Unchanged)
- >= 50 closed actionable trades
- Win rate > 45%
- Expectancy > 0.3R
- Expectancy after -0.02R cost > 0.3R
- Max DD < 15%
- OOS degradation <= 15%
- Walk-forward 4/5 windows pass
- No profit concentration
