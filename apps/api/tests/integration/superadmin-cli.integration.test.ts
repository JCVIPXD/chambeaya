import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService } from '../../src/modules/auth/auth.service.js';
import {
  anyAdminExists,
  createSuperadmin,
  resetSuperadminPassword,
  SUPERADMIN_EXIT_CODES,
} from '../../src/cli/superadmin.js';

// Comando de superadmin (`apps/api/src/cli/superadmin.ts`) contra PostgreSQL
// real: es lo que arranca una instalación de producción con la base de datos
// vacía (ver `docs/guides/deployment.md`, "Primer acceso"), así que necesita
// probarse contra la base real, no solo con dobles en memoria.
// Solo corre con opt-in explícito y contra una base cuyo nombre termina en
// `_test` (mismo guardia que el resto de `tests/integration`).

const integrationDatabaseUrl = process.env.DATABASE_URL;

function requireTestDatabase() {
  if (process.env.CHAMBEAYA_INTEGRATION_TESTS !== 'true') {
    throw new Error('INTEGRATION_TESTS_REQUIRE_EXPLICIT_OPT_IN');
  }
  if (!integrationDatabaseUrl) throw new Error('INTEGRATION_TESTS_REQUIRE_DATABASE_URL');

  const databaseName = new URL(integrationDatabaseUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!databaseName?.endsWith('_test')) {
    throw new Error('INTEGRATION_TESTS_REQUIRE_TEST_DATABASE');
  }
}

describe('comando de superadmin contra PostgreSQL real', () => {
  const prisma = new PrismaClient();
  const app = createApp({ rateLimit: false, authService: new DatabaseAuthService(prisma) });
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
  });

  afterEach(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crea un superadmin nuevo y permite loguearse con la contraseña generada', async () => {
    const result = await createSuperadmin(prisma, '  Primer.Admin@Empresa.COM ');

    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.OK);
    expect(result.email).toBe('primer.admin@empresa.com');
    expect(result.password).toBeDefined();

    const stored = await prisma.user.findUnique({ where: { email: 'primer.admin@empresa.com' } });
    expect(stored?.role).toBe('ADMIN');
    expect(stored?.localPasswordConfigured).toBe(true);
    expect(stored?.identifier).toMatch(/^ADMIN-[0-9a-f]{12}$/);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'primer.admin@empresa.com', password: result.password });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('ADMIN');
    expect(login.body).not.toHaveProperty('password');
  });

  it('--if-none no crea un segundo superadmin si ya existe uno', async () => {
    const first = await createSuperadmin(prisma, 'primero@empresa.com');
    expect(first.code).toBe(SUPERADMIN_EXIT_CODES.OK);

    const second = await createSuperadmin(prisma, 'segundo@empresa.com', { ifNone: true });
    expect(second.code).toBe(SUPERADMIN_EXIT_CODES.ALREADY_EXISTS);
    expect(second.password).toBeUndefined();

    const users = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('primero@empresa.com');
  });

  it('--if-none SÍ crea el primer superadmin cuando todavía no existe ninguno', async () => {
    expect(await anyAdminExists(prisma)).toBe(false);
    const result = await createSuperadmin(prisma, 'unico@empresa.com', { ifNone: true });
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.OK);
    expect(await anyAdminExists(prisma)).toBe(true);
  });

  it('falla con un mensaje claro si el correo ya está en uso, sin tocar la cuenta existente', async () => {
    await prisma.user.create({
      data: {
        email: 'ocupado@empresa.com',
        name: 'Trabajador existente',
        identifier: '87654321',
        role: 'WORKER',
        salt: 'salt',
        passwordHash: 'hash-original',
      },
    });

    const result = await createSuperadmin(prisma, 'ocupado@empresa.com');
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.VALIDATION_ERROR);
    expect(result.message).toMatch(/Ya existe un usuario/);

    const untouched = await prisma.user.findUnique({ where: { email: 'ocupado@empresa.com' } });
    expect(untouched?.role).toBe('WORKER');
    expect(untouched?.passwordHash).toBe('hash-original');
  });

  it('restablece la contraseña de un superadmin existente e invalida sus sesiones', async () => {
    const created = await createSuperadmin(prisma, 'restablecer@empresa.com');
    expect(created.code).toBe(SUPERADMIN_EXIT_CODES.OK);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'restablecer@empresa.com', password: created.password });
    expect(oldLogin.status).toBe(200);
    const oldToken = oldLogin.body.token as string;

    const sessionBefore = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${oldToken}`);
    expect(sessionBefore.status).toBe(200);

    const reset = await resetSuperadminPassword(prisma, 'restablecer@empresa.com');
    expect(reset.code).toBe(SUPERADMIN_EXIT_CODES.OK);
    expect(reset.password).toBeDefined();
    expect(reset.password).not.toBe(created.password);

    // La sesión anterior queda invalidada.
    const sessionAfter = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${oldToken}`);
    expect(sessionAfter.status).toBe(401);

    // La contraseña vieja ya no funciona; la nueva sí.
    const oldPasswordLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'restablecer@empresa.com', password: created.password });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'restablecer@empresa.com', password: reset.password });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.role).toBe('ADMIN');
  });

  it('reset falla sobre un usuario que no es ADMIN y no lo convierte en uno', async () => {
    await prisma.user.create({
      data: {
        email: 'trabajador@empresa.com',
        name: 'Trabajador',
        identifier: '11223344',
        role: 'WORKER',
        salt: 'salt',
        passwordHash: 'hash-original',
      },
    });

    const result = await resetSuperadminPassword(prisma, 'trabajador@empresa.com');
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.VALIDATION_ERROR);
    expect(result.password).toBeUndefined();

    const untouched = await prisma.user.findUnique({ where: { email: 'trabajador@empresa.com' } });
    expect(untouched?.role).toBe('WORKER');
    expect(untouched?.passwordHash).toBe('hash-original');
  });

  it('reset falla con un mensaje claro si el correo no existe', async () => {
    const result = await resetSuperadminPassword(prisma, 'nadie@empresa.com');
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.VALIDATION_ERROR);
    expect(result.message).toMatch(/No existe ningún usuario/);
  });
});
