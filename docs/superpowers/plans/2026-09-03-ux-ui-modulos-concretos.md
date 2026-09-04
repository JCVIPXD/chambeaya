# Plan UX/UI — módulos concretos y flujo sin redundancia

## Objetivo

Hacer que CumpleNow se entienda como una secuencia corta y repetible. Cada
módulo tendrá una responsabilidad única, una acción principal y estados claros.
Las excepciones vivirán dentro del turno que las originó; no se crearán pantallas
paralelas para resolverlas.

Este plan cubre primero UX/UI. No activa membresías, QR, pagos intermediados ni
automatizaciones que todavía no tengan soporte operativo.

## Regla de arquitectura de información

Cada pantalla debe responder:

1. ¿Qué estoy viendo?
2. ¿Qué puedo hacer aquí?
3. ¿Cuál es el siguiente paso?

Si una acción aparece en dos módulos, solo uno será su dueño. El otro módulo
podrá mostrar un resumen o un enlace contextual, pero no duplicará el control.

## Mapa de módulos objetivo

### Trabajador

| Módulo | Responsabilidad única | Acciones permitidas |
| --- | --- | --- |
| **Inicio** | Descubrir oportunidades | Buscar, filtrar, guardar, abrir detalle y postular |
| **Postulaciones** | Seguir cada turno propio | Confirmar asistencia, indicar que no podrá asistir, registrar llegada, registrar salida y reportar incidencia |
| **Mensajes** | Coordinar con empresas | Leer y enviar mensajes relacionados con un turno |
| **Perfil** | Identidad y preferencias | Editar datos, disponibilidad, preferencias y reputación |

Decisiones de simplificación:

- “Buscar” no será una pestaña separada: vive dentro de Inicio.
- Check-in y check-out solo se ejecutan desde Postulaciones.
- El historial de pagos se consulta dentro de la postulación finalizada; Perfil
  puede mostrar un resumen, pero no crea otro flujo de pagos.
- La disponibilidad se modifica en Perfil; Inicio solo muestra el estado actual.

### Empresa

| Módulo | Responsabilidad única | Acciones permitidas |
| --- | --- | --- |
| **Resumen** | Ver prioridades | Ir al turno pendiente, revisar alertas y consultar métricas |
| **Turnos** | Operar el ciclo completo | Publicar, revisar postulantes, aceptar/rechazar, validar asistencia, resolver incidencias y cerrar |
| **Trabajadores** | Consultar equipo conocido | Buscar perfiles, ver historial y abrir conversación; no seleccionar candidatos |
| **Mensajes** | Coordinar conversaciones | Leer, responder y ver el turno relacionado |
| **Pagos** | Reportar pagos de turnos cerrados | Registrar referencia, registrar pago parcial, marcar incidencia y corregir sin borrar historial |
| **Membresía** | Presentar propuesta futura | Consultar planes y beneficios; no cobrar ni bloquear operaciones |

Decisiones de simplificación:

- La selección de postulantes solo ocurre dentro del turno seleccionado.
- Asistencia, ausencia, reemplazo e incidencia se resuelven desde ese mismo
  turno.
- Trabajadores no será un segundo lugar para aceptar candidatos.
- Resumen tendrá enlaces de prioridad, no formularios duplicados.
- Pagos solo mostrará movimientos vinculados a un turno o asignación.

### Superadmin

| Módulo | Responsabilidad única | Acciones permitidas |
| --- | --- | --- |
| **Empresas** | Supervisar cuentas | Revisar empresa, estado y suscripción |
| **Trabajadores** | Supervisar identidades | Revisar perfil, verificación y estado |
| **Turnos** | Auditar operación | Consultar eventos, incidencias y trazabilidad |
| **Membresías** | Administrar planes futuros | Cambiar plan manualmente, registrar motivo y consultar historial |

Superadmin no ejecuta acciones operativas en nombre de una empresa salvo una
acción de soporte explícitamente auditada.

## Estados y acción principal

### Postulación del trabajador

La tarjeta muestra una sola acción primaria según el estado:

- **En revisión** → Esperar decisión.
- **Seleccionado** → Confirmar asistencia o indicar que no podrá asistir.
- **Confirmado** → Registrar llegada.
- **En turno** → Registrar salida.
- **Finalizado** → Revisar pago.
- **Incidencia** → Completar información solicitada.

Cancelar queda como acción secundaria antes del inicio y siempre exige motivo.
No se deben mostrar simultáneamente dos botones primarios para el mismo estado.

### Turno de empresa

El detalle del turno sigue una línea única:

`Publicar → Revisar → Aceptar → Confirmar cobertura → Validar asistencia → Reportar pago → Cerrar`

Cada paso debe indicar responsable, fecha/hora y resultado. Si algo falla, el
estado cambia a **Incidencia** y la resolución permanece dentro del turno.

## Fases de implementación

### Fase 1 — Inventario y limpieza de navegación

- Eliminar accesos duplicados y renombrar acciones ambiguas.
- Revisar navegación móvil, tablet y escritorio con el mismo mapa mental.
- Definir una fuente única de verdad para estados y etiquetas.
- Retirar botones que no ejecutan una operación real.

**Salida:** mapa de navegación aprobado y matriz de acciones por módulo.

### Fase 2 — Trabajador

- Consolidar Inicio como descubrimiento.
- Rediseñar Postulaciones como centro de estados y acciones.
- Mover check-in, check-out e incidencias al detalle de la postulación.
- Mostrar pago, referencia e incidencia en el cierre del turno.
- Dejar Perfil para identidad, disponibilidad y preferencias.

**Salida:** un trabajador puede completar el flujo sin entrar a más de cuatro
módulos ni buscar la siguiente acción.

### Fase 3 — Empresa

- Convertir el detalle de Turnos en el centro operativo.
- Separar claramente selección, asistencia y pago dentro del mismo contexto.
- Añadir confirmación y deshacer para acciones irreversibles.
- Exigir motivo al rechazar, cancelar o registrar una incidencia.
- Vincular cada pago a turno, asignación y trabajador antes de ampliar reportes.

**Salida:** la empresa puede cerrar un turno sin saltar entre Turnos, Trabajadores
y Pagos para completar una operación.

### Fase 4 — Excepciones y confianza

- Diseñar “No podré asistir”, ausencia, salida anticipada y pago parcial.
- Añadir responsable alterno y permisos por rol.
- Diseñar fallback de conectividad: código corto o registro pendiente de
  sincronización.
- Mantener auditoría visible sin exponer datos sensibles.

**Salida:** cada excepción tiene una ruta corta, reversible y trazable.

### Fase 5 — Validación visual y de uso

- Probar móvil 320/390 px, tablet 834 px y escritorio 1440 px.
- Verificar navegación por teclado, foco, contraste y textos de error.
- Ejecutar pruebas de tareas con trabajador, empresa y superadmin.
- Medir tiempo hasta la siguiente acción y errores por tarea.

**Criterio de aprobación:** una persona nueva puede explicar dónde está, qué
debe hacer y qué ocurre si algo sale mal sin ayuda externa.

## Reglas que no se deben romper

- No crear una pestaña solo porque una función tiene muchos estados.
- No mostrar una acción si el backend todavía no puede ejecutarla.
- No usar “billetera”, “saldo”, “retiro” o “pago liberado” en el flujo principal.
- No pedir al trabajador que escanee el QR de otra persona ni que muestre un QR
  personal.
- No activar membresías hasta medir recurrencia y valor operativo.
- No esconder incidencias en notificaciones: deben quedar visibles en el turno.

## Entregables de la primera iteración

1. Matriz de módulos y acciones aprobada.
2. Wireflow de trabajador y empresa con estados normales y excepciones.
3. Inventario de componentes duplicados o no funcionales.
4. Prototipo de detalle de turno como centro operativo.
5. Suite de pruebas de navegación y estados principales.

