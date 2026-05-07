# v4 Mean Reversion After Volatility Squeeze

## Core Idea
After a period of ATR contraction (squeeze), price often makes an initial move that fails and reverts. Entry on reversion confirmation.

## Why This Might Work
- Squeeze followed by failed expansion is structurally similar to failed breakout but occurs more frequently
- Does not require session boundaries
- Occurs on BTC, ETH, SOL — not pair-specific

## Frequency Hypothesis
Expected: 5-10 signals/month per pair at 1h timeframe

## Gates (unchanged)
- WinRate > 45%
- Expectancy > 0.3R
- MaxDD < 15%
- Min 100 trades before OOS

## Status
HYPOTHESIS — not yet implemented
