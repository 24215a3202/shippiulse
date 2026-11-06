import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = 'shippulse';
const AUDIENCE = 'shippulse-api';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function equalText(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sign(payload, secret) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function createAccessToken(user, familyId) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: user.id,
    orgId: user.organizationId,
    role: user.role,
    ver: user.sessionVersion,
    sid: familyId,
    typ: 'access',
    iat: now,
    exp: now + ACCESS_SECONDS,
    jti: randomUUID(),
  }, env.ACCESS_TOKEN_SECRET);
}

export function createRefreshToken(user, familyId) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + REFRESH_SECONDS) * 1000);
  const token = sign({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: user.id,
    orgId: user.organizationId,
    sid: familyId,
    typ: 'refresh',
    iat: now,
    exp: now + REFRESH_SECONDS,
    jti: randomUUID(),
  }, env.REFRESH_TOKEN_SECRET);

  return { token, expiresAt };
}

export function verifyToken(token, type) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const secret = type === 'access' ? env.ACCESS_TOKEN_SECRET : env.REFRESH_TOKEN_SECRET;
    const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.typ !== type || payload.iss !== ISSUER || payload.aud !== AUDIENCE || payload.exp <= now) return null;
    if (!payload.sub || !payload.orgId || !payload.sid) return null;
    return payload;
  } catch {
    return null;
  }
}

export const tokenTtl = Object.freeze({ accessMs: ACCESS_SECONDS * 1000, refreshMs: REFRESH_SECONDS * 1000 });

export function createCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function constantTimeTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return equalText(left, right);
}
