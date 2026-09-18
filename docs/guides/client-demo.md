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
un turno histórico pagado para mostrar historial y billetera. El comando
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
2. En `Selección de talento`, muestra la postulación pendiente de Trabajador Demo y acepta el perfil.
3. En el panel Trabajador, abre `Postulaciones`, confirma el turno y sigue el paso de llegada/check-in; completa la salida para generar el pago pendiente. El check-in real exige estar dentro de una ventana de tolerancia alrededor de la hora de inicio del turno (30 minutos antes, 60 minutos después; fuera de esa ventana el servidor responde `409` y, pasado ese margen sin check-in, la asignación queda `NO_SHOW`). `npm run demo:seed`/`npm run demo:smoke` siembran el turno de este recorrido con inicio 5 minutos antes de sembrarlo, así que la ventana se cierra unos 55 minutos después de sembrar la demo; si se pasa ese margen, vuelve a ejecutar `npm run demo:seed` (o `npm run demo:smoke`) para reiniciar la ventana antes de presentar.
4. Vuelve a Empresa, abre `Pagos` y marca el pago generado como procesado.
5. En Trabajador, confirma la recepción del pago. **La app Flutter no tiene hoy una pantalla de historial/billetera enrutada**: `workerDestinations` (`lib/core/navigation/worker_destination.dart`) solo expone Inicio, Postulaciones, Mensajes, Perfil e Invitaciones, y la vista de billetera que existe en `lib/features/marketplace/worker_pages.dart` no la importa ningún archivo de `lib/` (solo un test). El pago histórico del turno `Apoyo de salón` que siembra la demo se puede mostrar desde el panel Empresa (`Pagos`) o consultando `GET /api/workers/wallet` directamente; no busques una pestaña de billetera en la app.
6. En Trabajador, abre `Invitaciones`: el modo demo siembra una invitación pendiente de `Restaurante La Mar` que puede aceptarse o rechazarse. Contra la API real, esa pantalla lista las invitaciones creadas desde `Talento disponible` del panel Empresa y responde llamando al servidor; la tarjeta solo cambia de estado con la respuesta real.
7. Abre Superadmin para mostrar el resumen, la empresa y el trabajador con el mismo escenario.
8. Como cierre del recorrido de Trabajador, entra a `Perfil` y activa el interruptor `Modo oscuro`: el panel de trabajador completo (inicio, postulaciones, mensajes, perfil e invitaciones, junto con sus diálogos y hojas modales) cambia a la paleta oscura con una transición corta, y la preferencia se recuerda al volver a abrir la aplicación. Puedes activarlo en cualquier punto del recorrido: cambiar de tema conserva tus postulaciones, turnos guardados y el resto del estado del panel. El resto de la aplicación no cambia de apariencia.
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
