# Cumple Now — Flutter

Aplicación adaptable de empleos temporales para Android, iOS y web. Incluye onboarding por rol, registro/login, descubrimiento de empleos, filtros, guardados, postulaciones, mensajes y perfil profesional.

## Ejecutar la demostración

```powershell
npm run dev:mobile
```

El modo predeterminado usa datos locales y no necesita Docker. Para conectarlo a la API local:

```powershell
npm run dev:mobile -- -UseLocalApi
```

El lanzador detecta el SDK de Flutter instalado, usa `web-server` en el puerto
`7357` y evita depender de un Flutter embebido en `.tools`. Para abrir una
ventana Chrome administrada por Flutter usa `npm run dev:mobile -- -Device chrome`.

Para Android Emulator usa además `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. En un celular físico usa la IP local de la laptop y mantén ambos equipos en la misma red.

## Verificación

```powershell
..\..\.tools\flutter\bin\flutter.bat analyze
..\..\.tools\flutter\bin\flutter.bat test
```

La guía completa de presentación está en `../../docs/CLIENT_DEMO.md`.
