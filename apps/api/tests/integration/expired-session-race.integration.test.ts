import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Dos peticiones simultáneas con el mismo token vencido (CN-20260923-013,
// BAJO-1). Con `authSession.delete`, la segunda petición borraba una fila que la
// primera ya había borrado, fallaba con `P2025` y las rutas del trabajador
// respondían `500 INTERNAL_ERROR` en vez de `401 INVALID_SESSION`. `deleteMany`
// es idempotente. La prueba es DETERMINISTA: una barrera sobre
// `authSession.findUnique` obliga a que las dos peticiones lean la sesión antes
// de que cualquiera la borre.
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

type AnyFunction = (...args: unknown[]) => unknown;

/** Barrera de `parties` llegadas: las primeras esperan a las demás, las posteriores pasan. */
function barrier(parties: number) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return async () => {
    arrived += 1;
    if (arrived >= parties) open();
    if (arrived <= parties) await opened;
  };
}

/** Cliente Prisma cuyo `authSession.findUnique` termina, pero no devuelve hasta que `parties` lecturas hayan llegado. */
function withSessionReadBarrier(base: PrismaClient, parties: number) {
  const gate = barrier(parties);
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'authSession') {
        return new Proxy(target.authSession, {
          get(delegate, delegateProp) {
            const value = Reflect.get(delegate, delegateProp) as unknown;
            if (delegateProp === 'findUnique') {
              return async (...args: unknown[]) => {
                const result = await (value as AnyFunction).apply(delegate, args);
                await gate();
                return result;
              };
            }
            return typeof value === 'function' ? (value as AnyFunction).bind(delegate) : value;
          },
        });
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
    },
  }) as PrismaClient;
}

describe('two simultaneous requests with the same expired token both answer 401, never 500', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(withSessionReadBarrier(prisma, 2)),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });
  const registrationApp = createApp({
    rateLimit: false,
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });
  let databaseReady = false;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    databaseReady = true;
  });

  afterAll(async () => {
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  it('answers 401 INVALID_SESSION to both and leaves no session behind', async () => {
    const registered = await request(registrationApp).post('/api/auth/register').send({
      role: 'WORKER',
      name: 'Trabajador de sesion vencida',
      email: 'trabajador.sesionvencida@chambeaya.test',
      password: 'Trabajador123',
      dniOrRuc: '75000001',
    });
    expect(registered.status).toBe(201);
    const token = registered.body.token as string;
    expect(await verifier.authSession.count()).toBe(1);
    await verifier.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });

    const [first, second] = await Promise.all([
      request(app).get('/api/workers/applications').set('Authorization', `Bearer ${token}`).then((response) => response),
      request(app).get('/api/workers/applications').set('Authorization', `Bearer ${token}`).then((response) => response),
    ]);

    expect([first.status, second.status], JSON.stringify([first.body, second.body])).toEqual([401, 401]);
    expect(first.body).toEqual({ error: 'INVALID_SESSION' });
    expect(second.body).toEqual({ error: 'INVALID_SESSION' });
    expect(await verifier.authSession.count()).toBe(0);
  });
});
