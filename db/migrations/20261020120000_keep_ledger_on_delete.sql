-- Deleting an account used to delete its credit history too, which dropped
-- its purchases from the Money tab's yearly totals. The rows now stay with no
-- account attached: amounts, dates, and the Stripe reference only.
ALTER TABLE credit_ledger ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_account_id_fkey;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL;
