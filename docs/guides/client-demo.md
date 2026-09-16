# Demostración para clientes — Cumple Now

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

- Empresa: `empresa.demo@cumplenow.local` / `Demo2026!`
- Trabajador: `trabajador.demo@cumplenow.local` / `Demo2026!`
- Superadmin: `superadmin@cumplenow.local` / `Admin2026!`

Todos estos datos son ficticios. También puede usarse cualquier correo válido, contraseña de ocho o más caracteres y DNI de ocho dígitos.

## Recorrido recomendado

1. Abre el panel Empresa, entra a `Turnos` y selecciona `Anfitrión/a de eventos`.
2. En `Selección de talento`, muestra la postulación pendiente de Trabajador Demo y acepta el perfil.
3. En el panel Trabajador, abre `Postulaciones`, confirma el turno y sigue el paso de llegada/check-in; completa la salida para generar el pago pendiente.
4. Vuelve a Empresa, abre `Pagos` y marca el pago generado como procesado.
5. En Trabajador, confirma la recepción y abre el historial/billetera; el turno `Apoyo de salón` ya muestra un pago histórico liberado.
6. En Trabajador, abre `Invitaciones`: el modo demo siembra una invitación pendiente de `Restaurante La Mar` que puede aceptarse o rechazarse. Contra la API real, esa pantalla lista las invitaciones creadas desde `Talento disponible` del panel Empresa y responde llamando al servidor; la tarjeta solo cambia de estado con la respuesta real.
7. Abre Superadmin para mostrar el resumen, la empresa y el trabajador con el mismo escenario.
8. Si necesitas repetir desde el comienzo, ejecuta de nuevo `npm run demo:smoke` y recarga los paneles.

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
