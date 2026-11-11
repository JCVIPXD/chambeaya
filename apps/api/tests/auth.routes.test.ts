import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { AuthError, LocalAuthService, type AuthService } from '../src/modules/auth/auth.service.js';

describe('persistent authentication routes', () => {
  it('does not expose public business registration', async () => {
    const app = createApp({ authService: new LocalAuthService() });
    const response = await request(app).post('/api/auth/register').send({
      role: 'BUSINESS',
      name: 'Empresa Demo',
      email: 'empresa@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '20123456789',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'BUSINESS_REGISTRATION_DISABLED' });
  });

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

describe('POST /api/auth/password/change', () => {
  async function registeredApp() {
    const app = createApp({ authService: new LocalAuthService() });
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });
    return { app, token: registered.body.token as string };
  }

  it('rejects the request without a bearer session', async () => {
    const app = createApp({ authService: new LocalAuthService() });

    const response = await request(app)
      .post('/api/auth/password/change')
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClave2' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'INVALID_SESSION' });
  });

  it('rejects an incorrect current password with 401', async () => {
    const { app, token } = await registeredApp();

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Incorrecta1', newPassword: 'NuevaClave2' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'INVALID_CURRENT_PASSWORD' });
  });

  it('rejects a weak new password with 400', async () => {
    const { app, token } = await registeredApp();

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'debil' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'WEAK_PASSWORD' });
  });

  it('rejects a new password identical to the current one with 400', async () => {
    const { app, token } = await registeredApp();

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'ClaveSegura1' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'PASSWORD_UNCHANGED' });
  });

  it('rejects a Google-only account (no local password yet) with 409', async () => {
    const authService = new LocalAuthService();
    const app = createApp({ authService });
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });
    const token = registered.body.token as string;
    // Ver el comentario equivalente en `auth.service.test.ts`: no hay una vía
    // pública para crear una cuenta "solo Google" en `LocalAuthService`.
    (
      authService as unknown as {
        accounts: Map<string, { localPasswordConfigured: boolean }>;
      }
    ).accounts.get('ana@example.com')!.localPasswordConfigured = false;

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClave2' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'GOOGLE_ONLY_ACCOUNT' });
  });

  it('changes the password, keeps the current session and invalidates the others', async () => {
    const { app, token: firstToken } = await registeredApp();
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'ClaveSegura1' });
    const secondToken = secondLogin.body.token as string;

    const change = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClave2' });

    expect(change.status).toBe(200);

    const currentStillValid = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(currentStillValid.status).toBe(200);

    const otherNowInvalid = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${firstToken}`);
    expect(otherNowInvalid.status).toBe(401);

    const loginWithNewPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'NuevaClave2' });
    expect(loginWithNewPassword.status).toBe(200);

    const loginWithOldPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'ClaveSegura1' });
    expect(loginWithOldPassword.status).toBe(401);
  });

  it('maps PASSWORD_CHANGED_CONCURRENTLY (thrown when the optimistic check loses the race) to 409', async () => {
    const authService: AuthService = {
      register: vi.fn(),
      login: vi.fn(),
      restore: vi.fn(),
      logout: vi.fn(),
      startGoogleLogin: vi.fn(),
      completeGoogleProfile: vi.fn(),
      setInitialGooglePassword: vi.fn(),
      changePassword: vi.fn().mockRejectedValue(new AuthError('PASSWORD_CHANGED_CONCURRENTLY')),
    };
    const app = createApp({ authService });

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', 'Bearer cualquier-token')
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClave2' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'PASSWORD_CHANGED_CONCURRENTLY' });
  });

  // Corrección de CN-20260926-008 (BAJO-4): antes, cualquier error no
  // reconocido (por ejemplo una falla real de la base de datos) caía en el
  // `400` genérico y ocultaba un fallo del servidor detrás de un código que
  // sugiere un error del cliente.
  it('maps an unexpected error (not an AuthError) to 500 INTERNAL_ERROR without leaking details', async () => {
    const authService: AuthService = {
      register: vi.fn(),
      login: vi.fn(),
      restore: vi.fn(),
      logout: vi.fn(),
      startGoogleLogin: vi.fn(),
      completeGoogleProfile: vi.fn(),
      setInitialGooglePassword: vi.fn(),
      changePassword: vi.fn().mockRejectedValue(new Error('la base de datos se cayó, detalle sensible')),
    };
    const app = createApp({ authService });

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', 'Bearer cualquier-token')
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClave2' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'INTERNAL_ERROR' });
  });
});
