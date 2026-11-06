import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { organizations, passwordResetTokens, refreshSessions, users } from '../../db/schema.js';
import { HttpError, invalidCredentials, unauthorized } from './auth-errors.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { sendPasswordResetEmail } from './password-reset-email.js';
import { createAccessToken, createCsrfToken, createRefreshToken, hashToken, verifyToken } from './tokens.js';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
let dummyPasswordHash;

function publicUser(user, organization) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
  };
}

function setTokens(response, user, refreshToken, familyId) {
  setSessionCookies(response, createAccessToken(user, familyId), refreshToken, createCsrfToken());
}

async function createSession(transaction, user) {
  const familyId = randomUUID();
  const refresh = createRefreshToken(user, familyId);
  await transaction.insert(refreshSessions).values({
    familyId,
    userId: user.id,
    tokenHash: hashToken(refresh.token),
    expiresAt: refresh.expiresAt,
  });
  return { token: refresh.token, familyId };
}

function databaseErrorCode(error) {
  let current = error;
  while (current) {
    if (current.code) return current.code;
    current = current.cause;
  }
  return undefined;
}

export async function register(input, response) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    const result = await db.transaction(async (transaction) => {
      const [organization] = await transaction.insert(organizations).values({
        name: input.organizationName,
        slug: input.organizationSlug,
      }).returning();

      const [user] = await transaction.insert(users).values({
        organizationId: organization.id,
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'ORG_ADMIN',
      }).returning();

      const session = await createSession(transaction, user);
      return { organization, user, session };
    });

    setTokens(response, result.user, result.session.token, result.session.familyId);
    return publicUser(result.user, result.organization);
  } catch (error) {
    if (databaseErrorCode(error) === '23505') {
      throw new HttpError(409, 'ORGANIZATION_ALREADY_EXISTS', 'That organization address is already in use');
    }
    throw error;
  }
}

async function getDummyPasswordHash() {
  dummyPasswordHash ??= await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  return dummyPasswordHash;
}

export async function login(input, response) {
  const [record] = await db.select({
    user: users,
    organization: organizations,
  }).from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(and(eq(users.email, input.email), eq(organizations.slug, input.organizationSlug)))
    .limit(1);

  const hashToCheck = record?.user.passwordHash ?? await getDummyPasswordHash();
  const passwordMatches = await bcrypt.compare(input.password, hashToCheck);
  if (!record || !passwordMatches || record.user.status !== 'ACTIVE' || record.organization.status !== 'ACTIVE') {
    throw invalidCredentials();
  }

  const session = await db.transaction((transaction) => createSession(transaction, record.user));
  setTokens(response, record.user, session.token, session.familyId);
  return publicUser(record.user, record.organization);
}

export async function rotateRefreshToken(token, response) {
  const claims = verifyToken(token, 'refresh');
  if (!claims) throw unauthorized();

  const result = await db.transaction(async (transaction) => {
    const tokenHash = hashToken(token);
    const [session] = await transaction.select().from(refreshSessions)
      .where(eq(refreshSessions.tokenHash, tokenHash))
      .for('update')
      .limit(1);

    if (!session) return { invalid: true };

    if (session.revokedAt || session.familyId !== claims.sid || session.userId !== claims.sub || session.expiresAt <= new Date()) {
      await transaction.update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshSessions.familyId, session.familyId), isNull(refreshSessions.revokedAt)));
      return { invalid: true };
    }

    const [record] = await transaction.select({ user: users, organization: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(eq(users.id, session.userId), eq(organizations.id, claims.orgId)))
      .limit(1);

    if (!record || record.user.status !== 'ACTIVE' || record.organization.status !== 'ACTIVE') {
      await transaction.update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshSessions.familyId, session.familyId), isNull(refreshSessions.revokedAt)));
      return { invalid: true };
    }

    await transaction.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.id, session.id));
    const nextToken = createRefreshToken(record.user, session.familyId);
    await transaction.insert(refreshSessions).values({
      familyId: session.familyId,
      userId: record.user.id,
      tokenHash: hashToken(nextToken.token),
      expiresAt: nextToken.expiresAt,
    });
    return { user: record.user, organization: record.organization, token: nextToken.token, familyId: session.familyId };
  });

  if (result.invalid) throw unauthorized();
  setTokens(response, result.user, result.token, result.familyId);
  return publicUser(result.user, result.organization);
}

export async function logout(refreshToken, accessToken, response) {
  const claims = verifyToken(refreshToken, 'refresh') ?? verifyToken(accessToken, 'access');
  if (claims) {
    await db.update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshSessions.familyId, claims.sid), isNull(refreshSessions.revokedAt)));
  }
  clearSessionCookies(response);
}

export async function getCurrentUser(auth) {
  const [record] = await db.select({ user: users, organization: organizations })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(and(eq(users.id, auth.userId), eq(users.organizationId, auth.organizationId)))
    .limit(1);
  if (!record) throw unauthorized();
  return publicUser(record.user, record.organization);
}

export async function requestPasswordReset(input) {
  const [record] = await db.select({ user: users, organization: organizations })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(and(eq(users.email, input.email), eq(organizations.slug, input.organizationSlug)))
    .limit(1);

  if (!record || record.user.status !== 'ACTIVE' || record.organization.status !== 'ACTIVE') return {};

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await db.transaction(async (transaction) => {
    await transaction.update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, record.user.id), isNull(passwordResetTokens.consumedAt)));
    await transaction.insert(passwordResetTokens).values({
      userId: record.user.id,
      tokenHash: hashToken(token),
      expiresAt,
    });
  });

  const resetUrl = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendPasswordResetEmail({ email: record.user.email, organizationName: record.organization.name, resetUrl });

  if (!sent && env.NODE_ENV !== 'production') {
    return { developmentToken: token };
  }
  if (!sent) {
    logger.error('Password reset requested without an email transport');
    throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Password reset is temporarily unavailable');
  }
  return {};
}

export async function resetPassword(token, password, response) {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();

  const result = await db.transaction(async (transaction) => {
    const [resetRecord] = await transaction.select().from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.consumedAt),
        gt(passwordResetTokens.expiresAt, now),
      ))
      .for('update')
      .limit(1);

    if (!resetRecord) return false;

    const [user] = await transaction.update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now })
      .where(and(eq(users.id, resetRecord.userId), eq(users.status, 'ACTIVE')))
      .returning({ id: users.id });

    if (!user) return false;

    await transaction.update(passwordResetTokens).set({ consumedAt: now }).where(eq(passwordResetTokens.id, resetRecord.id));
    await transaction.update(passwordResetTokens)
      .set({ consumedAt: now })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.consumedAt)));
    await transaction.update(refreshSessions)
      .set({ revokedAt: now })
      .where(and(eq(refreshSessions.userId, user.id), isNull(refreshSessions.revokedAt)));
    return true;
  });

  clearSessionCookies(response);
  if (!result) throw new HttpError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or expired');
}
