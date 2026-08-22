import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';

describe('persistent authentication routes', () => {
  it('restores a bearer session and invalidates it on logout', async () => {
    const app = createApp({ authService: new LocalAuthService() });
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });

    expect(registered.status).toBe(201);
    const token = registered.body.token as string;

    const restored = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ role: 'WORKER', name: 'Ana Torres' });

    expect(
      (
        await request(app)
          .delete('/api/auth/session')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(204);

    expect(
      (
        await request(app)
          .get('/api/auth/session')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(401);
  });
});
