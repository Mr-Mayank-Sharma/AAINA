import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { config } from '../config.js';

export function sessionRoutes(app: FastifyInstance, pool: Pool): void {
  // POST /v1/sessions — create an active session for a scanned band.
  app.post('/v1/sessions', async (req, reply) => {
    const body = z
      .object({ tenant_id: z.string().uuid(), rfid_tag_id: z.string().min(1) })
      .parse(req.body);

    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
    try {
      const { rows } = await pool.query(
        `INSERT INTO sessions (tenant_id, rfid_tag_id, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [body.tenant_id, body.rfid_tag_id, expiresAt],
      );
      return reply.code(201).send({ session_id: rows[0].id });
    } catch (err: unknown) {
      // Partial unique index idx_sessions_rfid_active_unique → band already in use.
      if ((err as { code?: string }).code === '23505' || (err as { code?: string }).code === '23P01') {
        return reply.code(409).send({ error: 'rfid tag already linked to an active session' });
      }
      throw err;
    }
  });

  // POST /v1/sessions/:id/consent — consent gate. Denied ⇒ session ends immediately.
  app.post('/v1/sessions/:id/consent', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ consent_given: z.boolean(), save_profile: z.boolean() })
      .parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `UPDATE sessions SET consent_given = $2, save_profile = $3,
           status = CASE WHEN $2 THEN status ELSE 'ended' END,
           ended_at = CASE WHEN $2 THEN ended_at ELSE now() END
         WHERE id = $1 AND status = 'active'
         RETURNING id`,
        [id, body.consent_given, body.save_profile],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'no active session with that id' });
      }

      await client.query(
        `INSERT INTO consent_events (session_id, event_type) VALUES ($1, $2)`,
        [id, body.consent_given ? 'consent_given' : 'consent_denied'],
      );
      if (body.consent_given && body.save_profile) {
        await client.query(
          `INSERT INTO consent_events (session_id, event_type) VALUES ($1, 'save_profile_opt_in')`,
          [id],
        );
      }

      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /v1/sessions/:id/body-model — COMPLIANCE-CRITICAL: 403 without consent.
  app.post('/v1/sessions/:id/body-model', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        height_cm: z.number().optional(),
        shoulder_width_cm: z.number().optional(),
        chest_cm: z.number().optional(),
        waist_cm: z.number().optional(),
        hip_cm: z.number().optional(),
        inseam_cm: z.number().optional(),
        body_shape_vector: z.record(z.unknown()).optional(),
      })
      .parse(req.body);

    const { rows } = await pool.query(
      `SELECT consent_given FROM sessions WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'no active session with that id' });
    }
    if (!rows[0].consent_given) {
      // Hard server-side enforcement — this is the BIPA guardrail, not a UI nicety.
      return reply.code(403).send({ error: 'consent required before storing body model' });
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO body_models
         (session_id, height_cm, shoulder_width_cm, chest_cm, waist_cm, hip_cm, inseam_cm, body_shape_vector)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        id,
        body.height_cm ?? null,
        body.shoulder_width_cm ?? null,
        body.chest_cm ?? null,
        body.waist_cm ?? null,
        body.hip_cm ?? null,
        body.inseam_cm ?? null,
        body.body_shape_vector ? JSON.stringify(body.body_shape_vector) : null,
      ],
    );
    return reply.code(201).send({ body_model_id: inserted[0].id });
  });

  // GET /v1/sessions/by-rfid/:rfidTagId — display app resolves the band.
  app.get('/v1/sessions/by-rfid/:rfidTagId', async (req, reply) => {
    const { rfidTagId } = z.object({ rfidTagId: z.string().min(1) }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT s.id, EXISTS(SELECT 1 FROM body_models b WHERE b.session_id = s.id) AS has_body_model
       FROM sessions s WHERE s.rfid_tag_id = $1 AND s.status = 'active' AND s.expires_at > now()
       LIMIT 1`,
      [rfidTagId],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'no active session for this rfid tag' });
    }
    return { session_id: rows[0].id, has_body_model: rows[0].has_body_model };
  });

  // POST /v1/sessions/:id/end — shopper leaves; release the band.
  app.post('/v1/sessions/:id/end', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(
      `UPDATE sessions SET status = 'ended', ended_at = now()
       WHERE id = $1 AND status = 'active' RETURNING id`,
      [id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'no active session with that id' });
    }
    return { ok: true };
  });
}
