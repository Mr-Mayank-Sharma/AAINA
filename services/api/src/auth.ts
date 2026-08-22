import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

/**
 * Kiosk/display devices authenticate with a static device API key.
 * Admin dashboard uses JWT (registered via @fastify/jwt).
 */
export async function requireDeviceKey(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = req.headers['x-device-key'];
  if (key !== config.deviceApiKey) {
    await reply.code(401).send({ error: 'invalid device key' });
  }
}

export async function requireStaffJwt(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
