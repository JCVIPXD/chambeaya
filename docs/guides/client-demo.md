# Demostración para clientes — Chambeaya

Esta versión presenta el flujo profesional para trabajadores en Android, iOS y navegador. Los datos de empleos, postulaciones y conversaciones son ficticios y están diseñados para una demostración segura.

## Inicio rápido sin Docker

Desde la raíz del proyecto:

```powershell
npm run dev:mobile -- -Demo
```

Abre `http://localhost:7357`. El lanzador usa `web-server` para evitar pantallas en blanco por el arranque de Chrome; si necesitas una ventana Chrome administrada por Flutter, añade `-- -Device chrome`.

## Preparar la demostración persistente local

Para presentar los tres paneles conectados a PostgreSQL, inicia Docker y ejecuta
desde la raíz:

```powershell
docker compose up -d --build
npm run demo:seed
npm run demo:smoke
npm run dev:mobile
```

`npm run demo:seed` es explícito, idempotente y sólo opera sobre los registros
reservados para la demostración local. Restablece un turno con una postulación
pendiente para recorrer selección, confirmación, asistencia y pago; también deja
un turno histórico pagado para mostrar el historial de pagos (visible desde el panel
Empresa o vía `GET /api/workers/wallet`; la app Flutter no tiene una pantalla de
billetera enrutada, ver el paso 5 del recorrido). El comando
requiere exactamente `NODE_ENV=development`, se rechaza en producción y nunca se
ejecuta al iniciar Docker.

Antes de presentar, ejecuta `npm run demo:smoke`. El comando vuelve a preparar
la demo y valida por HTTP los contratos de Empresa, Trabajador y Superadmin:
sesiones y permisos por rol, postulación pendiente para decidir, historial con
pago y métricas administrativas. Sólo crea sesiones temporales y las cierra al
terminar; no acepta producción ni una API local indisponible.

## Datos sugeridos para la presentación

- Tipo de cuenta: `Quiero trabajar`
- Nombre: `Cliente Demo`
- Correo: `cliente@demo.pe`
- Contraseña: `Demo2026!`
- DNI de prueba: `12345678`

Para los paneles persistentes locales preparados con `npm run demo:seed`:

- Empresa: `empresa.demo@chambeaya.local` / `Demo2026!`
- Trabajador: `trabajador.demo@chambeaya.local` / `Demo2026!`
- Superadmin: `superadmin@chambeaya.local` / `Admin2026!`

Todos estos datos son ficticios. También puede usarse cualquier correo válido, contraseña de ocho o más caracteres y DNI de ocho dígitos.

## Recorrido recomendado

1. Abre el panel Empresa, entra a `Turnos` y selecciona `Anfitrión/a de eventos`.
2. En `Selección de talento`, muestra la postulación pendiente de Trabajador Demo y acepta el perfil. **"Ver CV" no aparece en la demo sembrada**: `npm run demo:seed`/`npm run demo:smoke` no crean ningún CV, y el botón solo se dibuja cuando la API responde `worker.hasCv: true`. Para mostrarlo, sube antes un PDF desde `Perfil` en la app Trabajador con el perfil visible; el botón abre el archivo en una pestaña nueva, en modo lectura, y el propio panel avisa que es un PDF subido por el trabajador y que Chambeaya no verifica su contenido. Si ocultas el perfil o rechazas la postulación, el botón desaparece en el siguiente refresco.
3. En el panel Trabajador, abre `Postulaciones`, confirma el turno y sigue el paso de llegada/check-in. Esa pantalla se actualiza sola cada 3 segundos: desde `CN-20260921-007` el refresco es silencioso (la lista se queda en pantalla, sin indicador de carga y sin perder el scroll) y solo se redibuja si cambió algo, así que durante la demo no verás parpadeos; el indicador a pantalla completa solo aparece la **primera** vez que se abre el panel, mientras llega la respuesta inicial (o tras "Reintentar"). Desde `CN-20260922-003` volver a entrar a la pestaña tampoco lo muestra: antes la página se remontaba en cada entrada —`WorkerShell` la montaba con `ValueKey(_applicationRevision)`— y ahora la revisión viaja como propiedad y solo dispara una recarga silenciosa, conservando en pantalla las tarjetas ya cargadas. En `Mensajes`, desde `CN-20260922-004` el sondeo de 4 segundos tampoco pinta ya el fotograma de indicador sobre la lista, y el botón "Actualizar mensajes" muestra un indicador mientras hay un refresco en curso en vez de no reaccionar; desde `CN-20260922-009` ese indicador usa el mismo color que el ícono estático al que sustituye (`onSecondaryContainer`, 7,31:1 de contraste sobre el relleno del botón en claro y en oscuro), así que se distingue con claridad en ambos temas. Continúa: completa la salida para generar el pago pendiente. El check-in real exige estar dentro de una ventana de tolerancia alrededor de la hora de inicio del turno (30 minutos antes, 60 minutos después; fuera de esa ventana el servidor responde `409` y, pasado ese margen sin check-in, la asignación queda `NO_SHOW`). `npm run demo:seed`/`npm run demo:smoke` siembran el turno de este recorrido con inicio 5 minutos antes de sembrarlo, así que la ventana se cierra unos 55 minutos después de sembrar la demo; si se pasa ese margen, vuelve a ejecutar `npm run demo:seed` (o `npm run demo:smoke`) para reiniciar la ventana antes de presentar. Si la ventana ya se cerró y no quieres volver a sembrar, esa misma pantalla sirve para mostrar el cierre manual: en Empresa → `Turnos` → `Postulaciones` la asignación aparece como "No se presentó a tiempo" con "Confirmar que sí trabajó" (deja un pago pendiente en `Pagos`, que la empresa paga directamente al trabajador) y "Cerrar sin pago"; ambas piden confirmación y no se pueden deshacer, así que úsalas solo si quieres mostrar ese caso.
4. Vuelve a Empresa, abre `Pagos` y marca el pago generado como procesado.
5. En Trabajador, confirma la recepción del pago. **La app Flutter no tiene hoy una pantalla de historial/billetera enrutada**: `workerDestinations` (`lib/core/navigation/worker_destination.dart`) solo expone Inicio, Postulaciones, Mensajes, Perfil e Invitaciones, y la única vista de billetera que existió (`lib/features/marketplace/worker_pages.dart`, no enrutada) se eliminó como código muerto. El pago histórico del turno `Apoyo de salón` que siembra la demo se puede mostrar desde el panel Empresa (`Pagos`) o consultando `GET /api/workers/wallet` directamente; no busques una pestaña de billetera en la app.
6. En Trabajador, abre `Invitaciones`: el modo demo siembra una invitación pendiente de `Restaurante La Mar` que puede aceptarse o rechazarse. Contra la API real, esa pantalla lista las invitaciones creadas desde `Talento disponible` del panel Empresa y responde llamando al servidor; la tarjeta solo cambia de estado con la respuesta real.
7. Abre Superadmin para mostrar el resumen, la empresa y el trabajador con el mismo escenario.
8. Como cierre del recorrido de Trabajador, entra a `Perfil` y activa el interruptor `Modo oscuro`: el panel de trabajador completo (inicio, postulaciones, mensajes, perfil e invitaciones, junto con sus diálogos y hojas modales) cambia a la paleta oscura en un solo fotograma —desde `CN-20260921-003` los colores ya no se funden durante 220 ms; lo único que se anima es el ícono del propio interruptor—, y la preferencia se recuerda al volver a abrir la aplicación. Puedes activarlo en cualquier punto del recorrido: cambiar de tema conserva tus postulaciones, turnos guardados y el resto del estado del panel. El resto de la aplicación no cambia de apariencia. Con el modo oscuro activo, abre `Inicio` → botón `Filtros`: desde `CN-20260921-009` los seis desplegables de la hoja "Filtros de búsqueda" se ven oscuros con el texto claro (antes eran cajas blancas con el texto casi invisible), y el contorno de los campos de texto y de los chips del trabajador es más claro que el resto de líneas divisorias para que se distinga del relleno.
9. Si necesitas repetir desde el comienzo, ejecuta de nuevo `npm run demo:smoke` y recarga los paneles.

## Vistas adaptables

- Móvil: ancho de 320 a 599 px, navegación inferior y detalle en hoja modal.
- Tablet: ancho de 600 a 1023 px, navegación lateral y cuadrícula de oportunidades.
- Escritorio/web: desde 1024 px, barra lateral, resultados y detalle simultáneo.

En Chrome DevTools pueden probarse rápidamente 390 × 844, 834 × 1112 y 1440 × 900.

## Modo con API local y Docker

Cuando Docker Desktop esté listo:

```powershell
docker compose up --build
npm run dev:mobile
```

Este modo envía registro e inicio de sesión a `http://127.0.0.1:4000/api` y consulta la API local de empleos.

En Android Emulator, inicia Flutter con `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. Para un celular físico conectado a la misma red Wi-Fi, usa la IP local de la laptop, por ejemplo `--dart-define=API_BASE_URL=http://192.168.1.50:4000/api`, y permite el puerto 4000 en el firewall de Windows.

## Límites visibles de esta entrega

- No se contacta a empleadores reales al postular.
- Pagos y retiros reales permanecen desactivados.
- Cámara, GPS, foto de DNI y reconocimiento facial permanecen desactivados.
- La validación DNI/rostro es una idea preparada para integrar cuando se contrate un proveedor autorizado.
- Los mensajes, estados y empleos del modo demostración no son persistentes.
- El `Modo oscuro` está limitado al panel de trabajador. La bienvenida, el
  inicio de sesión y el panel Empresa de la aplicación móvil siguen siempre en
  claro, incluso si el dispositivo tiene el modo oscuro del sistema activado,
  porque todavía no tienen colores oscuros propios. Los paneles web (Empresa y
  Superadmin) tampoco están incluidos.
- Dentro del panel de trabajador en oscuro quedan insignias con colores de marca
  fijos que se leen con poco contraste; la más visible es **"Postulación enviada"**
  (violeta, en `Postulaciones` e `Invitaciones`), medida en 2,46:1 en la auditoría
  `CN-20260921-010`. También "URGENTE", "EN VIVO" y el ícono del paso activo del
  recorrido del turno. Son anteriores al modo oscuro y están pendientes; si la
  demostración se hace en oscuro, conviene no detenerse en esas insignias. El
  inventario completo, con sus medidas y las del modo claro, está en la viñeta de
  `CN-20260921-009` de `docs/product/project-master-plan.md`.
