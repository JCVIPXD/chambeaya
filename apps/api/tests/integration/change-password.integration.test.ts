import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService } from '../../src/modules/auth/auth.service.js';

// `POST /api/auth/password/change` contra PostgreSQL real: verifica que la
// contraseña y las sesiones se actualizan en la misma transacción (patrón de
// `resetSuperadminPassword` en `cli/superadmin.ts`) y que la sesión que hizo
// la petición sigue viva mientras las demás quedan invalidadas.
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

describe('POST /api/auth/password/change contra PostgreSQL real', () => {
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

  it('cambia la contraseña, conserva la sesión actual e invalida las demás sesiones reales', async () => {
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador Cambio Clave',
      email: 'cambio.clave@chambeaya.test',
      password: 'ClaveSegura1',
      dniOrRuc: '75000002',
    });
    expect(registered.status).toBe(201);
    const firstToken = registered.body.token as string;

    // Segundo login real: otra sesión activa sobre la misma cuenta.
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.clave@chambeaya.test', password: 'ClaveSegura1' });
    expect(secondLogin.status).toBe(200);
    const secondToken = secondLogin.body.token as string;

    expect(await prisma.authSession.count()).toBe(2);

    const change = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClaveSegura2' });
    expect(change.status).toBe(200);

    // Solo queda la sesión que hizo el cambio.
    const remainingSessions = await prisma.authSession.findMany();
    expect(remainingSessions).toHaveLength(1);

    const currentStillValid = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(currentStillValid.status).toBe(200);

    const otherNowInvalid = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${firstToken}`);
    expect(otherNowInvalid.status).toBe(401);

    // Login real después del cambio: la contraseña anterior ya no funciona,
    // la nueva sí.
    const loginWithOldPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.clave@chambeaya.test', password: 'ClaveSegura1' });
    expect(loginWithOldPassword.status).toBe(401);

    const loginWithNewPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.clave@chambeaya.test', password: 'NuevaClaveSegura2' });
    expect(loginWithNewPassword.status).toBe(200);
  });

  it('rechaza con 409 una cuenta sin contraseña local configurada (solo Google)', async () => {
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador Solo Google',
      email: 'solo.google@chambeaya.test',
      password: 'ClaveSegura1',
      dniOrRuc: '75000003',
    });
    expect(registered.status).toBe(201);
    const token = registered.body.token as string;

    // Este estado sí es alcanzable en producción: la migración
    // `20260914190000_google_local_password` marcó con `false` las cuentas
    // Google creadas antes de ese paso (corrección de CN-20260926-008,
    // BAJO-3; el comentario anterior de esta prueba afirmaba lo contrario).
    // Aquí se fuerza el campo directamente porque este trabajador se registró
    // por el flujo local (contraseña propia desde el alta), no por Google;
    // el efecto sobre `changePassword` es el mismo en ambos casos.
    await prisma.user.update({
      where: { email: 'solo.google@chambeaya.test' },
      data: { localPasswordConfigured: false },
    });

    const response = await request(app)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'ClaveSegura1', newPassword: 'NuevaClaveSegura2' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'GOOGLE_ONLY_ACCOUNT' });
    // No se tocó ninguna sesión al rechazar la petición.
    expect(await prisma.authSession.count()).toBe(1);
  });

  // Corrección de CN-20260926-008 (MEDIO-1): antes, dos cambios simultáneos
  // que leían la misma contraseña "actual" pasaban ambos la verificación y
  // los dos `update` se aplicaban ("el último en escribir gana" en
  // silencio) — el auditor lo reprodujo 20/20 contra Postgres real. Ahora el
  // `updateMany` de `changePassword` está condicionado al `passwordHash` que
  // cada petición leyó, así que solo la primera en comprometerse afecta una
  // fila; la otra recibe `409 PASSWORD_CHANGED_CONCURRENTLY` sin tocar
  // ninguna sesión.
  it('dos cambios simultáneos: exactamente uno tiene éxito y la contraseña final es la de ese', async () => {
    const registered = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador Cambio Concurrente',
      email: 'cambio.concurrente@chambeaya.test',
      password: 'ClaveSegura1',
      dniOrRuc: '75000004',
    });
    expect(registered.status).toBe(201);
    const tokenA = registered.body.token as string;

    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.concurrente@chambeaya.test', password: 'ClaveSegura1' });
    expect(loginB.status).toBe(200);
    const tokenB = loginB.body.token as string;

    // Las dos leen la MISMA contraseña actual (`ClaveSegura1`, la única que
    // existe todavía) y proponen contraseñas nuevas distintas, disparadas en
    // paralelo con `Promise.all` sobre la misma `app` (mismo proceso Node;
    // el solapamiento real ocurre en las idas y vueltas a Postgres, no por
    // paralelismo de hilos — ver el comentario del `updateMany` en
    // `auth.service.ts`).
    const [responseA, responseB] = await Promise.all([
      request(app)
        .post('/api/auth/password/change')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currentPassword: 'ClaveSegura1', newPassword: 'ClaveNuevaDeA2' }),
      request(app)
        .post('/api/auth/password/change')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ currentPassword: 'ClaveSegura1', newPassword: 'ClaveNuevaDeB2' }),
    ]);

    const statuses = [responseA.status, responseB.status].sort((left, right) => left - right);
    expect(statuses, JSON.stringify({ a: responseA.body, b: responseB.body })).toEqual([200, 409]);

    const aWon = responseA.status === 200;
    const winningPassword = aWon ? 'ClaveNuevaDeA2' : 'ClaveNuevaDeB2';
    const losingPassword = aWon ? 'ClaveNuevaDeB2' : 'ClaveNuevaDeA2';
    const losingResponse = aWon ? responseB : responseA;
    expect(losingResponse.body).toEqual({ error: 'PASSWORD_CHANGED_CONCURRENTLY' });

    // Login real después de la carrera: solo la contraseña de quien ganó
    // quedó vigente.
    const loginWithWinner = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.concurrente@chambeaya.test', password: winningPassword });
    expect(loginWithWinner.status).toBe(200);

    const loginWithLoser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.concurrente@chambeaya.test', password: losingPassword });
    expect(loginWithLoser.status).toBe(401);

    const loginWithOriginal = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cambio.concurrente@chambeaya.test', password: 'ClaveSegura1' });
    expect(loginWithOriginal.status).toBe(401);
  });
});
