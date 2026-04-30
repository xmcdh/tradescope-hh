CREATE TABLE IF NOT EXISTS signal_logs (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  signal TEXT,
  signal_validity TEXT NOT NULL,
  setup_status TEXT NOT NULL,
  proof_status TEXT NOT NULL,
  candle_timestamp BIGINT,
  entry NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  rr NUMERIC,
  score NUMERIC,
  result TEXT,
  exit_price NUMERIC,
  exit_timestamp BIGINT,
  realized_r NUMERIC,
  r_result NUMERIC,
  btc_context JSONB,
  blocked_reason JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT,
  signal TEXT,
  signal_validity TEXT NOT NULL,
  setup_status TEXT NOT NULL,
  proof_status TEXT NOT NULL,
  paper_category TEXT NOT NULL,
  is_approved_paper_trade BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  entry NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  rr NUMERIC,
  score NUMERIC,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  exit_price NUMERIC,
  exit_timestamp BIGINT,
  realized_r NUMERIC,
  r_result NUMERIC,
  btc_context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proof_snapshots (
  id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  approved_setup_count INTEGER NOT NULL DEFAULT 0,
  collecting_data_setup_count INTEGER NOT NULL DEFAULT 0,
  rejected_setup_count INTEGER NOT NULL DEFAULT 0,
  storage_status TEXT NOT NULL,
  source_batch_filename TEXT,
  source_report_filename TEXT,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setup_approvals (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  proof_status TEXT NOT NULL,
  setup_status TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  source_report_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_logs_pair_timeframe ON signal_logs (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_signal_logs_created_at ON signal_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_signal_logs_candle_timestamp ON signal_logs (candle_timestamp);

CREATE INDEX IF NOT EXISTS idx_paper_trades_pair_timeframe ON paper_trades (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades (status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at ON paper_trades (created_at);

CREATE INDEX IF NOT EXISTS idx_proof_snapshots_generated_at ON proof_snapshots (generated_at);

CREATE INDEX IF NOT EXISTS idx_setup_approvals_pair_timeframe ON setup_approvals (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_setup_approvals_created_at ON setup_approvals (created_at);
