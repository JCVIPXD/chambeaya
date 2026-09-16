import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;

function restoreEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }

  if (ORIGINAL_CORS_ALLOWED_ORIGINS === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_CORS_ALLOWED_ORIGINS;
  }
}

describe('CORS por entorno (resolveCorsOptions vía createApp)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('es permisivo fuera de producción cuando CORS_ALLOWED_ORIGINS no está definida', async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'test';

    const response = await request(createApp({ authService: new LocalAuthService() }))
      .get('/api/health')
      .set('Origin', 'https://cualquier-origen.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('bloquea todos los orígenes en producción cuando CORS_ALLOWED_ORIGINS no está definida', async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';

    const response = await request(createApp({ authService: new LocalAuthService() }))
      .get('/api/health')
      .set('Origin', 'https://cualquier-origen.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('permite solo los orígenes listados en producción cuando CORS_ALLOWED_ORIGINS está definida', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://piloto.cumplenow.pe, https://admin.cumplenow.pe';

    const app = createApp({ authService: new LocalAuthService() });

    const allowed = await request(app).get('/api/health').set('Origin', 'https://piloto.cumplenow.pe');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://piloto.cumplenow.pe');

    const otherAllowed = await request(app).get('/api/health').set('Origin', 'https://admin.cumplenow.pe');
    expect(otherAllowed.headers['access-control-allow-origin']).toBe('https://admin.cumplenow.pe');

    const rejected = await request(app).get('/api/health').set('Origin', 'https://otro-origen.example');
    expect(rejected.status).toBe(200);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });
});
