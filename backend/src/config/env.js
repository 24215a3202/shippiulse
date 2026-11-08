import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const projectEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
dotenv.config({ path: projectEnvPath });

const emptyToUndefined = (schema) => z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default(process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL must be set'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  EXCEPTION_SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(60),
  EXCEPTION_DELIVERY_GRACE_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
  EXCEPTION_PICKUP_DELAY_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  EXCEPTION_MISSING_GPS_MINUTES: z.coerce.number().int().min(2).max(1440).default(15),
  EXCEPTION_ROUTE_DEVIATION_METERS: z.coerce.number().int().min(50).max(50000).default(1000),
  EXCEPTION_STOP_DELAY_MINUTES: z.coerce.number().int().min(1).max(1440).default(45),
  EXCEPTION_ESCALATION_MINUTES: z.coerce.number().int().min(5).max(10080).default(60),
  ACCESS_TOKEN_SECRET: emptyToUndefined(z.string().min(32)),
  REFRESH_TOKEN_SECRET: emptyToUndefined(z.string().min(32)),
  SMTP_URL: emptyToUndefined(z.string().url()),
  SMTP_FROM: emptyToUndefined(z.string().min(3)),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'SMTP_URL', 'SMTP_FROM']) {
    if (!value[key]) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  }
});

const result = envSchema.safeParse({
  ...process.env,
  API_PORT: process.env.API_PORT ?? process.env.PORT,
});

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = Object.freeze({
  ...result.data,
  DATABASE_SSL: result.data.DATABASE_SSL === 'true',
  ACCESS_TOKEN_SECRET: result.data.ACCESS_TOKEN_SECRET ?? randomBytes(32).toString('base64url'),
  REFRESH_TOKEN_SECRET: result.data.REFRESH_TOKEN_SECRET ?? randomBytes(32).toString('base64url'),
  SMTP_URL: result.data.SMTP_URL || undefined,
  EXCEPTION_SCAN_INTERVAL_SECONDS: result.data.EXCEPTION_SCAN_INTERVAL_SECONDS,
  EXCEPTION_DELIVERY_GRACE_MINUTES: result.data.EXCEPTION_DELIVERY_GRACE_MINUTES,
  EXCEPTION_PICKUP_DELAY_MINUTES: result.data.EXCEPTION_PICKUP_DELAY_MINUTES,
  EXCEPTION_MISSING_GPS_MINUTES: result.data.EXCEPTION_MISSING_GPS_MINUTES,
  EXCEPTION_ROUTE_DEVIATION_METERS: result.data.EXCEPTION_ROUTE_DEVIATION_METERS,
  EXCEPTION_STOP_DELAY_MINUTES: result.data.EXCEPTION_STOP_DELAY_MINUTES,
  EXCEPTION_ESCALATION_MINUTES: result.data.EXCEPTION_ESCALATION_MINUTES,
});
