import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import pg from 'pg';
import { config } from './config.js';
import { sessionRoutes } from './routes/sessions.js';
import { garmentRoutes } from './routes/garments.js';
import { renderRoutes } from './routes/render.js';
import { analyticsRoutes } from './routes/analytics.js';
import { authRoutes } from './routes/auth.js';

export function buildApp(overrides?: { pool?: pg.Pool; startWorker?: boolean }) {
  const app = Fastify({ logger: true });
  const pool =
    overrides?.pool ??
    new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
    });

  app.register(fastifyJwt, { secret: config.jwtSecret });
  app.register(fastifyCors, { origin: true }); // dev: allow kiosk/display/admin origins

  sessionRoutes(app, pool);
  garmentRoutes(app, pool);
  renderRoutes(app, pool);
  analyticsRoutes(app, pool);
  authRoutes(app, pool);

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    await pool.end();
  });

  // Worker runs only in real server mode (not tests).
  let stopWorker: (() => void) | null = null;
  if (overrides?.startWorker) {
    void import('./worker.js').then(({ startRenderWorker }) => {
      const worker = startRenderWorker(pool);
      stopWorker = () => void worker.close();
    });
  }

  return {
    app,
    close: async () => {
      stopWorker?.();
      await app.close();
    },
  };
}

// Only auto-start when run directly (tests import buildApp instead).
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const { app, close } = buildApp({ startWorker: true });
  app
    .listen({ port: config.port, host: '0.0.0.0' })
    .then(() => console.log(`AAYNA API listening on :${config.port}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => void close());
  }
}
