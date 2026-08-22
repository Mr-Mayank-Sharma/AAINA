import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';

const garmentInput = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  color: z.string().optional(),
  size_options: z.array(z.string()).optional(),
  reference_image_url: z.string().url(),
  reference_image_back_url: z.string().url().nullable().optional(),
  fit_metadata: z.record(z.unknown()).optional(),
});

export function garmentRoutes(app: FastifyInstance, pool: Pool): void {
  // GET /v1/tenants/:tenantId/garments — list, filterable.
  app.get('/v1/tenants/:tenantId/garments', async (req) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        category: z.string().optional(),
        color: z.string().optional(),
        active: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const clauses: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (q.category) { params.push(q.category); clauses.push(`category = $${params.length}`); }
    if (q.color) { params.push(q.color); clauses.push(`color = $${params.length}`); }
    if (q.active !== undefined) { params.push(q.active === 'true'); clauses.push(`active = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT * FROM garments WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return { garments: rows };
  });

  // POST /v1/tenants/:tenantId/garments — create (admin only).
  app.post('/v1/tenants/:tenantId/garments', async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const body = garmentInput.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO garments
         (tenant_id, sku, name, category, color, size_options,
          reference_image_url, reference_image_back_url, fit_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        tenantId, body.sku, body.name, body.category ?? null, body.color ?? null,
        body.size_options ?? [], body.reference_image_url,
        body.reference_image_back_url ?? null,
        body.fit_metadata ? JSON.stringify(body.fit_metadata) : null,
      ],
    );
    return reply.code(201).send(rows[0]);
  });

  // PUT /v1/tenants/:tenantId/garments/:id — update (admin only).
  app.put('/v1/tenants/:tenantId/garments/:id', async (req, reply) => {
    const { tenantId, id } = z
      .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
      .parse(req.params);
    const body = garmentInput.partial().parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      sku: 'sku', name: 'name', category: 'category', color: 'color',
      reference_image_url: 'reference_image_url',
      reference_image_back_url: 'reference_image_back_url',
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in body) { params.push((body as Record<string, unknown>)[key]); sets.push(`${col} = $${params.length}`); }
    }
    if ('size_options' in body) { params.push(body.size_options!); sets.push(`size_options = $${params.length}`); }
    if ('fit_metadata' in body) { params.push(JSON.stringify(body.fit_metadata)); sets.push(`fit_metadata = $${params.length}`); }
    if (sets.length === 0) return reply.code(400).send({ error: 'no fields to update' });

    params.push(tenantId, id);
    const { rows } = await pool.query(
      `UPDATE garments SET ${sets.join(', ')} WHERE tenant_id = $${params.length - 1} AND id = $${params.length} RETURNING *`,
      params,
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'garment not found' });
    return rows[0];
  });

  // DELETE — soft-delete via active=false (admin only).
  app.delete('/v1/tenants/:tenantId/garments/:id', async (req, reply) => {
    const { tenantId, id } = z
      .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
      .parse(req.params);
    const { rows } = await pool.query(
      `UPDATE garments SET active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'garment not found' });
    return { ok: true };
  });

  // POST /v1/tenants/:tenantId/garments/bulk-import — CSV/JSON bulk upload.
  app.post('/v1/tenants/:tenantId/garments/bulk-import', async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const body = z.object({ items: z.array(garmentInput).min(1) }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let imported = 0;
      for (const g of body.items) {
        await client.query(
          `INSERT INTO garments
             (tenant_id, sku, name, category, color, size_options,
              reference_image_url, reference_image_back_url, fit_metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, sku) DO UPDATE SET
             name = EXCLUDED.name, category = EXCLUDED.category, color = EXCLUDED.color,
             size_options = EXCLUDED.size_options,
             reference_image_url = EXCLUDED.reference_image_url,
             reference_image_back_url = EXCLUDED.reference_image_back_url,
             fit_metadata = EXCLUDED.fit_metadata`,
          [
            tenantId, g.sku, g.name, g.category ?? null, g.color ?? null,
            g.size_options ?? [], g.reference_image_url,
            g.reference_image_back_url ?? null,
            g.fit_metadata ? JSON.stringify(g.fit_metadata) : null,
          ],
        );
        imported++;
      }
      await client.query('COMMIT');
      return { imported };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /v1/tenants/:tenantId/garments/:id/image-qc — validate photo requirements (Section 4).
  // MVP checks resolution + presence; lighting/background heuristics arrive with the vendor bake-off.
  app.post('/v1/tenants/:tenantId/garments/:id/image-qc', async (req, reply) => {
    const { tenantId, id } = z
      .object({ tenantId: z.string().uuid(), id: z.string().uuid() })
      .parse(req.params);
    const body = z
      .object({
        width_px: z.number().int().positive(),
        height_px: z.number().int().positive(),
        is_blurry: z.boolean().optional(),
      })
      .parse(req.body);

    const MIN_SHORT_EDGE = 1500;
    const shortEdge = Math.min(body.width_px, body.height_px);
    let status: 'passed' | 'flagged' = 'passed';
    const issues: string[] = [];

    if (shortEdge < MIN_SHORT_EDGE) {
      status = 'flagged';
      issues.push(`short edge ${shortEdge}px < required ${MIN_SHORT_EDGE}px`);
    }
    if (body.is_blurry) {
      status = 'flagged';
      issues.push('image flagged as blurry');
    }

    const { rows } = await pool.query(
      `UPDATE garments SET image_qc_status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id, image_qc_status`,
      [tenantId, id, status],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'garment not found' });
    return { ...rows[0], issues };
  });
}
