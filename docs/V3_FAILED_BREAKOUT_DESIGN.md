# V3 Failed Breakout Design

## Hypothesis
When price breaks out of a compression range but FAILS to follow through (no continuation within 3 candles), it traps breakout traders. Their stop losses become fuel for a reversal back into and through the range.

This is the OPPOSITE of breakout continuation. We trade the FAILURE, not the breakout.

## Why This Makes Sense
From v2 and v3-B research:
- Market compression: common
- Valid breakout continuation: rare (low WR)
- Failed breakouts: frequent
- Failed breakout = trapped longs/shorts = predictable reversal pressure

## Failed Breakout Definition

### Step 1 — Detect Compression Range
Last 20 candles form a range where:
- Range high = highest high of 20 candles
- Range low = lowest low of 20 candles
- Range size = high - low
- Range size <= 2.0 ATR (compressed)
- At least 15/20 candles inside range (not already trending)

### Step 2 — Detect Failed Breakout
LONG setup (SHORT breakout failed):
- A candle closed BELOW range low (breakout candle)
- Within next 1-3 candles, price closes BACK ABOVE range low (breakout failed = trap)
- Current candle is the failure candle

SHORT setup (LONG breakout failed):
- A candle closed ABOVE range high
- Within next 1-3 candles, price closes BACK BELOW range high
- Entry: trade the reversion

### Step 3 — Entry and Risk
LONG (after failed SHORT breakout):
- Entry: close of candle that reclaims range
- SL: below the failed breakout low - 0.2 ATR
- TP1: risk * 1.5R
- TP2: risk * 2.5R+

SHORT (after failed LONG breakout):
- Entry: close of candle back inside range
- SL: above the failed breakout high + 0.2 ATR
- TP1: risk * 1.5R
- TP2: risk * 2.5R+

### Step 4 — Filters
- Volume on breakout candle >= 1.2x avg (real breakout attempt, not random)
- Volume on failure candle: any
- RSI: 35-65 at entry
- Failure must happen within 3 candles of the breakout (fresh trap)

## Falsification Criteria
False if after 50+ trades:
- Win rate < 45%
- Expectancy < 0.3R
- MaxDD > 15%

## Gates (Unchanged)
Standard project gates apply.
