import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';

export function authRoutes(app: FastifyInstance, pool: Pool): void {
  // POST /v1/auth/login — admin dashboard staff login.
  app.post('/v1/auth/login', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    const { rows } = await pool.query(
      `SELECT id, tenant_id, password_hash, role FROM staff_users WHERE email = $1`,
      [body.email],
    );
    if (rows.length === 0 || !(await bcrypt.compare(body.password, rows[0].password_hash))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const token = app.jwt.sign(
      { sub: rows[0].id, tenant_id: rows[0].tenant_id, role: rows[0].role },
      { expiresIn: '12h' },
    );
    return { token, tenant_id: rows[0].tenant_id };
  });
}
