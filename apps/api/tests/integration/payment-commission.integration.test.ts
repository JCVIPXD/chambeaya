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
    // Este archivo registra muchos trabajadores a lo largo de todo su
    // recorrido (un `registerWorker()` por caso); el límite de intentos de
    // `/api/auth/*` (20 cada 15 min, pensado para proteger login/registro
    // reales) no es lo que se está probando aquí, y con las pruebas nuevas
    // de esta corrección ya lo supera. Mismo patrón que el resto de
    // `apps/api/tests/integration` (p. ej. `worker-assignment-load`).
    rateLimit: false,
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
    // regla contraria (la empresa siempre la ve). Se marca pagado (Alcance
    // D: `mark-paid`, el CRUD manual con `PATCH` ya no existe) para poder
    // ejercer `confirmPayment` como trabajador a continuación.
    const markProcessed = await request(app)
      .post(`/api/business/payments/${payment.id}/mark-paid`)
      .set('Authorization', `Bearer ${businessToken}`);
    expect(markProcessed.status).toBe(200);
    expect(markProcessed.body.status).toBe('PROCESSED');

    const walletBeforeConfirm = await request(app).get('/api/workers/wallet').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/wallet', walletBeforeConfirm.body);
    const walletPayment = walletBeforeConfirm.body.movements.find((item: { id: string }) => item.id === payment.id);
    expect(walletPayment).toMatchObject({ canConfirmReceipt: true, receiptConfirmed: false });

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
    const confirmedWalletPayment = wallet.body.movements.find((item: { id: string }) => item.id === payment.id);
    expect(confirmedWalletPayment).toMatchObject({ canConfirmReceipt: false, receiptConfirmed: true });

    const availability = await request(app).get('/api/workers/availability').set('Authorization', `Bearer ${workerToken}`);
    expectNoLeak('GET /api/workers/availability', availability.body);
  });

  // Alcance D: registro confiable y modo manual. El CRUD manual de pagos se
  // retira (nunca vuelve a existir un `POST`/`PATCH`/`DELETE` en este
  // router); el único escritor que le queda a la empresa es `mark-paid`.
  describe('Alcance D: mark-paid y GET /api/admin/commissions', () => {
    it('POST/PATCH/DELETE /api/business/payments[/:id] ya no existen (404)', async () => {
      expect((await request(app).post('/api/business/payments').set('Authorization', `Bearer ${businessToken}`).send({})).status).toBe(404);
      expect((await request(app).patch('/api/business/payments/x').set('Authorization', `Bearer ${businessToken}`).send({})).status).toBe(404);
      expect((await request(app).delete('/api/business/payments/x').set('Authorization', `Bearer ${businessToken}`)).status).toBe(404);
    });

    it('mark-paid transiciona un pago manual PENDING a PROCESSED y registra un único PAYMENT_REPORTED', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno para mark-paid', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
      expect((await confirm(shiftId, workerToken)).status).toBe(200);
      expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
      expect((await checkOut(shiftId, workerToken)).status).toBe(200);
      const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });
      expect(payment.status).toBe('PENDING');

      const marked = await request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`);
      expect(marked.status).toBe(200);
      expect(marked.body).toMatchObject({ id: payment.id, status: 'PROCESSED' });
      expect(marked.body.processedAt).toBeTruthy();

      const events = await verifier.shiftEvent.findMany({ where: { shiftId, type: 'PAYMENT_REPORTED' } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ detail: payment.id, actorRole: 'BUSINESS' });

      // Repetir la llamada (ya PROCESSED) responde 409 sin duplicar el evento.
      const again = await request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`);
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ error: 'PAYMENT_NOT_PAYABLE' });
      expect(await verifier.shiftEvent.count({ where: { shiftId, type: 'PAYMENT_REPORTED' } })).toBe(1);
    });

    it('dos mark-paid concurrentes sobre el mismo pago producen un solo PROCESSED y un solo PAYMENT_REPORTED', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno para la carrera de mark-paid', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
      expect((await confirm(shiftId, workerToken)).status).toBe(200);
      expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
      expect((await checkOut(shiftId, workerToken)).status).toBe(200);
      const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });

      const [first, second] = await Promise.all([
        request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`),
        request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const finalPayment = await verifier.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(finalPayment.status).toBe('PROCESSED');
      expect(await verifier.shiftEvent.count({ where: { shiftId, type: 'PAYMENT_REPORTED' } })).toBe(1);
    });

    it('mark-paid acepta un pago legacy PENDING (backfill sin assignmentId) sin tocar ningún monto ni crear ShiftEvent', async () => {
      const company = await verifier.company.findFirstOrThrow({ where: { owner: { email: 'empresa.comision@chambeaya.test' } } });
      const legacy = await prisma.payment.create({
        data: {
          companyId: company.id, reference: `LEGACY-${Date.now()}`, description: 'Pago legacy de prueba',
          amountCents: 5000, provider: 'legacy', commissionBps: 0, commissionCents: 0, taxBps: 0, taxCents: 0, totalCents: 5000,
          status: 'PENDING',
        },
      });

      const marked = await request(app).post(`/api/business/payments/${legacy.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`);
      expect(marked.status).toBe(200);
      expect(marked.body).toMatchObject({ id: legacy.id, status: 'PROCESSED', amountCents: 5000, commissionCents: 0, taxCents: 0 });
      expect(await verifier.shiftEvent.count({ where: { detail: legacy.id } })).toBe(0);
    });

    it('mark-paid responde 404 para un pago de otra empresa y 409 para uno CANCELLED', async () => {
      const otherCompanySalt = 'otra-empresa-salt';
      await prisma.user.create({
        data: {
          email: 'otra.empresa.comision@chambeaya.test', passwordHash: hashPassword('OtraEmpresa123', otherCompanySalt), salt: otherCompanySalt,
          role: 'BUSINESS', name: 'Otra empresa', identifier: '20777777777',
        },
      });
      const otherLogin = await request(app).post('/api/auth/login').send({ email: 'otra.empresa.comision@chambeaya.test', password: 'OtraEmpresa123' });
      const otherToken = otherLogin.body.token as string;

      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno de la empresa dueña', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
      expect((await confirm(shiftId, workerToken)).status).toBe(200);
      expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
      expect((await checkOut(shiftId, workerToken)).status).toBe(200);
      const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });

      const foreign = await request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${otherToken}`);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({ error: 'PAYMENT_NOT_FOUND' });

      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
      const cancelled = await request(app).post(`/api/business/payments/${payment.id}/mark-paid`).set('Authorization', `Bearer ${businessToken}`);
      expect(cancelled.status).toBe(409);
      expect(cancelled.body).toEqual({ error: 'PAYMENT_NOT_PAYABLE' });
    });

    // MEDIO-1 de CN-20260926-020: `closedWithoutPayment` es una señal
    // estructurada en `ShiftAssignment` (`closedWithoutPayment`/`At`/`ById`),
    // nunca un texto en `ShiftEvent.detail`. Los seis casos siguientes cubren
    // exactamente los caminos pedidos por la auditoría.
    it('resolveAssignment CANCELLED sobre NO_SHOW marca closedWithoutPayment con la fecha y el actor correctos', async () => {
      const now = Date.now();
      const noShowShiftId = await createShift({ title: 'Turno cerrado sin pago (no-show)', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId } = await applyAndAccept(noShowShiftId, workerToken);
      await verifier.shiftAssignment.update({ where: { id: assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR), workerConfirmedAt: new Date(now - 4 * HOUR) } });
      const panel = await request(app).get(`/api/business/shifts/${noShowShiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
      expect(panel.status).toBe(200);
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('NO_SHOW');

      const before = new Date();
      const resolvedAsCancelled = await request(app)
        .post(`/api/business/shifts/${noShowShiftId}/assignments/${assignmentId}/resolve`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ outcome: 'CANCELLED', reason: 'No llegó y no hay evidencia de que trabajara' });
      expect(resolvedAsCancelled.status).toBe(200);
      expect(await verifier.payment.findFirst({ where: { assignmentId } })).toBeNull();

      const closed = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(closed.closedWithoutPayment).toBe(true);
      expect(closed.closedWithoutPaymentAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      const business = await verifier.company.findFirstOrThrow({ where: { owner: { email: 'empresa.comision@chambeaya.test' } } });
      expect(closed.closedWithoutPaymentById).toBe(business.ownerId);
    });

    // La ventana de `ABANDONED` (60 min tras `endsAt`) se fuerza moviendo
    // `endsAt` al pasado DESPUÉS de un check-in real, en vez de esperar una
    // hora de reloj real.
    it('resolveAssignment CANCELLED sobre ABANDONED también marca closedWithoutPayment', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno cerrado sin pago (abandonado)', startsAt: new Date(now - 10 * MINUTE), endsAt: new Date(now + 20 * MINUTE), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
      expect((await confirm(shiftId, workerToken)).status).toBe(200);
      expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);

      // Empuja `endsAt` bien al pasado (sin pasar por la API, que rechaza un
      // `endsAt` ya vencido): `abandonedAt = endsAt + 60 min` queda en el
      // pasado y el próximo refresco del panel marca ABANDONED.
      await prisma.shift.update({ where: { id: shiftId }, data: { endsAt: new Date(now - 2 * HOUR) } });
      const panel = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
      expect(panel.status).toBe(200);
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ABANDONED');

      const resolvedAsCancelled = await request(app)
        .post(`/api/business/shifts/${shiftId}/assignments/${assignmentId}/resolve`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ outcome: 'CANCELLED', reason: 'Hizo check-in y nunca volvió' });
      expect(resolvedAsCancelled.status).toBe(200);

      const closed = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(closed.closedWithoutPayment).toBe(true);
      expect(closed.closedWithoutPaymentAt).not.toBeNull();
    });

    // "Ocultar, segunda vía" de la auditoría: antes, `cancelShift` arrastraba
    // una `NO_SHOW` sin resolver a `CANCELLED` sin dejar ninguna señal.
    it('cancelShift arrastrando una NO_SHOW sin resolver también la marca closedWithoutPayment', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno cancelado con NO_SHOW arrastrada', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId } = await applyAndAccept(shiftId, workerToken);
      await verifier.shiftAssignment.update({ where: { id: assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR), workerConfirmedAt: new Date(now - 4 * HOUR) } });
      const panel = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
      expect(panel.status).toBe(200);
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('NO_SHOW');

      const cancelled = await request(app)
        .post(`/api/business/shifts/${shiftId}/cancel`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ reason: 'Se cerró el local; de todas formas nadie llegó' });
      expect(cancelled.status).toBe(200);

      const closed = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(closed.status).toBe('CANCELLED');
      expect(closed.closedWithoutPayment).toBe(true);
      expect(closed.closedWithoutPaymentAt).not.toBeNull();
    });

    // Una `ASSIGNED` simple (nunca llegó a "presentarse o no") nunca cuenta,
    // ni con un motivo que use textualmente el prefijo que usaba la versión
    // anterior ("falsear, primera vía" de la auditoría): ya no se lee
    // ningún texto, así que ese motivo no tiene ningún efecto.
    it('cancelShift antes de que la asignación llegue a NO_SHOW nunca marca closedWithoutPayment, ni con un motivo que imite el prefijo retirado', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno cancelado antes de empezar', startsAt: new Date(now + HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId } = await applyAndAccept(shiftId, workerToken);
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ASSIGNED');

      const cancelled = await request(app)
        .post(`/api/business/shifts/${shiftId}/cancel`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ reason: 'Cierre manual sin pago de una asignación: esto ya no debería alterar nada' });
      expect(cancelled.status).toBe(200);

      const closed = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(closed.status).toBe('CANCELLED');
      expect(closed.closedWithoutPayment).toBe(false);
      expect(closed.closedWithoutPaymentAt).toBeNull();
    });

    // "Ocultar, primera vía": una NO_SHOW/ABANDONED que la empresa nunca
    // resuelve no debe poder desaparecer del reporte. `pendingResolution` la
    // mantiene visible, sin necesitar ningún filtro de fecha.
    it('una NO_SHOW nunca resuelta aparece como pendingResolution en el reporte, sin filtrar por fecha', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno con NO_SHOW pendiente de decisión', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      await applyAndAccept(shiftId, workerToken);
      const application = await verifier.shiftApplication.findFirstOrThrow({ where: { shiftId } });
      await verifier.shiftAssignment.update({
        where: { applicationId: application.id },
        data: { assignedAt: new Date(now - 4 * HOUR), workerConfirmedAt: new Date(now - 4 * HOUR) },
      });
      const panel = await request(app).get(`/api/business/shifts/${shiftId}/applications`).set('Authorization', `Bearer ${businessToken}`);
      expect(panel.status).toBe(200);

      const company = await verifier.company.findFirstOrThrow({ where: { owner: { email: 'empresa.comision@chambeaya.test' } } });
      const oldPeriodReport = await request(app)
        .get('/api/admin/commissions')
        .query({ from: '2020-01-01', to: '2020-01-31' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(oldPeriodReport.status).toBe(200);
      const companyRow = oldPeriodReport.body.companies.find((row: { companyId: string }) => row.companyId === company.id);
      expect(companyRow).toBeDefined();
      expect(companyRow.pendingResolution).toBeGreaterThanOrEqual(1);
    });

    // MEDIO-1 (nuevo) de CN-20260926-022, reproducido exactamente como lo
    // hizo la auditoría: una asignación cuya ventana de check-in ya venció,
    // pero que NADIE volvió a tocar (nunca se abrió el panel de
    // postulaciones, nunca se llamó a `resolve`), sigue `ASSIGNED` en la
    // base -`NO_SHOW`/`ABANDONED` son perezosos-. El reporte debe contarla
    // igual, sin necesitar esa lectura previa.
    it('una asignación ASSIGNED con la ventana de check-in ya vencida, que nadie resolvió todavía, cuenta como pendingResolution sin haberla tocado antes', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno ASSIGNED con ventana vencida, sin tocar', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId } = await applyAndAccept(shiftId, workerToken);
      // Ventana de check-in vencida (`assignedAt` bien en el pasado), pero
      // sin abrir el panel ni llamar a `resolve`: a propósito, para que
      // ningún código intermedio persista el `NO_SHOW` antes del reporte.
      await prisma.shiftAssignment.update({ where: { id: assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR) } });
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ASSIGNED');

      const company = await verifier.company.findFirstOrThrow({ where: { owner: { email: 'empresa.comision@chambeaya.test' } } });
      const report = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${adminToken}`);
      expect(report.status).toBe(200);
      const companyRow = report.body.companies.find((row: { companyId: string }) => row.companyId === company.id);
      expect(companyRow?.pendingResolution).toBeGreaterThanOrEqual(1);

      // El reporte es de solo lectura: no debe haber persistido nada.
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ASSIGNED');
    });

    // La misma asignación de arriba, pero la empresa cancela el turno
    // completo (`cancelShift`) SIN haber abierto antes las postulaciones:
    // debe quedar `closedWithoutPayment`, no solo `CANCELLED` a secas (era
    // exactamente la vía que reprodujo la auditoría).
    it('cancelShift sobre un turno cuya única asignación tiene la ventana vencida (sin resolver antes) la marca closedWithoutPayment', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno ASSIGNED con ventana vencida, cancelado sin resolver antes', startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now + 5 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId } = await applyAndAccept(shiftId, workerToken);
      await prisma.shiftAssignment.update({ where: { id: assignmentId }, data: { assignedAt: new Date(now - 4 * HOUR) } });
      expect((await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ASSIGNED');

      const cancelled = await request(app)
        .post(`/api/business/shifts/${shiftId}/cancel`)
        .set('Authorization', `Bearer ${businessToken}`)
        .send({ reason: 'Se cerró el local; nunca abrimos el panel de postulaciones' });
      expect(cancelled.status).toBe(200);

      const closed = await verifier.shiftAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(closed.status).toBe('CANCELLED');
      expect(closed.closedWithoutPayment).toBe(true);
      expect(closed.closedWithoutPaymentAt).not.toBeNull();

      const company = await verifier.company.findFirstOrThrow({ where: { owner: { email: 'empresa.comision@chambeaya.test' } } });
      const report = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${adminToken}`);
      const companyRow = report.body.companies.find((row: { companyId: string }) => row.companyId === company.id);
      expect(companyRow?.closedWithoutPayment).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/admin/commissions totaliza "por facturar" (manual) por empresa y período, y excluye legacy', async () => {
      const uniqueSuffix = `${Date.now()}`;
      const companyASalt = `salt-a-${uniqueSuffix}`;
      await prisma.user.create({
        data: {
          email: `empresa.a.${uniqueSuffix}@chambeaya.test`, passwordHash: hashPassword('EmpresaA1234', companyASalt), salt: companyASalt,
          role: 'BUSINESS', name: 'Empresa A del reporte', identifier: `2088${uniqueSuffix}`.slice(0, 11),
        },
      });
      const loginA = await request(app).post('/api/auth/login').send({ email: `empresa.a.${uniqueSuffix}@chambeaya.test`, password: 'EmpresaA1234' });
      const tokenA = loginA.body.token as string;

      const settings = await verifier.platformSettings.findUniqueOrThrow({ where: { id: 'global' } });
      // `Company` nace perezosamente (`companyFor`, un `upsert`) en la
      // primera llamada autenticada que la necesita -aquí, crear el
      // turno-, nunca en el registro/login: leerla antes de esa llamada
      // encontraría 0 filas.
      const shift = await request(app).post('/api/business/shifts').set('Authorization', `Bearer ${tokenA}`).send({
        title: 'Turno del reporte de comisiones', location: 'San Isidro, Lima',
        startsAt: new Date(Date.now() + 10 * MINUTE).toISOString(), endsAt: new Date(Date.now() + 8 * HOUR).toISOString(),
        payCents: 20000, requiredWorkers: 1,
        description: 'Turno de prueba de integración del reporte de comisiones.',
        requirements: 'Disponibilidad completa para el horario indicado.',
        expectedCommissionBps: settings.commissionBps, expectedTaxBps: settings.taxBps,
      });
      expect(shift.status).toBe(201);
      const companyA = await verifier.company.findFirstOrThrow({ where: { owner: { email: `empresa.a.${uniqueSuffix}@chambeaya.test` } } });
      const workerToken = await registerWorker();
      const application = await request(app).post(`/api/shifts/${shift.body.id}/applications`).set('Authorization', `Bearer ${workerToken}`).send({ answers: [] });
      const accepted = await request(app).patch(`/api/business/shifts/${shift.body.id}/applications/${application.body.id}`).set('Authorization', `Bearer ${tokenA}`).send({ decision: 'ACCEPTED' });
      expect(accepted.status).toBe(200);
      const mine = await request(app).get('/api/workers/applications').set('Authorization', `Bearer ${workerToken}`);
      const assignment = mine.body.find((item: { shiftId: string }) => item.shiftId === shift.body.id).assignment as { id: string; checkInCredential: string };
      expect((await confirm(shift.body.id, workerToken)).status).toBe(200);
      expect((await checkIn(shift.body.id, workerToken, assignment.checkInCredential)).status).toBe(200);
      expect((await checkOut(shift.body.id, workerToken)).status).toBe(200);
      const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
      expect(payment).toMatchObject({ amountCents: 20000, commissionCents: 2000, taxCents: 360 });

      // Fuera del período consultado más abajo: no debe sumar a los totales.
      const outOfRangeDate = new Date('2020-01-01T00:00:00.000Z');
      await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: outOfRangeDate } });

      const outOfRange = await request(app).get('/api/admin/commissions').query({ from: '2026-01-01', to: '2026-12-31' }).set('Authorization', `Bearer ${adminToken}`);
      expect(outOfRange.status).toBe(200);
      expect(outOfRange.body.companies.find((row: { companyId: string }) => row.companyId === companyA.id)).toBeUndefined();

      // Sin filtro de fecha, sí debe aparecer con la comisión/IGV correctos,
      // marcado como "por facturar" aunque siga PENDING (no se ha marcado
      // pagado): el modo manual no cobra nada por la app.
      const allTime = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${adminToken}`);
      expect(allTime.status).toBe(200);
      const companyRow = allTime.body.companies.find((row: { companyId: string }) => row.companyId === companyA.id);
      expect(companyRow).toMatchObject({ name: 'Empresa A del reporte', toInvoiceCents: 2000, toInvoiceTaxCents: 360, collectedCents: 0, pendingCollectionCents: 0, payments: 1 });
    });

    // Corrección de ALTO-1 de CN-20260926-020, contra Postgres real: los
    // límites son de calendario de LIMA, no de UTC. Antes, `to: '2026-08-31'`
    // se interpretaba como `<= 2026-08-31T00:00:00.000Z` (medianoche UTC =
    // 31/08 19:00 hora Lima) y perdía todo lo ocurrido después de esa hora,
    // hora Lima, del último día.
    it('los límites de from/to son de calendario de Lima: 31/08 23:59:59 Lima entra en agosto; el cambio de año también respeta ese límite', async () => {
      const now = Date.now();
      const shiftId = await createShift({ title: 'Turno para límites de fecha de Lima', startsAt: new Date(now + 10 * MINUTE), endsAt: new Date(now + 8 * HOUR), payCents: 10000 });
      const workerToken = await registerWorker();
      const { assignmentId, credential } = await applyAndAccept(shiftId, workerToken);
      expect((await confirm(shiftId, workerToken)).status).toBe(200);
      expect((await checkIn(shiftId, workerToken, credential)).status).toBe(200);
      expect((await checkOut(shiftId, workerToken)).status).toBe(200);
      const payment = await verifier.payment.findUniqueOrThrow({ where: { assignmentId } });

      const companyId = payment.companyId;
      expect(payment).toMatchObject({ commissionCents: 1000, taxCents: 180 });

      // 31/08 23:59:59 hora Lima = 01/09 04:59:59 UTC: la versión anterior
      // (medianoche UTC) ya lo daba por fuera de agosto; debe seguir DENTRO.
      await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date('2026-08-31T23:59:59.000-05:00') } });
      const august = await request(app).get('/api/admin/commissions').query({ from: '2026-08-01', to: '2026-08-31' }).set('Authorization', `Bearer ${adminToken}`);
      expect(august.status).toBe(200);
      expect(august.body.period).toMatchObject({ fromUtc: '2026-08-01T05:00:00.000Z', toUtcExclusive: '2026-09-01T05:00:00.000Z' });
      const augustBefore = august.body.companies.find((row: { companyId: string }) => row.companyId === companyId);
      expect(augustBefore?.payments).toBeGreaterThanOrEqual(1);

      // 01/09 00:00:00 hora Lima = 01/09 05:00:00 UTC: un segundo después,
      // ya debe quedar FUERA de agosto (comparación relativa: la comisión de
      // ESTE pago, 1000, ya no está incluida) y DENTRO de setiembre.
      await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date('2026-09-01T00:00:00.000-05:00') } });
      const augustAfterMoving = await request(app).get('/api/admin/commissions').query({ from: '2026-08-01', to: '2026-08-31' }).set('Authorization', `Bearer ${adminToken}`);
      const augustAfter = augustAfterMoving.body.companies.find((row: { companyId: string }) => row.companyId === companyId);
      expect((augustAfter?.toInvoiceCents ?? 0)).toBeLessThanOrEqual((augustBefore?.toInvoiceCents ?? 0) - 1000);

      const september = await request(app).get('/api/admin/commissions').query({ from: '2026-09-01', to: '2026-09-30' }).set('Authorization', `Bearer ${adminToken}`);
      const septemberRow = september.body.companies.find((row: { companyId: string }) => row.companyId === companyId);
      expect(septemberRow?.payments).toBeGreaterThanOrEqual(1);

      // Cambio de año: 31/12 23:00 hora Lima cae en diciembre 2026, nunca en enero 2027.
      await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date('2026-12-31T23:00:00.000-05:00') } });
      const december = await request(app).get('/api/admin/commissions').query({ from: '2026-12-01', to: '2026-12-31' }).set('Authorization', `Bearer ${adminToken}`);
      expect(december.body.companies.find((row: { companyId: string }) => row.companyId === companyId)?.payments).toBeGreaterThanOrEqual(1);
      // `pendingResolution` nunca se filtra por período (a propósito, ver el
      // test dedicado más arriba), así que esta empresa puede seguir
      // apareciendo por asignaciones pendientes de otras pruebas de este
      // mismo archivo: lo que debe dar 0 en enero es lo que SÍ depende del
      // período (el pago movido a diciembre).
      const nextJanuary = await request(app).get('/api/admin/commissions').query({ from: '2027-01-01', to: '2027-01-31' }).set('Authorization', `Bearer ${adminToken}`);
      const nextJanuaryRow = nextJanuary.body.companies.find((row: { companyId: string }) => row.companyId === companyId);
      expect(nextJanuaryRow?.toInvoiceCents ?? 0).toBe(0);
      expect(nextJanuaryRow?.payments ?? 0).toBe(0);
    });

    it('GET /api/admin/commissions rechaza un from/to que no sea estrictamente AAAA-MM-DD (una fecha-hora completa ya no se acepta)', async () => {
      const response = await request(app).get('/api/admin/commissions').query({ from: '2026-09-01T00:00:00.000Z' }).set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
    });

    it('GET /api/admin/commissions requiere sesión ADMIN y valida el rango de fechas', async () => {
      const forbidden = await request(app).get('/api/admin/commissions').set('Authorization', `Bearer ${businessToken}`);
      expect(forbidden.status).toBe(403);

      const invalidRange = await request(app).get('/api/admin/commissions').query({ from: '2026-12-31', to: '2026-01-01' }).set('Authorization', `Bearer ${adminToken}`);
      expect(invalidRange.status).toBe(400);
    });
  });
});
