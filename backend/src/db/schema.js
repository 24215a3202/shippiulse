import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar, index } from 'drizzle-orm/pg-core';

export const organizationStatus = pgEnum('organization_status', ['ACTIVE', 'SUSPENDED']);
export const userRole = pgEnum('user_role', ['SUPER_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER']);

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  status: organizationStatus('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull().default(''),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('VIEWER'),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  sessionVersion: integer('session_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_org_email_unique').on(table.organizationId, table.email),
]);

export const refreshSessions = pgTable('refresh_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('refresh_sessions_family_idx').on(table.familyId),
  index('refresh_sessions_user_idx').on(table.userId),
]);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('password_reset_tokens_user_idx').on(table.userId),
]);
