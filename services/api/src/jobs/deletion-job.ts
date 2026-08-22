import pg from 'pg';
import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Deletion job — COMPLIANCE REQUIREMENT, not optional (design doc, Step 10).
 *
 * For every expired session with save_profile = false:
 *   1. Write a 'data_deleted' consent event FIRST (audit trail survives everything).
 *   2. Hard-delete body_models.
 *   3. Delete transient render inputs (person frames in Redis).
 *   4. ANONYMIZE the sessions row: strip RFID linkage, set status='anonymized'.
 *      The row stays so consent_events FKs never orphan and the BIPA evidence
 *      trail remains — with zero biometric or identity linkage attached.
 *
 * Render output images default to deletion too unless RETAIN_RENDER_OUTPUTS=true.
 *
 * Run standalone (cron/systemd/launchd):  node dist/jobs/deletion-job.js
 * Or loop mode for dev:                   node dist/jobs/deletion-job.js --loop
 */

export async function runDeletionPass(
  pool: pg.Pool,
  redis: Redis,
): Promise<{ anonymized: number }> {
  const client = await pool.connect();
  let anonymized = 0;
  let expired: { id: string }[] = [];
  try {
    await client.query('BEGIN');

    // Expired, non-saved, not-yet-anonymized sessions.
    const { rows } = await client.query(
      `SELECT id FROM sessions
       WHERE expires_at < now() AND save_profile = false AND status != 'anonymized'
       FOR UPDATE SKIP LOCKED`,
    );
    expired = rows;

    for (const { id } of rows) {
      // 1. Audit event BEFORE any deletion.
      await client.query(
        `INSERT INTO consent_events (session_id, event_type) VALUES ($1, 'data_deleted')`,
        [id],
      );
      // 2. Hard-delete biometric data.
      await client.query(`DELETE FROM body_models WHERE session_id = $1`, [id]);
      // 3. Anonymize the session row (keep audit linkage, strip identity).
      await client.query(
        `UPDATE sessions SET status = 'anonymized', rfid_tag_id = $2 WHERE id = $1`,
        [id, `deleted:${id}`],
      );
      anonymized++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3b. Transient person frames + render outputs (outside the tx; idempotent).
  const retainOutputs = process.env.RETAIN_RENDER_OUTPUTS === 'true';
  if (!retainOutputs && expired.length > 0) {
    for (const { id } of expired) {
      await redis.del(`person-frame:${id}`);
    }
    await pool.query(
      `UPDATE render_requests SET output_image_url = NULL
       WHERE session_id = ANY($1::uuid[])`,
      [expired.map((r) => r.id)],
    );
  }

  return { anonymized };
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl);

  const loop = process.argv.includes('--loop');
  const runOnce = async () => {
    try {
      const { anonymized } = await runDeletionPass(pool, redis);
      if (anonymized > 0) console.log(`deletion job: anonymized ${anonymized} expired session(s)`);
    } catch (err) {
      console.error('deletion job failed:', err);
      process.exitCode = 1;
    }
  };

  if (loop) {
    console.log('deletion job: running hourly');
    await runOnce();
    setInterval(runOnce, 3600_000);
  } else {
    await runOnce();
    await pool.end();
    redis.disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith('deletion-job.ts')) {
  void main();
}
