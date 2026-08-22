import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mirra:mirra_dev_password@localhost:5432/mirra',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  deviceApiKey: process.env.DEVICE_API_KEY ?? 'dev-device-key',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 4),
  // Transient person-frame storage TTL in Redis (seconds). Frames are also
  // deleted explicitly after each vendor call — this is just a safety net.
  personFrameTtlSeconds: Number(process.env.PERSON_FRAME_TTL_SECONDS ?? 600),
};
