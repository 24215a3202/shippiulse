import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireCsrf } from './auth-middleware.js';
import { readCookie } from './cookies.js';
import {
  getCurrentUser,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  rotateRefreshToken,
} from './auth-service.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sendValidationError,
} from './validation.js';

const router = Router();
function createAuthLimiter(limit) {
  return rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
  });
}

const registrationLimiter = createAuthLimiter(5);
const loginLimiter = createAuthLimiter(10);
const refreshLimiter = createAuthLimiter(30);
const resetLimiter = createAuthLimiter(5);

function parseBody(schema, request, response) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    sendValidationError(response, parsed.error);
    return null;
  }
  return parsed.data;
}

router.post('/register', registrationLimiter, async (request, response) => {
  const input = parseBody(registerSchema, request, response);
  if (!input) return;
  const user = await register(input, response);
  response.status(201).json({ user });
});

router.post('/login', loginLimiter, async (request, response) => {
  const input = parseBody(loginSchema, request, response);
  if (!input) return;
  const user = await login(input, response);
  response.json({ user });
});

router.post('/refresh', refreshLimiter, requireCsrf, async (request, response) => {
  const user = await rotateRefreshToken(readCookie(request, 'sp_refresh'), response);
  response.json({ user });
});

router.post('/logout', requireCsrf, async (request, response) => {
  await logout(readCookie(request, 'sp_refresh'), readCookie(request, 'sp_access'), response);
  response.status(204).end();
});

router.get('/me', requireAuth, async (request, response) => {
  const user = await getCurrentUser(request.auth);
  response.json({ user });
});

router.post('/password/forgot', resetLimiter, async (request, response) => {
  const input = parseBody(forgotPasswordSchema, request, response);
  if (!input) return;
  const result = await requestPasswordReset(input);
  response.status(202).json({
    message: 'If an active account matches those details, password reset instructions have been prepared.',
    ...(result.developmentToken ? { developmentToken: result.developmentToken } : {}),
  });
});

router.post('/password/reset', resetLimiter, async (request, response) => {
  const input = parseBody(resetPasswordSchema, request, response);
  if (!input) return;
  await resetPassword(input.token, input.password, response);
  response.status(204).end();
});

export const authRouter = router;
