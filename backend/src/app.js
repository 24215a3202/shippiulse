import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { checkDatabase } from './db/client.js';
import { checkRedis } from './db/redis.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { teamRouter } from './modules/team/team.routes.js';
import { fleetRouter } from './modules/fleet/fleet.routes.js';
import { shipmentsRouter } from './modules/shipments/shipments.routes.js';
import { trackingRouter } from './modules/tracking/tracking.routes.js';
import { geospatialRouter } from './modules/geospatial/geospatial.routes.js';
import { exceptionsRouter } from './modules/exceptions/exceptions.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origin === env.WEB_ORIGIN), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({
  logger,
  autoLogging: env.NODE_ENV !== 'test',
  customLogLevel: (request, response, error) => {
    if (request.url === '/health' && response.statusCode === 503) return 'warn';
    if (error || response.statusCode >= 500) return 'error';
    if (response.statusCode >= 400) return 'warn';
    return 'info';
  },
}));

app.get('/health', async (_request, response) => {
  const [database, redis] = await Promise.allSettled([checkDatabase(), checkRedis()]);
  const checks = {
    database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
    redis: redis.status === 'fulfilled' ? 'ok' : 'unavailable',
  };
  const ready = Object.values(checks).every((status) => status === 'ok');

  response.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    service: 'shippulse-api',
    timestamp: new Date().toISOString(),
    checks,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/team', teamRouter);
app.use('/api/fleet', fleetRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api', geospatialRouter);
app.use('/api/exceptions', exceptionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics', analyticsRouter);

app.use(notFound);
app.use(errorHandler);
