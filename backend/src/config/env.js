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
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL must be set'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
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

const result = envSchema.safeParse(process.env);

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
});
