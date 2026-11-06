import { env } from '../../config/env.js';
import { tokenTtl } from './tokens.js';

const secure = env.NODE_ENV === 'production';
const sameSite = 'strict';

export function readCookie(request, name) {
  const raw = request.headers.cookie;
  if (!raw) return undefined;

  for (const entry of raw.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function setSessionCookies(response, accessToken, refreshToken, csrfToken) {
  response.cookie('sp_access', accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: tokenTtl.accessMs,
  });
  response.cookie('sp_refresh', refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth',
    maxAge: tokenTtl.refreshMs,
  });
  response.cookie('sp_csrf', csrfToken, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    maxAge: tokenTtl.refreshMs,
  });
}

export function clearSessionCookies(response) {
  response.clearCookie('sp_access', { httpOnly: true, secure, sameSite, path: '/' });
  response.clearCookie('sp_refresh', { httpOnly: true, secure, sameSite, path: '/api/auth' });
  response.clearCookie('sp_csrf', { secure, sameSite, path: '/' });
}
