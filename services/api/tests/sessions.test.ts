import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/index.js';

// Integration tests against local docker infra (npm run infra:up first).
// COMPLIANCE-CRITICAL PATHS ARE TESTED EXPLICITLY per design doc.

const TEST_RFID_PREFIX = `test-${Date.now()}`;
let tenantId: string;
let pool: pg.Pool;
let app: ReturnType<typeof buildApp>['app'];
let closeApp: () => Promise<void>;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://mirra:mirra_dev_password@localhost:5432/mirra',
  });
  const { rows } = await pool.query(`SELECT id FROM tenants LIMIT 1`);
  tenantId = rows[0].id;
  const built = buildApp({ pool });
  app = built.app;
  closeApp = built.close;
  await app.ready();
});

afterAll(async () => {
  // Clean up test data only, children first.
  await pool.query(
    `DELETE FROM body_models WHERE session_id IN (SELECT id FROM sessions WHERE rfid_tag_id LIKE $1)`,
    [`${TEST_RFID_PREFIX}%`],
  );
  await pool.query(`DELETE FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE rfid_tag_id LIKE $1)`, [`${TEST_RFID_PREFIX}%`]);
  await pool.query(`DELETE FROM render_requests WHERE session_id IN (SELECT id FROM sessions WHERE rfid_tag_id LIKE $1)`, [`${TEST_RFID_PREFIX}%`]);
  await pool.query(`DELETE FROM sessions WHERE rfid_tag_id LIKE $1`, [`${TEST_RFID_PREFIX}%`]);
  await closeApp();
});

const deviceHeaders = { 'x-device-key': 'dev-device-key' };

async function createSession(rfidTagId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: deviceHeaders,
    payload: { tenant_id: tenantId, rfid_tag_id: rfidTagId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().session_id;
}

describe('session + consent flow', () => {
  it('creates an active session', async () => {
    const sessionId = await createSession(`${TEST_RFID_PREFIX}-a`);
    const { rows } = await pool.query(`SELECT status FROM sessions WHERE id = $1`, [sessionId]);
    expect(rows[0].status).toBe('active');
  });

  it('REJECTS a second active session for the same RFID band (409)', async () => {
    const tag = `${TEST_RFID_PREFIX}-dup`;
    await createSession(tag);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: deviceHeaders,
      payload: { tenant_id: tenantId, rfid_tag_id: tag },
    });
    expect(res.statusCode).toBe(409);
  });

  it('RETURNS 403 when writing a body model WITHOUT consent — compliance-critical', async () => {
    const sessionId = await createSession(`${TEST_RFID_PREFIX}-noconsent`);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/body-model`,
      headers: deviceHeaders,
      payload: { height_cm: 170, chest_cm: 90 },
    });
    expect(res.statusCode).toBe(403);

    // And nothing was persisted.
    const { rows } = await pool.query(`SELECT * FROM body_models WHERE session_id = $1`, [sessionId]);
    expect(rows.length).toBe(0);
  });

  it('ALLOWS body model after consent, and logs both consent + save_profile events', async () => {
    const sessionId = await createSession(`${TEST_RFID_PREFIX}-happy`);

    const consentRes = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/consent`,
      headers: deviceHeaders,
      payload: { consent_given: true, save_profile: true },
    });
    expect(consentRes.statusCode).toBe(200);

    const bmRes = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/body-model`,
      headers: deviceHeaders,
      payload: { height_cm: 172, chest_cm: 92, waist_cm: 78 },
    });
    expect(bmRes.statusCode).toBe(201);

    const { rows: events } = await pool.query(
      `SELECT event_type FROM consent_events WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );
    expect(events.map((e) => e.event_type)).toEqual(['consent_given', 'save_profile_opt_in']);
  });

  it('ENDS the session immediately when consent is denied', async () => {
    const sessionId = await createSession(`${TEST_RFID_PREFIX}-denied`);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/consent`,
      headers: deviceHeaders,
      payload: { consent_given: false, save_profile: false },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query(`SELECT status FROM sessions WHERE id = $1`, [sessionId]);
    expect(rows[0].status).toBe('ended');

    // Body model must still be impossible after denial.
    const bmRes = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/body-model`,
      headers: deviceHeaders,
      payload: { height_cm: 170 },
    });
    expect(bmRes.statusCode).toBe(404); // no ACTIVE session anymore
  });

  it('resolves by-rfid only for active sessions', async () => {
    const tag = `${TEST_RFID_PREFIX}-byrfid`;
    const sessionId = await createSession(tag);
    const ok = await app.inject({ method: 'GET', url: `/v1/sessions/by-rfid/${tag}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ session_id: sessionId, has_body_model: false });

    await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/end` });
    const gone = await app.inject({ method: 'GET', url: `/v1/sessions/by-rfid/${tag}` });
    expect(gone.statusCode).toBe(404);
  });

  it('returns 403 on render without consent/body model', async () => {
    const sessionId = await createSession(`${TEST_RFID_PREFIX}-render`);
    const garment = await pool.query(
      `INSERT INTO garments (tenant_id, sku, name, reference_image_url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, `${TEST_RFID_PREFIX}-sku`, 'Test Tee', 'https://example.com/tee.jpg'],
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/render',
      headers: deviceHeaders,
      payload: { session_id: sessionId, garment_id: garment.rows[0].id },
    });
    expect(res.statusCode).toBe(403);
  });
});
