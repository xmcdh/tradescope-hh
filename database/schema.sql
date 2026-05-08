CREATE TABLE IF NOT EXISTS signal_logs (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_version TEXT,
  risk_model TEXT,
  signal_logic_version TEXT,
  activated_at TIMESTAMPTZ,
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
  strategy_version TEXT,
  risk_model TEXT,
  signal_logic_version TEXT,
  activated_at TIMESTAMPTZ,
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

CREATE TABLE IF NOT EXISTS conviction_trades (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  strategy TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry NUMERIC,
  sl NUMERIC,
  tp1 NUMERIC,
  tp2 NUMERIC,
  score NUMERIC,
  status TEXT NOT NULL,
  r_outcome NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proof_snapshots (
  id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  strategy_version TEXT,
  risk_model TEXT,
  signal_logic_version TEXT,
  activated_at TIMESTAMPTZ,
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
  strategy_version TEXT,
  risk_model TEXT,
  signal_logic_version TEXT,
  activated_at TIMESTAMPTZ,
  proof_status TEXT NOT NULL,
  setup_status TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  source_report_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS signal_logs
  ADD COLUMN IF NOT EXISTS strategy_version TEXT,
  ADD COLUMN IF NOT EXISTS risk_model TEXT,
  ADD COLUMN IF NOT EXISTS signal_logic_version TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS paper_trades
  ADD COLUMN IF NOT EXISTS strategy_version TEXT,
  ADD COLUMN IF NOT EXISTS risk_model TEXT,
  ADD COLUMN IF NOT EXISTS signal_logic_version TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS proof_snapshots
  ADD COLUMN IF NOT EXISTS strategy_version TEXT,
  ADD COLUMN IF NOT EXISTS risk_model TEXT,
  ADD COLUMN IF NOT EXISTS signal_logic_version TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS setup_approvals
  ADD COLUMN IF NOT EXISTS strategy_version TEXT,
  ADD COLUMN IF NOT EXISTS risk_model TEXT,
  ADD COLUMN IF NOT EXISTS signal_logic_version TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signal_logs_pair_timeframe ON signal_logs (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_signal_logs_strategy_version ON signal_logs (strategy_version);
CREATE INDEX IF NOT EXISTS idx_signal_logs_created_at ON signal_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_signal_logs_candle_timestamp ON signal_logs (candle_timestamp);

CREATE INDEX IF NOT EXISTS idx_paper_trades_pair_timeframe ON paper_trades (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_version ON paper_trades (strategy_version);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades (status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at ON paper_trades (created_at);

CREATE INDEX IF NOT EXISTS idx_conviction_trades_portfolio_date ON conviction_trades (portfolio_id, date);
CREATE INDEX IF NOT EXISTS idx_conviction_trades_status ON conviction_trades (status);

CREATE INDEX IF NOT EXISTS idx_proof_snapshots_generated_at ON proof_snapshots (generated_at);
CREATE INDEX IF NOT EXISTS idx_proof_snapshots_strategy_version ON proof_snapshots (strategy_version);

CREATE INDEX IF NOT EXISTS idx_setup_approvals_pair_timeframe ON setup_approvals (pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_setup_approvals_strategy_version ON setup_approvals (strategy_version);
CREATE INDEX IF NOT EXISTS idx_setup_approvals_created_at ON setup_approvals (created_at);
