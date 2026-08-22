const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const DEVICE_KEY = import.meta.env.VITE_DEVICE_KEY ?? 'dev-device-key';

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-device-key': DEVICE_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export const createSession = (tenantId: string, rfidTagId: string) =>
  api<{ session_id: string }>('/v1/sessions', 'POST', { tenant_id: tenantId, rfid_tag_id: rfidTagId });

export const postConsent = (sessionId: string, consent_given: boolean, save_profile: boolean) =>
  api<{ ok: boolean }>(`/v1/sessions/${sessionId}/consent`, 'POST', { consent_given, save_profile });

export const postBodyModel = (sessionId: string, m: Record<string, unknown>) =>
  api<{ body_model_id: string }>(`/v1/sessions/${sessionId}/body-model`, 'POST', m);

export const uploadPersonFrame = (sessionId: string, frameBase64: string) =>
  api<{ ok: boolean }>(`/v1/sessions/${sessionId}/person-frame`, 'POST', { frame_base64: frameBase64 });

export const endSession = (sessionId: string) =>
  api<{ ok: boolean }>(`/v1/sessions/${sessionId}/end`, 'POST');
