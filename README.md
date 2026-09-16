# Cumple Now

Plataforma de empleos temporales con una aplicación Flutter para trabajadores,
un panel web para empresas y administración, y una API Node.js con PostgreSQL.

## Componentes

- `apps/mobile_flutter`: aplicación de trabajadores para Android, iOS y web.
- `apps/web`: panel Next.js de empresas y superadministración.
- `apps/api`: API Express y Prisma.
- `packages/shared`: contratos compartidos.

## Inicio local

Requiere Node.js LTS, Docker Desktop en ejecución y Flutter en `PATH` para la
aplicación móvil.

```powershell
Copy-Item .env.example .env
npm install
docker compose up --build
```

El panel queda en `http://127.0.0.1:3000`, la API en
`http://127.0.0.1:4000/api` y PostgreSQL en el puerto host `5433`. Para abrir
la aplicación Flutter contra la API local:

```powershell
npm run dev:mobile
```

Para una demostración aislada, añade `-- -Demo`. La guía de
[desarrollo local](docs/guides/local-development.md) contiene cuentas demo,
arranque por terminales, dispositivos Android y diagnóstico.

## Verificación

```powershell
# API, panel y paquetes con pruebas configuradas
npm test

# Interfaz del panel en Chromium
npm run test:web:install
npm run test:web
```

La prueba integrada del ciclo de turnos requiere una base aislada cuyo nombre
termine en `_test` y confirmación explícita:

```powershell
$env:CUMPLENOW_INTEGRATION_TESTS = 'true'
$env:DATABASE_URL = 'postgresql://usuario:clave@host:5432/cumplenow_test?schema=public'
npm run test:integration --workspace=@cumple-now/api
```

## Documentación

El [índice de documentación](docs/README.md) agrupa las guías vigentes de
desarrollo, demostración y despliegue, la referencia técnica, la hoja de ruta y
el registro operativo. Los documentos fechados y planes anteriores están
separados en `docs/archive/` para no confundirse con la fuente de verdad actual.

## Alcance actual

Los trabajadores pueden registrarse; las cuentas empresariales se provisionan
por Cumple Now. Los turnos, postulaciones, selección y asistencia operan contra
la API por defecto; la demo requiere `CUMPLENOW_DEMO_MODE=true`. Los pagos
reales, retiros, cámara, ubicación, foto de DNI y reconocimiento facial siguen
intencionalmente desactivados.
