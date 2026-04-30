import fs from 'node:fs/promises';
import path from 'node:path';
import { DISABLED_SETUPS, normalizeSetupConfigKey } from '../config/disabledSetups.js';

export const SETUP_STATUS = {
  APPROVED_FOR_PAPER: 'APPROVED_FOR_PAPER',
  COLLECT_MORE_DATA: 'COLLECT_MORE_DATA',
  REJECTED_OOS_FAILURE: 'REJECTED_OOS_FAILURE',
  REJECTED_EXPECTANCY: 'REJECTED_EXPECTANCY',
  REJECTED_DRAWDOWN: 'REJECTED_DRAWDOWN',
  REJECTED_WIN_RATE: 'REJECTED_WIN_RATE',
  DISABLED_MANUAL: 'DISABLED_MANUAL',
  UNKNOWN: 'UNKNOWN',
};

export const PAPER_CATEGORY = {
  PAPER_ELIGIBLE: 'PAPER_ELIGIBLE',
  OBSERVATION_ONLY: 'OBSERVATION_ONLY',
  REJECTED_SETUP: 'REJECTED_SETUP',
  BLOCKED_SIGNAL: 'BLOCKED_SIGNAL',
};

function normalizePairDisplay(pair) {
  const text = String(pair ?? '').toUpperCase();
  if (text.includes('/')) {
    return text;
  }

  if (text.endsWith('USDT')) {
    return `${text.slice(0, -4)}/USDT`;
  }

  return text;
}

export function toSetupSymbolKey(pair, timeframe) {
  return normalizeSetupConfigKey(pair, timeframe);
}

function manualDisableMap(disabledSetups = DISABLED_SETUPS) {
  return new Map(
    (Array.isArray(disabledSetups) ? disabledSetups : []).map((item) => [
      normalizeSetupConfigKey(item.pair, item.timeframe),
      item.reason || 'Manually disabled by local config.',
    ]),
  );
}

export function mapProofStatusToSetupStatus(proofStatus) {
  switch (proofStatus) {
    case 'PROVEN_READY_FOR_PAPER':
      return SETUP_STATUS.APPROVED_FOR_PAPER;
    case 'INSUFFICIENT_SAMPLE':
      return SETUP_STATUS.COLLECT_MORE_DATA;
    case 'FAILED_OOS':
      return SETUP_STATUS.REJECTED_OOS_FAILURE;
    case 'FAILED_EXPECTANCY':
      return SETUP_STATUS.REJECTED_EXPECTANCY;
    case 'FAILED_DRAWDOWN':
      return SETUP_STATUS.REJECTED_DRAWDOWN;
    case 'FAILED_WIN_RATE':
      return SETUP_STATUS.REJECTED_WIN_RATE;
    default:
      return SETUP_STATUS.UNKNOWN;
  }
}

export function recommendationForSetupStatus(setupStatus) {
  switch (setupStatus) {
    case SETUP_STATUS.APPROVED_FOR_PAPER:
      return 'Continue paper trading';
    case SETUP_STATUS.COLLECT_MORE_DATA:
      return 'Collect more sample';
    case SETUP_STATUS.REJECTED_OOS_FAILURE:
      return 'Re-test on longer history';
    case SETUP_STATUS.REJECTED_EXPECTANCY:
    case SETUP_STATUS.REJECTED_DRAWDOWN:
    case SETUP_STATUS.REJECTED_WIN_RATE:
      return 'Remove from approved universe';
    case SETUP_STATUS.DISABLED_MANUAL:
    case SETUP_STATUS.UNKNOWN:
    default:
      return 'Watch only';
  }
}

function buildRegistryEntry(setup, resultByKey, disabledMap) {
  const pair = normalizePairDisplay(setup?.metrics?.pair ?? setup?.pair);
  const timeframe = String(setup?.metrics?.timeframe ?? setup?.timeframe ?? '').toLowerCase();
  const symbolKey = toSetupSymbolKey(pair, timeframe);
  const disabledReason = disabledMap.get(symbolKey) ?? null;
  const baseStatus = mapProofStatusToSetupStatus(setup?.status);
  const setupStatus = disabledReason ? SETUP_STATUS.DISABLED_MANUAL : baseStatus;
  const result = resultByKey.get(symbolKey) ?? null;
  const validationFlags = result?.validation?.flags ?? [];
  const oosStatus = setup?.metrics?.oosDegradation != null && setup.metrics.oosDegradation <= 0.15 && setup.metrics.walkForwardPass
    ? 'PASS'
    : validationFlags.length
      ? validationFlags.join(', ')
      : 'REVIEW';
  const rejectionReason =
    disabledReason ??
    (setupStatus === SETUP_STATUS.APPROVED_FOR_PAPER ? '' : setup?.failedCriteria?.join(' | ') || 'Setup is not approved for paper trading.');

  return {
    key: `${pair}:${timeframe}`,
    symbolKey,
    pair,
    timeframe,
    proofStatus: setup?.status ?? 'UNKNOWN',
    setupStatus,
    actionableTrades: setup?.metrics?.closedTrades ?? 0,
    expectancy: setup?.metrics?.expectancy ?? 0,
    winRate: setup?.metrics?.winRate ?? 0,
    maxDrawdown: setup?.metrics?.maxDrawdown ?? 0,
    oosStatus,
    recommendation: recommendationForSetupStatus(setupStatus),
    failedCriteria: Array.isArray(setup?.failedCriteria) ? setup.failedCriteria : [],
    rejectionReason,
  };
}

export function buildSetupRegistry(summary, options = {}) {
  const proof = summary?.proof ?? null;
  const disabledMap = manualDisableMap(options.disabledSetups);
  const resultByKey = new Map(
    (summary?.results ?? []).map((item) => [toSetupSymbolKey(item.pair, item.timeframe), item]),
  );
  const entries = (proof?.setups ?? []).map((setup) => buildRegistryEntry(setup, resultByKey, disabledMap));
  const bySymbolKey = Object.fromEntries(entries.map((entry) => [entry.symbolKey, entry]));
  const counts = {
    approved: entries.filter((entry) => entry.setupStatus === SETUP_STATUS.APPROVED_FOR_PAPER).length,
    collectingData: entries.filter((entry) => entry.setupStatus === SETUP_STATUS.COLLECT_MORE_DATA).length,
    rejected: entries.filter((entry) =>
      [
        SETUP_STATUS.REJECTED_OOS_FAILURE,
        SETUP_STATUS.REJECTED_EXPECTANCY,
        SETUP_STATUS.REJECTED_DRAWDOWN,
        SETUP_STATUS.REJECTED_WIN_RATE,
        SETUP_STATUS.DISABLED_MANUAL,
      ].includes(entry.setupStatus),
    ).length,
    disabled: entries.filter((entry) => entry.setupStatus === SETUP_STATUS.DISABLED_MANUAL).length,
    unknown: entries.filter((entry) => entry.setupStatus === SETUP_STATUS.UNKNOWN).length,
  };

  return {
    generatedAt: summary?.generatedAt ?? null,
    proofStatus: proof?.status ?? 'UNKNOWN',
    counts,
    entries,
    bySymbolKey,
  };
}

export async function readLatestProofSummary() {
  const directory = path.resolve(process.cwd(), 'backtest-results');

  try {
    const files = (await fs.readdir(directory))
      .filter((file) => file.startsWith('batch-summary-') && file.endsWith('.json'))
      .map((file) => path.join(directory, file));

    if (!files.length) {
      return null;
    }

    const withStats = await Promise.all(
      files.map(async (file) => ({
        file,
        stat: await fs.stat(file),
      })),
    );

    const latest = withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    return JSON.parse(await fs.readFile(latest.file, 'utf8'));
  } catch {
    return null;
  }
}

export async function loadSetupRegistry() {
  const summary = await readLatestProofSummary();
  return buildSetupRegistry(summary);
}

export function lookupSetupEntry(registry, pair, timeframe) {
  return registry?.bySymbolKey?.[toSetupSymbolKey(pair, timeframe)] ?? null;
}

export function classifySignalForPaper({ setupStatus, signalValidity, signal, proofStatus, rejectionReason }) {
  const executable = ['LONG', 'SHORT'].includes(signal);

  if (signalValidity === 'BLOCKED') {
    return {
      paperCategory: PAPER_CATEGORY.BLOCKED_SIGNAL,
      isApprovedPaperTrade: false,
      shouldTrackOutcome: false,
      rejectionReason: rejectionReason || 'Blocked signal cannot enter paper trading.',
      proofStatus,
      setupStatus,
    };
  }

  if (!executable) {
    return {
      paperCategory: PAPER_CATEGORY.OBSERVATION_ONLY,
      isApprovedPaperTrade: false,
      shouldTrackOutcome: false,
      rejectionReason: rejectionReason || 'Non-executable signal. Observation only.',
      proofStatus,
      setupStatus,
    };
  }

  if (signalValidity !== 'VALID') {
    return {
      paperCategory: PAPER_CATEGORY.OBSERVATION_ONLY,
      isApprovedPaperTrade: false,
      shouldTrackOutcome: true,
      rejectionReason: rejectionReason || `Signal validity ${signalValidity ?? 'UNKNOWN'} is observation only.`,
      proofStatus,
      setupStatus,
    };
  }

  if (setupStatus === SETUP_STATUS.APPROVED_FOR_PAPER) {
    return {
      paperCategory: PAPER_CATEGORY.PAPER_ELIGIBLE,
      isApprovedPaperTrade: true,
      shouldTrackOutcome: true,
      rejectionReason: '',
      proofStatus,
      setupStatus,
    };
  }

  if (setupStatus === SETUP_STATUS.COLLECT_MORE_DATA || setupStatus === SETUP_STATUS.UNKNOWN) {
    return {
      paperCategory: PAPER_CATEGORY.OBSERVATION_ONLY,
      isApprovedPaperTrade: false,
      shouldTrackOutcome: true,
      rejectionReason: rejectionReason || 'Setup is still collecting evidence and remains observation only.',
      proofStatus,
      setupStatus,
    };
  }

  return {
    paperCategory: PAPER_CATEGORY.REJECTED_SETUP,
    isApprovedPaperTrade: false,
    shouldTrackOutcome: false,
    rejectionReason: rejectionReason || 'Setup is not approved for paper trading.',
    proofStatus,
    setupStatus,
  };
}
