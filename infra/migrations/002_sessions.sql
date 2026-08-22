-- 002: Shopper sessions (one visit) + RFID uniqueness fix
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rfid_tag_id TEXT NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  save_profile BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired', 'anonymized')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_rfid ON sessions(rfid_tag_id, status);

-- REVIEW FIX: a physical band can only be linked to ONE active session at a time.
CREATE UNIQUE INDEX idx_sessions_rfid_active_unique
  ON sessions(rfid_tag_id)
  WHERE status = 'active';
