# Cumple Now

Plataforma de empleos temporales: aplicación móvil para trabajadores y panel web para empresas y administración.

## Estructura

- `apps/mobile_flutter`: aplicación Flutter para Android/iOS. La carpeta `apps/mobile` conserva temporalmente la primera prueba React Native durante la migración.
- `apps/web`: panel web Next.js para empresas.
- `apps/api`: API Node.js + Express y Prisma.
- `packages/shared`: tipos y contratos compartidos.

## Requisitos locales

1. Node.js LTS (incluye npm).
2. Docker Desktop, con el motor iniciado.
3. Flutter SDK disponible en `PATH`.

## Inicio (cuando Node y Docker estén instalados)

```powershell
Copy-Item .env.example .env
npm install
docker compose up --build
```

La API quedará en `http://127.0.0.1:4000`, el panel web en `http://127.0.0.1:3000` y PostgreSQL en el puerto host `5433`.

La app móvil no se ejecuta dentro de Docker: para poder abrirse en Android/iPhone debe usar Flutter desde el equipo anfitrión.

```powershell
npm run dev:mobile
```
## Ejecutar la demostración Flutter

La app Flutter se ejecuta en Windows (Chrome, emulador o teléfono) y el backend opcional usa Docker Desktop.

1. Instala Docker Desktop y reinicia Windows si el instalador lo solicita.
2. Abre Docker Desktop y espera a que indique que está listo.
3. Desde esta carpeta ejecuta:

```powershell
docker compose up --build
```

La API quedará en `http://127.0.0.1:4000/api` y PostgreSQL en el puerto host `5433`.

Para abrir Flutter con datos demo, sin depender de Docker:

```powershell
flutter run -d chrome --web-port 7357
```

Para que Flutter consulte la API local:

```powershell
flutter run -d chrome --web-port 7357 --dart-define=USE_LOCAL_API=true
```

En un emulador Android reemplaza la URL de la API por `http://10.0.2.2:4000/api`. En un teléfono físico conectado a la misma red Wi-Fi usa la IP local de la laptop:

```powershell
flutter run -d <ID_DEL_TELEFONO> --dart-define=USE_LOCAL_API=true --dart-define=API_BASE_URL=http://192.168.X.X:4000/api
```

La experiencia del trabajador ya incluye diseño adaptable para móvil, tablet y escritorio; búsqueda selectiva, filtros, guardados, postulación local, seguimiento y mensajes de demostración. Consulta [la guía para presentar el avance](docs/CLIENT_DEMO.md).

El panel empresarial incluye las vistas de resumen, turnos, trabajadores, mensajes y pagos con diseño adaptable y flujos interactivos. Consulta el [estado de implementación al 22 de agosto de 2026](docs/AVANCE_2026-08-22.md) para conocer funcionalidades terminadas, validaciones y próximos pasos.

Los módulos empresariales principales ya están conectados a PostgreSQL mediante endpoints CRUD autenticados. La referencia técnica se encuentra en [API CRUD empresarial](docs/API_CRUD.md).

Las cuentas y sesiones de desarrollo se guardan en PostgreSQL. Flutter conserva la sesión localmente, la valida contra `GET /api/auth/session` al iniciar y permite cerrarla desde el perfil o panel de empresa. Los tokens opacos se almacenan en la base de datos sólo como hashes.

Los pagos reales, retiros, cámara, ubicación, foto de DNI y reconocimiento facial están intencionalmente desactivados. El marketplace de la API continúa usando datos de demostración en memoria.
