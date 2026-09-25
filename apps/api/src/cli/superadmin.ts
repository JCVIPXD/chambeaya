/**
 * Comando de mantenimiento para crear o restablecer el primer superadmin
 * (rol `ADMIN`) de una instancia de Chambeaya. Sin esto, una base de datos
 * vacía en producción no tiene forma de arrancar: el registro público solo
 * acepta `WORKER` (`POST /api/auth/register`, `BUSINESS_REGISTRATION_DISABLED`)
 * y las empresas las crea el propio superadmin desde `/empresas/admin`
 * (`POST /api/admin/companies`).
 *
 * Se ejecuta dentro del contenedor `api` en producción (compilado a
 * `dist/src/cli/superadmin.js`, ver `apps/api/Dockerfile.production`), a
 * través de `scripts/crear-superadmin.sh` o del propio
 * `scripts/instalar-produccion.sh`.
 *
 * Reglas de seguridad deliberadas:
 * - La contraseña SIEMPRE se genera aquí; nunca se acepta como argumento de
 *   línea de comandos (quedaría en el historial del shell y en `ps`) ni se
 *   pide por stdin. `docker compose exec -T` (usado por
 *   `scripts/crear-superadmin.sh`) no asigna una pseudo-TTY, así que un
 *   prompt interactivo sin eco no funcionaría de forma confiable ahí; y
 *   generarla siempre evita contraseñas débiles elegidas a mano.
 * - La contraseña se imprime una sola vez por stdout y nunca se escribe a
 *   disco ni a ningún log.
 * - `create` nunca modifica un usuario ya existente con ese correo (aunque
 *   ya sea `ADMIN`): falla con un mensaje claro. `reset` nunca convierte en
 *   `ADMIN` a un usuario que no lo era.
 */
import { randomBytes, randomInt } from 'node:crypto';

import { Prisma, PrismaClient, type User } from '@prisma/client';

import { hashPassword } from '../modules/auth/auth.service.js';

export const SUPERADMIN_EXIT_CODES = {
  /** Superadmin creado o restablecido correctamente. */
  OK: 0,
  /** Error de uso de la línea de comandos (flags/argumentos inválidos). */
  USAGE_ERROR: 2,
  /** `create --if-none`: ya existía un ADMIN; no se creó ninguno (no es un error). */
  ALREADY_EXISTS: 3,
  /** Entrada inválida a nivel de dominio (correo mal formado, correo ya usado, objetivo de `reset` sin ser ADMIN, etc.). */
  VALIDATION_ERROR: 4,
  /** Fallo al hablar con la base de datos (conexión, error inesperado de Prisma, etc.). */
  DATABASE_ERROR: 5,
} as const;

/** Usado por `status` (y por `scripts/instalar-produccion.sh`, que lo invoca antes de pedir el correo). */
export const SUPERADMIN_STATUS_CODES = {
  ADMIN_EXISTS: 0,
  NO_ADMIN: 1,
} as const;

export interface SuperadminResult {
  code: number;
  message: string;
  /** Solo presente cuando `code === OK`: la contraseña en texto plano, para mostrarla una única vez. */
  password?: string;
  email?: string;
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * Normaliza igual que `POST /api/admin/companies`
 * (`apps/api/src/modules/admin/admin.routes.ts`): recorta espacios y pasa a
 * minúsculas antes de guardar. Aquí se recorta primero y luego se valida el
 * formato (a diferencia del esquema zod de esa ruta, que valida el crudo),
 * porque un correo pasado por línea de comandos puede traer espacios del
 * propio shell y no tiene sentido rechazarlo solo por eso.
 */
export function normalizeEmail(rawEmail: string): string {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error(`Correo inválido: "${rawEmail}"`);
  }
  return email;
}

const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*-_=+';
const PASSWORD_ALL = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;
const PASSWORD_LENGTH = 24;

/** Misma regla que `isValidPassword` en `auth.service.ts` (no exportada): al menos 8 caracteres, un dígito y una mayúscula. */
function isStrongEnough(password: string) {
  return password.length >= 8 && /\d/.test(password) && /[A-Z]/.test(password);
}

/**
 * Genera una contraseña aleatoria criptográficamente segura. Se garantiza al
 * menos una minúscula, una mayúscula, un dígito y un símbolo eligiendo un
 * carácter de cada conjunto explícitamente y completando el resto desde el
 * alfabeto combinado; el orden final se mezcla para no dejar un patrón fijo
 * (posiciones 0-3 siempre de un tipo distinto). `randomInt` evita el sesgo de
 * módulo de `Math.random()`/`% length`.
 */
export function generatePassword(length: number = PASSWORD_LENGTH): string {
  const pick = (charset: string) => charset[randomInt(charset.length)];
  const chars = [pick(PASSWORD_LOWER), pick(PASSWORD_UPPER), pick(PASSWORD_DIGITS), pick(PASSWORD_SYMBOLS)];
  for (let i = chars.length; i < length; i += 1) {
    chars.push(pick(PASSWORD_ALL));
  }
  // Fisher-Yates con randomInt: evita que las 4 posiciones garantizadas
  // queden siempre al inicio de la contraseña.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join('');
  // No debería fallar nunca dado el algoritmo anterior; es una red de
  // seguridad explícita porque una contraseña generada que no cumpliera la
  // regla del propio login sería un defecto grave y silencioso.
  return isStrongEnough(password) ? password : generatePassword(length);
}

/**
 * Identificador único para la cuenta ADMIN. `User.identifier` es obligatorio
 * y único en todo el sistema (`apps/api/prisma/schema.prisma`), y ya está
 * ocupado con DNI de 8 dígitos (`WORKER`) y RUC de 11 dígitos (`BUSINESS`,
 * ver `normalizeRegistration` en `auth.service.ts`). Un prefijo con letras y
 * guion no puede colisionar con ningún DNI/RUC real (ambos son
 * exclusivamente numéricos), y los 12 caracteres hexadecimales (48 bits)
 * hacen la colisión entre dos superadmins astronómicamente improbable; aun
 * así, `createSuperadmin` reintenta con un identificador nuevo si el
 * `@unique` la detecta.
 */
export function generateAdminIdentifier(): string {
  return `ADMIN-${randomBytes(6).toString('hex')}`;
}

function isUniqueConstraintOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === 'string' && target.includes(field);
}

/** ¿Existe al menos un usuario con rol `ADMIN`? Usado por `create --if-none` y por el subcomando `status`. */
export async function anyAdminExists(prisma: PrismaClient): Promise<boolean> {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  return admin !== null;
}

export interface CreateSuperadminOptions {
  /** Solo crea si todavía no existe ningún `ADMIN`; si ya existe, no toca nada (usado por el instalador). */
  ifNone?: boolean;
}

const MAX_IDENTIFIER_ATTEMPTS = 5;

/**
 * `normalizeEmail` lanza sobre un correo mal formado. Es una entrada
 * inválida del operador, no un fallo de base de datos: se convierte aquí en
 * un `SuperadminResult` con `VALIDATION_ERROR` en vez de dejarla subir, para
 * que `runSuperadminCli` no la etiquete por error como "error de base de
 * datos" (código 5) cuando en realidad es código 4.
 */
function tryNormalizeEmail(rawEmail: string): { email: string } | { errorResult: SuperadminResult } {
  try {
    return { email: normalizeEmail(rawEmail) };
  } catch (error) {
    return {
      errorResult: {
        code: SUPERADMIN_EXIT_CODES.VALIDATION_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function createSuperadmin(
  prisma: PrismaClient,
  rawEmail: string,
  options: CreateSuperadminOptions = {},
): Promise<SuperadminResult> {
  const normalized = tryNormalizeEmail(rawEmail);
  if ('errorResult' in normalized) return normalized.errorResult;
  const { email } = normalized;

  if (options.ifNone && (await anyAdminExists(prisma))) {
    return {
      code: SUPERADMIN_EXIT_CODES.ALREADY_EXISTS,
      message: 'Ya existe al menos un superadmin (rol ADMIN); no se creó ninguno nuevo (--if-none).',
    };
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (existing) {
    return {
      code: SUPERADMIN_EXIT_CODES.VALIDATION_ERROR,
      message: `Ya existe un usuario con el correo "${email}" (rol actual: ${existing.role}). No se modificó.`,
    };
  }

  const password = generatePassword();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt += 1) {
    const identifier = generateAdminIdentifier();
    try {
      const user = await prisma.user.create({
        data: {
          email,
          name: 'Superadmin Chambeaya',
          identifier,
          role: 'ADMIN',
          salt,
          passwordHash,
          localPasswordConfigured: true,
        },
      });
      return {
        code: SUPERADMIN_EXIT_CODES.OK,
        message: `Superadmin creado (id ${user.id}).`,
        password,
        email: user.email,
      };
    } catch (error) {
      if (isUniqueConstraintOn(error, 'identifier')) {
        lastError = error;
        continue; // colisión astronómicamente improbable; se reintenta con otro identificador.
      }
      if (isUniqueConstraintOn(error, 'email')) {
        // Carrera con otra ejecución concurrente entre el `findUnique` y el `create`.
        return {
          code: SUPERADMIN_EXIT_CODES.VALIDATION_ERROR,
          message: `Ya existe un usuario con el correo "${email}". No se modificó.`,
        };
      }
      throw error;
    }
  }
  throw new Error(`No se pudo generar un identificador único tras ${MAX_IDENTIFIER_ATTEMPTS} intentos: ${String(lastError)}`);
}

export async function resetSuperadminPassword(prisma: PrismaClient, rawEmail: string): Promise<SuperadminResult> {
  const normalized = tryNormalizeEmail(rawEmail);
  if ('errorResult' in normalized) return normalized.errorResult;
  const { email } = normalized;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    return {
      code: SUPERADMIN_EXIT_CODES.VALIDATION_ERROR,
      message: `No existe ningún usuario con el correo "${email}".`,
    };
  }
  if (existing.role !== 'ADMIN') {
    return {
      code: SUPERADMIN_EXIT_CODES.VALIDATION_ERROR,
      message: `El usuario con el correo "${email}" existe pero su rol es ${existing.role}, no ADMIN. No se modificó ni se convirtió en superadmin.`,
    };
  }

  const password = generatePassword();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: existing.id },
      data: { salt, passwordHash },
    }),
    prisma.authSession.deleteMany({ where: { userId: existing.id } }),
  ]);

  return {
    code: SUPERADMIN_EXIT_CODES.OK,
    message: `Contraseña restablecida para el superadmin "${email}" (id ${(updated as User).id}). Todas sus sesiones anteriores fueron invalidadas.`,
    password,
    email,
  };
}

// --- CLI -------------------------------------------------------------------

interface ParsedArgs {
  command: 'create' | 'reset' | 'status';
  email?: string;
  ifNone: boolean;
}

function printUsage(stream: NodeJS.WritableStream = process.stdout) {
  stream.write(`Uso:
  node dist/src/cli/superadmin.js create --email correo@dominio.com [--if-none]
  node dist/src/cli/superadmin.js reset  --email correo@dominio.com
  node dist/src/cli/superadmin.js status

  create           Crea un nuevo superadmin (rol ADMIN) con el correo dado.
                    Falla si ya existe un usuario con ese correo.
    --if-none       Solo crea si todavía no existe NINGÚN superadmin; si ya
                     existe uno (de cualquier correo), no hace nada.
  reset             Genera una contraseña nueva para un superadmin YA
                    existente e invalida todas sus sesiones activas. Falla si
                    el correo no existe o no pertenece a un ADMIN.
  status            Solo informa: código de salida 0 si ya existe algún
                    superadmin, 1 si no existe ninguno. No modifica nada.

La contraseña SIEMPRE se genera aquí y se imprime una sola vez por stdout.
Nunca se acepta por argumento ni por variable de entorno.
`);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== 'create' && command !== 'reset' && command !== 'status') {
    throw new Error(`Comando desconocido: "${command ?? ''}". Usa "create", "reset" o "status".`);
  }
  let email: string | undefined;
  let ifNone = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--email') {
      email = rest[i + 1];
      if (email === undefined) throw new Error('Falta el valor de --email.');
      i += 1;
    } else if (arg === '--if-none') {
      ifNone = true;
    } else if (arg === '--password' || arg.startsWith('--password=')) {
      throw new Error('La contraseña nunca se acepta por línea de comandos: se genera y se muestra por stdout.');
    } else {
      throw new Error(`Opción desconocida: "${arg}".`);
    }
  }
  if ((command === 'create' || command === 'reset') && !email) {
    throw new Error(`El comando "${command}" requiere --email.`);
  }
  if (command === 'reset' && ifNone) {
    throw new Error('--if-none solo aplica a "create".');
  }
  if (command === 'status' && (email || ifNone)) {
    throw new Error('"status" no acepta --email ni --if-none.');
  }
  return { command, email, ifNone };
}

function printResult(result: SuperadminResult) {
  console.log(result.message);
  if (result.code === SUPERADMIN_EXIT_CODES.OK && result.password) {
    console.log('');
    console.log(`  Correo:      ${result.email}`);
    console.log(`  Contraseña:  ${result.password}`);
    console.log('');
    console.log('Guarda esta contraseña ahora: no se mostrará de nuevo ni queda registrada en');
    console.log('ningún archivo ni log. El panel todavía no tiene una opción para cambiarla');
    console.log('desde la sesión; si necesitas otra más adelante, usa:');
    console.log('  ./scripts/crear-superadmin.sh --email <correo> --reset');
  }
}

export async function runSuperadminCli(argv: string[], prisma: PrismaClient): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage(process.stderr);
    return SUPERADMIN_EXIT_CODES.USAGE_ERROR;
  }

  try {
    if (parsed.command === 'status') {
      const exists = await anyAdminExists(prisma);
      console.log(exists ? 'Ya existe al menos un superadmin (rol ADMIN).' : 'No existe ningún superadmin (rol ADMIN) todavía.');
      return exists ? SUPERADMIN_STATUS_CODES.ADMIN_EXISTS : SUPERADMIN_STATUS_CODES.NO_ADMIN;
    }

    const result = parsed.command === 'create'
      ? await createSuperadmin(prisma, parsed.email!, { ifNone: parsed.ifNone })
      : await resetSuperadminPassword(prisma, parsed.email!);

    printResult(result);
    // `ALREADY_EXISTS` no es un error (es el resultado esperado de
    // `--if-none` cuando ya hay un superadmin): solo se duplica a stderr el
    // mensaje de los casos que sí lo son.
    if (result.code === SUPERADMIN_EXIT_CODES.VALIDATION_ERROR) {
      console.error(result.message);
    }
    return result.code;
  } catch (error) {
    console.error('Error de base de datos al ejecutar el comando de superadmin:');
    console.error(error instanceof Error ? error.message : String(error));
    return SUPERADMIN_EXIT_CODES.DATABASE_ERROR;
  }
}

/* c8 ignore start - entry point, cubierto por las pruebas de integración vía las funciones exportadas arriba. */
async function main() {
  const prisma = new PrismaClient();
  try {
    const code = await runSuperadminCli(process.argv.slice(2), prisma);
    process.exitCode = code;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectExecution = process.argv[1]?.endsWith('superadmin.js') || process.argv[1]?.endsWith('superadmin.ts');
if (isDirectExecution) {
  void main();
}
/* c8 ignore stop */
