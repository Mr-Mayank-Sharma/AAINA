-- 005: Try-on render requests/results
CREATE TABLE render_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  garment_id UUID REFERENCES garments(id) NOT NULL,
  size TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  output_image_url TEXT,
  vendor_used TEXT, -- 'mocked' | 'fashn' | 'kling_kolors' | 'veesual'
  error_message TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_render_requests_session ON render_requests(session_id);
CREATE INDEX idx_render_requests_vendor_status ON render_requests(vendor_used, status);
