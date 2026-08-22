import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { Redis } from 'ioredis';
import { runDeletionPass } from '../src/jobs/deletion-job.js';

const TAG = `deljob-${Date.now()}`;
let tenantId: string;
let pool: pg.Pool;
let redis: Redis;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://mirra:mirra_dev_password@localhost:5432/mirra',
  });
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const { rows } = await pool.query(`SELECT id FROM tenants LIMIT 1`);
  tenantId = rows[0].id;
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE rfid_tag_id LIKE $1)`,
    [`${TAG}%`],
  );
  await pool.query(`DELETE FROM sessions WHERE rfid_tag_id LIKE $1`, [`${TAG}%`]);
  await pool.end();
  redis.disconnect();
});

describe('deletion job', () => {
  it('anonymizes expired non-saved sessions, deletes body models, logs data_deleted', async () => {
    // Expired session WITH a body model and save_profile=false.
    const { rows: s1 } = await pool.query(
      `INSERT INTO sessions (tenant_id, rfid_tag_id, expires_at)
       VALUES ($1, $2, now() - interval '1 hour') RETURNING id`,
      [tenantId, `${TAG}-expired`],
    );
    const sessionId = s1[0].id;
    await pool.query(
      `INSERT INTO body_models (session_id, height_cm) VALUES ($1, 170)`,
      [sessionId],
    );

    // Active session that must NOT be touched.
    const { rows: s2 } = await pool.query(
      `INSERT INTO sessions (tenant_id, rfid_tag_id, expires_at)
       VALUES ($1, $2, now() + interval '4 hours') RETURNING id`,
      [tenantId, `${TAG}-active`],
    );
    const activeId = s2[0].id;

    const { anonymized } = await runDeletionPass(pool, redis);
    expect(anonymized).toBeGreaterThanOrEqual(1);

    // Body model hard-deleted.
    const bm = await pool.query(`SELECT * FROM body_models WHERE session_id = $1`, [sessionId]);
    expect(bm.rows.length).toBe(0);

    // Session anonymized: RFID stripped, status set.
    const sess = await pool.query(`SELECT status, rfid_tag_id FROM sessions WHERE id = $1`, [sessionId]);
    expect(sess.rows[0].status).toBe('anonymized');
    expect(sess.rows[0].rfid_tag_id).toBe(`deleted:${sessionId}`);

    // data_deleted event logged and row retained (audit trail survives).
    const ev = await pool.query(
      `SELECT event_type FROM consent_events WHERE session_id = $1`,
      [sessionId],
    );
    expect(ev.rows.map((r) => r.event_type)).toContain('data_deleted');

    // Active session untouched.
    const untouched = await pool.query(`SELECT status FROM sessions WHERE id = $1`, [activeId]);
    expect(untouched.rows[0].status).toBe('active');
  });

  it('leaves save_profile=true sessions alone', async () => {
    const { rows } = await pool.query(
      `INSERT INTO sessions (tenant_id, rfid_tag_id, expires_at, consent_given, save_profile)
       VALUES ($1, $2, now() - interval '1 hour', true, true) RETURNING id`,
      [tenantId, `${TAG}-saved`],
    );
    await runDeletionPass(pool, redis);
    const check = await pool.query(`SELECT status FROM sessions WHERE id = $1`, [rows[0].id]);
    expect(check.rows[0].status).toBe('active');
  });
});
