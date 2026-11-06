import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
  application_name: 'shippulse-api',
});

export const db = drizzle(pool, { schema });

export async function checkDatabase() {
  await pool.query('select 1');
}

export async function closeDatabase() {
  await pool.end();
}
