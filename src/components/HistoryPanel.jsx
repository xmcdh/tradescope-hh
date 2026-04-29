export default function HistoryPanel({ history }) {
  return (
    <section className="rounded-[28px] border border-line bg-panel/90 p-5 shadow-glow backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-accent">Recent Actions</p>
          <h2 className="mt-2 text-xl font-semibold text-text">Copy History</h2>
        </div>
        <span className="rounded-full border border-line px-3 py-1 font-mono text-[11px] text-text">{history.length}</span>
      </div>

      <div className="mt-5 space-y-3">
        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-muted">
            Belum ada aktivitas copy. Histori akan muncul saat kamu menyalin signal atau prompt AI.
          </div>
        ) : (
          history.map((item) => (
            <div key={item.id} className="rounded-2xl border border-line bg-ink/70 px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-text">{item.symbol}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">{item.action}</div>
                </div>
                <div className="text-right font-mono text-[11px] text-muted">
                  <div>{item.signal}</div>
                  <div>{item.time}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
