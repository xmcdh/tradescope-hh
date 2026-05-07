# V5: RSI Divergence Reversal

## Core Idea
When RSI makes a higher low while price makes a lower low (bullish div), or RSI makes a lower high while price makes a higher high (bearish div), this signals momentum exhaustion.

Entry on first candle that confirms reversal direction after divergence.

## Why This Might Work
- Momentum exhaustion is measurable and does not depend on geometric patterns (FVG, OB) or session bounds
- RSI divergence has documented edge across multiple markets and timeframes
- Does not require compression/squeeze — occurs more frequently
- Crypto 1h has enough volatility for RSI to diverge meaningfully

## Key Difference from V4
V4 assumed post-squeeze = reversion. Data showed post-squeeze = continuation. V5 does not assume anything about market structure — only about momentum.

## Frequency Hypothesis
Expected: 8-15 divergence setups/month per pair at 1h timeframe

## Pre-Implementation Audit Required
Before coding signal logic:
1. Count raw RSI divergence occurrences on BTC/ETH 1h 2023-2026
2. Check what % lead to actual reversal (price confirms within 5 candles)
3. Decide if frequency justifies implementation

## Gates (unchanged)
- WinRate > 45%
- Expectancy > 0.3R
- MaxDD < 15%
- Min 100 trades before OOS

## Status
HYPOTHESIS — audit required first
