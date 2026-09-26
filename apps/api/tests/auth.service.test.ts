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

  describe('changePassword', () => {
    function registeredService() {
      const service = new LocalAuthService();
      const session = service.register({
        role: 'WORKER',
        name: 'Ana Torres',
        email: 'ana@example.com',
        password: 'ClaveSegura1',
        dniOrRuc: '12345678',
      });
      return { service, session };
    }

    it('rejects an incorrect current password without changing anything', () => {
      const { service, session } = registeredService();

      expect(() =>
        service.changePassword(session.token, 'Incorrecta1', 'NuevaClave2'),
      ).toThrow('INVALID_CURRENT_PASSWORD');
      // La contraseña original sigue vigente.
      expect(service.login('ana@example.com', 'ClaveSegura1')).toBeTruthy();
    });

    it('rejects a new password that does not meet the strength rule', () => {
      const { service, session } = registeredService();

      expect(() =>
        service.changePassword(session.token, 'ClaveSegura1', 'debil'),
      ).toThrow('WEAK_PASSWORD');
    });

    it('rejects a new password identical to the current one', () => {
      const { service, session } = registeredService();

      expect(() =>
        service.changePassword(session.token, 'ClaveSegura1', 'ClaveSegura1'),
      ).toThrow('PASSWORD_UNCHANGED');
    });

    it('rejects the call for an account without a local password (Google-only)', () => {
      const { service, session } = registeredService();
      // `LocalAuthService.register` siempre deja `localPasswordConfigured:
      // true` y no tiene ninguna vía pública propia para dejarlo en `false`
      // (a diferencia de la base real: la migración
      // `20260914190000_google_local_password` sí deja cuentas Google
      // antiguas en ese estado — ver `docs/reference/api.md` — así que
      // `GOOGLE_ONLY_ACCOUNT` es alcanzable en producción, corrección de
      // CN-20260926-008, BAJO-3). Se fuerza el campo directamente para
      // cubrir en este servicio en memoria la misma rama que
      // `DatabaseAuthService.changePassword` valida contra una fila real.
      const accounts = (
        service as unknown as {
          accounts: Map<string, { localPasswordConfigured: boolean }>;
        }
      ).accounts;
      accounts.get('ana@example.com')!.localPasswordConfigured = false;

      expect(() =>
        service.changePassword(session.token, 'ClaveSegura1', 'NuevaClave2'),
      ).toThrow('GOOGLE_ONLY_ACCOUNT');
    });

    it('rejects the call when there is no valid session', () => {
      const service = new LocalAuthService();

      expect(() =>
        service.changePassword('token-inexistente', 'ClaveSegura1', 'NuevaClave2'),
      ).toThrow('INVALID_SESSION');
    });

    it('changes the password, keeps the current session and invalidates every other one', () => {
      const { service, session: firstSession } = registeredService();
      const secondSession = service.login('ana@example.com', 'ClaveSegura1');

      const result = service.changePassword(
        secondSession.token,
        'ClaveSegura1',
        'NuevaClave2',
      );

      expect(result.token).toBe(secondSession.token);
      // La sesión que hizo el cambio (segunda) sigue viva.
      expect(service.restore(secondSession.token)).toEqual(result);
      // La otra sesión previa (primera) quedó invalidada.
      expect(() => service.restore(firstSession.token)).toThrow('INVALID_SESSION');
      // La contraseña anterior ya no funciona y la nueva sí.
      expect(() => service.login('ana@example.com', 'ClaveSegura1')).toThrow(
        'INVALID_CREDENTIALS',
      );
      expect(service.login('ana@example.com', 'NuevaClave2')).toBeTruthy();
    });
  });
});
