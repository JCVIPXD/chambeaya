import { PrismaClient } from '@prisma/client';

import { seedDemoDatabase } from '../src/demo/demo.seed.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedDemoDatabase(prisma);
    console.info('Datos demo persistentes preparados. Consulta docs/guides/client-demo.md para el recorrido local.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const code = error instanceof Error ? error.message : 'DEMO_SEED_FAILED';
  console.error(`No se prepararon los datos demo: ${code}`);
  process.exitCode = 1;
});
