import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProfitabilityProof } from '../src/lib/profitabilityProof.js';
import { getStorageEnvironmentStatus } from '../src/lib/storageAdapter.js';
import { deriveVerdict, toMarkdown } from '../src/scripts/generateBacktestReport.js';
import { evaluateSplitValidation } from '../src/lib/backtestValidator.js';
import { activeStrategy, strategyVersion } from '../src/config/strategyVersion.js';

function makeResult({
  pair = 'BTCUSDT',
  timeframe = '1h',
  closed = 60,
  winRate = 52,
  expectancy = 0.45,
  avgR = 0.45,
  maxDrawdown = 0.08,
  profitFactor = 1.6,
  netR = 20,
  oosDegradation = 0.1,
  walkForwardPass = true,
  flags = [],
} = {}) {
  return {
    pair,
    timeframe,
    metadata: {
      ...activeStrategy,
    },
    ...activeStrategy,
    backtest: {
      actionableTradeCount: closed + 4,
      actionableClosedTradeCount: closed,
      actionableWinRate: winRate,
      actionableExpectancy: expectancy,
      actionableAvgR: avgR,
      actionableMaxDrawdown: maxDrawdown,
      actionableProfitFactor: profitFactor,
      actionableNetR: netR,
    },
    validation: {
      comparison: {
        oosDegradation,
      },
      walkForward: {
        pass: walkForwardPass,
      },
      flags,
    },
  };
}

test('evaluateProfitabilityProof marks setup as proven when all gates pass', () => {
  const proof = evaluateProfitabilityProof([makeResult()]);

  assert.equal(proof.status, 'PROVEN_READY_FOR_PAPER');
  assert.equal(proof.setups[0].status, 'PROVEN_READY_FOR_PAPER');
});

test('evaluateProfitabilityProof rejects stale strategy proof for ATR version', () => {
  const proof = evaluateProfitabilityProof([
    makeResult({
      pair: 'BTCUSDT',
    }),
    {
      ...makeResult({ pair: 'ETHUSDT' }),
      metadata: {
        strategyVersion: 'v1.0',
        riskModel: 'Fixed percentage TP/SL',
      },
      strategyVersion: 'v1.0',
      riskModel: 'Fixed percentage TP/SL',
    },
  ]);

  assert.equal(proof.status, 'STALE_STRATEGY_VERSION');
  assert.ok(proof.failedCriteria.some((item) => item.includes(strategyVersion)));
});

test('evaluateProfitabilityProof marks insufficient sample per setup', () => {
  const proof = evaluateProfitabilityProof([makeResult({ closed: 20 })]);

  assert.equal(proof.status, 'INSUFFICIENT_SAMPLE');
  assert.equal(proof.setups[0].status, 'INSUFFICIENT_SAMPLE');
});

test('evaluateProfitabilityProof fails on OOS degradation', () => {
  const proof = evaluateProfitabilityProof([
    makeResult({
      oosDegradation: 0.2,
      flags: ['OOS_WIN_RATE_DROP_GT_15'],
      walkForwardPass: false,
    }),
  ]);

  assert.equal(proof.status, 'FAILED_OOS');
  assert.ok(proof.failedCriteria.some((item) => item.includes('OOS_DEGRADATION')));
});

test('evaluateSplitValidation passes when OOS remains stable', () => {
  const result = evaluateSplitValidation(
    {
      actionableClosedTradeCount: 70,
      actionableWinRate: 54,
      actionableExpectancy: 0.5,
      actionableAvgR: 0.5,
      actionableProfitFactor: 1.7,
    },
    {
      actionableClosedTradeCount: 55,
      actionableWinRate: 48,
      actionableExpectancy: 0.32,
      actionableAvgR: 0.32,
      actionableProfitFactor: 1.3,
    },
  );

  assert.equal(result.pass, true);
  assert.deepEqual(result.flags, []);
});

test('storage adapter warns when using tmp path', () => {
  const status = getStorageEnvironmentStatus('/tmp/tradescope-data/paper-trades.json');

  assert.equal(status.durable, false);
  assert.match(status.warning, /not authoritative/i);
});

test('report generator markdown includes final verdict and setup section', () => {
  const summary = {
    metadata: {
      ...activeStrategy,
      from: '2024-01-01',
      to: '2024-07-01',
      pairs: ['BTC/USDT'],
      timeframes: ['1h'],
      dataSource: 'vercel-market-data-proxy',
      fallbackDataSource: 'local-cache',
      successCount: 1,
      failureCount: 0,
      runCount: 1,
    },
    proof: evaluateProfitabilityProof([makeResult()]),
    results: [
      {
        ...makeResult(),
        metadata: {
          ...activeStrategy,
          dataSource: 'vercel-market-data-proxy',
          candleCount: 260,
        },
        integrity: {
          valid: true,
          issues: [],
        },
      },
    ],
    failures: [
      {
        pair: 'ETH/USDT',
        timeframe: '1h',
        error: 'mock fetch failed',
      },
    ],
  };
  const liveGate = {
    ready: false,
    paperGatePassed: false,
    paperDurationPassed: false,
    failedCriteria: ['MIN_CLOSED_TRADES (12/30)'],
    stats: {
      totalClosedTrades: 12,
      winRate: 0.5,
      expectancy: 0.2,
      maxDrawdown: 0.1,
    },
    storage: {
      durable: false,
      warning:
        'Paper trading results are not authoritative because durable storage is not configured. Configure a database before using paper results for live-readiness.',
    },
  };
  const verdict = deriveVerdict({ proof: summary.proof, liveGate });
  const markdown = toMarkdown({
    sourcePath: '/tmp/backtest-results/batch-summary-test.json',
    summary,
    liveGate,
  });

  assert.equal(verdict, 'NOT READY');
  assert.match(markdown, /Final verdict: \*\*NOT READY\*\*/);
  assert.match(markdown, /Requested data source: vercel-market-data-proxy/);
  assert.match(markdown, /Data sources used: vercel-market-data-proxy/);
  assert.match(markdown, /mock fetch failed/);
  assert.match(markdown, /BTCUSDT 1h: pass/);
  assert.match(markdown, /\| Pair \| Timeframe \| Proof Status \| Setup Status \|/);
  assert.match(markdown, /Continue paper trading/);
  assert.match(markdown, /## Why Not Ready Yet/);
  assert.match(markdown, /\| BTC\/USDT \| 1h \| PROVEN_READY_FOR_PAPER \| APPROVED_FOR_PAPER \|/);
});
