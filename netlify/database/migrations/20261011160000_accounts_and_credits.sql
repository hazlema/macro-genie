-- Accounts hold the bare minimum: who you are to Google, the name shown on
-- your posts, your credits, and (later) your Stripe customer id. No email.
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  stripe_customer TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every change to a balance, with its reason. A (reason, ref) pair can only
-- be recorded once, so a payment notification that arrives twice can't add
-- credits twice.
CREATE TABLE credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reason, ref)
);

CREATE INDEX credit_ledger_account ON credit_ledger (account_id, created_at DESC);
