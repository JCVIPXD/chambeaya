import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  createSuperadmin,
  generateAdminIdentifier,
  generatePassword,
  normalizeEmail,
  parseArgs,
  resetSuperadminPassword,
  SUPERADMIN_EXIT_CODES,
} from '../src/cli/superadmin.js';

/** Nunca debería llamarse: un correo inválido debe rechazarse ANTES de tocar Prisma. */
const untouchablePrisma = new Proxy(
  {},
  {
    get() {
      throw new Error('No debería consultarse Prisma con un correo inválido.');
    },
  },
) as PrismaClient;

// Pruebas unitarias de las partes puras del comando de superadmin (sin base
// de datos). El comportamiento contra Postgres real (crear, `--if-none`,
// correo duplicado, restablecer invalidando sesiones, restablecer sobre un
// no-admin, y login real con la contraseña generada) está en
// `tests/integration/superadmin-cli.integration.test.ts`.

describe('normalizeEmail', () => {
  it('recorta espacios y pasa a minúsculas, igual que POST /admin/companies', () => {
    expect(normalizeEmail('  Admin@Empresa.COM  ')).toBe('admin@empresa.com');
  });

  it('rechaza un correo mal formado', () => {
    expect(() => normalizeEmail('no-es-un-correo')).toThrow(/Correo inválido/);
    expect(() => normalizeEmail('   ')).toThrow(/Correo inválido/);
  });
});

describe('generatePassword', () => {
  it('genera contraseñas fuertes (8+ caracteres, con dígito y mayúscula) que la API aceptaría', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(password.length).toBeGreaterThanOrEqual(8);
      expect(password).toMatch(/\d/);
      expect(password).toMatch(/[A-Z]/);
    }
  });

  it('no repite la misma contraseña entre llamadas', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generatePassword()));
    expect(passwords.size).toBe(20);
  });
});

describe('generateAdminIdentifier', () => {
  it('nunca puede colisionar con un DNI (8 dígitos) ni un RUC (11 dígitos) reales', () => {
    for (let i = 0; i < 20; i += 1) {
      const identifier = generateAdminIdentifier();
      expect(identifier).toMatch(/^ADMIN-[0-9a-f]{12}$/);
      expect(/^\d{8}$/.test(identifier)).toBe(false);
      expect(/^\d{11}$/.test(identifier)).toBe(false);
    }
  });
});

describe('parseArgs', () => {
  it('exige --email en create y en reset', () => {
    expect(() => parseArgs(['create'])).toThrow(/requiere --email/);
    expect(() => parseArgs(['reset'])).toThrow(/requiere --email/);
  });

  it('acepta create con --email y --if-none', () => {
    expect(parseArgs(['create', '--email', 'a@b.com', '--if-none'])).toEqual({
      command: 'create',
      email: 'a@b.com',
      ifNone: true,
    });
  });

  it('rechaza --if-none en reset', () => {
    expect(() => parseArgs(['reset', '--email', 'a@b.com', '--if-none'])).toThrow(/--if-none solo aplica a "create"/);
  });

  it('status no acepta --email ni --if-none', () => {
    expect(parseArgs(['status'])).toEqual({ command: 'status', email: undefined, ifNone: false });
    expect(() => parseArgs(['status', '--email', 'a@b.com'])).toThrow(/"status" no acepta/);
  });

  it('nunca acepta una contraseña por línea de comandos', () => {
    expect(() => parseArgs(['create', '--email', 'a@b.com', '--password', 'x'])).toThrow(
      /nunca se acepta por línea de comandos/,
    );
    expect(() => parseArgs(['create', '--email', 'a@b.com', '--password=x'])).toThrow(
      /nunca se acepta por línea de comandos/,
    );
  });

  it('rechaza un comando desconocido', () => {
    expect(() => parseArgs(['borrar'])).toThrow(/Comando desconocido/);
    expect(() => parseArgs([])).toThrow(/Comando desconocido/);
  });
});

describe('un correo inválido se rechaza como VALIDATION_ERROR, no como error de base de datos', () => {
  // Regresión: antes, `normalizeEmail` lanzaba dentro de `createSuperadmin`/
  // `resetSuperadminPassword`, y `runSuperadminCli` etiquetaba ESE error como
  // "error de base de datos" (código 5) en vez de "error de validación"
  // (código 4). Se comprueba también que ni siquiera se consulta Prisma.
  it('createSuperadmin', async () => {
    const result = await createSuperadmin(untouchablePrisma, 'no-es-un-correo');
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.VALIDATION_ERROR);
    expect(result.password).toBeUndefined();
  });

  it('resetSuperadminPassword', async () => {
    const result = await resetSuperadminPassword(untouchablePrisma, 'no-es-un-correo');
    expect(result.code).toBe(SUPERADMIN_EXIT_CODES.VALIDATION_ERROR);
    expect(result.password).toBeUndefined();
  });
});

describe('SUPERADMIN_EXIT_CODES', () => {
  it('usa un código distinto para cada resultado posible', () => {
    const codes = Object.values(SUPERADMIN_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
