import { and, eq, exists, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { organizations, refreshSessions, users } from '../../db/schema.js';
import { HttpError, unauthorized } from './auth-errors.js';
import { constantTimeTextEqual, verifyToken } from './tokens.js';
import { readCookie } from './cookies.js';

export async function requireAuth(request, _response, next) {
  const claims = verifyToken(readCookie(request, 'sp_access'), 'access');
  if (!claims) return next(unauthorized());

  try {
    const [record] = await db.select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
      sessionVersion: users.sessionVersion,
      userStatus: users.status,
      organizationStatus: organizations.status,
    }).from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(
        eq(users.id, claims.sub),
        eq(users.organizationId, claims.orgId),
        exists(db.select({ id: refreshSessions.id }).from(refreshSessions).where(and(
          eq(refreshSessions.familyId, claims.sid),
          eq(refreshSessions.userId, users.id),
          isNull(refreshSessions.revokedAt),
          gt(refreshSessions.expiresAt, new Date()),
        ))),
      ))
      .limit(1);

    if (!record || record.userStatus !== 'ACTIVE' || record.organizationStatus !== 'ACTIVE' || record.sessionVersion !== claims.ver) {
      return next(unauthorized());
    }

    request.auth = { userId: record.id, organizationId: record.organizationId, role: record.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles) {
  return (request, _response, next) => {
    if (!request.auth) return next(unauthorized());
    if (!roles.includes(request.auth.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    }
    return next();
  };
}

export function requireCsrf(request, _response, next) {
  const cookieToken = readCookie(request, 'sp_csrf');
  const headerToken = request.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || !constantTimeTextEqual(cookieToken, headerToken)) {
    return next(new HttpError(403, 'CSRF_VALIDATION_FAILED', 'Refresh the page and try again'));
  }
  return next();
}
