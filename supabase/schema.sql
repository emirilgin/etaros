-- ============================================================
-- Sidekick License Database
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor
-- ============================================================

-- License keys table
CREATE TABLE IF NOT EXISTS license_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text        UNIQUE NOT NULL,
  tier            text        NOT NULL CHECK (tier IN ('pro', 'max', 'tester')),
  email           text,
  stripe_payment_id    text,
  stripe_customer_id   text,
  max_machines    int         NOT NULL DEFAULT 2,
  machines        text[]      NOT NULL DEFAULT '{}',
  revoked         boolean     NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_license_keys_key     ON license_keys (key);
CREATE INDEX IF NOT EXISTS idx_license_keys_email   ON license_keys (email);
CREATE INDEX IF NOT EXISTS idx_license_keys_stripe  ON license_keys (stripe_customer_id);

-- Row Level Security — only Edge Functions (service role) can read/write
ALTER TABLE license_keys ENABLE ROW LEVEL SECURITY;

-- No public access — all access via Edge Functions with service_role key
CREATE POLICY "No public access" ON license_keys FOR ALL USING (false);

-- ============================================================
-- Admin view (for Supabase dashboard)
-- ============================================================
CREATE OR REPLACE VIEW license_summary AS
SELECT
  key,
  tier,
  email,
  array_length(machines, 1) AS active_machines,
  max_machines,
  revoked,
  created_at
FROM license_keys
ORDER BY created_at DESC;

-- ============================================================
-- Helper: generate a random license key (for manual creation)
-- Usage: SELECT generate_license_key('pro');
-- ============================================================
CREATE OR REPLACE FUNCTION generate_license_key(p_tier text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := '0123456789ABCDEF';
  r1 text := '';
  r2 text := '';
  i int;
  prefix text;
BEGIN
  -- Prefix per tier
  prefix := CASE p_tier
    WHEN 'max'    THEN 'SMAX'
    WHEN 'pro'    THEN 'SIDE'
    WHEN 'tester' THEN 'STEST'
    ELSE RAISE EXCEPTION 'Unknown tier: %', p_tier
  END;

  -- Generate 4-char hex random segments
  FOR i IN 1..4 LOOP
    r1 := r1 || substr(chars, (random() * 15)::int + 1, 1);
    r2 := r2 || substr(chars, (random() * 15)::int + 1, 1);
  END LOOP;

  RETURN prefix || '-' || r1 || '-' || r2;
END;
$$;
