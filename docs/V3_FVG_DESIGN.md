# V3 Candidate C — Fair Value Gap (FVG) Fill

## Status
Design phase. Not implemented. Not approved.
candidateOnly: true
backtest-only path

## Hypothesis
A Fair Value Gap (FVG) is created when price moves so strongly in one direction that a 3-candle imbalance forms:
- Candle 1 high (for bearish FVG) or candle 1 low (for bullish FVG)
- Candle 3 low (bearish) or high (bullish)
- Gap between them = area of no trading = FVG

Price tends to return to fill this gap because:
1. Market makers need to fill unfilled orders
2. Price discovery is incomplete in FVG zones
3. Institutional traders use FVG as entry zones

This is a structural edge based on price delivery mechanics, not indicator combinations.

## Why This Is Different From V1.x and V3-B

V1.x: lagging indicators (EMA/RSI/MACD)
V3-B: time-based session boundaries
V3-C: structural price imbalance zones

FVG edge comes from market microstructure — the mechanics of how price moves and fills orders — not from pattern recognition or session timing.

## FVG Definition (Objective)

### Bullish FVG (potential LONG entry)
Formed when:
- Candle[i-2].high < Candle[i].low
- (gap between candle 1 high and candle 3 low)
- Candle[i-1] is a strong bullish candle (close > open, body >= 60% of range)
- FVG size >= 0.3 ATR (meaningful gap)
- FVG size <= 3.0 ATR (not extreme news spike)

FVG zone:
- FVG top = Candle[i].low
- FVG bottom = Candle[i-2].high
- Midpoint = (FVG top + FVG bottom) / 2

### Bearish FVG (potential SHORT entry)
Formed when:
- Candle[i-2].low > Candle[i].high
- Candle[i-1] is a strong bearish candle (close < open, body >= 60% of range)
- FVG size >= 0.3 ATR
- FVG size <= 3.0 ATR

FVG zone:
- FVG top = Candle[i-2].low
- FVG bottom = Candle[i].high

## Entry Rules (Objective)

### Step 1 — Detect FVG
Scan last 50 candles for valid FVG.
Use most recent unfilled FVG only.
FVG is "unfilled" if price has not yet traded through the full FVG zone.

### Step 2 — Entry Trigger
LONG (bullish FVG fill):
- Price enters FVG zone from above (current candle low <= FVG top)
- Current candle closes INSIDE or ABOVE FVG zone (not below FVG bottom)
- Entry at close of trigger candle

SHORT (bearish FVG fill):
- Price enters FVG zone from below (current candle high >= FVG bottom)
- Current candle closes INSIDE or BELOW FVG zone (not above FVG top)
- Entry at close of trigger candle

### Step 3 — Filters
- EMA trend: LONG if price > EMA50, SHORT if price < EMA50 (FVG must be in direction of larger trend)
- RSI: LONG RSI 35-65, SHORT RSI 35-65 (not extreme in either direction)
- Volume at FVG creation candle >= 1.5x avg (strong move creates more reliable FVG)
- FVG not older than 30 candles (fresh FVG more reliable than stale)

### Step 4 — Risk Levels
LONG:
  SL = FVG bottom - (ATR * 0.2)
  risk = entry - SL
  TP1 = entry + (risk * 2.0)
  TP2 = entry + (risk * 3.5)

SHORT:
  SL = FVG top + (ATR * 0.2)
  risk = SL - entry
  TP1 = entry - (risk * 2.0)
  TP2 = entry - (risk * 3.5)

SL is just below/above the FVG zone.
If price fully fills FVG, setup is invalid.

## Falsification Criteria
This hypothesis is FALSE if after 50+ trades:
- Win rate < 38%
- Expectancy < 0.3R after costs
- MaxDD > 15%
- FVG fill rate < 60% (if price rarely enters FVG, hypothesis about price delivery is wrong)

## Expected Edge
FVG entry = tight SL (just below FVG bottom)
Strong impulsive move = large FVG = meaningful price target
Expected payoff: 2:1 to 3.5:1

Win rate target: 45-55%
(price fills FVG more often than not, but not all fills continue in direction)

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
