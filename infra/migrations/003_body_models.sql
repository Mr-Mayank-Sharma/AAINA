-- 003: Parametric body model — NO facial data, NO raw images. Ever.
CREATE TABLE body_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  height_cm NUMERIC,
  shoulder_width_cm NUMERIC,
  chest_cm NUMERIC,
  waist_cm NUMERIC,
  hip_cm NUMERIC,
  inseam_cm NUMERIC,
  body_shape_vector JSONB, -- normalized parametric params only; no imagery
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_body_models_session ON body_models(session_id);
