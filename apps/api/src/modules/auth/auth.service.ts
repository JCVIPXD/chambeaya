import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { PrismaClient, type User } from '@prisma/client';

export type AccountRole = 'WORKER' | 'BUSINESS';

export interface RegisterInput {
  role: AccountRole;
  name: string;
  email: string;
  password: string;
  dniOrRuc: string;
}

export interface AuthSession {
  token: string;
  role: AccountRole;
  name: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthSession> | AuthSession;
  login(email: string, password: string): Promise<AuthSession> | AuthSession;
  restore(token: string): Promise<AuthSession> | AuthSession;
  logout(token: string): Promise<void> | void;
}

interface Account extends Omit<RegisterInput, 'password'> {
  id: string;
  salt: string;
  passwordHash: string;
}

export class AuthError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_CREDENTIALS'
      | 'DUPLICATE_ACCOUNT'
      | 'INVALID_REGISTRATION'
      | 'INVALID_SESSION',
  ) {
    super(code);
  }
}

const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;

function normalizeRegistration(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const identifier = input.dniOrRuc.trim();
  if (
    !input.name.trim() ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    input.password.length < 8 ||
    !/\d/.test(input.password) ||
    !/[A-Z]/.test(input.password)
  ) {
    throw new AuthError('INVALID_REGISTRATION');
  }
  if (
    (input.role === 'WORKER' && !/^\d{8}$/.test(identifier)) ||
    (input.role === 'BUSINESS' && !/^\d{11}$/.test(identifier))
  ) {
    throw new AuthError('INVALID_REGISTRATION');
  }
  return { email, identifier, name: input.name.trim() };
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

function passwordMatches(password: string, account: Pick<Account, 'salt' | 'passwordHash'>) {
  const actual = Buffer.from(hashPassword(password, account.salt), 'hex');
  const expected = Buffer.from(account.passwordHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicSession(token: string, account: Pick<Account, 'role' | 'name'>): AuthSession {
  return { token, role: account.role, name: account.name };
}

export class LocalAuthService implements AuthService {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, Account>();

  register(input: RegisterInput): AuthSession {
    const normalized = normalizeRegistration(input);
    if (this.accounts.has(normalized.email)) throw new AuthError('DUPLICATE_ACCOUNT');

    const salt = randomBytes(16).toString('hex');
    const account: Account = {
      id: randomBytes(12).toString('hex'),
      role: input.role,
      name: normalized.name,
      email: normalized.email,
      dniOrRuc: normalized.identifier,
      salt,
      passwordHash: hashPassword(input.password, salt),
    };
    this.accounts.set(account.email, account);
    return this.sessionFor(account);
  }

  login(emailInput: string, password: string): AuthSession {
    const account = this.accounts.get(emailInput.trim().toLowerCase());
    if (!account || !passwordMatches(password, account)) {
      throw new AuthError('INVALID_CREDENTIALS');
    }
    return this.sessionFor(account);
  }

  restore(token: string): AuthSession {
    const account = this.sessions.get(hashToken(token));
    if (!account) throw new AuthError('INVALID_SESSION');
    return publicSession(token, account);
  }

  logout(token: string): void {
    this.sessions.delete(hashToken(token));
  }

  private sessionFor(account: Account): AuthSession {
    const token = createOpaqueToken();
    this.sessions.set(hashToken(token), account);
    return publicSession(token, account);
  }
}

export class DatabaseAuthService implements AuthService {
  constructor(private readonly prisma = new PrismaClient()) {}

  async register(input: RegisterInput): Promise<AuthSession> {
    const normalized = normalizeRegistration(input);
    const salt = randomBytes(16).toString('hex');
    try {
      const account = await this.prisma.user.create({
        data: {
          email: normalized.email,
          passwordHash: hashPassword(input.password, salt),
          salt,
          role: input.role,
          name: normalized.name,
          identifier: normalized.identifier,
        },
      });
      return this.sessionFor(account);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new AuthError('DUPLICATE_ACCOUNT');
      }
      throw error;
    }
  }

  async login(emailInput: string, password: string): Promise<AuthSession> {
    const account = await this.prisma.user.findUnique({
      where: { email: emailInput.trim().toLowerCase() },
    });
    if (!account || !passwordMatches(password, this.toAccount(account))) {
      throw new AuthError('INVALID_CREDENTIALS');
    }
    return this.sessionFor(account);
  }

  async restore(token: string): Promise<AuthSession> {
    if (!token) throw new AuthError('INVALID_SESSION');
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await this.prisma.authSession.delete({ where: { id: session.id } });
      throw new AuthError('INVALID_SESSION');
    }
    return publicSession(token, this.toAccount(session.user));
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  private async sessionFor(account: User): Promise<AuthSession> {
    const token = createOpaqueToken();
    await this.prisma.authSession.create({
      data: {
        tokenHash: hashToken(token),
        userId: account.id,
        expiresAt: new Date(Date.now() + sessionDurationMs),
      },
    });
    return publicSession(token, this.toAccount(account));
  }

  private toAccount(account: User): Account {
    return {
      id: account.id,
      email: account.email,
      passwordHash: account.passwordHash,
      salt: account.salt,
      role: account.role as AccountRole,
      name: account.name,
      dniOrRuc: account.identifier,
    };
  }
}
