# v2 Liquidity Sweep Reclaim Design

Generated at: 2026-05-03

## Status

Research-only design. No approved setup, no paper-trading approval, and no live-readiness implication.

- Active production strategy remains: v1.1-atr-risk
- v1.1 post-MACD-fix verdict: NOT_READY
- v1.1 blocker: expectancy_below_0.3R_all_setups
- Next research phase: v2-liquidity-sweep-reclaim

## Hypothesis

Price sweeps below support (or above resistance) to trigger stop losses, then reclaims the level quickly. This creates a high-probability reversal entry with tight SL just beyond the sweep low/high.

## Why v2

The v1.1 post-MACD-fix audit showed that the best setup, ETH/USDT 1h, remained below the expectancy gate despite acceptable drawdown and near-target win rate. Exit changes and simple filters did not produce a robust, sample-valid improvement. The next test should change the edge hypothesis instead of adding another filter to the trend-pullback baseline.

## Market Condition

Target liquid markets where recent swing highs or lows are visible enough to attract stop orders. The preferred context is a range, shallow trend, or pullback area where a failed breakout can revert toward the prior range.

Avoid conditions where the sweep is more likely to be a real breakout:

- Oversized sweep candle relative to ATR.
- Strong close beyond the swept level with no reclaim.
- Immediate follow-through outside the prior range.
- Very wide stop distance that destroys R:R.

## Level Definition

Use mechanical swing levels only.

- Swing low: lowest low over a fixed lookback with neighboring candles confirming it as a local low.
- Swing high: highest high over a fixed lookback with neighboring candles confirming it as a local high.
- The level must be recent enough to matter but not so recent that every candle becomes a level.
- First-pass tests should use predeclared lookbacks, not optimized per pair.

## Entry Logic

LONG setup:

- Identify recent swing low / support.
- Sweep candle trades below the swing low.
- Reclaim candle closes back above the swept level within a fixed number of candles.
- Entry is at reclaim close or next candle open, depending on the backtester convention selected before testing.

SHORT setup:

- Identify recent swing high / resistance.
- Sweep candle trades above the swing high.
- Reclaim candle closes back below the swept level within a fixed number of candles.
- Entry is at reclaim close or next candle open, depending on the backtester convention selected before testing.

## Confirmation Rules

First-pass confirmation should stay minimal:

- Reclaim close must be decisive, measured by close distance back inside the level or body share.
- Sweep wick should be meaningful relative to ATR.
- Reclaim must happen quickly, for example within 1 to 3 candles.
- Do not add RSI divergence, BTC bias, or volume filters until the baseline sweep behavior is measured.

## Invalidation Logic

- LONG invalidation: price closes below the sweep low or hits the sweep-low stop.
- SHORT invalidation: price closes above the sweep high or hits the sweep-high stop.
- Time invalidation if price does not move favorably within a fixed number of candles.
- Reject setup if the stop distance exceeds a predeclared ATR multiple.

## SL/TP Model

- LONG SL: below sweep low with small ATR buffer.
- SHORT SL: above sweep high with small ATR buffer.
- TP1: range midpoint or 1.5R, whichever is more conservative for first-pass testing.
- TP2: opposite range boundary or 2.5R, tracked but not assumed to be reached.
- Exit geometry should begin with the existing single-target baseline before testing runners.

## Required Metrics

Report every candidate by pair and timeframe:

- Candles tested.
- Sweep candidates.
- Reclaim confirmations.
- Executable signals.
- Actionable trades.
- Closed trades.
- Win rate.
- Expectancy.
- Average win and average loss.
- Max drawdown.
- TP1 hit rate.
- TP2 reach-after-TP1 rate.
- Time-to-resolution distribution.

## Test Universe

Initial test universe:

- Pairs: BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT
- Timeframes: 15m, 1h, 4h
- Data source: local cache
- Range: 2024-01-01 to 2026-04-30

## Promotion Gates

No setup is a candidate unless it clears all gates:

- Closed trades >= 50
- Win rate > 45%
- Expectancy > 0.3R
- Max drawdown < 15%
- OOS degradation <= 15%
- Walk-forward acceptable
- No profit concentration
- Cost-adjusted expectancy remains acceptable at -0.02R, with -0.05R and -0.10R sensitivity reported

## Overfitting Controls

- Predeclare sweep lookback, reclaim window, ATR buffer, and max stop distance.
- Do not tune thresholds on ETH/USDT 1h only.
- Report failures and sparse samples.
- Separate LONG and SHORT performance.
- Compare range context versus trend context without promoting either until OOS confirms it.

## First-Pass Verdict Criteria

Classify each setup:

- CANDIDATE: clears all promotion gates.
- WATCHLIST: clears expectancy, win rate, and drawdown but has sample or OOS gaps.
- NOT_READY: fails expectancy, win rate, drawdown, or robustness.
- INSUFFICIENT_SAMPLE: fewer than 50 closed trades.

## Implementation Notes

Keep v2 separate from v1.x strategy metadata. A liquidity-sweep experiment should use its own strategy version and should not change production behavior until a separate promotion decision explicitly approves it.
