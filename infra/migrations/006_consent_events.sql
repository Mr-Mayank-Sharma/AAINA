-- 006: Consent + retention audit trail (BIPA evidence — retained permanently)
-- REVIEW FIX: 'save_profile_opt_in' restored as a distinct auditable event.
CREATE TABLE consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'consent_given',
    'consent_denied',
    'save_profile_opt_in',
    'data_deleted'
  )),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_consent_events_session ON consent_events(session_id);

-- NOTE: deletion job ANONYMIZES sessions rows (strips rfid linkage) rather than
-- deleting them, so consent_events FKs never orphan and the audit trail survives.
