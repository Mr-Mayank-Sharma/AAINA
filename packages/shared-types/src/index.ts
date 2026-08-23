// Shared types — single source of truth for api + kiosk + display + admin.
// Mirrors infra/migrations exactly.

export type SessionStatus = 'active' | 'ended' | 'expired' | 'anonymized';

export interface Session {
  id: string;
  tenant_id: string;
  rfid_tag_id: string;
  consent_given: boolean;
  save_profile: boolean;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
}

export interface BodyModel {
  id: string;
  session_id: string;
  height_cm: number | null;
  shoulder_width_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  inseam_cm: number | null;
  body_shape_vector: Record<string, unknown> | null;
  created_at: string;
}

export type ImageQcStatus = 'pending' | 'passed' | 'flagged';

export interface Garment {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  category: string | null;
  color: string | null;
  size_options: string[];
  reference_image_url: string;
  reference_image_back_url: string | null;
  image_qc_status: ImageQcStatus;
  fit_metadata: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
}

export type RenderStatus = 'pending' | 'processing' | 'complete' | 'failed';
export type RenderVendor = 'mocked' | 'fashn' | 'kling_kolors' | 'veesual';

export type DisplayMode = 'single' | 'list';

/** A physical try-on screen placed at a rack/wall. */
export interface DisplayConfig {
  id: string;
  tenant_id: string;
  label: string;
  mode: DisplayMode;
  garment_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface RenderRequest {
  id: string;
  session_id: string;
  garment_id: string;
  size: string | null;
  status: RenderStatus;
  output_image_url: string | null;
  vendor_used: RenderVendor | null;
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
}

export type ConsentEventType =
  | 'consent_given'
  | 'consent_denied'
  | 'save_profile_opt_in'
  | 'data_deleted';

export interface ConsentEvent {
  id: string;
  session_id: string;
  event_type: ConsentEventType;
  created_at: string;
}

// ---- API request/response payloads ----

export interface CreateSessionRequest {
  tenant_id: string;
  rfid_tag_id: string;
}

export interface CreateSessionResponse {
  session_id: string;
}

export interface ConsentRequest {
  consent_given: boolean;
  save_profile: boolean;
}

export interface BodyModelRequest {
  height_cm?: number;
  shoulder_width_cm?: number;
  chest_cm?: number;
  waist_cm?: number;
  hip_cm?: number;
  inseam_cm?: number;
  body_shape_vector?: Record<string, unknown>;
}

export interface SessionByRfidResponse {
  session_id: string;
  has_body_model: boolean;
}

export interface RenderCreateRequest {
  session_id: string;
  garment_id: string;
  size?: string;
}

export interface RenderCreateResponse {
  render_request_id: string;
}

export interface RenderStatusResponse {
  status: RenderStatus;
  output_image_url: string | null;
  vendor_used: RenderVendor | null;
}

export interface AnalyticsSummary {
  sessions_today: number;
  renders_today: number;
  consent_opt_in_rate: number;
  top_viewed_garments: { garment_id: string; name: string; views: number }[];
  render_success_rate_per_vendor: { vendor: string; success_rate: number; total: number }[];
}
