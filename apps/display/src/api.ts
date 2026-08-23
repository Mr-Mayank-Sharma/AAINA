import type {
  Garment,
  RenderCreateResponse,
  RenderStatusResponse,
  SessionByRfidResponse,
} from '@aayna/shared-types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const DEVICE_KEY = import.meta.env.VITE_DEVICE_KEY ?? 'dev-device-key';

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-device-key': DEVICE_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

export const getSessionByRfid = (rfid: string) =>
  api<SessionByRfidResponse>(`/v1/sessions/by-rfid/${encodeURIComponent(rfid)}`, 'GET');

export const listGarments = (tenantId: string) =>
  api<{ garments: Garment[] }>(`/v1/tenants/${tenantId}/garments?active=true`, 'GET');

export const requestRender = (sessionId: string, garmentId: string, size?: string) =>
  api<RenderCreateResponse>('/v1/render', 'POST', { session_id: sessionId, garment_id: garmentId, size });

export async function pollRender(
  renderRequestId: string,
  onTick?: (s: RenderStatusResponse) => void,
  timeoutMs = 30000,
): Promise<RenderStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await api<RenderStatusResponse>(`/v1/render/${renderRequestId}`, 'GET');
    onTick?.(status);
    if (status.status === 'complete' || status.status === 'failed') return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('render timed out');
}

/** Fetch the rendered image through the authenticated presigned-redirect
 *  endpoint and return a blob URL for <img src>. */
export async function fetchRenderImageUrl(renderRequestId: string): Promise<string> {
  const res = await fetch(`${API}/v1/render/${renderRequestId}/image`, {
    headers: { 'x-device-key': DEVICE_KEY },
  });
  if (!res.ok) throw new Error(`render image → ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

export const logGarmentView = (tenantId: string, sessionId: string, garmentId: string) =>
  api<{ ok: boolean }>('/v1/tenants/' + tenantId + '/garment-views', 'POST', { session_id: sessionId, garment_id: garmentId }).catch(() => ({ ok: false }));
