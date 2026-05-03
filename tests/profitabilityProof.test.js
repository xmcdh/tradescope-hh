import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProfitabilityProof } from '../src/lib/profitabilityProof.js';
import { getStorageEnvironmentStatus } from '../src/lib/storageAdapter.js';
import { buildSampleSizeStatus, deriveVerdict, toMarkdown } from '../src/scripts/generateBacktestReport.js';
import { evaluateSplitValidation } from '../src/lib/backtestValidator.js';
import { activeStrategy, strategyVersion } from '../src/config/strategyVersion.js';
import { buildHistoryLengthComparison } from '../src/lib/historyLengthComparison.js';
import { buildRegimeDependencyAnalysis } from '../src/lib/regimeDependencyAnalysis.js';
import { buildRegimeFeatureAudit } from '../src/lib/regimeFeatureAudit.js';

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
  assert.match(markdown, /## Sample Size Status/);
  assert.match(markdown, /BTCUSDT \| 1h \| 60\/50/);
  assert.match(markdown, /Continue paper trading/);
  assert.match(markdown, /## Why Not Ready Yet/);
  assert.match(markdown, /\| BTC\/USDT \| 1h \| PROVEN_READY_FOR_PAPER \| APPROVED_FOR_PAPER \|/);
});

test('report generator explains zero actionable trades when valid signals are non-executable', () => {
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
    proof: evaluateProfitabilityProof([
      makeResult({
        closed: 0,
        winRate: 0,
        expectancy: 0,
        avgR: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        netR: 0,
      }),
    ]),
    results: [
      {
        ...makeResult({
          closed: 0,
          winRate: 0,
          expectancy: 0,
          avgR: 0,
          maxDrawdown: 0,
          profitFactor: 0,
          netR: 0,
        }),
        metadata: {
          ...activeStrategy,
          dataSource: 'vercel-market-data-proxy',
          candleCount: 4368,
        },
        backtest: {
          actionableTradeCount: 0,
          actionableClosedTradeCount: 0,
          actionableWinRate: 0,
          actionableExpectancy: 0,
          actionableAvgR: 0,
          actionableMaxDrawdown: 0,
          actionableProfitFactor: 0,
          actionableNetR: 0,
          diagnostics: {
            totalCandlesEvaluated: 100,
            rawSignalCount: 100,
            longSignalCount: 0,
            shortSignalCount: 0,
            noTradeCount: 90,
            waitCount: 0,
            waitRetestCount: 10,
            validCount: 10,
            marginalCount: 0,
            blockedCount: 90,
            validExecutableSignalCount: 0,
            validNonExecutableSignalCount: 10,
            hardBlockReasonBreakdown: {},
            rrWarningCount: 0,
            levelWarningCount: 0,
            missingTradeLevelCount: 0,
            missingAtrCount: 0,
            simulatedTradeOpenedCount: 0,
            simulatedTradeClosedCount: 0,
            expiredTradeCount: 0,
            unresolvedTradeCount: 0,
            pendingRetestCreatedCount: 10,
            pendingRetestConfirmedCount: 0,
            pendingRetestExpiredCount: 10,
            pendingRetestInvalidatedCount: 0,
            confirmedLongCount: 0,
            confirmedShortCount: 0,
            nonActionableReasonBreakdown: {
              'Signal WAIT_RETEST is not executable; backtester opens LONG/SHORT only.': 10,
            },
          },
        },
        integrity: {
          valid: true,
          issues: [],
        },
      },
    ],
    failures: [],
  };
  const liveGate = {
    ready: false,
    paperGatePassed: false,
    paperDurationPassed: false,
    failedCriteria: ['MIN_CLOSED_TRADES (0/30)'],
    stats: {
      totalClosedTrades: 0,
      winRate: 0,
      expectancy: 0,
      maxDrawdown: 0,
    },
    storage: {
      durable: true,
      warning: '',
    },
  };

  const markdown = toMarkdown({
    sourcePath: '/tmp/backtest-results/batch-summary-test.json',
    summary,
    liveGate,
  });

  assert.match(markdown, /Zero-trade diagnosis: WAIT_RETEST setups were observed \(10\), but none confirmed within the configured window/);
});

test('sample-size report shows distance to 50 closed actionable trades', () => {
  const summary = {
    results: [
      makeResult({
        pair: 'BNB/USDT',
        timeframe: '15m',
        closed: 11,
      }),
      makeResult({
        pair: 'BTC/USDT',
        timeframe: '1h',
        closed: 0,
      }),
    ],
  };

  const sampleStatus = buildSampleSizeStatus(summary, 50);

  assert.equal(sampleStatus.best.pair, 'BNB/USDT');
  assert.equal(sampleStatus.best.closed, 11);
  assert.equal(sampleStatus.best.missing, 39);
  assert.equal(sampleStatus.officialMonitored.pair, 'BTC/USDT');
  assert.equal(sampleStatus.officialMonitored.sampleStatus, 'INSUFFICIENT_SAMPLE');
  assert.equal(sampleStatus.officialMonitored.missing, 50);
});

test('history-length comparison keeps sparse strategy unapproved below 50 trades', () => {
  const comparison = buildHistoryLengthComparison([
    {
      sourceFile: 'six-month.json',
      metadata: {
        ...activeStrategy,
        from: '2024-01-01',
        to: '2024-07-01',
        dataSource: 'vercel-market-data-proxy',
      },
      proof: evaluateProfitabilityProof([makeResult({ pair: 'BNB/USDT', timeframe: '15m', closed: 11 })]),
      results: [makeResult({ pair: 'BNB/USDT', timeframe: '15m', closed: 11 })],
    },
    {
      sourceFile: 'eighteen-month.json',
      metadata: {
        ...activeStrategy,
        from: '2023-01-01',
        to: '2024-07-01',
        dataSource: 'vercel-market-data-proxy',
      },
      proof: evaluateProfitabilityProof([makeResult({ pair: 'BNB/USDT', timeframe: '15m', closed: 25 })]),
      results: [makeResult({ pair: 'BNB/USDT', timeframe: '15m', closed: 25 })],
    },
  ]);

  assert.equal(comparison.conclusion.anySetupEligibleForApproval, false);
  assert.equal(comparison.conclusion.sparseUnderCurrentRules, true);
  assert.match(comparison.conclusion.statement, /too selective/);
  assert.equal(comparison.ranges[1].bestSetup.closedActionableTrades, 25);
  assert.equal(comparison.growth[0].latestClosedActionableTrades, 25);
});

test('regime dependency analysis keeps v1.5 trailing not promotable on profit concentration', () => {
  const payload = {
    metadata: {
      pair: 'SOL/USDT',
      timeframe: '1h',
      experimentId: 'v1.5-trailing-after-1r',
      strategyVersion: 'v1.5-trailing-after-1r',
      from: '2021-07-01',
      to: '2024-07-01',
      dataSource: 'local-cache',
    },
    backtest: {
      actionableClosedTradeCount: 3,
      actionableWinRate: 66.67,
      actionableExpectancy: 0.6,
      actionableMaxDrawdown: 0.02,
      trades: [
        {
          timestamp: Date.parse('2022-12-01T00:00:00.000Z'),
          exitTimestamp: Date.parse('2022-12-02T00:00:00.000Z'),
          signal: 'LONG',
          outcome: 'LOSS',
          r: -1,
          atr: 1,
          entry: 10,
          tradeLevelFields: { sl: 9.5 },
          confidenceScore: 7,
        },
        {
          timestamp: Date.parse('2023-08-01T00:00:00.000Z'),
          exitTimestamp: Date.parse('2023-08-02T00:00:00.000Z'),
          signal: 'SHORT',
          outcome: 'WIN',
          r: 1.4,
          atr: 3,
          entry: 10,
          tradeLevelFields: { sl: 10.5 },
          confidenceScore: 8,
        },
        {
          timestamp: Date.parse('2023-08-10T00:00:00.000Z'),
          exitTimestamp: Date.parse('2023-08-11T00:00:00.000Z'),
          signal: 'SHORT',
          outcome: 'WIN',
          r: 1.4,
          atr: 4,
          entry: 10,
          tradeLevelFields: { sl: 10.5 },
          confidenceScore: 8,
        },
      ],
    },
    validation: {
      walkForward: {
        pass: false,
        flags: ['WALK_FORWARD_PROFIT_CONCENTRATION'],
        summary: {
          profitConcentration: 1,
        },
        windows: [
          {
            index: 1,
            pass: true,
            outOfSample: {
              netR: 2.8,
            },
          },
        ],
      },
    },
  };

  const analysis = buildRegimeDependencyAnalysis(payload, { status: 'FAILED_WALK_FORWARD', profitConcentration: 1 });

  assert.equal(analysis.headlineMetrics.promotionStatus, 'FAILED_WALK_FORWARD');
  assert.equal(analysis.safety.approvedSetups, 0);
  assert.equal(analysis.safety.paperDay1, 'PENDING_SETUP_APPROVAL');
  assert.equal(analysis.regimeBreakdowns.byMarketWindow.some((row) => row.regime === '2022_BEAR_MARKET'), true);
  assert.ok(analysis.unavailableFields.includes('trendStrengthOrEmaSlope'));
});

test('regime feature audit is research-only and proposes filters without approval', () => {
  const payload = {
    metadata: {
      pair: 'SOL/USDT',
      timeframe: '1h',
      experimentId: 'v1.5-trailing-after-1r',
      from: '2021-07-01',
      to: '2024-07-01',
    },
    backtest: {
      trades: [
        {
          outcome: 'LOSS',
          signal: 'LONG',
          r: -1,
          regimeFeatures: {
            atrPercentile: 0.1,
            emaSlope: 0,
            trendStrengthScore: 1,
            chopScore: 75,
            impulseSizeAtr: 1,
            pullbackDepthAtr: 1,
            volatilityRegime: 'LOW',
            trendRegime: 'SIDEWAYS',
          },
        },
        {
          outcome: 'WIN',
          signal: 'SHORT',
          r: 1.5,
          regimeFeatures: {
            atrPercentile: 0.8,
            emaSlope: -0.1,
            trendStrengthScore: 9,
            chopScore: 10,
            impulseSizeAtr: 3,
            pullbackDepthAtr: 2,
            volatilityRegime: 'HIGH',
            trendRegime: 'BEARISH',
          },
        },
      ],
    },
  };

  const audit = buildRegimeFeatureAudit(payload);

  assert.equal(audit.safety.approvedSetups, 0);
  assert.equal(audit.safety.paperDay1, 'PENDING_SETUP_APPROVAL');
  assert.equal(audit.conclusion.implementedFilter, false);
  assert.ok(audit.candidateFilters.some((candidate) => candidate.filter === 'avoid_SIDEWAYS_trendRegime'));
});
