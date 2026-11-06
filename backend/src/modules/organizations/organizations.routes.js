import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client.js';
import { organizations } from '../../db/schema.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';
import { z } from 'zod';

const router = Router();
const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  slug: z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
}).refine((value) => value.name !== undefined || value.slug !== undefined);

function validationError(response, error) {
  response.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Check the submitted fields and try again',
      fields: error.flatten().fieldErrors,
    },
  });
}

router.get('/me', requireAuth, async (request, response) => {
  const [organization] = await db.select({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    status: organizations.status,
  }).from(organizations)
    .where(eq(organizations.id, request.auth.organizationId))
    .limit(1);

  if (!organization) throw new HttpError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
  response.json({ organization });
});

router.patch('/me', requireAuth, requireRole('ORG_ADMIN', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);

  try {
    const [organization] = await db.update(organizations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(organizations.id, request.auth.organizationId))
      .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status });
    response.json({ organization });
  } catch (error) {
    if (error?.cause?.code === '23505' || error?.code === '23505') {
      throw new HttpError(409, 'ORGANIZATION_SLUG_IN_USE', 'That organization address is already in use');
    }
    throw error;
  }
});

export const organizationsRouter = router;
