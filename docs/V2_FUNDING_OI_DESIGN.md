# V2 Funding/OI Design

## Hypothesis

Funding rate extremes combined with Open Interest direction create high-probability mean-reversion or momentum setups in crypto futures.

When funding is extremely positive AND OI is falling: longs are being liquidated -> SHORT signal.
When funding is extremely negative AND OI is falling: shorts are being liquidated -> LONG signal.
When funding neutral AND OI rising with price: momentum continuation -> trade with trend.

## Edge Definition

Three sub-strategies:

1. Funding extreme mean-reversion
   - Entry: funding > threshold AND OI dropping
   - Direction: against the crowded side
   - SL: ATR-based beyond recent swing
   - TP: measured move 2-3R

2. Liquidation cascade momentum
   - Entry: OI dropping sharply (>10% in 4h) while price moves strongly
   - Direction: with the price move
   - SL: tight ATR-based
   - TP: 2-3R

3. OI accumulation breakout
   - Entry: OI rising steadily + price at key level + funding neutral
   - Direction: breakout direction
   - SL: below accumulation level
   - TP: 3-4R (wide target, strong setup)

## Data Requirements

- OHLCV 1h and 4h (already available)
- Funding rate data (need to verify source)
- Open Interest data (need to verify source)
- Check: does /api/binance have funding/OI endpoints?

## Falsification Criteria

This hypothesis is false if:

- Win rate < 40% after 50+ trades
- Payoff ratio < 2.0 after costs
- Funding/OI signal not available for enough historical periods

## Implementation Complexity

HIGH - requires funding + OI historical data which may not be in current local cache.

Recommended first step before implementation:
Verify funding rate and OI historical data availability for 2024-2026 period.

## Gates (unchanged from project standard)

- >= 50 closed actionable trades
- win rate > 45%
- expectancy > 0.3R
- expectancy after -0.02R cost > 0.3R
- max DD < 15%
- OOS pass
- walk-forward pass
- no profit concentration

## Status

Design phase only. Not implemented. Not approved.
