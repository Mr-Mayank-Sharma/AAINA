import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl);

/**
 * Transient person-frame storage. PRIVACY-CRITICAL:
 * - Only ever lives in Redis (never S3, never Postgres).
 * - TTL-bounded safety net on top of explicit deletion after vendor calls.
 * - Keyed by session_id; only valid for consented sessions.
 */
const PERSON_FRAME_PREFIX = 'person-frame:';

export async function storePersonFrame(sessionId: string, frameBase64: string): Promise<void> {
  await redis.set(
    PERSON_FRAME_PREFIX + sessionId,
    frameBase64,
    'EX',
    config.personFrameTtlSeconds,
  );
}

export async function getPersonFrame(sessionId: string): Promise<string | null> {
  return redis.get(PERSON_FRAME_PREFIX + sessionId);
}

export async function deletePersonFrame(sessionId: string): Promise<void> {
  await redis.del(PERSON_FRAME_PREFIX + sessionId);
}
