import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { config } from '../config.js';

/**
 * Displays: physical try-on screens placed at racks/walls.
 *
 * Setup happens ON the display device itself (first run or "Change Display"),
 * authenticated by the device key — physical possession of the device is the
 * pilot's trust anchor. Staff JWT also works for remote management.
 */
export function displayRoutes(app: FastifyInstance, pool: Pool): void {
  async function requireDeviceOrStaff(req: { headers: Record<string, unknown>; jwtVerify: () => Promise<unknown> }, reply: {
    code: (n: number) => { send: (b: unknown) => unknown };
  }): Promise<boolean> {
    if (req.headers['x-device-key'] === config.deviceApiKey) return true;
    try {
      await req.jwtVerify();
      return true;
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
  }

  // POST /v1/displays — register a new display (returns its id).
  app.post('/v1/displays', async (req, reply) => {
    if (!(await requireDeviceOrStaff(req, reply))) return;
    const body = z
      .object({
        tenant_id: z.string().uuid(),
        label: z.string().max(120).optional(),
        mode: z.enum(['single', 'list']).optional(),
        garment_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body ?? {});
    const { rows } = await pool.query(
      `INSERT INTO displays (tenant_id, label, mode, garment_ids)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.tenant_id, body.label ?? '', body.mode ?? 'list', body.garment_ids ?? []],
    );
    return reply.code(201).send(rows[0]);
  });

  // GET /v1/displays/:id — display config for boot.
  app.get('/v1/displays/:id', async (req, reply) => {
    if (!(await requireDeviceOrStaff(req, reply))) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(`SELECT * FROM displays WHERE id = $1`, [id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'display not found' });
    return rows[0];
  });

  // PATCH /v1/displays/:id — update label/mode/garments ("Change Display" flow).
  app.patch('/v1/displays/:id', async (req, reply) => {
    if (!(await requireDeviceOrStaff(req, reply))) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        label: z.string().max(120).optional(),
        mode: z.enum(['single', 'list']).optional(),
        garment_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body);

    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    if (body.label !== undefined) { params.push(body.label); sets.push(`label = $${params.length}`); }
    if (body.mode !== undefined) { params.push(body.mode); sets.push(`mode = $${params.length}`); }
    if (body.garment_ids !== undefined) { params.push(body.garment_ids); sets.push(`garment_ids = $${params.length}`); }
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE displays SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'display not found' });
    return rows[0];
  });

  // GET /v1/tenants/:tenantId/displays — list a tenant's displays (admin).
  app.get('/v1/tenants/:tenantId/displays', async (req) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT * FROM displays WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return { displays: rows };
  });
}
