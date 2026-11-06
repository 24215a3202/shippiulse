import { z } from 'zod';

const email = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const password = z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
  message: 'Password must be no longer than 72 UTF-8 bytes',
});
const organizationSlug = z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  organizationSlug,
  name: z.string().trim().min(2).max(120),
  email,
  password,
});

export const loginSchema = z.object({ organizationSlug, email, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ organizationSlug, email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(256), password });

export function sendValidationError(response, error) {
  response.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Check the submitted fields and try again',
      fields: error.flatten().fieldErrors,
    },
  });
}
