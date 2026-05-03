# TradeScope v2 Strategy Design

Generated at: 2026-05-01

## Current Status

v1.1 through v1.6 research is closed with no approved setup.

- Approved setups: 0
- Paper Day 1: PENDING_SETUP_APPROVAL
- Global verdict: NOT READY
- Live execution: STUBBED
- Active production strategy: v1.1-atr-risk
- Main v1 blocker: regime_dependency_with_profit_concentration
- v2 objective: redesign the edge hypothesis before implementing anything

v2 must not be treated as a continuation of v1.7. The goal is to test new reasons for edge, not add another layer of filters to the v1 trend-pullback family.

## v2 Hypothesis 1: v2-breakout-volume-expansion

### Market Condition

Targets directional expansion after compression or range containment. The intended market is a pair that has been coiling below resistance or above support, then breaks with volatility and volume expansion.

### Entry Logic

- Detect a recent range using highest high / lowest low over a fixed lookback.
- Require pre-breakout compression, such as declining ATR percentile or narrow recent range relative to ATR.
- LONG trigger: candle closes above range high with volume ratio above threshold and candle body confirming direction.
- SHORT trigger: candle closes below range low with volume ratio above threshold and candle body confirming direction.
- Avoid entries if breakout candle is extremely extended relative to ATR.
- Prefer first breakout after compression, not repeated late continuation signals.

### Invalidation Logic

- Breakout closes back inside the prior range within a small number of candles.
- Volume expansion disappears immediately after entry.
- Price fails to advance at least a minimum R distance within a fixed time window.
- Opposite breakout occurs before TP1.

### SL/TP Model

- Initial SL beyond the opposite side of the breakout candle or back inside the range, capped by ATR.
- TP1 at 1.2R to 1.5R.
- TP2 at 2R to 2.5R.
- Optional trailing only after TP1 or after price reaches +1R, tested separately.

### Required Data

- OHLCV candles.
- ATR and ATR percentile.
- Volume moving average / volume ratio.
- Range high / range low.
- Candle body and wick measurements.

### Expected Trade Frequency

Medium. Fewer than broad trend-pullback entries, but materially higher than v1.1 retest logic if tested on 15m and 1h across BTC, ETH, SOL, BNB, and XRP.

### Expected Risks

- False breakouts in choppy markets.
- Late entries after oversized candles.
- Slippage during fast moves.
- High sensitivity to volume data quality.

### Overfitting Risks

- Tuning volume ratio, range lookback, and ATR compression thresholds to one symbol.
- Selecting only a single breakout month or market cycle.
- Adding too many post-breakout confirmation filters after seeing failures.

### Why It Is Different From v1.1-v1.6

v1.x mainly searched for trend/retest/pullback continuation and then tried to filter bad entries. This hypothesis starts from expansion after compression: the edge is a volatility transition, not a cleaner pullback inside an existing trend.

### Test Plan

- Start with simple, predeclared thresholds.
- Test across multiple symbols and 15m/1h before tuning.
- Report raw expectancy and cost-adjusted expectancy at -0.02R, -0.05R, and -0.10R.
- Require minimum 50 closed actionable trades per setup before promotion review.
- Require OOS, walk-forward, and no profit concentration.

## v2 Hypothesis 2: v2-liquidity-sweep-reclaim

### Market Condition

Targets failed stop runs around obvious recent highs/lows. The intended market is a range or shallow trend where price sweeps liquidity, rejects the extreme, and reclaims the prior level.

### Entry Logic

- Identify a recent swing high or swing low over a fixed lookback.
- LONG trigger: price sweeps below swing low, then closes back above the swept level.
- SHORT trigger: price sweeps above swing high, then closes back below the swept level.
- Require reclaim candle body to close decisively back inside the prior range.
- Optional confirmation: RSI divergence or wick dominance, but only after baseline testing.

### Invalidation Logic

- Price closes back beyond the swept extreme after entry.
- Reclaim candle is too weak or immediately reversed.
- No move toward range midpoint within a fixed number of candles.
- The sweep candle is too large relative to ATR, implying a real breakout rather than a failed stop run.

### SL/TP Model

- Initial SL beyond the sweep wick with ATR buffer.
- TP1 at range midpoint or 1R, whichever is nearer.
- TP2 near opposite range boundary or 2R.
- Time stop if price stalls after reclaim.

### Required Data

- OHLCV candles.
- Swing high / swing low detection.
- Wick size and candle body measurements.
- ATR for stop buffer and oversized-sweep rejection.
- Optional RSI divergence only as a later experiment.

### Expected Trade Frequency

Medium-low. Frequency depends on range formation and swing detection. It should produce more trades than v1.1 on liquid pairs but fewer than v1.3 trend-pullback.

### Expected Risks

- Mistaking real breakouts for failed sweeps.
- Ambiguous swing levels.
- High sensitivity to wick and close definitions.
- Entries can cluster during volatile chop.

### Overfitting Risks

- Over-tuning swing lookback and wick thresholds.
- Adding discretionary-looking reclaim definitions.
- Fitting to SOL/USDT 1h only because v1.x found partial edge there.

### Why It Is Different From v1.1-v1.6

v1.x looked for continuation after trend/retest behavior. This hypothesis is mean-reversion after liquidity failure. It expects the breakout attempt to fail, not continue.

### Test Plan

- Define swing and reclaim rules mechanically before running experiments.
- Test both range and trend contexts separately.
- Compare performance by sweep direction, timeframe, and volatility regime.
- Require the same proof gates, cost sensitivity, OOS, walk-forward, and concentration checks.

## v2 Hypothesis 3: v2-funding-oi-momentum

### Market Condition

Targets futures momentum when price trend, funding pressure, and open interest expansion align. The intended market is directional continuation supported by derivatives positioning.

### Entry Logic

- LONG trigger: price trend is bullish, open interest expands, and funding is not excessively overheated against the trade.
- SHORT trigger: price trend is bearish, open interest expands, and funding is not excessively overheated against the trade.
- Require momentum confirmation from candle structure or EMA slope.
- Block entries when funding is extreme enough to imply crowded positioning.

### Invalidation Logic

- Open interest contracts sharply after entry.
- Funding flips into an extreme adverse state.
- Price loses EMA/momentum structure.
- Momentum candle fails to produce follow-through within a fixed time window.

### SL/TP Model

- ATR-based SL below/above momentum structure.
- TP1 at 1.5R.
- TP2 at 2.5R or trailed while OI remains supportive.
- Funding/OI deterioration can trigger early exit only after separate testing.

### Required Data

- OHLCV candles.
- Funding rate.
- Open interest history.
- EMA slope / trend structure.
- Volume and ATR.

### Expected Trade Frequency

Low to medium. It may be sparse if reliable OI and funding data are limited by exchange/source availability.

### Expected Risks

- Data availability and consistency across exchanges.
- Funding and OI can lag price.
- Crowded-trade reversals.
- More moving parts than pure OHLCV strategies.

### Overfitting Risks

- Tuning funding and OI thresholds to a small number of market events.
- Mixing exchange-specific derivatives data without normalization.
- Treating unavailable or delayed OI as reliable signal.

### Why It Is Different From v1.1-v1.6

v1.x used price/indicator structure and later regime filters. This hypothesis introduces derivatives participation as part of the edge definition, so the reason for trade is positioning-supported momentum, not only candle/EMA shape.

### Test Plan

- First validate data availability and timestamp alignment.
- Run an OHLCV-only control versus OHLCV + funding/OI.
- Require improvement after costs and across OOS/walk-forward windows.
- Do not promote if data coverage is incomplete or exchange-specific.

## v2 Testing Protocol

All v2 strategies are backtest-only until a setup passes the full proof process.

Required gates:
- Minimum 50 closed actionable trades per setup.
- Expectancy > 0.3R.
- Win rate > 45%.
- Max drawdown < 15%.
- OOS degradation <= 15%.
- Walk-forward acceptable.
- No profit concentration.
- Cost-adjusted expectancy must remain acceptable at -0.02R, and sensitivity must be reported at -0.05R and -0.10R.

Operational rules:
- No paper trading until explicit setup approval.
- No live readiness until at least 28 days of official approved paper proof.
- Live execution remains stubbed during research.
- v2 must use separate strategyVersion values from v1.x.
- v1.1-v1.6 research remains archived and cannot be counted as v2 approval.
- Production active strategy remains v1.1-atr-risk until a separate explicit promotion decision changes it.

Validation requirements:
- Test across multiple pairs and timeframes before narrowing.
- Keep all thresholds predeclared for the first pass.
- Compare each v2 candidate against a simple baseline.
- Report failure reasons even when headline profit looks attractive.
- Reject variants that only work in one isolated month, quarter, symbol, or volatility regime.

## Recommended First Candidate

Implement first: v2-breakout-volume-expansion.

Reasons:
- Clearest edge hypothesis: volatility expansion after compression is a concrete market behavior.
- Lowest dependency complexity: uses OHLCV, ATR, volume, and range structure already available in the current stack.
- Easiest objective validation: breakouts, volume expansion, candle size, and range boundaries can be measured mechanically.
- Lower overfitting risk than funding/OI because it avoids extra external derivatives data.
- Lower ambiguity than liquidity-sweep reclaim because level sweep definitions can become highly sensitive to lookback and wick rules.

The first implementation should be a minimal, predeclared baseline. Do not add regime filters until the base hypothesis is measured across the full test universe.
