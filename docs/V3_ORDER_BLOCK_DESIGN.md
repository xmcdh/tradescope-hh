# V3 Candidate D — Institutional Order Block

## Status
Design phase. Not implemented. Not approved.
candidateOnly: true
backtest-only path

## Hypothesis
An Order Block (OB) is the last bearish candle before a strong bullish move, or the last bullish candle before a strong bearish move.

These zones represent where institutional participants placed large orders. When price returns to these zones, unfilled orders from institutions get triggered again, creating high-probability reversals.

Key difference from FVG:
- FVG = gap in price (no trading zone)
- OB = specific candle where orders were placed
- OB has more precise entry/exit definition
- OB respects the candle body, not just wicks

## Order Block Definition (Objective)

### Bullish Order Block (LONG setup)
The last BEARISH candle before a strong bullish impulse move:

Conditions for valid bullish OB:
1. Candle[i] is bearish: close < open
2. Candle[i] body >= 40% of candle range
3. After candle[i], price moves up strongly:
   - Next 3 candles net move >= 1.5 ATR upward
   - OR next candle is engulfing candle[i]
4. OB zone:
   - OB top = candle[i].open (or high)
   - OB bottom = candle[i].close (or low)
   - Use body: top=open, bottom=close
5. OB size >= 0.3 ATR, <= 2.5 ATR
6. OB not yet violated
   (no candle after impulse closed below OB bottom)

### Bearish Order Block (SHORT setup)
The last BULLISH candle before a strong bearish impulse move:

1. Candle[i] is bullish: close > open
2. Body >= 40% of candle range
3. After candle[i], price moves down strongly:
   - Next 3 candles net move >= 1.5 ATR downward
4. OB zone:
   - OB top = candle[i].close
   - OB bottom = candle[i].open
5. OB size >= 0.3 ATR, <= 2.5 ATR
6. OB not yet violated

## Entry Rules (Objective)

### Step 1 — Detect Order Block
Scan last 100 candles for valid OB.
Use most recent unviolated OB only.
OB is "violated" if price closed beyond the OB zone after the impulse move.

### Step 2 — Entry Trigger
LONG (bullish OB):
- Price returns to OB zone:
  current candle low <= OB top
  AND current candle close >= OB bottom
  (price touched OB but did not close below)
- Entry: close of trigger candle

SHORT (bearish OB):
- Price returns to OB zone:
  current candle high >= OB bottom
  AND current candle close <= OB top
- Entry: close of trigger candle

### Step 3 — Confirmation Filter
- Trigger candle body ratio >= 0.4 (not a doji — needs conviction)
- Volume at trigger >= 0.8x avg volume (lower threshold — OB entries often quiet)
- EMA50 direction aligned with trade:
  LONG: EMA50 slope positive (rising)
  SHORT: EMA50 slope negative (falling)
- RSI at entry: 35-65 range
- OB age <= 50 candles (fresh OB)

### Step 4 — Risk Levels
LONG:
  SL = OB bottom - (ATR * 0.15)
  risk = entry - SL
  TP1 = entry + (risk * 2.0)
  TP2 = entry + (risk * 4.0)
  (OB SL is very tight = high payoff potential)

SHORT:
  SL = OB top + (ATR * 0.15)
  risk = SL - entry
  TP1 = entry - (risk * 2.0)
  TP2 = entry - (risk * 4.0)

## Falsification Criteria
This hypothesis is FALSE if after 50+ trades:
- Win rate < 40%
- Expectancy < 0.3R after costs
- MaxDD > 15%
- OB return rate < 50% (if price rarely returns to OB, institutional order theory is wrong for crypto)

## Expected Edge
Very tight SL (0.15 ATR buffer only) means:
- Risk is small relative to move size
- Even 40% WR can produce 0.3R+ expectancy at 2:1 payoff
- TP4 at 4R creates potential for large winning trades

## Test Universe
Priority 1: BTC/USDT, ETH/USDT, SOL/USDT 1h
Priority 2: All pairs 4h

## Gates (Unchanged from project standard)
- >= 50 closed actionable trades
- Win rate > 45%
- Expectancy > 0.3R
- Expectancy after -0.02R cost > 0.3R
- Max DD < 15%
- OOS degradation <= 15%
- Walk-forward 4/5 windows pass
- No profit concentration
