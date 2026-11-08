import { describe, expect, test } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('HTTP security boundaries', () => {
  test('adds security headers and does not disclose Express', async () => {
    const response = await request(app).get('/api/auth/me').expect(401);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  test('does not authorize untrusted browser origins or unauthenticated shipment access', async () => {
    const response = await request(app)
      .get('/api/shipments')
      .set('Origin', 'https://untrusted.example')
      .expect(401);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
