# V3 Edge Redesign

## Why V3

V1.x through V2 all failed because:
- Payoff ratio 1.5:1 insufficient at 45-48% WR
- Need either WR > 53% or payoff > 2.0:1
- No filter combination achieves this with sample >= 50 trades

To reach expectancy > 0.3R sustainably, the new hypothesis must structurally produce either higher payoff OR higher win rate - not through parameter tuning, but through a genuinely different entry logic.

## What Must Be Different in V3

V3 hypothesis MUST satisfy these design criteria:

1. Structural edge - not indicator combination
   The edge must come from market structure or participant behavior, not from EMA/RSI/MACD combinations that are widely known.

2. Asymmetric risk profile
   Entry condition must naturally produce tight SL (< 1.0 ATR) OR wide TP (> 2.5R). This is what creates payoff > 2.0:1.

3. Regime-independent
   Must work in trending AND ranging markets, or must have a clear regime filter that preserves >= 50 trades per tested period.

4. Falsifiable before implementation
   Write down: "this hypothesis is wrong if X" before writing any code.

## V3 Candidate Hypotheses

### Candidate A - Order Block Reversal

**Hypothesis:** Institutional order blocks (areas where large orders were placed, visible as strong impulsive candles) act as high-probability support/resistance.

Entry: price returns to order block zone
SL: beyond the order block (tight, 0.5-1.0 ATR)
TP: measured move to next imbalance (3-4R)
Expected payoff: 3:1 to 4:1

Why different: based on order flow logic, not indicator calculation.

Data needed: OHLCV only (already available)
Complexity: MEDIUM

### Candidate B - Session Open Range Breakout

**Hypothesis:** The first 1-4 hours of major sessions (Asia open, London open, NY open) define a range. Breakout of that range with volume confirmation has high follow-through.

Entry: breakout of session open range
SL: back inside the range (tight)
TP: 2x the range size (fixed RR)
Expected payoff: 2:1 minimum (fixed by design)

Why different: time-based structural edge, not price indicator.

Data needed: OHLCV with hour timestamps (already available)
Complexity: LOW-MEDIUM

### Candidate C - Imbalance Fill

**Hypothesis:** Price gaps / fair value gaps (FVG) created by strong moves are filled with high probability. Trading the fill provides predictable entry and exit.

Entry: price enters the FVG zone
SL: beyond the FVG (tight)
TP: opposite edge of FVG (fixed by structure)
Expected payoff: varies, avg 2-3R

Why different: structural imbalance in price discovery, not indicator signal.

Data needed: OHLCV only (already available)
Complexity: MEDIUM

## Recommended First Candidate

**Candidate B - Session Open Range Breakout**

Reasons:
1. Lowest complexity, fastest to implement
2. Fixed RR by design (2:1 minimum)
3. No additional data needed
4. Clear falsification criteria
5. Well-documented in professional literature
6. Time filter naturally reduces overtrading

## Implementation Order

1. Write design doc for chosen candidate
2. Define exact entry/exit rules objectively
3. Write falsification criteria BEFORE coding
4. Implement as backtest-only experiment
5. Run on BTC/ETH/SOL 1h and 4h first
6. Apply full validation pipeline:
   - In-sample / OOS split
   - Walk-forward 5 windows
   - Cost sensitivity
   - Profit concentration check
7. Only promote if ALL gates pass

## Current Status

Phase: DESIGN
Active candidate: PENDING_SELECTION
Implementation: NOT_STARTED
Gates: UNCHANGED from project standard

## Do Not Do

- Do not implement without written design doc
- Do not change gates to make a candidate pass
- Do not approve based on in-sample only
- Do not start paper trading without approved setup
- Do not combine v3 with v1.1 production code
