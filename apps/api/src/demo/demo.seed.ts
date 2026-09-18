import { randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { hashPassword } from '../modules/auth/auth.service.js';

const demoEmails = {
  business: 'empresa.demo@chambeaya.local',
  worker: 'trabajador.demo@chambeaya.local',
  admin: 'superadmin@chambeaya.local',
} as const;

const demoPasswords = {
  business: 'Demo2026!',
  worker: 'Demo2026!',
  admin: 'Admin2026!',
} as const;

const ids = {
  flowShift: 'demo-presentation-flow-shift',
  historyShift: 'demo-presentation-history-shift',
  flowConversation: 'demo-presentation-flow-conversation',
} as const;

export const demoPresentation = {
  accounts: {
    business: { email: demoEmails.business, password: demoPasswords.business, role: 'BUSINESS' },
    worker: { email: demoEmails.worker, password: demoPasswords.worker, role: 'WORKER' },
    admin: { email: demoEmails.admin, password: demoPasswords.admin, role: 'ADMIN' },
  },
  ids,
} as const;

type SeedEnvironment = {
  NODE_ENV?: string;
  CHAMBEAYA_ALLOW_DEMO_SEED?: string;
};

/** Prevents an explicit local convenience command from becoming a production mutation. */
export function assertDemoSeedAllowed(environment: SeedEnvironment = process.env) {
  if (environment.NODE_ENV !== 'development') {
    throw new Error('DEMO_SEED_REQUIRES_LOCAL_DEVELOPMENT');
  }
  if (environment.CHAMBEAYA_ALLOW_DEMO_SEED !== 'true') {
    throw new Error('DEMO_SEED_REQUIRES_EXPLICIT_OPT_IN');
  }
}

function passwordRecord(password: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: hashPassword(password, salt) };
}

async function upsertDemoUser(
  prisma: PrismaClient,
  input: { email: string; password: string; name: string; identifier: string; role: 'WORKER' | 'BUSINESS' | 'ADMIN' },
) {
  const password = passwordRecord(input.password);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name, identifier: input.identifier, role: input.role, ...password },
    create: { email: input.email, name: input.name, identifier: input.identifier, role: input.role, ...password },
  });
}

/**
 * Creates only records whose identifiers are reserved for the local product demo.
 * Re-running the seed resets the pending flow so it can be presented again.
 */
export async function seedDemoDatabase(
  prisma: PrismaClient,
  environment: SeedEnvironment = process.env,
) {
  assertDemoSeedAllowed(environment);

  const [business, worker, admin] = await Promise.all([
    upsertDemoUser(prisma, {
      email: demoEmails.business,
      password: demoPasswords.business,
      name: 'Empresa Chambeaya Nueva',
      identifier: '20555555551',
      role: 'BUSINESS',
    }),
    upsertDemoUser(prisma, {
      email: demoEmails.worker,
      password: demoPasswords.worker,
      name: 'Trabajador Demo',
      identifier: '12345678',
      role: 'WORKER',
    }),
    upsertDemoUser(prisma, {
      email: demoEmails.admin,
      password: demoPasswords.admin,
      name: 'Superadmin Demo',
      identifier: '90000001',
      role: 'ADMIN',
    }),
  ]);
  await prisma.authSession.deleteMany({ where: { userId: { in: [business.id, worker.id, admin.id] } } });

  const company = await prisma.company.upsert({
    where: { ownerId: business.id },
    update: {
      name: 'Empresa Chambeaya Nueva', legalName: 'Chambeaya Demo S.A.C.', ruc: '20555555551',
      industry: 'Hospitalidad', phone: '999 000 111', address: 'Av. Demo 123', district: 'Miraflores',
    },
    create: {
      ownerId: business.id, name: 'Empresa Chambeaya Nueva', legalName: 'Chambeaya Demo S.A.C.', ruc: '20555555551',
      industry: 'Hospitalidad', phone: '999 000 111', address: 'Av. Demo 123', district: 'Miraflores',
    },
  });

  await prisma.companySubscription.upsert({
    where: { companyId: company.id },
    update: { plan: 'PILOT', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    create: { companyId: company.id, plan: 'PILOT', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });

  const profile = await prisma.companyWorkerContact.upsert({
    where: { companyId_email: { companyId: company.id, email: worker.email } },
    update: {
      workerUserId: worker.id, name: worker.name, phone: '999 222 333', role: 'Anfitrión/a de eventos',
      skills: ['Atención al cliente', 'Puntualidad'], status: 'AVAILABLE', availability: 'Disponible esta semana',
    },
    create: {
      companyId: company.id, workerUserId: worker.id, name: worker.name, email: worker.email, phone: '999 222 333',
      role: 'Anfitrión/a de eventos', skills: ['Atención al cliente', 'Puntualidad'], status: 'AVAILABLE',
      availability: 'Disponible esta semana',
    },
  });

  const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  startsAt.setHours(9, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);
  const completedStartsAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  completedStartsAt.setHours(9, 0, 0, 0);
  const completedEndsAt = new Date(completedStartsAt.getTime() + 8 * 60 * 60 * 1000);

  const flowShift = await prisma.shift.upsert({
    where: { id: ids.flowShift },
    update: {
      companyId: company.id, title: 'Anfitrión/a de eventos', location: 'Miraflores, Lima', startsAt, endsAt,
      payCents: 12000, requiredWorkers: 1, confirmedWorkers: 0, description: 'Recibe a asistentes y orienta el ingreso durante un evento corporativo.',
      responsibilities: 'Dar la bienvenida\nValidar el ingreso\nOrientar a asistentes', requirements: 'Buena comunicación y disponibilidad completa.',
      screeningQuestions: [], modality: 'PRESENCIAL', notes: 'DEMO_PRESENTACION: flujo pendiente', rescueActive: false, status: 'PUBLISHED',
    },
    create: {
      id: ids.flowShift, companyId: company.id, title: 'Anfitrión/a de eventos', location: 'Miraflores, Lima', startsAt, endsAt,
      payCents: 12000, requiredWorkers: 1, description: 'Recibe a asistentes y orienta el ingreso durante un evento corporativo.',
      responsibilities: 'Dar la bienvenida\nValidar el ingreso\nOrientar a asistentes', requirements: 'Buena comunicación y disponibilidad completa.',
      screeningQuestions: [], modality: 'PRESENCIAL', notes: 'DEMO_PRESENTACION: flujo pendiente', rescueActive: false, status: 'PUBLISHED',
    },
  });

  await prisma.payment.deleteMany({ where: { shiftId: flowShift.id } });
  await prisma.shiftAssignment.deleteMany({ where: { shiftId: flowShift.id } });
  const flowApplication = await prisma.shiftApplication.upsert({
    where: { shiftId_workerId: { shiftId: flowShift.id, workerId: worker.id } },
    update: { status: 'PENDING', screeningAnswers: [] },
    create: { shiftId: flowShift.id, workerId: worker.id, status: 'PENDING', screeningAnswers: [] },
  });
  await prisma.shiftEvent.deleteMany({ where: { shiftId: flowShift.id } });
  await prisma.shiftEvent.createMany({
    data: [
      { shiftId: flowShift.id, actorId: business.id, actorRole: 'BUSINESS', type: 'PUBLISHED', detail: 'DEMO_PRESENTACION' },
      { shiftId: flowShift.id, actorId: worker.id, actorRole: 'WORKER', type: 'APPLICATION_SUBMITTED', detail: flowApplication.id },
    ],
  });

  const conversation = await prisma.conversation.upsert({
    where: { id: ids.flowConversation },
    update: { companyId: company.id, workerId: profile.id, workerUserId: worker.id, shiftId: flowShift.id, subject: 'Postulación · Anfitrión/a de eventos', status: 'OPEN' },
    create: { id: ids.flowConversation, companyId: company.id, workerId: profile.id, workerUserId: worker.id, shiftId: flowShift.id, subject: 'Postulación · Anfitrión/a de eventos', status: 'OPEN' },
  });
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.message.createMany({
    data: [
      { conversationId: conversation.id, sender: 'BUSINESS', body: 'Gracias por postular. Revisaremos tu perfil para este turno.' },
      { conversationId: conversation.id, sender: 'WORKER', body: 'Gracias, tengo disponibilidad completa para el horario indicado.' },
    ],
  });

  const historyShift = await prisma.shift.upsert({
    where: { id: ids.historyShift },
    update: {
      companyId: company.id, title: 'Apoyo de salón', location: 'San Isidro, Lima', startsAt: completedStartsAt, endsAt: completedEndsAt,
      payCents: 10000, requiredWorkers: 1, confirmedWorkers: 1, description: 'Turno completado para mostrar historial y pago confirmado.',
      responsibilities: 'Atender mesas', requirements: 'Experiencia en atención al cliente.', screeningQuestions: [], modality: 'PRESENCIAL',
      notes: 'DEMO_PRESENTACION: historial', rescueActive: false, status: 'COMPLETED',
    },
    create: {
      id: ids.historyShift, companyId: company.id, title: 'Apoyo de salón', location: 'San Isidro, Lima', startsAt: completedStartsAt, endsAt: completedEndsAt,
      payCents: 10000, requiredWorkers: 1, confirmedWorkers: 1, description: 'Turno completado para mostrar historial y pago confirmado.',
      responsibilities: 'Atender mesas', requirements: 'Experiencia en atención al cliente.', screeningQuestions: [], modality: 'PRESENCIAL',
      notes: 'DEMO_PRESENTACION: historial', rescueActive: false, status: 'COMPLETED',
    },
  });
  const historyApplication = await prisma.shiftApplication.upsert({
    where: { shiftId_workerId: { shiftId: historyShift.id, workerId: worker.id } },
    update: { status: 'ACCEPTED', screeningAnswers: [] },
    create: { shiftId: historyShift.id, workerId: worker.id, status: 'ACCEPTED', screeningAnswers: [] },
  });
  const historyAssignment = await prisma.shiftAssignment.upsert({
    where: { applicationId: historyApplication.id },
    update: {
      shiftId: historyShift.id, workerId: worker.id, status: 'COMPLETED', checkInCredential: `CUMPLE-${historyShift.id.slice(-8).toUpperCase()}`,
      workerConfirmedAt: completedStartsAt, checkedInAt: completedStartsAt, checkedOutAt: completedEndsAt, completedAt: completedEndsAt,
    },
    create: {
      shiftId: historyShift.id, workerId: worker.id, applicationId: historyApplication.id, status: 'COMPLETED',
      checkInCredential: `CUMPLE-${historyShift.id.slice(-8).toUpperCase()}`, workerConfirmedAt: completedStartsAt,
      checkedInAt: completedStartsAt, checkedOutAt: completedEndsAt, completedAt: completedEndsAt,
    },
  });
  await prisma.payment.upsert({
    where: { assignmentId: historyAssignment.id },
    update: { companyId: company.id, shiftId: historyShift.id, reference: 'DEMO-PAGO-HISTORIAL-001', description: 'Apoyo de salón · Empresa Chambeaya Nueva', amountCents: 10000, workerCount: 1, status: 'PROCESSED', dueAt: completedEndsAt, processedAt: completedEndsAt, workerConfirmedAt: completedEndsAt },
    create: { companyId: company.id, shiftId: historyShift.id, assignmentId: historyAssignment.id, reference: 'DEMO-PAGO-HISTORIAL-001', description: 'Apoyo de salón · Empresa Chambeaya Nueva', amountCents: 10000, workerCount: 1, status: 'PROCESSED', dueAt: completedEndsAt, processedAt: completedEndsAt, workerConfirmedAt: completedEndsAt },
  });

  return { companyId: company.id, businessId: business.id, workerId: worker.id, adminId: admin.id, flowShiftId: flowShift.id, historyShiftId: historyShift.id };
}
