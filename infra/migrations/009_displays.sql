-- Displays: physical try-on screens placed at garment racks/walls.
-- Staff configures which garments a display fronts (single or a list);
-- the display's RFID sensor links band taps to those garments.
CREATE TABLE IF NOT EXISTS displays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'list' CHECK (mode IN ('single', 'list')),
  garment_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_displays_tenant ON displays(tenant_id);
