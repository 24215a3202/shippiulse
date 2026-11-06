import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { closeDatabase, db } from '../src/db/client.js';
import { organizations } from '../src/db/schema.js';
import { inArray } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { users } from '../src/db/schema.js';

const testId = randomUUID().replaceAll('-', '').slice(0, 12);
const slugA = `auth-test-${testId}-a`;
const slugB = `auth-test-${testId}-b`;
const email = `ops-${testId}@example.test`;

function csrfFrom(response) {
  const csrfCookie = response.headers['set-cookie']?.find((value) => value.startsWith('sp_csrf='));
  return csrfCookie?.split(';', 1)[0].slice('sp_csrf='.length);
}

function cookiesFrom(response) {
  return response.headers['set-cookie']?.map((value) => value.split(';', 1)[0]).join('; ');
}

describe('authentication and tenant isolation', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './migrations' });
  });

  afterAll(async () => {
    try {
      await db.delete(organizations).where(inArray(organizations.slug, [slugA, slugB]));
    } finally {
      await closeDatabase();
    }
  });

  test('registers organizations, protects accounts, rotates sessions, and resets passwords', async () => {
    const password = 'Sundial-Freight-2026';
    const nextPassword = 'Maple-River-Operations-2026';
    const accountA = request.agent(app);
    const accountB = request.agent(app);

    const registrationA = await accountA.post('/api/auth/register').send({
      organizationName: 'Northstar Freight',
      organizationSlug: slugA,
      name: 'Avery Dispatcher',
      email,
      password,
    }).expect(201);

    expect(registrationA.body.user.role).toBe('ORG_ADMIN');
    expect(registrationA.body.user.organization.slug).toBe(slugA);
    expect(registrationA.headers['set-cookie'].some((value) => value.startsWith('sp_access=') && value.includes('HttpOnly'))).toBe(true);
    expect(registrationA.headers['set-cookie'].some((value) => value.startsWith('sp_csrf=') && !value.includes('HttpOnly'))).toBe(true);

    const meA = await accountA.get('/api/auth/me').expect(200);
    expect(meA.body.user.organization.slug).toBe(slugA);

    await request(app).post('/api/auth/register').send({
      organizationName: 'Duplicate Northstar',
      organizationSlug: slugA,
      name: 'Other Admin',
      email: `other-${testId}@example.test`,
      password,
    }).expect(409);

    await request(app).post('/api/auth/login').send({ organizationSlug: slugB, email, password }).expect(401);

    const registrationB = await accountB.post('/api/auth/register').send({
      organizationName: 'Southstar Freight',
      organizationSlug: slugB,
      name: 'Blake Dispatcher',
      email,
      password,
    }).expect(201);
    expect(registrationB.body.user.organization.slug).toBe(slugB);
    expect((await accountB.get('/api/auth/me').expect(200)).body.user.organization.slug).toBe(slugB);
    expect((await accountB.get('/api/organizations/me').expect(200)).body.organization.slug).toBe(slugB);

    await db.update(users).set({ role: 'VIEWER' }).where(eq(users.id, registrationB.body.user.id));
    await accountB.patch('/api/organizations/me')
      .set('X-CSRF-Token', csrfFrom(registrationB))
      .send({ name: 'Unauthorized Name Change' })
      .expect(403);

    const organizationAUpdate = await accountA.patch('/api/organizations/me')
      .set('X-CSRF-Token', csrfFrom(registrationA))
      .send({ name: 'Northstar Freight Group' })
      .expect(200);
    expect(organizationAUpdate.body.organization.slug).toBe(slugA);
    expect((await accountB.get('/api/organizations/me').expect(200)).body.organization.name).toBe('Southstar Freight');

    await accountA.post('/api/auth/refresh').expect(403);

    const oldCookies = cookiesFrom(registrationA);
    const firstCsrf = csrfFrom(registrationA);
    const refreshed = await accountA.post('/api/auth/refresh')
      .set('X-CSRF-Token', firstCsrf)
      .expect(200);
    expect(refreshed.body.user.organization.slug).toBe(slugA);

    await request(app).post('/api/auth/refresh')
      .set('Cookie', oldCookies)
      .set('X-CSRF-Token', firstCsrf)
      .expect(401);
    await accountA.get('/api/auth/me').expect(401);

    const loginA = request.agent(app);
    const loginResponse = await loginA.post('/api/auth/login').send({ organizationSlug: slugA, email, password }).expect(200);
    const loginMe = await loginA.get('/api/auth/me').expect(200);
    expect(loginMe.body.user.organization.slug).toBe(slugA);

    await loginA.post('/api/auth/logout')
      .set('X-CSRF-Token', csrfFrom(loginResponse))
      .expect(204);
    await loginA.get('/api/auth/me').expect(401);

    const forgot = await request(app).post('/api/auth/password/forgot').send({ organizationSlug: slugA, email }).expect(202);
    expect(forgot.body.message).toContain('If an active account matches');
    expect(forgot.body.developmentToken).toBeTruthy();

    await request(app).post('/api/auth/password/reset').send({
      token: forgot.body.developmentToken,
      password: nextPassword,
    }).expect(204);

    await request(app).post('/api/auth/password/reset').send({
      token: forgot.body.developmentToken,
      password: nextPassword,
    }).expect(400);

    await request(app).post('/api/auth/login').send({ organizationSlug: slugA, email, password }).expect(401);
    const newLogin = await request(app).post('/api/auth/login').send({
      organizationSlug: slugA,
      email,
      password: nextPassword,
    }).expect(200);
    expect(newLogin.body.user.email).toBe(email);
  });
});
