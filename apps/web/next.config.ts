import type { NextConfig } from 'next';

// NEXT_BASE_PATH se fija en compilación (queda inlineado en el bundle del
// cliente, ver https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
// y también debe estar presente cuando corre `next start`, porque este mismo
// archivo se vuelve a leer en tiempo de ejecución para decidir el enrutado
// del servidor. En desarrollo, `npm run dev`, `docker-compose.yml` y las
// suites de Playwright no la definen, así que basePath queda '' (la raíz),
// exactamente como antes de que existiera esta variable. En producción,
// scripts/instalar-produccion.sh la fija en "/empresas"
// (CN-20260925-006: un solo dominio con /, /empresas y /api en vez de 3
// subdominios).
const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  basePath: process.env.NEXT_BASE_PATH || '',
};

export default nextConfig;
