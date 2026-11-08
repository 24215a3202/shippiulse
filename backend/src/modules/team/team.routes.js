import bcrypt from 'bcryptjs';
import { and, eq, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { driverProfiles, users, vehicles } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';
import { disconnectUserSockets } from '../../realtime/socket-server.js';

const router = Router();
const userRoles = ['ORG_ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'];
const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(72),
  role: z.enum(['ORG_ADMIN', 'DISPATCHER', 'VIEWER']),
});
const updateUserSchema = z.object({
  role: z.enum(['ORG_ADMIN', 'DISPATCHER', 'VIEWER']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).refine((value) => value.role !== undefined || value.status !== undefined);
const createDriverSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(72),
  phone: z.string().trim().max(32).optional(),
  licenseNumber: z.string().trim().min(2).max(64),
  licenseExpiresOn: z.iso.date().optional(),
});

function badInput(response, error) {
  return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: error.flatten().fieldErrors } });
}

function conflict(error) {
  let current = error;
  while (current) {
    if (current.code === '23505') return true;
    current = current.cause;
  }
  return false;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, createdAt: user.createdAt };
}

router.use(requireAuth);

router.get('/users', requireRole('ORG_ADMIN', 'SUPER_ADMIN'), async (request, response) => {
  const rows = await db.select({ user: users, driver: driverProfiles })
    .from(users)
    .leftJoin(driverProfiles, and(eq(driverProfiles.userId, users.id), eq(driverProfiles.organizationId, request.auth.organizationId)))
    .where(eq(users.organizationId, request.auth.organizationId))
    .orderBy(users.createdAt)
    .limit(200);
  response.json({ users: rows.map(({ user, driver }) => ({ ...publicUser(user), driver: driver ? {
    phone: driver.phone,
    licenseNumber: driver.licenseNumber,
    licenseExpiresOn: driver.licenseExpiresOn,
  } : null })) });
});

router.post('/users', requireRole('ORG_ADMIN', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = createUserSchema.safeParse(request.body);
  if (!parsed.success) return badInput(response, parsed.error);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const [user] = await db.insert(users).values({
      organizationId: request.auth.organizationId,
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
    }).returning();
    response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (conflict(error)) throw new HttpError(409, 'USER_EMAIL_IN_USE', 'That email is already used in this organization');
    throw error;
  }
});

router.patch('/users/:userId', requireRole('ORG_ADMIN', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = updateUserSchema.safeParse(request.body);
  if (!parsed.success) return badInput(response, parsed.error);
  if (request.params.userId === request.auth.userId) {
    throw new HttpError(400, 'CANNOT_EDIT_SELF', 'Ask another organization administrator to change your own access');
  }
  const [target] = await db.select().from(users).where(and(
    eq(users.id, request.params.userId),
    eq(users.organizationId, request.auth.organizationId),
    ne(users.role, 'SUPER_ADMIN'),
  )).limit(1);
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'Team member not found');

  const nextRole = parsed.data.role ?? target.role;
  const nextStatus = parsed.data.status ?? target.status;
  if (target.role === 'ORG_ADMIN' && (nextRole !== 'ORG_ADMIN' || nextStatus !== 'ACTIVE')) {
    const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(users).where(and(
      eq(users.organizationId, request.auth.organizationId), eq(users.role, 'ORG_ADMIN'), eq(users.status, 'ACTIVE'),
    ));
    if (Number(count) <= 1) throw new HttpError(409, 'LAST_ORG_ADMIN', 'An organization must keep at least one active administrator');
  }
  const user = await db.transaction(async (transaction) => {
    const [updatedUser] = await transaction.update(users).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.organizationId, request.auth.organizationId)))
      .returning();
    if (target.role === 'DRIVER' && parsed.data.status === 'INACTIVE') {
      await transaction.update(vehicles).set({ assignedDriverId: null, updatedAt: new Date() })
        .where(and(eq(vehicles.organizationId, request.auth.organizationId), eq(vehicles.assignedDriverId, target.id)));
    }
    return updatedUser;
  });
  if (parsed.data.status === 'INACTIVE' || (parsed.data.role && parsed.data.role !== target.role)) {
    await disconnectUserSockets(request.app.get('io'), target.id);
  }
  response.json({ user: publicUser(user) });
});

router.get('/drivers', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), async (request, response) => {
  const rows = await db.select({ user: users, driver: driverProfiles }).from(driverProfiles)
    .innerJoin(users, and(eq(users.id, driverProfiles.userId), eq(users.organizationId, driverProfiles.organizationId)))
    .where(eq(driverProfiles.organizationId, request.auth.organizationId))
    .orderBy(users.name);
  response.json({ drivers: rows.map(({ user, driver }) => ({ ...publicUser(user), phone: driver.phone, licenseNumber: driver.licenseNumber, licenseExpiresOn: driver.licenseExpiresOn })) });
});

router.post('/drivers', requireRole('ORG_ADMIN', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = createDriverSchema.safeParse(request.body);
  if (!parsed.success) return badInput(response, parsed.error);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const driver = await db.transaction(async (transaction) => {
      const [user] = await transaction.insert(users).values({
        organizationId: request.auth.organizationId,
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: 'DRIVER',
      }).returning();
      const [profile] = await transaction.insert(driverProfiles).values({
        organizationId: request.auth.organizationId,
        userId: user.id,
        phone: parsed.data.phone || null,
        licenseNumber: parsed.data.licenseNumber,
        licenseExpiresOn: parsed.data.licenseExpiresOn || null,
      }).returning();
      return { ...publicUser(user), phone: profile.phone, licenseNumber: profile.licenseNumber, licenseExpiresOn: profile.licenseExpiresOn };
    });
    response.status(201).json({ driver });
  } catch (error) {
    if (conflict(error)) throw new HttpError(409, 'DRIVER_ALREADY_EXISTS', 'The email or license number is already in use');
    throw error;
  }
});

export const teamRouter = router;
