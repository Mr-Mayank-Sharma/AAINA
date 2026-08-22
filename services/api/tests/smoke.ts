// E2E smoke test: session → consent → body-model → frame → render enqueue → login → analytics.
const API = 'http://localhost:8080';
const DEVICE = { 'content-type': 'application/json', 'x-device-key': 'dev-device-key' };

async function api(path, method = 'GET', body?: unknown, headers: Record<string, string> = DEVICE) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  // Tenant + garment ids via direct DB access through the API's own pool is not
  // exposed, so use psql via child_process.
  const { execSync } = await import('node:child_process');
  const psql = (q: string) =>
    execSync(`docker exec mirra-postgres psql -U mirra -d mirra -t -A -c "${q}"`)
      .toString()
      .trim()
      .split('\n')[0];

  const tenantId = psql('SELECT id FROM tenants LIMIT 1');
  console.log('1. tenant:', tenantId);

  const garmentId = psql(
    `INSERT INTO garments (tenant_id, sku, name, category, size_options, reference_image_url, image_qc_status) VALUES ('${tenantId}','SMOKE-TEE-01','Smoke Tee','top','{S,M,L}','https://example.com/tee.jpg','passed') ON CONFLICT (tenant_id, sku) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
  );
  console.log('2. garment:', garmentId);

  const { session_id: sessionId } = await api('/v1/sessions', 'POST', {
    tenant_id: tenantId,
    rfid_tag_id: `smoke-${Date.now()}`,
  });
  console.log('3. session:', sessionId);

  await api(`/v1/sessions/${sessionId}/consent`, 'POST', { consent_given: true, save_profile: false });
  console.log('4. consent recorded');

  await api(`/v1/sessions/${sessionId}/body-model`, 'POST', { height_cm: 172, chest_cm: 94 });
  console.log('5. body model stored');

  await api(`/v1/sessions/${sessionId}/person-frame`, 'POST', { frame_base64: 'dGVzdC1mcmFtZQ==' });
  console.log('6. person frame uploaded (Redis-only)');

  const byRfid = await api('/v1/sessions/by-rfid/smoke-band-001');
  console.log('7. by-rfid:', JSON.stringify(byRfid));

  const { render_request_id: requestId } = await api('/v1/render', 'POST', {
    session_id: sessionId,
    garment_id: garmentId,
    size: 'M',
  });
  console.log('8. render enqueued:', requestId);
  await new Promise((r) => setTimeout(r, 3000));
  const renderStatus = await api(`/v1/render/${requestId}`);
  console.log('9. render status:', JSON.stringify(renderStatus));
  // Expected: failed with vendor error (render-service not running) — proves queue + worker + failure path work.

  const { token } = await api('/v1/auth/login', 'POST', {
    email: 'admin@pilot.test',
    password: 'mirra-dev-2026',
  }, { 'content-type': 'application/json' });
  console.log('10. admin login OK, token received');

  const summary = await api(`/v1/tenants/${tenantId}/analytics/summary`, 'GET', undefined, {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  });
  console.log('11. analytics:', JSON.stringify(summary));

  console.log('\nSMOKE TEST COMPLETE');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
