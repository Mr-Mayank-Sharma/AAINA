import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { Queue } from 'bullmq';
import { Client } from 'minio';
import { config } from '../config.js';

let renderQueue: Queue | null = null;
function getQueue(): Queue {
  if (!renderQueue) {
    renderQueue = new Queue('render', { connection: { url: config.redisUrl } });
  }
  return renderQueue;
}

// Presigned-GET issuer for private render outputs. Renders are images of the
// shopper's own body — they must never sit on a public bucket.
let minioClient: Client | null = null;
function getMinio(): Client {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: new URL(process.env.S3_ENDPOINT ?? 'http://localhost:9000').hostname,
      port: Number(new URL(process.env.S3_ENDPOINT ?? 'http://localhost:9000').port) || 9000,
      useSSL: (process.env.S3_ENDPOINT ?? 'http://localhost:9000').startsWith('https'),
      accessKey: process.env.S3_ACCESS_KEY ?? 'mirra',
      secretKey: process.env.S3_SECRET_KEY ?? 'mirra_dev_secret',
    });
  }
  return minioClient;
}

const RENDER_BUCKET = 'mirra-render-outputs';

export function renderRoutes(app: FastifyInstance, pool: Pool): void {
  // POST /v1/render — COMPLIANCE-CRITICAL: requires consent + body model.
  app.post('/v1/render', async (req, reply) => {
    const body = z
      .object({
        session_id: z.string().uuid(),
        garment_id: z.string().uuid(),
        size: z.string().optional(),
      })
      .parse(req.body);

    const { rows } = await pool.query(
      `SELECT s.consent_given,
              EXISTS(SELECT 1 FROM body_models b WHERE b.session_id = s.id) AS has_body_model,
              EXISTS(SELECT 1 FROM garments g WHERE g.id = $2 AND g.tenant_id = s.tenant_id AND g.active) AS garment_valid
       FROM sessions s WHERE s.id = $1 AND s.status = 'active'`,
      [body.session_id, body.garment_id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'no active session' });
    }
    if (!rows[0].consent_given || !rows[0].has_body_model) {
      return reply.code(403).send({ error: 'consent and body model required before rendering' });
    }
    if (!rows[0].garment_valid) {
      return reply.code(404).send({ error: 'garment not found or inactive for this tenant' });
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO render_requests (session_id, garment_id, size) VALUES ($1,$2,$3) RETURNING id`,
      [body.session_id, body.garment_id, body.size ?? null],
    );
    const requestId = inserted[0].id;

    await getQueue().add('render', { render_request_id: requestId });

    return reply.code(202).send({ render_request_id: requestId });
  });

  // GET /v1/render/:id — poll for status/result.
  app.get('/v1/render/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT status, output_image_url, vendor_used FROM render_requests WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'render request not found' });
    return rows[0];
  });

  // GET /v1/render/:id/image — presigned redirect to the render output.
  // PRIVACY: renders are images of the shopper's own body. Requires device key
  // or staff JWT; the bucket itself stays private behind short-lived signatures.
  app.get('/v1/render/:id/image', async (req, reply) => {
    if (req.headers['x-device-key'] !== config.deviceApiKey) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT output_image_url, status FROM render_requests WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'render request not found' });
    if (rows[0].status !== 'complete' || !rows[0].output_image_url) {
      return reply.code(409).send({ error: 'render not complete' });
    }
    const key = rows[0].output_image_url.split(`/mirra-render-outputs/`)[1];
    if (!key) return reply.code(500).send({ error: 'malformed output url' });
    const url = await getMinio().presignedGetObject(RENDER_BUCKET, key, 5 * 60);
    return reply.redirect(url);
  });

  // POST /v1/sessions/:id/person-frame — kiosk uploads the transient capture frame.
  // PRIVACY: stored in Redis ONLY with TTL; deleted immediately after each vendor call.
  app.post('/v1/sessions/:id/person-frame', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ frame_base64: z.string().min(1) }).parse(req.body);

    const { rows } = await pool.query(
      `SELECT consent_given FROM sessions WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'no active session' });
    if (!rows[0].consent_given) {
      return reply.code(403).send({ error: 'consent required before frame upload' });
    }

    const { storePersonFrame } = await import('../redis.js');
    await storePersonFrame(id, body.frame_base64);
    return reply.code(201).send({ ok: true });
  });
}
