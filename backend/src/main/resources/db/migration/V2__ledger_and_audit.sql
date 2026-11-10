-- V2: double-entry ledger, price marks, audit log, roles.
--
-- Before this migration a portfolio was a mutable `cash` number plus a
-- `holdings` table the user could overwrite. From here on, the only source of
-- truth is an append-only journal: every deposit, withdrawal, buy and sell is
-- a transaction made of entries that sum to zero, and cash and holdings are
-- derived by adding the entries up. Nothing in the journal is ever edited or
-- deleted; a mistake is corrected by posting a reversal.

-- Present in V1, repeated here for databases created before demo mode existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'
  CHECK (role IN ('USER', 'ADMIN'));

-- When a refresh token was revoked. Lets the API tell a harmless race (two
-- tabs refreshing at once) from a stolen token being replayed later.
ALTER TABLE refresh_tokens ADD COLUMN revoked_at TIMESTAMPTZ;

-- ------------------------------------------------------------------ journal

CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  seq BIGINT GENERATED ALWAYS AS IDENTITY,          -- total order of postings
  type TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'REVERSAL')),
  ticker TEXT,
  quantity NUMERIC(18, 6) CHECK (quantity IS NULL OR quantity > 0),
  price NUMERIC(18, 4) CHECK (price IS NULL OR price >= 0),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount >= 0), -- gross cash value
  memo TEXT,
  -- A client-chosen key. Retrying a request with the same key returns the
  -- original transaction instead of posting it twice.
  idempotency_key TEXT,
  reverses_id UUID REFERENCES ledger_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, idempotency_key),
  UNIQUE (reverses_id),                              -- reversed at most once
  CHECK ((type = 'REVERSAL') = (reverses_id IS NOT NULL))
);
CREATE INDEX idx_ledger_tx_portfolio ON ledger_transactions (portfolio_id, seq DESC);

-- Sign convention: a debit is positive, a credit is negative.
--   CASH, SECURITIES       assets: a positive balance is what you own
--   CONTRIBUTIONS          money paid in by the owner (credit balance)
--   REALIZED_PNL           gains and losses locked in by selling (credit = gain)
CREATE TABLE ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('CASH', 'SECURITIES', 'CONTRIBUTIONS', 'REALIZED_PNL')),
  ticker TEXT,
  amount NUMERIC(18, 2) NOT NULL,
  quantity NUMERIC(18, 6) NOT NULL DEFAULT 0,
  -- Only securities entries carry a ticker and a share quantity.
  CHECK ((account = 'SECURITIES') = (ticker IS NOT NULL)),
  CHECK (account = 'SECURITIES' OR quantity = 0)
);
CREATE INDEX idx_ledger_entries_balance ON ledger_entries (portfolio_id, account, ticker);
CREATE INDEX idx_ledger_entries_tx ON ledger_entries (transaction_id);

-- Rule 1: every transaction balances. Checked by the database at commit, so
-- no application bug can leave debits and credits unequal.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total
  FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (entries sum to %)',
      NEW.transaction_id, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Rule 2: the journal is append-only. Updates are always refused. A delete is
-- refused unless the parent row is already gone, which only happens when a
-- whole portfolio is removed (account deletion, demo clean-up) and the delete
-- cascades down.
CREATE FUNCTION ledger_transactions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM portfolios WHERE id = OLD.portfolio_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'the ledger is append-only: post a reversal instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE id = OLD.transaction_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'the ledger is append-only: post a reversal instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_immutable();
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

-- -------------------------------------------------------------- price marks
-- The latest known price per ticker. This is market data, not a money
-- movement, so it lives outside the journal and may be overwritten.
CREATE TABLE price_marks (
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  price NUMERIC(18, 4) NOT NULL CHECK (price >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, ticker)
);

-- ---------------------------------------------------------------- audit log
-- Who did what, when, from where. Append-only with no exceptions. user_id is
-- deliberately not a foreign key: the log must outlive the account.
CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_user ON audit_log (user_id, id DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ------------------------------------------- carry existing portfolios over
-- Each old portfolio becomes opening entries: one deposit covering its cash
-- plus what its holdings cost, then one buy per ticker at its average cost.
-- The result is the same cash, shares and cost basis as before.
DO $$
DECLARE
  p RECORD;
  h RECORD;
  tx UUID;
  total_basis NUMERIC(18, 2);
BEGIN
  FOR p IN SELECT id, cash FROM portfolios LOOP
    SELECT COALESCE(SUM(ROUND(shares * cost, 2)), 0) INTO total_basis
    FROM holdings WHERE portfolio_id = p.id AND shares > 0;

    IF p.cash + total_basis > 0 THEN
      INSERT INTO ledger_transactions (portfolio_id, type, amount, memo)
      VALUES (p.id, 'DEPOSIT', p.cash + total_basis, 'Opening balance (migrated)')
      RETURNING id INTO tx;
      INSERT INTO ledger_entries (transaction_id, portfolio_id, account, amount) VALUES
        (tx, p.id, 'CASH', p.cash + total_basis),
        (tx, p.id, 'CONTRIBUTIONS', -(p.cash + total_basis));
    END IF;

    FOR h IN
      SELECT upper(trim(ticker)) AS ticker, SUM(shares) AS quantity,
             SUM(ROUND(shares * cost, 2)) AS basis, MAX(price) AS price
      FROM holdings WHERE portfolio_id = p.id AND shares > 0
      GROUP BY upper(trim(ticker))
    LOOP
      INSERT INTO ledger_transactions (portfolio_id, type, ticker, quantity, price, amount, memo)
      VALUES (p.id, 'BUY', h.ticker, h.quantity, ROUND(h.basis / h.quantity, 4), h.basis,
              'Opening position (migrated)')
      RETURNING id INTO tx;
      INSERT INTO ledger_entries (transaction_id, portfolio_id, account, ticker, amount, quantity) VALUES
        (tx, p.id, 'SECURITIES', h.ticker, h.basis, h.quantity),
        (tx, p.id, 'CASH', NULL, -h.basis, 0);
      INSERT INTO price_marks (portfolio_id, ticker, price) VALUES (p.id, h.ticker, h.price);
    END LOOP;
  END LOOP;
END $$;

DROP TABLE holdings;
ALTER TABLE portfolios DROP COLUMN cash;
