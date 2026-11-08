import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf } from '../auth/auth-middleware.js';
import { publishUserRealtime } from '../../realtime/socket-server.js';

const router = Router();
const listSchema = z.object({ unreadOnly: z.enum(['true', 'false']).default('false'), limit: z.coerce.number().int().min(1).max(100).default(50) });

router.use(requireAuth);

router.get('/', async (request, response) => {
  const parsed = listSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: parsed.error.flatten().fieldErrors } });
  const conditions = [eq(notifications.organizationId, request.auth.organizationId), eq(notifications.userId, request.auth.userId)];
  if (parsed.data.unreadOnly === 'true') conditions.push(isNull(notifications.readAt));
  const [unread] = await db.select({ count: sql`count(*)::int` }).from(notifications).where(and(
    eq(notifications.organizationId, request.auth.organizationId), eq(notifications.userId, request.auth.userId), isNull(notifications.readAt),
  ));
  const rows = await db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(parsed.data.limit);
  response.json({ notifications: rows, unreadCount: unread.count });
});

router.patch('/:notificationId/read', requireCsrf, async (request, response) => {
  if (!z.uuid().safeParse(request.params.notificationId).success) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  const [notification] = await db.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.id, request.params.notificationId), eq(notifications.organizationId, request.auth.organizationId), eq(notifications.userId, request.auth.userId),
  )).returning();
  if (!notification) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  response.json({ notification });
});

router.post('/read-all', requireCsrf, async (request, response) => {
  const changed = await db.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.organizationId, request.auth.organizationId), eq(notifications.userId, request.auth.userId), isNull(notifications.readAt),
  )).returning({ id: notifications.id });
  publishUserRealtime(request.app.get('io'), request.auth.userId, 'notification:read-all', { count: changed.length });
  response.json({ markedRead: changed.length });
});

export const notificationsRouter = router;
