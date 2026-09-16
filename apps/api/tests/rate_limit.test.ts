import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';

describe('rate limiting on auth routes', () => {
  it('responds with 429 and a generic error code after exceeding the limit on POST /api/auth/login', async () => {
    const app = createApp({
      authService: new LocalAuthService(),
      rateLimit: { windowMs: 60_000, max: 2 },
    });

    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'ataque@example.com', password: 'incorrecta' });

    const first = await attempt();
    const second = await attempt();
    const third = await attempt();

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: 'AUTH_RATE_LIMITED' });
    // La respuesta de límite no debe filtrar si la cuenta existe ni ningún otro dato.
    expect(Object.keys(third.body)).toEqual(['error']);
  });

  it('counts every guarded auth route toward the same limit, including register', async () => {
    const app = createApp({
      authService: new LocalAuthService(),
      rateLimit: { windowMs: 60_000, max: 1 },
    });

    const first = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador Uno',
      email: 'uno@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '11111111',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador Dos',
      email: 'dos@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '22222222',
    });

    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'AUTH_RATE_LIMITED' });
  });

  it('does not rate limit unrelated routes such as GET /api/health', async () => {
    const app = createApp({
      authService: new LocalAuthService(),
      rateLimit: { windowMs: 60_000, max: 1 },
    });

    // Agota el cupo de las rutas de auth primero para confirmar que el
    // limitador de /api/auth no afecta a /api/health.
    await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'x' });
    await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'x' });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).get('/api/health')),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    }
  });

  it('can be disabled entirely via rateLimit: false', async () => {
    const app = createApp({ authService: new LocalAuthService(), rateLimit: false });

    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'x' }),
      ),
    );

    for (const response of responses) {
      expect(response.status).not.toBe(429);
    }
  });
});
