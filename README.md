# TradeScope

Personal Crypto Futures Signal Dashboard.

## Market Data Connectivity Troubleshooting

Test the local proxy:

```bash
curl http://localhost:3001/api/klines/BTCUSDT
curl http://localhost:3001/api/ticker/BTCUSDT
curl http://localhost:3001/api/funding/BTCUSDT
curl http://localhost:3001/api/openinterest/BTCUSDT
```

Signs that the current network is blocking exchange data:

- The response body is HTML instead of JSON.
- The response contains text like `Situs Diblokir`.
- HTTP status is `200`, but the body is not market JSON.
- TradeScope reports `NETWORK_BLOCKED` or `UPSTREAM_HTML_RESPONSE`.

Recommended fixes:

- Try a phone hotspot or another network.
- Deploy the proxy to a VPS/cloud network that can reach exchange APIs.
- Use a supported fallback provider when available.
- Keep the stale/error safety rule enabled.

Warning: never enable `LONG` or `SHORT` generation from stale, blocked, price-only, or error data. CoinGecko-style price-only fallback is only safe for price display and must not generate futures signals.

## Fallback Provider Plan

Provider priority:

1. Binance Futures
2. Bybit Futures
3. OKX public futures/swap
4. CoinGecko price-only fallback

Abstraction target:

- `getMarketSnapshot(symbol)`
- `getKlines(symbol, timeframe)`
- `getFunding(symbol)`
- `getOpenInterest(symbol)`

Every provider result should include:

- `source`
- `ok`
- `data`
- `errorType`
- `freshness`
- `signalAllowed`

If a provider does not supply fresh futures candles, `signalAllowed` must be `false`.

## Official Paper Market Data Source

During the official 28-day paper tracking phase, Binance Futures is the authoritative market data source for Health Panel success, proof review, and any future live-readiness decision.

- Required health checks use Binance klines, ticker, funding, and open interest.
- Bybit remains optional/future fallback only.
- Bybit does not affect Health Panel success, paper proof, liveGate, setup approval, strategy validation, or live readiness.
- Official paper tracking must count only durable approved BTC/USDT 1h records from the active proof gate.
