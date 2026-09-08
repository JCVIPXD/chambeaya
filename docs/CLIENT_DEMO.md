# Demostración para clientes — Cumple Now

Esta versión presenta el flujo profesional para trabajadores en Android, iOS y navegador. Los datos de empleos, postulaciones y conversaciones son ficticios y están diseñados para una demostración segura.

## Inicio rápido sin Docker

Desde la raíz del proyecto:

```powershell
npm run dev:mobile
```

Abre `http://localhost:7357`. El lanzador usa `web-server` para evitar pantallas en blanco por el arranque de Chrome; si necesitas una ventana Chrome administrada por Flutter, añade `-- -Device chrome`.

## Preparar la demostración persistente local

Para presentar los tres paneles conectados a PostgreSQL, inicia Docker y ejecuta
desde la raíz:

```powershell
docker compose up -d --build
npm run demo:seed
npm run dev:mobile -- -UseLocalApi
```

`npm run demo:seed` es explícito, idempotente y sólo opera sobre los registros
reservados para la demostración local. Restablece un turno con una postulación
pendiente para recorrer selección, confirmación, asistencia y pago; también deja
un turno histórico pagado para mostrar historial y billetera. El comando
requiere exactamente `NODE_ENV=development`, se rechaza en producción y nunca se
ejecuta al iniciar Docker.

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

1. Completa el onboarding como trabajador y crea la cuenta de demostración.
2. En `Inicio`, busca `mozo`, `hotel` o `Miraflores`.
3. Activa los filtros `Urgentes` y `Recomendados`, y después usa `Limpiar filtros`.
4. Guarda una oportunidad con el icono de marcador.
5. En escritorio, revisa el detalle lateral y pulsa `Postular ahora`.
6. Abre `Postulaciones` para mostrar las etapas del proceso.
7. Abre `Mensajes` para mostrar conversaciones seguras de ejemplo.
8. Abre `Perfil` para mostrar reputación, certificados y experiencia.
9. Usa `Datos de demostración` para alternar entre resultados normales, lista vacía y error simulado.

## Vistas adaptables

- Móvil: ancho de 320 a 599 px, navegación inferior y detalle en hoja modal.
- Tablet: ancho de 600 a 1023 px, navegación lateral y cuadrícula de oportunidades.
- Escritorio/web: desde 1024 px, barra lateral, resultados y detalle simultáneo.

En Chrome DevTools pueden probarse rápidamente 390 × 844, 834 × 1112 y 1440 × 900.

## Modo con API local y Docker

Cuando Docker Desktop esté listo:

```powershell
docker compose up --build
npm run dev:mobile -- -UseLocalApi
```

Este modo envía registro e inicio de sesión a `http://127.0.0.1:4000/api` y consulta la API local de empleos.

En Android Emulator, inicia Flutter con `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. Para un celular físico conectado a la misma red Wi-Fi, usa la IP local de la laptop, por ejemplo `--dart-define=API_BASE_URL=http://192.168.1.50:4000/api`, y permite el puerto 4000 en el firewall de Windows.

## Límites visibles de esta entrega

- No se contacta a empleadores reales al postular.
- Pagos y retiros reales permanecen desactivados.
- Cámara, GPS, foto de DNI y reconocimiento facial permanecen desactivados.
- La validación DNI/rostro es una idea preparada para integrar cuando se contrate un proveedor autorizado.
- Los mensajes, estados y empleos del modo demostración no son persistentes.
