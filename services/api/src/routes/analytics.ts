import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';

export function analyticsRoutes(app: FastifyInstance, pool: Pool): void {
  // POST /v1/tenants/:tenantId/garment-views — display app logs a view (feeds top-viewed).
  app.post('/v1/tenants/:tenantId/garment-views', async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ session_id: z.string().uuid(), garment_id: z.string().uuid() })
      .parse(req.body);
    await pool.query(
      `INSERT INTO garment_view_events (tenant_id, session_id, garment_id) VALUES ($1,$2,$3)`,
      [tenantId, body.session_id, body.garment_id],
    );
    return reply.code(201).send({ ok: true });
  });

  // GET /v1/tenants/:tenantId/analytics/summary — AGGREGATE ONLY.
  // Must never expose per-shopper body measurements. Enforced by construction:
  // every query below returns counts/rates only.
  app.get('/v1/tenants/:tenantId/analytics/summary', async (req) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);

    const sessionsToday = await pool.query(
      `SELECT count(*)::int AS n FROM sessions
       WHERE tenant_id = $1 AND created_at >= date_trunc('day', now())`,
      [tenantId],
    );
    const rendersToday = await pool.query(
      `SELECT count(*)::int AS n FROM render_requests r
       JOIN sessions s ON s.id = r.session_id
       WHERE s.tenant_id = $1 AND r.requested_at >= date_trunc('day', now())`,
      [tenantId],
    );
    const consentRate = await pool.query(
      `SELECT COALESCE(
         avg(CASE WHEN consent_given THEN 1.0 ELSE 0.0 END), 0)::float AS rate
       FROM sessions WHERE tenant_id = $1`,
      [tenantId],
    );
    const topViewed = await pool.query(
      `SELECT v.garment_id, g.name, count(*)::int AS views
       FROM garment_view_events v
       JOIN garments g ON g.id = v.garment_id
       WHERE v.tenant_id = $1
       GROUP BY v.garment_id, g.name ORDER BY views DESC LIMIT 10`,
      [tenantId],
    );
    const vendorRates = await pool.query(
      `SELECT r.vendor_used AS vendor,
              round(avg(CASE WHEN r.status = 'complete' THEN 1.0 ELSE 0.0 END)::numeric, 3)::float AS success_rate,
              count(*)::int AS total
       FROM render_requests r
       JOIN sessions s ON s.id = r.session_id
       WHERE s.tenant_id = $1 AND r.vendor_used IS NOT NULL
       GROUP BY r.vendor_used`,
      [tenantId],
    );

    return {
      sessions_today: sessionsToday.rows[0].n,
      renders_today: rendersToday.rows[0].n,
      consent_opt_in_rate: consentRate.rows[0].rate,
      top_viewed_garments: topViewed.rows,
      render_success_rate_per_vendor: vendorRates.rows,
    };
  });
}
