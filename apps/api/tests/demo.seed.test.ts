import { describe, expect, it } from 'vitest';

import { assertDemoSeedAllowed, seedDemoDatabase } from '../src/demo/demo.seed.js';

type Row = Record<string, unknown> & { id: string; __key?: string };
type UpsertInput = { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> };

/**
 * Small relational adapter for the seed: it applies the relevant unique and
 * foreign-key constraints so the idempotency test fails on broken references.
 */
class InMemoryDemoDatabase {
  readonly users: Row[] = [];
  readonly companies: Row[] = [];
  readonly subscriptions: Row[] = [];
  readonly profiles: Row[] = [];
  readonly shifts: Row[] = [];
  readonly applications: Row[] = [];
  readonly assignments: Row[] = [];
  readonly payments: Row[] = [];
  readonly conversations: Row[] = [];
  readonly messages: Row[] = [];
  readonly events: Row[] = [];

  private fail(message: string): never {
    throw new Error(`RELATION_CONSTRAINT:${message}`);
  }

  private require<RowType extends Row>(rows: RowType[], id: unknown, name: string) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) this.fail(name);
    return row;
  }

  private upsert(
    rows: Row[],
    key: string,
    input: UpsertInput,
    fallbackId: string,
    validate: (row: Row) => void = () => undefined,
  ) {
    const existing = rows.find((row) => row.__key === key);
    const next = existing
      ? { ...existing, ...input.update }
      : { ...input.create, id: String(input.create.id ?? fallbackId), __key: key } as Row;
    validate(next);
    if (existing) {
      Object.assign(existing, input.update);
      return { ...existing };
    }
    rows.push(next);
    return { ...next };
  }

  private validateCompany = (company: Row) => {
    const owner = this.require(this.users, company.ownerId, 'COMPANY_OWNER');
    if (owner.role !== 'BUSINESS') this.fail('COMPANY_OWNER_ROLE');
  };

  private validateSubscription = (subscription: Row) => {
    this.require(this.companies, subscription.companyId, 'SUBSCRIPTION_COMPANY');
  };

  private validateProfile = (profile: Row) => {
    this.require(this.companies, profile.companyId, 'PROFILE_COMPANY');
    const worker = this.require(this.users, profile.workerUserId, 'PROFILE_WORKER');
    if (worker.role !== 'WORKER' || worker.email !== profile.email) this.fail('PROFILE_WORKER_MATCH');
  };

  private validateShift = (shift: Row) => {
    this.require(this.companies, shift.companyId, 'SHIFT_COMPANY');
  };

  private validateApplication = (application: Row) => {
    this.require(this.shifts, application.shiftId, 'APPLICATION_SHIFT');
    const worker = this.require(this.users, application.workerId, 'APPLICATION_WORKER');
    if (worker.role !== 'WORKER') this.fail('APPLICATION_WORKER_ROLE');
  };

  private validateAssignment = (assignment: Row) => {
    const application = this.require(this.applications, assignment.applicationId, 'ASSIGNMENT_APPLICATION');
    this.require(this.shifts, assignment.shiftId, 'ASSIGNMENT_SHIFT');
    if (application.shiftId !== assignment.shiftId || application.workerId !== assignment.workerId) this.fail('ASSIGNMENT_APPLICATION_MATCH');
  };

  private validatePayment = (payment: Row) => {
    const company = this.require(this.companies, payment.companyId, 'PAYMENT_COMPANY');
    const shift = this.require(this.shifts, payment.shiftId, 'PAYMENT_SHIFT');
    const assignment = this.require(this.assignments, payment.assignmentId, 'PAYMENT_ASSIGNMENT');
    if (shift.companyId !== company.id || assignment.shiftId !== shift.id) this.fail('PAYMENT_SCOPE');
  };

  private validateConversation = (conversation: Row) => {
    const company = this.require(this.companies, conversation.companyId, 'CONVERSATION_COMPANY');
    const profile = this.require(this.profiles, conversation.workerId, 'CONVERSATION_PROFILE');
    const worker = this.require(this.users, conversation.workerUserId, 'CONVERSATION_WORKER');
    const shift = this.require(this.shifts, conversation.shiftId, 'CONVERSATION_SHIFT');
    if (profile.companyId !== company.id || profile.workerUserId !== worker.id || shift.companyId !== company.id) this.fail('CONVERSATION_SCOPE');
  };

  readonly user = {
    upsert: async (input: UpsertInput) => this.upsert(this.users, `email:${input.where.email}`, input, `user-${input.where.email}`),
  };

  readonly company = {
    upsert: async (input: UpsertInput) => this.upsert(this.companies, `owner:${input.where.ownerId}`, input, `company-${input.where.ownerId}`, this.validateCompany),
  };

  readonly companySubscription = {
    upsert: async (input: UpsertInput) => this.upsert(this.subscriptions, `company:${input.where.companyId}`, input, `subscription-${input.where.companyId}`, this.validateSubscription),
  };

  readonly workerProfile = {
    upsert: async (input: UpsertInput) => {
      const compound = input.where.companyId_email as { companyId: string; email: string };
      return this.upsert(this.profiles, `profile:${compound.companyId}:${compound.email}`, input, `profile-${compound.companyId}`, this.validateProfile);
    },
  };

  readonly shift = {
    upsert: async (input: UpsertInput) => this.upsert(this.shifts, `shift:${input.where.id}`, input, String(input.where.id), this.validateShift),
  };

  readonly payment = {
    deleteMany: async ({ where }: { where: { shiftId: string } }) => {
      this.payments.splice(0, this.payments.length, ...this.payments.filter((payment) => payment.shiftId !== where.shiftId));
    },
    upsert: async (input: UpsertInput) => this.upsert(this.payments, `assignment:${input.where.assignmentId}`, input, `payment-${input.where.assignmentId}`, this.validatePayment),
  };

  readonly shiftAssignment = {
    deleteMany: async ({ where }: { where: { shiftId: string } }) => {
      this.assignments.splice(0, this.assignments.length, ...this.assignments.filter((assignment) => assignment.shiftId !== where.shiftId));
    },
    upsert: async (input: UpsertInput) => this.upsert(this.assignments, `application:${input.where.applicationId}`, input, `assignment-${input.where.applicationId}`, this.validateAssignment),
  };

  readonly shiftApplication = {
    upsert: async (input: UpsertInput) => {
      const compound = input.where.shiftId_workerId as { shiftId: string; workerId: string };
      return this.upsert(this.applications, `application:${compound.shiftId}:${compound.workerId}`, input, `application-${compound.shiftId}`, this.validateApplication);
    },
  };

  readonly shiftEvent = {
    deleteMany: async ({ where }: { where: { shiftId: string } }) => {
      this.events.splice(0, this.events.length, ...this.events.filter((event) => event.shiftId !== where.shiftId));
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      data.forEach((event) => {
        this.require(this.shifts, event.shiftId, 'EVENT_SHIFT');
        if (event.actorId) this.require(this.users, event.actorId, 'EVENT_ACTOR');
      });
      this.events.push(...data.map((event, index) => ({ id: `event-${this.events.length + index + 1}`, ...event })));
    },
  };

  readonly conversation = {
    upsert: async (input: UpsertInput) => this.upsert(this.conversations, `conversation:${input.where.id}`, input, String(input.where.id), this.validateConversation),
  };

  readonly message = {
    deleteMany: async ({ where }: { where: { conversationId: string } }) => {
      this.messages.splice(0, this.messages.length, ...this.messages.filter((message) => message.conversationId !== where.conversationId));
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      data.forEach((message) => this.require(this.conversations, message.conversationId, 'MESSAGE_CONVERSATION'));
      this.messages.push(...data.map((message, index) => ({ id: `message-${this.messages.length + index + 1}`, ...message })));
    },
  };
}

const localEnvironment = { NODE_ENV: 'development', CUMPLENOW_ALLOW_DEMO_SEED: 'true' };

describe('demo seed safety guard', () => {
  it('allows only an explicit local development opt-in', () => {
    expect(() => assertDemoSeedAllowed(localEnvironment)).not.toThrow();
  });

  it.each([
    [{ NODE_ENV: 'development' }, 'DEMO_SEED_REQUIRES_EXPLICIT_OPT_IN'],
    [{ CUMPLENOW_ALLOW_DEMO_SEED: 'true' }, 'DEMO_SEED_REQUIRES_LOCAL_DEVELOPMENT'],
    [{ NODE_ENV: 'Production', CUMPLENOW_ALLOW_DEMO_SEED: 'true' }, 'DEMO_SEED_REQUIRES_LOCAL_DEVELOPMENT'],
    [{ NODE_ENV: 'staging', CUMPLENOW_ALLOW_DEMO_SEED: 'true' }, 'DEMO_SEED_REQUIRES_LOCAL_DEVELOPMENT'],
    [{ NODE_ENV: 'production', CUMPLENOW_ALLOW_DEMO_SEED: 'true' }, 'DEMO_SEED_REQUIRES_LOCAL_DEVELOPMENT'],
  ])('fails closed for %#', (environment, error) => {
    expect(() => assertDemoSeedAllowed(environment)).toThrow(error);
  });
});

describe('seedDemoDatabase', () => {
  it('is idempotent and restores the deterministic presentation state with valid relations', async () => {
    const database = new InMemoryDemoDatabase();

    const first = await seedDemoDatabase(database as never, localEnvironment);
    const flowApplication = database.applications.find((application) => application.shiftId === first.flowShiftId)!;
    database.assignments.push({ id: 'stale-flow-assignment', shiftId: first.flowShiftId, applicationId: flowApplication.id, workerId: first.workerId, status: 'ASSIGNED' });
    database.payments.push({ id: 'stale-flow-payment', shiftId: first.flowShiftId, assignmentId: 'stale-flow-assignment', status: 'PENDING' });
    flowApplication.status = 'ACCEPTED';

    const second = await seedDemoDatabase(database as never, localEnvironment);

    expect(second).toEqual(first);
    expect(database.users).toHaveLength(3);
    expect(database.companies).toHaveLength(1);
    expect(database.subscriptions).toHaveLength(1);
    expect(database.profiles).toHaveLength(1);
    expect(database.shifts).toHaveLength(2);
    expect(database.applications).toHaveLength(2);
    expect(database.assignments).toHaveLength(1);
    expect(database.payments).toHaveLength(1);
    expect(database.conversations).toHaveLength(1);
    expect(database.messages).toHaveLength(2);
    expect(database.events).toHaveLength(2);

    const company = database.companies[0];
    const subscription = database.subscriptions[0];
    const profile = database.profiles[0];
    const flow = database.shifts.find((shift) => shift.id === first.flowShiftId)!;
    const pendingApplication = database.applications.find((application) => application.shiftId === first.flowShiftId)!;
    const historyApplication = database.applications.find((application) => application.shiftId === first.historyShiftId)!;
    const historyAssignment = database.assignments[0];
    const historyPayment = database.payments[0];
    const conversation = database.conversations[0];

    expect(company).toMatchObject({ id: first.companyId, ownerId: first.businessId });
    expect(subscription).toMatchObject({ companyId: company.id });
    expect(profile).toMatchObject({ companyId: company.id, workerUserId: first.workerId, email: 'trabajador.demo@cumplenow.local' });
    expect(flow).toMatchObject({ companyId: company.id, status: 'PUBLISHED', confirmedWorkers: 0 });
    expect(pendingApplication).toMatchObject({ workerId: first.workerId, status: 'PENDING' });
    expect(historyApplication).toMatchObject({ workerId: first.workerId, status: 'ACCEPTED' });
    expect(historyAssignment).toMatchObject({ shiftId: first.historyShiftId, applicationId: historyApplication.id, workerId: first.workerId, status: 'COMPLETED' });
    expect(historyPayment).toMatchObject({ companyId: company.id, shiftId: first.historyShiftId, assignmentId: historyAssignment.id, status: 'PROCESSED' });
    expect(conversation).toMatchObject({ companyId: company.id, workerId: profile.id, workerUserId: first.workerId, shiftId: first.flowShiftId });
    expect(database.messages.every((message) => message.conversationId === conversation.id)).toBe(true);
    expect(database.events.every((event) => event.shiftId === first.flowShiftId && [first.businessId, first.workerId].includes(String(event.actorId)))).toBe(true);
  });

  it('rejects broken relations in the in-memory persistence adapter', async () => {
    const database = new InMemoryDemoDatabase();

    await seedDemoDatabase(database as never, localEnvironment);

    await expect(database.conversation.upsert({
      where: { id: 'invalid-conversation' }, update: {},
      create: { id: 'invalid-conversation', companyId: 'missing-company', workerId: 'missing-profile', workerUserId: 'missing-worker', shiftId: 'missing-shift' },
    })).rejects.toThrow('RELATION_CONSTRAINT:CONVERSATION_COMPANY');
  });
});
