-- Money tab. Paid credits are the part of a balance that was bought; free
-- credits (welcome, admin grants) are spent first.
ALTER TABLE accounts ADD COLUMN paid_credits INTEGER NOT NULL DEFAULT 0
  CHECK (paid_credits >= 0);
ALTER TABLE accounts ADD CONSTRAINT paid_within_credits
  CHECK (paid_credits <= credits);
-- On spends (and their failed-job refunds): did the credit come from paid ones.
ALTER TABLE credit_ledger ADD COLUMN paid BOOLEAN;

-- One row per AI job, with the app's own cost estimate.
CREATE TABLE ai_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  step TEXT NOT NULL CHECK (step IN ('idea', 'recipe', 'moderation')),
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 4) NOT NULL,
  ledger_id BIGINT REFERENCES credit_ledger (id) ON DELETE SET NULL,
  failed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX ai_usage_created ON ai_usage (created_at);

-- Bills typed in on the Money tab. Months are stored as their first day.
CREATE TABLE fixed_costs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents > 0),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly', 'once')),
  starts DATE NOT NULL,
  ends DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends IS NULL OR ends >= starts)
);

-- Finished months, saved once so they load fast and don't drift.
CREATE TABLE money_months (
  month DATE PRIMARY KEY,
  totals JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
