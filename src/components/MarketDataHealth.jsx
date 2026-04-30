function formatTime(value) {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function statusTone(status) {
  if (status === 'OK') {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]';
  }

  if (status === 'BLOCKED' || status === 'TIMEOUT') {
    return 'border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)]';
  }

  if (status === 'STALE') {
    return 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]';
  }

  return 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]';
}

export default function MarketDataHealth({ health }) {
  const rows = health?.rows ?? [];
  const summary = health?.summary ?? {};

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 md:p-4">
      <div className="grid gap-3 md:flex md:flex-wrap md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:text-[11px] md:tracking-[0.24em]">Market Data Health</div>
          <div className="mt-1 text-sm text-[var(--text-primary)]">{summary.message ?? 'Checking market data...'}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] md:gap-x-5 md:text-right md:text-[11px] md:tracking-[0.16em]">
          <span>Source</span>
          <span className="font-mono text-[var(--text-primary)]">{summary.activeDataSource ?? 'None'}</span>
          <span>Last OK</span>
          <span className="font-mono text-[var(--text-primary)]">{formatTime(summary.lastSuccessfulUpdate)}</span>
          <span>Signals</span>
          <span className={summary.signalAllowed ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
            {summary.signalAllowed ? 'Allowed' : 'Disabled'}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:mt-4 xl:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="truncate text-xs font-medium text-[var(--text-primary)]">{row.source}</div>
                  {!row.required ? (
                    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Optional
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{row.endpoint}</div>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${statusTone(row.status)}`}>
                {row.status}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] uppercase tracking-[0.10em] text-[var(--text-muted)] md:tracking-[0.16em]">
              <span>Last Success</span>
              <span className="text-right font-mono text-[var(--text-secondary)]">{formatTime(row.lastSuccessAt)}</span>
              <span>Last Error</span>
              <span className="text-right font-mono text-[var(--text-secondary)]">{formatTime(row.lastErrorAt)}</span>
              <span>Error Type</span>
              <span className="truncate text-right font-mono text-[var(--text-secondary)]" title={row.errorType ?? ''}>
                {row.errorType ?? '--'}
              </span>
              <span>Source</span>
              <span className="truncate text-right font-mono text-[var(--text-secondary)]">{row.responseSource ?? '--'}</span>
            </div>
            {row.message && row.message !== 'OK' ? (
              <div className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-[var(--text-secondary)]" title={row.message}>
                {row.message}
              </div>
            ) : null}
            {!row.required ? (
              <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Not used for official paper proof or live gate.
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
