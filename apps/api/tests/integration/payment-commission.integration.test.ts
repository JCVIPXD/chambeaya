import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DatabaseAuthService, hashPassword } from '../../src/modules/auth/auth.service.js';
import { DatabaseBusinessService } from '../../src/modules/business/business.service.js';
import { DatabaseMarketplaceService } from '../../src/modules/marketplace/marketplace.service.js';

// Comisión de Chambeaya congelada al publicar un turno, contra PostgreSQL
// real (Alcance C del plan de pagos, corregido tras la auditoría
// CN-20260926-012). Cubre lo que ningún test con Prisma simulado puede
// probar de verdad: que la fila `PlatformSettings` insertada por la
// migración existe, que un cambio del admin (`PATCH /api/admin/settings`)
// no altera un turno ya publicado, que un turno anterior a la migración
// (backfill a 0%) nunca cobra comisión sin importar el ajuste global
// vigente, que 8 `PATCH` concurrentes dejan una cadena de auditoría
// coherente, y que ninguna respuesta del trabajador filtra comisión/IGV.
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

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('comisión de Chambeaya congelada al publicar, contra PostgreSQL real', () => {
  const prisma = new PrismaClient();
  const verifier = new PrismaClient();
  const app = createApp({
    authService: new DatabaseAuthService(prisma),
    businessService: new DatabaseBusinessService(prisma),
    marketplaceService: new DatabaseMarketplaceService(prisma),
  });

  let businessToken = '';
  let adminToken = '';
  let databaseReady = false;
  let workerCounter = 0;

  beforeAll(async () => {
    requireTestDatabase();
    await prisma.$connect();
    await verifier.$connect();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    // La migración inserta esta fila; una corrida anterior de esta misma
    // suite puede haberla dejado en un valor distinto de 1000/1800.
    await prisma.platformSettings.upsert({
      where: { id: 'global' },
      update: { commissionBps: 1000, taxBps: 1800, updatedById: null },
      create: { id: 'global', commissionBps: 1000, taxBps: 1800 },
    });
    databaseReady = true;

    const salt = 'payment-commission-salt';
    await prisma.user.create({
      data: {
        email: 'empresa.comision@chambeaya.test',
        passwordHash: hashPassword('Empresa123', salt),
        salt,
        role: 'BUSINESS',
        name: 'Empresa de comisión',
        identifier: '20666666666',
      },
    });
    const businessLogin = await request(app).post('/api/auth/login').send({ email: 'empresa.comision@chambeaya.test', password: 'Empresa123' });
    expect(businessLogin.status).toBe(200);
    businessToken = businessLogin.body.token as string;

    const adminSalt = 'payment-commission-admin-salt';
    await prisma.user.create({
      data: {
        email: 'admin.comision@chambeaya.test',
        passwordHash: hashPassword('Admin12345', adminSalt),
        salt: adminSalt,
        role: 'ADMIN',
        name: 'Superadmin de comisión',
        identifier: 'ADMIN-COMISION-0001',
      },
    });
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin.comision@chambeaya.test', password: 'Admin12345' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.token as string;
  });

  afterAll(async () => {
    // `TRUNCATE ... CASCADE` también vacía `PlatformSettings`/
    // `PlatformSettingChange` (tienen una FK hacia `User`): no hace falta
    // (ni es válido) restaurar la fila `global` después de esto. La próxima
    // suite de integración que la necesite la reinserta en su propio
    // `beforeAll` (mismo patrón que este archivo), o usa el valor por
    // defecto defensivo de `getPlatformSettings` si no lo hace.
    if (databaseReady) await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    await Promise.all([prisma.$disconnect(), verifier.$disconnect()]);
  });

  async function registerWorker() {
    workerCounter += 1;
    const response = await request(app).post('/api/auth/register').send({
      role: 'WORKER',
      name: `Trabajador de comisión ${workerCounter}`,
      email: `trabajador.comision.${workerCounter}@chambeaya.test`,
      password: 'Trabajador123',
      dniOrRuc: `5000${String(workerCounter).padStart(4, '0')}`,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  async function createShift(input: { title: string; startsAt: Date; endsAt: Date; payCents: number }) {
    // BAJO-1 de CN-20260926-014: `expectedCommissionBps`/`expectedTaxBps`
    // son obligatorios al crear. Se leen del ajuste global vigente AHORA
    // MISMO (no un valor fijo) para que este helper siga funcionando aunque
    // otro test de este archivo deje el ajuste en un valor distinto de
    // 1000/1800.
    const current = await verifier.platformSettings.findUniqueOrThrow({ where: { id: 'global' } });
    const response = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        title: input.title,
        location: 'Miraflores, Lima',
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        payCents: input.payCents,
        requiredWorkers: 1,
        description: 'Turno de prueba de integración de la comisión de Chambeaya.',
        requirements: 'Disponibilidad completa para el horario indicado.',
        expectedCommissionBps: current.commissionBps,
        expectedTaxBps: current.taxBps,
      });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function applyAndAccept(shiftId: string, workerToken: string) {
    const application = await request(app)
      .post(`/api/shifts/${shiftId}/applications`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ answers: [] });
    expect(application.status).toBe(201);
    const accepted = await request(app)
      .patch(`/api/business/shifts/${shiftId}/applications/${application.body.id}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ decision: 'ACCEPTED' });
    expect(accepted.status).toBe(200);
    const mine = await request(app).get('/api/workers/applications').set('Authorization', `Bearer ${workerToken}`);
    const assignment = mine.body.find((item: { shiftId: string }) => item.shiftId === shiftId).assignment as { id: string; checkInCredential: string };
    return { applicationId: application.body.id as string, assignmentId: assignment.id, credential: assignment.checkInCredential };
  }

  const confirm = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/confirm`).set('Authorization', `Bearer ${token}`);
  const checkIn = (shiftId: string, token: string, credential: string) => request(app).post(`/api/shifts/${shiftId}/check-in`).set('Authorization', `Bearer ${token}`).send({ credential });
  const checkOut = (shiftId: string, token: string) => request(app).post(`/api/shifts/${shiftId}/check-out`).set('Authorization', `Bearer ${token}`);

  it('freezes the commission/tax at publish time: a PATCH to /api/admin/settings before the checkout does not change this payment', async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Anfitrión con comisión congelada', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
    const publishedShift = await verifier.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(publishedShift).toMatchObject({ commissionBps: 1000, taxBps: 1800 });

    const workerToken = await registerWorker();
    const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);

    // El admin cambia el ajuste global DESPUÉS de publicar el turno pero
    // ANTES del check-out: no debe afectar a este pago.
    const patch = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ commissionBps: 2500 });
    expect(patch.status).toBe(200);
    expect(patch.body.commissionBps).toBe(2500);

    expect((await confirm(shiftId, workerToken)).status).toBe(200);
    expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
    expect((await checkOut(shiftId, workerToken)).status).toBe(200);

    const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });
    expect(payment).toMatchObject({
      amountCents: 10000, commissionBps: 1000, commissionCents: 1000, taxBps: 1800, taxCents: 180, totalCents: 11180, provider: 'manual',
    });

    // Restaura el ajuste global para no contaminar las demás pruebas de este archivo.
    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1000, taxBps: 1800 } });
  });

  it('resolveAssignment COMPLETED (cierre manual de un NO_SHOW) computes the same frozen 10%/18%', async () => {
    const now = Date.now();
    // Turno de un cupo que empezó hace 3 horas (ventana de check-in ya
    // cerrada) y termina en 5: nunca hizo check-in, así que la próxima vez
    // que algo lo toque queda NO_SHOW.
    const shiftId = await createShift({ title: 'Turno con ausente', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
    const workerToken = await registerWorker();
    const { assignmentId } = await applyAndAccept(shiftId, workerToken);
    await verifier.shiftAssignment.update({ where: { id: assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR), workerConfirmedAt: new Date(now - 4 * HOUR) } });

    // Abrir el panel de la empresa resuelve el ciclo de vida: NO_SHOW.
    const panel = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
    expect(panel.status).toBe(200);
    expect(await (await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('NO_SHOW');

    const resolved = await request(app)
      .post(`/api/business/shifts/${shiftId}/assignments/${assignmentId}/resolve`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ outcome: 'COMPLETED', reason: 'El cliente confirmó que sí trabajó' });
    expect(resolved.status).toBe(200);

    const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });
    expect(payment).toMatchObject({
      amountCents: 10000, commissionBps: 1000, commissionCents: 1000, taxBps: 1800, taxCents: 180, totalCents: 11180, provider: 'manual',
    });
  });

  // MEDIO-2 de CN-20260926-012 (decisión del usuario): un turno anterior a
  // la migración de comisiones se cobra SIN comisión (0%, no el ajuste
  // global). `Shift.commissionBps`/`taxBps` son `NOT NULL` desde esa misma
  // migración (backfill a 0/0 sobre los turnos que no tenían valor), así
  // que ya no existe ningún respaldo al ajuste global: se simula ese turno
  // "legacy" con 0/0 directamente (no se puede escribir `NULL`: la columna
  // ya no lo admite) y se verifica que el pago sale con comisión e IGV en 0
  // aunque el ajuste global vigente sea otro.
  it('a shift backfilled with 0% commission (pre-migration) charges no commission regardless of the current global rate', async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Turno anterior a la migración', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
    await verifier.shift.update({ where: { id: shiftId }, data: { commissionBps: 0, taxBps: 0 } });
    // El ajuste global vigente AHORA es distinto de 0, a propósito, para
    // distinguir "el turno usa su propio 0%" de "casualmente coincidió".
    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1500, taxBps: 1800 } });

    const workerToken = await registerWorker();
    const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
    expect((await confirm(shiftId, workerToken)).status).toBe(200);
    expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
    expect((await checkOut(shiftId, workerToken)).status).toBe(200);

    const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });
    expect(payment).toMatchObject({ amountCents: 10000, commissionBps: 0, commissionCents: 0, taxBps: 0, taxCents: 0, totalCents: 10000 });

    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1000, taxBps: 1800 } });
  });

  it("the worker's wallet never exposes commission or tax, only their own 100% amount", async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Turno para la billetera', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
    const workerToken = await registerWorker();
    const { credential } = await applyAndAccept(shiftId, workerToken);
    expect((await confirm(shiftId, workerToken)).status).toBe(200);
    expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
    expect((await checkOut(shiftId, workerToken)).status).toBe(200);

    const wallet = await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${workerToken}`);
    expect(wallet.status).toBe(200);
    const movement = wallet.body.movements.find((item: { amountCents: number }) => item.amountCents === 10000);
    expect(movement).toBeDefined();
    expect(movement).not.toHaveProperty('commissionBps');
    expect(movement).not.toHaveProperty('commissionCents');
    expect(movement).not.toHaveProperty('taxBps');
    expect(movement).not.toHaveProperty('taxCents');
    expect(movement).not.toHaveProperty('totalCents');
    expect(JSON.stringify(wallet.body)).not.toContain('commission');
  });

  it('PATCH /api/admin/settings requires ADMIN, validates the range, and records an audit trail entry', async () => {
    const forbidden = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ commissionBps: 1500 });
    expect(forbidden.status).toBe(403);

    const outOfRange = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ commissionBps: 5001 });
    expect(outOfRange.status).toBe(400);

    const before = await verifier.platformSettings.findUniqueOrThrow({ where: { id: 'global' } });
    const changed = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ commissionBps: 1300 });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ commissionBps: 1300, taxBps: 1800 });

    const auditRows = await verifier.platformSettingChange.findMany({ where: { field: 'commissionBps' }, orderBy: { createdAt: 'desc' } });
    expect(auditRows[0]).toMatchObject({ oldValue: String(before.commissionBps), newValue: '1300' });

    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1000, taxBps: 1800 } });
  });

  // MEDIO-1 de CN-20260926-012: un `upsert` con `update: {}` no bloqueaba la
  // fila bajo `READ COMMITTED`, así que 8 `PATCH` concurrentes leían el
  // mismo `oldValue` (reproducido por la auditoría: 6 de 8 duplicados). Con
  // el `SELECT ... FOR UPDATE` dentro de la transacción, la cadena
  // `oldValue -> newValue` de la auditoría debe reconstruir exactamente la
  // secuencia real de valores por los que pasó `commissionBps`, sin
  // huecos ni duplicados, y el valor final debe ser el de quien terminó
  // último (todas responden 200: no hay reintento visible al cliente).
  it('8 PATCH /api/admin/settings concurrentes producen una cadena de auditoría oldValue->newValue coherente, sin oldValue duplicados', async () => {
    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1000, taxBps: 1800 } });
    const before = await verifier.platformSettingChange.count();

    const candidateValues = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800];
    const responses = await Promise.all(candidateValues.map((commissionBps) =>
      request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`).send({ commissionBps })));

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const auditRows = await verifier.platformSettingChange.findMany({
      where: { field: 'commissionBps' },
      orderBy: { createdAt: 'asc' },
      skip: before,
    });
    expect(auditRows).toHaveLength(8);

    // Cadena coherente: cada `oldValue` (salvo el primero) debe ser el
    // `newValue` de la entrada inmediatamente anterior -ninguna transacción
    // "vio" un valor que otra ya había reemplazado sin que quedara
    // registrado entre medias- y no puede haber dos `oldValue` iguales
    // (eso es exactamente lo que el bloqueo de fila impide).
    const oldValues = auditRows.map((row) => row.oldValue);
    expect(new Set(oldValues).size).toBe(oldValues.length);
    for (let index = 1; index < auditRows.length; index += 1) {
      expect(auditRows[index]!.oldValue).toBe(auditRows[index - 1]!.newValue);
    }
    expect(oldValues[0]).toBe('1000');

    const finalSettings = await verifier.platformSettings.findUniqueOrThrow({ where: { id: 'global' } });
    expect(finalSettings.commissionBps).toBe(Number(auditRows[auditRows.length - 1]!.newValue));
    expect(candidateValues).toContain(finalSettings.commissionBps);

    await prisma.platformSettings.update({ where: { id: 'global' }, data: { commissionBps: 1000, taxBps: 1800 } });
  });

  // ALTO-1 de CN-20260926-012: el trabajador nunca debe recibir la comisión,
  // el IGV, el total ni el `provider`/`needsReview` de un pago. Contra
  // Postgres real (no un doble simulado), recorre CADA respuesta que puede
  // devolver una ruta de `/api/workers/*` o `/api/shifts*` en un flujo
  // completo (turno con comisión -> postulación -> conversación -> check-in
  // -> check-out -> pago marcado `PROCESSED` por la empresa -> el
  // trabajador lo confirma) y falla si aparece cualquier clave prohibida a
  // cualquier profundidad.
  const FORBIDDEN_KEYS = ['commissionBps', 'commissionCents', 'taxBps', 'taxCents', 'totalCents', 'provider', 'needsReview'];
  function findForbiddenKeyPaths(value: unknown, path = '$'): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeyPaths(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
        const here = FORBIDDEN_KEYS.includes(key) ? [`${path}.${key}`] : [];
        return [...here, ...findForbiddenKeyPaths(nested, `${path}.${key}`)];
      });
    }
    return [];
  }
  function expectNoLeak(label: string, body: unknown) {
    const leaks = findForbiddenKeyPaths(body);
    expect(leaks, `${label} filtró: ${leaks.join(', ')}`).toEqual([]);
  }

  it('no worker-facing response leaks commission, tax, total, provider or needsReview, at any depth, end to end', async () => {
    const now = Date.now();
    const shiftId = await createShift({ title: 'Turno para el escaneo de fuga', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
    const workerToken = await registerWorker();
    const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
    expect((await confirm(shiftId, workerToken)).status).toBe(200);
    expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
    expect((await checkOut(shiftId, workerToken)).status).toBe(200);

    const businessPayments = await request(app).get('/api/business/payments').set('Authorization', `Bearer ${businessToken}`);
    expect(businessPayments.status).toBe(200);
    const payment = businessPayments.body.find((item: { assignmentId: string | null }) => item.assignmentId === assignmentId);
    expect(payment).toBeDefined();
    // El negocio SÍ ve la comisión (la paga): esto no es una fuga, es la
    // regla contraria (la empresa siempre la ve). Se marca PROCESSED para
    // poder ejercer `confirmPayment` como trabajador a continuación.
    const markProcessed = await request(app)
      .patch(`/api/business/payments/${payment.id}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ status: 'PROCESSED' });
    expect(markProcessed.status).toBe(200);

    const shiftsFeed = await request(app).get('/api/shifts');
    expectNoLeak('GET /api/shifts', shiftsFeed.body);

    const activeShift = await request(app).get('/api/shifts/active').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/shifts/active', activeShift.body);

    const applications = await request(app).get('/api/workers/applications').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/applications', applications.body);

    const conversationsList = await request(app).get('/api/workers/conversations').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/conversations', conversationsList.body);
    const conversationId = conversationsList.body[0]?.id as string | undefined;
    expect(conversationId).toBeDefined();

    const conversationDetail = await request(app).get(`/api/workers/conversations/${conversationId}`).set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/conversations/:id', conversationDetail.body);

    const confirmPaymentResponse = await request(app)
      .post(`/api/workers/payments/${payment.id}/confirm`)
      .set('Authorization', `Bearer ${workerToken}`);
    expect(confirmPaymentResponse.status).toBe(200);
    expectNoLeak('POST /api/workers/payments/:id/confirm', confirmPaymentResponse.body);
    expect(confirmPaymentResponse.body).toMatchObject({ amountCents: 10000, shiftId });

    // Idempotencia: confirmar de nuevo (ya confirmado) tampoco filtra nada.
    const confirmAgain = await request(app)
      .post(`/api/workers/payments/${payment.id}/confirm`)
      .set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('POST /api/workers/payments/:id/confirm (repetido)', confirmAgain.body);

    const wallet = await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/wallet', wallet.body);

    const availability = await request(app).get('/api/workers/availability').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/availability', availability.body);
  });
});
