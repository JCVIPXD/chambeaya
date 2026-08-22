# Cumple Now — Flutter

Aplicación adaptable de empleos temporales para Android, iOS y web. Incluye onboarding por rol, registro/login, descubrimiento de empleos, filtros, guardados, postulaciones, mensajes y perfil profesional.

## Ejecutar la demostración

```powershell
..\..\.tools\flutter\bin\flutter.bat run -d chrome --web-port 7357
```

El modo predeterminado usa datos locales y no necesita Docker. Para conectarlo a la API local:

```powershell
..\..\.tools\flutter\bin\flutter.bat run -d chrome --web-port 7357 --dart-define=USE_LOCAL_API=true
```

Para Android Emulator usa además `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. En un celular físico usa la IP local de la laptop y mantén ambos equipos en la misma red.

## Verificación

```powershell
..\..\.tools\flutter\bin\flutter.bat analyze
..\..\.tools\flutter\bin\flutter.bat test
```

La guía completa de presentación está en `../../docs/CLIENT_DEMO.md`.
