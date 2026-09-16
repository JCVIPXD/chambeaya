# Cumple Now — Flutter

Aplicación adaptable de empleos temporales para Android, iOS y web. Incluye onboarding por rol, registro/login, descubrimiento de empleos, filtros, guardados, postulaciones, mensajes y perfil profesional.

## Ejecutar con la API local

```powershell
npm run dev:mobile
```

El modo predeterminado usa la API configurada y valida su healthcheck antes de
abrir Flutter. Para una demostración aislada, sin Docker ni datos persistentes:

```powershell
npm run dev:mobile -- -Demo
```

El lanzador detecta el SDK de Flutter instalado, usa `web-server` en
`http://localhost:7357` y evita depender de un Flutter embebido en `.tools`. Para abrir una
ventana Chrome administrada por Flutter usa `npm run dev:mobile -- -Device chrome`.

Para Android Emulator usa además `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. En un celular físico usa la IP local de la laptop y mantén ambos equipos en la misma red. La demo solo se activa con `--dart-define=CUMPLENOW_DEMO_MODE=true`.

## Verificación

```powershell
flutter analyze
flutter test
```

GitHub Actions ejecuta estas dos comprobaciones con Flutter estable `3.44.0`,
las dependencias bloqueadas en `pubspec.lock` y caché del SDK y de Pub. El
workflow se activa al cambiar esta aplicación o su configuración de CI.

La guía completa de presentación está en
[`../../docs/guides/client-demo.md`](../../docs/guides/client-demo.md).

## Google Sign-In local

Con `GOOGLE_OAUTH_WEB_CLIENT_ID` en el `.env` de la raíz, `npm run dev:mobile`
lo transmite como un `dart-define` seguro para el identificador público. La
pantalla de acceso muestra primero el botón oficial de Google. Solo después de
validar una cuenta nueva solicita el DNI y una contraseña nueva, exclusiva de
Cumple Now, mediante un comprobante temporal del servidor; nunca solicita ni
conserva la contraseña de Google. Luego abre el perfil para completar CV,
especialidades y disponibilidad. Autoriza `http://localhost` y
`http://localhost:7357` como orígenes JavaScript en Google Cloud; no se envía
ningún secreto de OAuth a Flutter.
