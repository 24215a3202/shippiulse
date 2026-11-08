import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { driverProfiles, users, vehicles } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';

const router = Router();
const vehicleTypes = ['VAN', 'TRUCK', 'TRAILER', 'MOTORCYCLE', 'OTHER'];
const createSchema = z.object({
  registrationNumber: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  vehicleType: z.enum(vehicleTypes),
  capacityKg: z.number().int().positive().max(1000000).optional(),
});
const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).optional(),
  driverId: z.union([z.uuid(), z.null()]).optional(),
}).refine((value) => value.status !== undefined || value.driverId !== undefined);

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

router.use(requireAuth);

router.get('/vehicles', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), async (request, response) => {
  const rows = await db.select({ vehicle: vehicles, driver: users }).from(vehicles)
    .leftJoin(users, and(eq(users.id, vehicles.assignedDriverId), eq(users.organizationId, request.auth.organizationId)))
    .where(eq(vehicles.organizationId, request.auth.organizationId))
    .orderBy(vehicles.registrationNumber);
  response.json({ vehicles: rows.map(({ vehicle, driver }) => ({
    ...vehicle,
    assignedDriver: driver ? { id: driver.id, name: driver.name, email: driver.email, status: driver.status } : null,
  })) });
});

router.post('/vehicles', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) return badInput(response, parsed.error);
  try {
    const [vehicle] = await db.insert(vehicles).values({ organizationId: request.auth.organizationId, ...parsed.data }).returning();
    response.status(201).json({ vehicle });
  } catch (error) {
    if (conflict(error)) throw new HttpError(409, 'VEHICLE_REGISTRATION_IN_USE', 'That registration number is already registered');
    throw error;
  }
});

router.patch('/vehicles/:vehicleId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) return badInput(response, parsed.error);
  if (parsed.data.driverId) {
    const [driver] = await db.select({ id: users.id }).from(users)
      .innerJoin(driverProfiles, and(eq(driverProfiles.userId, users.id), eq(driverProfiles.organizationId, request.auth.organizationId)))
      .where(and(eq(users.id, parsed.data.driverId), eq(users.organizationId, request.auth.organizationId), eq(users.role, 'DRIVER'), eq(users.status, 'ACTIVE')))
      .limit(1);
    if (!driver) throw new HttpError(400, 'INVALID_DRIVER', 'Choose an active driver from your organization');
  }
  try {
    const [vehicle] = await db.update(vehicles).set({
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.driverId !== undefined ? { assignedDriverId: parsed.data.driverId } : {}),
      updatedAt: new Date(),
    }).where(and(eq(vehicles.id, request.params.vehicleId), eq(vehicles.organizationId, request.auth.organizationId))).returning();
    if (!vehicle) throw new HttpError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    response.json({ vehicle });
  } catch (error) {
    if (conflict(error)) throw new HttpError(409, 'DRIVER_ALREADY_ASSIGNED', 'That driver is already assigned to another vehicle');
    throw error;
  }
});

export const fleetRouter = router;
