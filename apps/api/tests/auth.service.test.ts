import { describe, expect, it } from 'vitest';

import { LocalAuthService } from '../src/modules/auth/auth.service.js';

describe('LocalAuthService', () => {
  it('never exposes a plaintext password when registering a worker', () => {
    const service = new LocalAuthService();

    const session = service.register({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });

    expect(session).not.toHaveProperty('password');
    expect(session.role).toBe('WORKER');
    expect(session.token.length).toBeGreaterThan(32);
  });

  it('restores a session until the user logs out', () => {
    const service = new LocalAuthService();
    const session = service.register({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });

    expect(service.restore(session.token)).toEqual(session);
    service.logout(session.token);
    expect(() => service.restore(session.token)).toThrow('INVALID_SESSION');
  });

  it('identifies a duplicate DNI independently from a duplicate email', () => {
    const service = new LocalAuthService();
    service.register({
      role: 'WORKER',
      name: 'Ana Torres',
      email: 'ana@example.com',
      password: 'ClaveSegura1',
      dniOrRuc: '12345678',
    });

    expect(() =>
      service.register({
        role: 'WORKER',
        name: 'Beatriz Ramos',
        email: 'beatriz@example.com',
        password: 'ClaveSegura1',
        dniOrRuc: '12345678',
      }),
    ).toThrow('DUPLICATE_IDENTIFIER');
  });
});
