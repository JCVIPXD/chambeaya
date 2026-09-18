# Plan: cerrar brechas para un flujo simple (check-in/check-out, pagos, complejidad accidental)

- Fecha: 2026-09-18
- Origen: orden del usuario — "necesito que guardes esta version del proyecto en git y abras una rama nueva para iniciar con los cambios radicales... realiza el plan para cerrar brechas" (flujo simple, pagos sin sensación de custodia, check-in/check-out con brechas).
- Supuestos: no se construye una pasarela de pago real en este ciclo (la reunión que debía definir el modelo económico real no se dio); el reencuadre de pagos se limita a naming/comportamiento interno de bajo riesgo. Rama nueva nombrada `codex/simplificacion-radical` (ya creada, ver Alcance 0).
- Preguntas abiertas: ninguna bloqueante — quedan declaradas como "fuera de alcance" en cada sección donde aplica (ver Alcance 2 y nota final del Alcance 3).

## Contexto

El objetivo del usuario es lograr un flujo lo más simple posible en Chambeaya. Hay tres frentes de dolor concretos:

1. **Pagos**: preocupa que el sistema se "sienta" como si Chambeaya retuviera dinero del usuario. La reunión para decidir el modelo de pagos reales (pasarela, comisión) no se dio y no se puede esperar más para seguir avanzando.
2. **Check-in / check-out**: el flujo tiene brechas reales que permiten fallos (turnos que quedan colgados, credenciales débiles).
3. **Complejidad general**: hay módulos que cuestan de simplificar (duplicación, código muerto, patrones repetidos).

Investigación ya realizada (3 agentes de exploración + 1 de diseño) confirma con código y línea exacta:

- **Pagos**: NO existe pasarela real ni custodia de fondos. Es un ledger de reporte manual (`Payment` PENDING→PROCESSED creado en `checkOut`, `WalletMovement` para el "wallet" del trabajador). `feeCents` está hardcoded a 0 en producción. La documentación de producto (`docs/product/memberships.md`, `roadmap.md`) ya declara explícitamente "Chambeaya no custodia fondos" y difiere cualquier pasarela real a una Fase 6 que requiere validación legal previa. El copy visible al usuario final (web empresa `apps/web/app/page.tsx`, Flutter trabajador `worker_pages.dart`) **ya está bien encuadrado** ("Confirma que ya pagaste...", "Chambeaya no administra tu dinero"). Lo que queda "sonando" a custodia es la capa interna: modelo `WalletMovement`, endpoint `GET /api/workers/wallet`, estados `RELEASED`/`REVERSED`, y que `business.service.getSubscription` crea una fila real de "trial" en BD la primera vez que alguien abre esa pantalla, aunque nadie activó nada.
- **Check-in/check-out**: `apps/api/src/modules/marketplace/marketplace.service.ts:425-484` — `checkIn` no valida ventana de tiempo (solo que `endsAt` sea futuro); `checkOut` solo exige `checkedInAt` no nulo, sin ventana propia. La credencial (`business.service.ts:236`, `` `CUMPLE-${shift.id.slice(-8)}` ``) se deriva solo del `shiftId`: en un turno con `requiredWorkers > 1`, **todas las asignaciones comparten la misma credencial**. Una asignación `CHECKED_IN` sin `checkOut` queda varada para siempre (no hay cierre automático); una asignación `ASSIGNED` sin check-in (no-show) tampoco se resuelve nunca. Esto ya está marcado como **P0 sin resolver** en `docs/product/project-master-plan.md`.
- **Complejidad accidental**: código muerto no enrutado (`worker_pages.dart`), duplicación conceptual entre `CompanyWorkerContact` (business) y `WorkerTalentProfile` (talent), un mismo bug de framework (`setState(Future)`) repetido en 6 sitios, y `main.dart` mezclando DI + theming + sesión (causó 5 rondas de auditoría solo para el modo oscuro, según `docs/PROGRESO.md`).

**Decisión implícita del usuario**: no construir una pasarela de pago real ahora (eso sigue diferido a cuando haya validación legal/reunión). Lo que sí se puede y debe hacer ya: simplificar/reencuadrar lo que existe y cerrar las brechas operativas reales de check-in/check-out, sin esperar esa reunión.

## Alcance 0 — Checkpoint en git y rama de trabajo (COMPLETADO fuera de este plan)

- **Objetivo**: dejar la versión previa (rama `codex/modelo-negocio-simplificado`) a salvo, y abrir una rama nueva para los cambios radicales sin tocar la actual.
- **Estado**: ejecutado el 2026-09-18 — commit de checkpoint `c47fa87` en `codex/modelo-negocio-simplificado`, y rama nueva `codex/simplificacion-radical` creada desde ese commit. `implementador-sonnet` debe trabajar sobre `codex/simplificacion-radical` para los alcances siguientes.

## Alcance 1 — Cerrar brechas de check-in / check-out (P0 del master plan)

- **Objetivo**: eliminar los escenarios donde un turno queda varado o una credencial se reutiliza, con el cambio mínimo (sin cron, resolviendo "al leer").
- **Cambios concretos**:
  1. Credencial aleatoria **por asignación** (no derivada del `shiftId`) en `business.service.ts:236` — resuelve que asignaciones del mismo turno multi-cupo compartan credencial.
  2. Ventana de tiempo en `checkIn` (`marketplace.service.ts:425-445`): tolerancia antes de `startsAt` y límite de tardanza; rechazo `409` fuera de ventana.
  3. Dos nuevos valores en el enum `AssignmentStatus` (`apps/api/prisma/schema.prisma:61-65`): `NO_SHOW` (confirmado, nunca hizo check-in, pasado el margen) y `ABANDONED` (hizo check-in, nunca check-out, pasado el margen). Migración Prisma additiva.
  4. Función pura de resolución (`resolveAssignmentLifecycle`) en `apps/api/src/modules/operations/shift-state.ts`, invocada solo en los puntos donde ya se toca una asignación puntual (`checkIn`, `checkOut`, lectura de turno individual en `business.service.ts`) — **no** en listados/polling, para no añadir escrituras por cada refresco.
  5. `deriveShiftStatus` (`shift-state.ts:34-51`) debe excluir `NO_SHOW`/`ABANDONED` del cálculo agregado igual que ya excluye `CANCELLED`.
  6. Endpoint nuevo de cierre manual controlado: `POST /api/business/shifts/:id/assignments/:assignmentId/resolve` (`business.routes.ts` + `business.service.ts`) con `outcome: COMPLETED | CANCELLED`, para decidir humanamente qué pasa con una asignación `ABANDONED` (evita completar pagos automáticamente sin decisión de la empresa).
- **Archivos/módulos probablemente afectados**: `apps/api/prisma/schema.prisma`, `apps/api/src/modules/operations/shift-state.ts`, `apps/api/src/modules/marketplace/marketplace.service.ts`, `apps/api/src/modules/business/business.service.ts`, `apps/api/src/modules/business/business.routes.ts`, y revisar mapeos de `AssignmentStatus` en `apps/web/app/page.tsx` y `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart` (badges de estado) para que no muestren "desconocido".
- **Validaciones requeridas**: tests nuevos en `marketplace.service.test.ts`/`marketplace.routes.test.ts` para ventana de tiempo, no-show, abandono, credenciales distintas por asignación en turno multi-cupo; suite completa de API en verde; migración Prisma aplicada sin romper datos existentes.
- **Riesgos o dependencias**: registros ya varados en producción no se autocorrigen solo con el deploy — requiere un backfill de una sola vez (fuera de este alcance, declarar como tarea aparte); revisar que ningún test dependa del valor exacto de la credencial actual (`CUMPLE-${shiftId...}`).

## Alcance 2 — Reencuadrar pagos sin construir pasarela real

- **Objetivo**: que ni la capa interna ni cualquier futura pantalla de soporte/admin "suene" a custodia de fondos, sin fusionar tablas ni romper contratos de API estables.
- **Cambios concretos** (bajo riesgo, deliberadamente acotados):
  1. **No fusionar** `Payment`+`WalletMovement` a nivel de esquema (la fusión conceptual ya ocurre en memoria en `wallet()`, `marketplace.service.ts:563-594`) — se descarta explícitamente para evitar riesgo alto por bajo beneficio.
  2. `business.service.getSubscription` (`business.service.ts:176-183`): dejar de crear una fila real de `CompanySubscription` en el primer `GET /business/subscription`; devolver un objeto sintético en memoria (`{ plan: 'PILOT', status: 'INACTIVE' }`) cuando no existe fila, y solo persistir cuando haya una activación explícita real. Antes de tocarlo, confirmar que ningún test de integración depende de que la fila se cree en el primer `GET`.
  3. Unificar el mapeo interno inconsistente en `apps/mobile_flutter/lib/features/marketplace/http_worker_marketplace_repository.dart:254-257` (mezcla `'Liberado'`/`'Reversed'` español/inglés) a español consistente — no cambia texto visible al usuario, ya traducido en `worker_pages.dart:713`.
  4. Documentar en `docs/reference/api.md` que `balanceCents`/`pendingBalanceCents` de `GET /api/workers/wallet` representan "monto confirmado por la empresa" / "monto pendiente de reporte", no saldo custodiado — deja constancia para quien mantenga o construya un panel admin futuro.
- **Explícitamente fuera de alcance**: renombrar la ruta `/api/workers/wallet`, tocar `Payment`/`WalletMovement` como tablas, o construir cualquier integración con pasarela de pago real (eso sigue esperando la decisión/reunión pendiente).
- **Archivos/módulos probablemente afectados**: `apps/api/src/modules/business/business.service.ts`, `apps/mobile_flutter/lib/features/marketplace/http_worker_marketplace_repository.dart`, `docs/reference/api.md`.
- **Validaciones requeridas**: test que confirme que llamar `GET /business/subscription` dos veces sin activar nada no crea fila en BD; suite de `business.service.test.ts`/`business.routes.test.ts` en verde; revisión de que ningún cliente rompe por el cambio de `getSubscription`.
- **Riesgos o dependencias**: verificar primero si algún test existente asume la creación de la fila trial "fantasma" antes de cambiar ese comportamiento.

## Alcance 3 — Reducir complejidad accidental identificada

- **Objetivo**: bajar la carga cognitiva del código sin cambiar comportamiento visible, atacando lo ya identificado como deuda concreta.
- **Cambios concretos** (cada uno es chico e independiente; se puede tomar todo o solo una parte):
  1. Eliminar `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart` si se confirma que ningún archivo de `lib/` lo importa (solo un test) — incluye insignias fabricadas ("Reemplazante IA") que no deberían existir. Actualizar/eliminar el test asociado.
  2. Extraer una utilidad común para el patrón repetido `setState(() => x = future)` (6 sitios en `worker_secondary_pages.dart`/`worker_discovery_page.dart`) en vez de repetirlo.
  3. Evaluar fusionar el módulo `operations` (un solo archivo, `shift-state.ts`) dentro de `marketplace` para reducir la cantidad de carpetas-módulo que hay que entender.
- **Archivos/módulos probablemente afectados**: `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart`, `worker_secondary_pages.dart`, `worker_discovery_page.dart`, `apps/api/src/modules/operations/shift-state.ts`.
- **Validaciones requeridas**: `flutter analyze`/tests de Flutter en verde tras eliminar código muerto; tests de API en verde si se mueve `shift-state.ts`.
- **Riesgos o dependencias**: confirmar con grep exhaustivo antes de borrar `worker_pages.dart` que nada lo enruta en producción (ya lo confirmó el agente de exploración, pero re-verificar en el momento de implementar).
- **Nota**: la duplicación `CompanyWorkerContact` vs `WorkerTalentProfile` y el rediseño de `main.dart` (DI/theming/sesión) son candidatos reales pero de mayor alcance/riesgo — se deja fuera de este ciclo y se declara como pendiente para un plan futuro, no se improvisa aquí.

## Orden recomendado

1. ~~Alcance 0 (checkpoint + rama)~~ — completado.
2. Alcance 1 (check-in/check-out) — es el P0 ya documentado, el de mayor riesgo operativo real (turnos varados, credencial débil). `implementador-sonnet` debe tomarlo primero.
3. Alcance 2 (pagos) — bajo riesgo, cierra la preocupación de "sensación de custodia" sin esperar la reunión pendiente.
4. Alcance 3 (limpieza) — beneficio de mantenibilidad, menor urgencia; puede tomarse parcial o después.

## Verificación end-to-end

- Alcance 1: suite de `apps/api` en verde incluyendo los tests nuevos de ventana de tiempo/no-show/abandono; probar manualmente con la demo (`docs/guides/client-demo.md`) un turno multi-cupo y confirmar credenciales distintas por trabajador.
- Alcance 2: suite de `apps/api` en verde; abrir el panel admin (`apps/web/app/admin/page.tsx`) y confirmar que una empresa nueva sin activar nada no muestra un "trial" persistido inesperadamente.
- Alcance 3: `flutter test`/`flutter analyze` en verde tras eliminar código muerto.
