import { logger } from '../config/logger.js';

export function notFound(_request, response) {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(error, _request, response, _next) {
  if (error.statusCode && error.statusCode < 500) {
    logger.warn({ statusCode: error.statusCode, code: error.code }, 'Request rejected');
  } else {
    logger.error({ err: error }, 'Request failed');
  }
  if (response.headersSent) return;

  response.status(error.statusCode ?? 500).json({
    error: {
      code: error.code ?? 'INTERNAL_SERVER_ERROR',
      message: error.statusCode ? error.message : 'An unexpected error occurred',
    },
  });
}
