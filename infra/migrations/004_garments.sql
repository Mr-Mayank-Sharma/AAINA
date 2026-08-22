-- 004: Garment catalog — photos are the fabric/texture source of truth (D6)
CREATE TABLE garments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT, -- 'top' | 'bottom' | 'dress' | 'outerwear' | ...
  color TEXT,
  size_options TEXT[],
  reference_image_url TEXT NOT NULL,     -- primary front-facing photo (compositing input)
  reference_image_back_url TEXT,         -- optional back-detail photo
  image_qc_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (image_qc_status IN ('pending', 'passed', 'flagged')), -- Section 4 photo requirements
  fit_metadata JSONB,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

CREATE INDEX idx_garments_tenant_active ON garments(tenant_id, active);
