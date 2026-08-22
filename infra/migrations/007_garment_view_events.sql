-- 007: Garment view events — feeds "top-viewed garments" analytics
-- REVIEW FIX: analytics promised top-viewed garments; this is its data source.
-- Written when the display app shows a garment, independent of render requests.
CREATE TABLE garment_view_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  session_id UUID REFERENCES sessions(id) NOT NULL,
  garment_id UUID REFERENCES garments(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_garment_views_tenant_time ON garment_view_events(tenant_id, created_at);
CREATE INDEX idx_garment_views_garment ON garment_view_events(garment_id);
