import { Worker } from 'bullmq';
import type { Pool } from 'pg';
import { config } from './config.js';
import { getPersonFrame, deletePersonFrame } from './redis.js';

/**
 * Render queue worker.
 *
 * PRIVACY-CRITICAL FLOW (design doc "Resolved Review Items" #6):
 * 1. Pull person frame from Redis (transient, TTL-bounded).
 * 2. POST it to render-service → vendor adapter → S3 output URL.
 * 3. DELETE the person frame IMMEDIATELY after the call — success or failure.
 * The frame never touches S3 or Postgres.
 */
export function startRenderWorker(pool: Pool): Worker {
  const worker = new Worker(
    'render',
    async (job) => {
      const { render_request_id: requestId } = job.data as { render_request_id: string };

      await pool.query(`UPDATE render_requests SET status = 'processing' WHERE id = $1`, [requestId]);

      const { rows } = await pool.query(
        `SELECT r.session_id, g.reference_image_url, g.reference_image_back_url, g.category
         FROM render_requests r
         JOIN garments g ON g.id = r.garment_id
         WHERE r.id = $1`,
        [requestId],
      );
      if (rows.length === 0) throw new Error(`render request ${requestId} not found`);
      const req = rows[0];

      let personFrame: string | null = null;
      try {
        personFrame = await getPersonFrame(req.session_id);
        if (!personFrame) throw new Error('person frame missing or expired');

        const resp = await fetch(`${process.env.RENDER_SERVICE_URL ?? 'http://localhost:8100'}/internal/render`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body_shape_vector: {},
            person_frame_base64: personFrame,
            garment_reference_image_url: req.reference_image_url,
            garment_reference_back_image_url: req.reference_image_back_url,
            garment_category: req.category,
          }),
        });
        if (!resp.ok) {
          const detail = await resp.text();
          throw new Error(`render-service ${resp.status}: ${detail}`);
        }
        const result = (await resp.json()) as { output_image_url: string; vendor_used: string };

        await pool.query(
          `UPDATE render_requests
           SET status = 'complete', output_image_url = $2, vendor_used = $3, completed_at = now()
           WHERE id = $1`,
          [requestId, result.output_image_url, result.vendor_used],
        );
      } catch (err) {
        await pool.query(
          `UPDATE render_requests SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1`,
          [requestId, err instanceof Error ? err.message : String(err)],
        );
        throw err;
      } finally {
        // Delete the frame no matter what happened. Always.
        if (req.session_id) await deletePersonFrame(req.session_id);
      }
    },
    { connection: { url: config.redisUrl }, concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    console.error(`render job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
