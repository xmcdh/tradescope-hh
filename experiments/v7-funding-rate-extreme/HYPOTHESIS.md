# V7: Funding Rate Extreme Reversal

## Core Idea
When perpetual futures funding rate reaches extreme levels (very positive or very negative), it signals crowded positioning. Crowded longs paying high funding eventually capitulate, causing price reversal. Entry on first 1h candle that confirms reversal direction after funding extreme.

## Why This Is Different
- Not a derived indicator — actual market positioning data
- Funding rate extreme = real cost pressure on one side of the market
- Used by institutional crypto traders as contrarian signal

## Data Source
Binance public API — free, no auth. Funding updates every 8 hours.

## Frequency Hypothesis
Extreme funding events (>0.01% or <-0.01%) expected: 3-6 per month. After price confirmation: 2-4/month. Lower frequency than v3-v6 but potentially much higher quality.

## Gates (unchanged)
- WinRate > 45%
- Expectancy > 0.3R
- MaxDD < 15%
- Min 100 trades before OOS

## Status
HYPOTHESIS — data fetch required first
