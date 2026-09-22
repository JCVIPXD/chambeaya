# Chambeaya — Flutter

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

Para Android Emulator usa además `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. En un celular físico usa la IP local de la laptop y mantén ambos equipos en la misma red. La demo solo se activa con `--dart-define=CHAMBEAYA_DEMO_MODE=true`.

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

## Tema, modo oscuro y contraste

`lib/theme/app_theme.dart` separa dos cosas:

- `AppColors`: colores de marca **fijos**, iguales en claro y en oscuro. Solo valen
  como relleno de acento (con contenido claro encima) o como ícono/texto de acento
  que ya se lee sobre ambos fondos.
- `AppPalette` (extensión de `ThemeData`, se lee con `context.palette`): los colores
  que **dependen de la superficie actual** — `background`, `surface`, `surfaceMuted`,
  `border`, `controlBorder`, `ink`, `muted`, `accentSoft`, `onNotice`, `shadow`.

Regla práctica: en cualquier pantalla del trabajador, un fondo de tarjeta, hoja o
control, y el color de un texto o borde sobre ese fondo, se toman de `context.palette`
o del tema; nunca de `Colors.white`, `Colors.grey*` ni de un literal claro. Un color
fijo se ve bien en claro y desaparece en oscuro: fue exactamente el defecto de los
filtros de búsqueda que corrigió `CN-20260921-009`.

Dos tokens existen por razones de contraste y conviene no confundirlos:

- `controlBorder` es el contorno de los controles interactivos (campos de texto,
  chips) y debe distinguirse de su propio relleno (WCAG 1.4.11, 3:1). `border` es el
  hairline decorativo de tarjetas y divisores y puede ser mucho más sutil. En claro
  ambos valen lo mismo; en oscuro `controlBorder` es un tono más claro.
- `onNotice` es el texto sobre el relleno ámbar fijo del aviso de error
  (`#FFF4E5` en ambos modos): al ser un fondo claro siempre, el texto no puede
  heredar el `muted` de la paleta oscura.

El modo oscuro cubre **solo** el panel de trabajador. La bienvenida, el inicio de
sesión y el panel de empresa están fijados en claro y `test/dark_theme_scope_test.dart`
lo impide cambiar por accidente. `test/worker_filter_contrast_test.dart` mide razones
de contraste WCAG sobre el árbol renderizado de la búsqueda y los filtros en ambos
modos; es el lugar donde añadir una comprobación al tocar esos colores.

## Google Sign-In local

Con `GOOGLE_OAUTH_WEB_CLIENT_ID` en el `.env` de la raíz, `npm run dev:mobile`
lo transmite como un `dart-define` seguro para el identificador público. La
pantalla de acceso muestra primero el botón oficial de Google. Solo después de
validar una cuenta nueva solicita el DNI y una contraseña nueva, exclusiva de
Chambeaya, mediante un comprobante temporal del servidor; nunca solicita ni
conserva la contraseña de Google. Luego abre el perfil para completar CV,
especialidades y disponibilidad. Autoriza `http://localhost` y
`http://localhost:7357` como orígenes JavaScript en Google Cloud; no se envía
ningún secreto de OAuth a Flutter.
