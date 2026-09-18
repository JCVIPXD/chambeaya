import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import { createApp } from "../src/app.js";
import { hashPassword } from "../src/modules/auth/auth.service.js";

/**
 * Arranca la API real (Express + Prisma) contra una base PostgreSQL real
 * para la suite E2E de Playwright del panel superadmin
 * (`apps/web/e2e-real/`). No es apto para producción ni para desarrollo
 * normal: aplica migraciones y siembra una cuenta ADMIN fija sobre el valor
 * de `DATABASE_URL` que reciba.
 *
 * Guardarraíl obligatorio, igual al de
 * `apps/api/tests/integration/vertical-marketplace-flow.integration.test.ts`:
 * exige opt-in explícito y que el nombre de la base termine en `_test`, para
 * que un valor accidental de `DATABASE_URL` nunca alcance una base de
 * desarrollo o producción.
 */
function requireE2eTestDatabase() {
  if (process.env.CHAMBEAYA_E2E_REAL_TESTS !== "true") {
    throw new Error("E2E_REAL_TESTS_REQUIRE_EXPLICIT_OPT_IN");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("E2E_REAL_TESTS_REQUIRE_DATABASE_URL");
  }
  const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!databaseName?.endsWith("_test")) {
    throw new Error("E2E_REAL_TESTS_REQUIRE_TEST_DATABASE");
  }
}

/**
 * Credenciales de la cuenta ADMIN sembrada para la suite E2E real. El
 * fixture `apps/web/e2e-real/fixtures/admin-real.ts` usa exactamente estos
 * mismos valores para autenticarse desde la interfaz; si se cambian aquí,
 * deben cambiarse también allí.
 */
export const e2eAdminAccount = {
  email: "admin.e2e@chambeaya.test",
  password: "AdminE2E-2026!",
  name: "Admin E2E Playwright",
  identifier: "90000099",
} as const;

async function seedAdmin(prisma: PrismaClient) {
  const salt = randomBytes(16).toString("hex");
  await prisma.user.upsert({
    where: { email: e2eAdminAccount.email },
    update: {
      name: e2eAdminAccount.name,
      identifier: e2eAdminAccount.identifier,
      role: "ADMIN",
      salt,
      passwordHash: hashPassword(e2eAdminAccount.password, salt),
    },
    create: {
      email: e2eAdminAccount.email,
      name: e2eAdminAccount.name,
      identifier: e2eAdminAccount.identifier,
      role: "ADMIN",
      salt,
      passwordHash: hashPassword(e2eAdminAccount.password, salt),
    },
  });
}

async function main() {
  requireE2eTestDatabase();

  // La base ya debe existir (creada por quien orquesta el clúster efímero);
  // este script sólo aplica el historial de migraciones del proyecto.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
  });

  const prisma = new PrismaClient();
  await prisma.$connect();
  await seedAdmin(prisma);
  await prisma.$disconnect();

  const port = Number(process.env.API_PORT ?? 4100);
  createApp().listen(port, () => {
    console.info(`API real de E2E escuchando en el puerto ${port}`);
  });
}

void main().catch((error) => {
  const code = error instanceof Error ? error.message : "E2E_SERVE_FAILED";
  console.error(`No se pudo arrancar la API real de E2E: ${code}`);
  process.exitCode = 1;
});
