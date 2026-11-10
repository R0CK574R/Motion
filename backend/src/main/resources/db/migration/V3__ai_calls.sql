-- V3: a record of every AI request.
--
-- For each call: who asked, which feature, which model and prompt version,
-- which tools the model used, how long it took, what it cost in tokens, and
-- what the safety checks found. This is what lets a wrong answer be traced
-- back, and what the daily limits are counted from.
--
-- The API key is never written here. The rows belong to the user and are
-- removed with the account.
CREATE TABLE ai_calls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  feature TEXT NOT NULL CHECK (feature IN ('ask', 'memo', 'analysis')),
  prompt_version TEXT NOT NULL,
  -- NULL when no model was called (a sample answer served to a demo account).
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'sample', 'error')),
  question TEXT,
  answer TEXT,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_turns INT NOT NULL DEFAULT 0,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  -- Did every figure in the answer match the data the model was given?
  grounded BOOLEAN,
  ungrounded JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Was the answer withheld because it read as investment advice?
  advice_blocked BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_calls_user ON ai_calls (user_id, created_at DESC);
CREATE INDEX idx_ai_calls_demo ON ai_calls (created_at) WHERE is_demo AND status <> 'sample';
