# Moneda virtual y puestos fijos

Decidido el 2026-10-01. Es un cambio de enfoque: Chambeaya pasa de turnos
temporales con pago a **puestos fijos formales** movidos por una **moneda
virtual** común a empresas y trabajadores. Este documento es producto y diseño;
el avance operativo vive solo en [`../PROGRESO.md`](../PROGRESO.md).

## Decisiones

1. **Una sola moneda** para empresas y trabajadores, con nombre propio. Nombre
   de trabajo: **Chambitas** (configurable, no fijado en el código). Alternativa
   considerada: *Chispas*.
2. **Quién la usa:** ambos lados, **sin invadir**. Un usuario molesto elegirá
   otra opción, así que la moneda solo se pide en acciones de alto valor y
   nunca en las básicas.
3. **Turnos temporales:** se mantienen **inactivos** con una bandera, no se
   borran. Se reutiliza su infraestructura (postulaciones, asignaciones,
   conversaciones, reseñas, perfiles de talento, invitaciones, eventos).
4. **Puesto fijo:** trabajo **formal**, de tiempo completo o parcial, con todo
   el proceso: postulación, preselección, entrevista, oferta, aceptación,
   contrato e ingreso.
5. **Pagos reales:** quedan para después. Pausados los alcances G (Culqi), H
   (liquidación de comisiones), I (suscripciones) y J (cierre de pagos) del
   [plan de Culqi](roadmap.md). Lo ya auditado (modo manual, adaptadores y
   proveedor simulado) se conserva sin cambios.

## Naturaleza de la moneda (restricciones de diseño)

La moneda es **crédito cerrado**: no se retira por dinero, no se transfiere
entre usuarios y solo se canjea por acciones de la plataforma. Así se evita que
encaje en el régimen de dinero electrónico y se simplifica el diseño. Cuando
llegue la compra con dinero real se valida con un abogado antes de
implementarla.

Reglas técnicas obligatorias:

- Libro mayor **solo de suma** (append-only): cada movimiento es una fila
  inmutable; el saldo se deriva y nunca se edita.
- **Idempotencia** por clave en cada movimiento (reintentos y webhooks no
  duplican).
- **Sin saldo negativo** y sin gasto doble bajo concurrencia.
- Cada movimiento guarda quién, qué acción, cuánto, saldo resultante y la
  entidad relacionada (puesto, postulación).
- Costos y premios **configurables por el admin** y con historial de cambios,
  igual que `PlatformSettings` hoy.
- Ajustes manuales del admin con motivo obligatorio.

## Qué pide monedas y qué no

Principio: lo básico siempre es gratis; se cobra el valor extra, nunca el
camino principal.

| Siempre gratis | Empresa gasta | Trabajador gasta |
|---|---|---|
| Registrarse, completar el perfil, explorar puestos, chatear con quien ya interactuó, aceptar una oferta, calificar | Publicar más allá de la cuota gratuita mensual, destacar un puesto, invitar de forma proactiva a un candidato, desbloquear CV o contacto de un candidato que no postuló | Postular más allá de la cuota gratuita mensual, postulación destacada o con prioridad, destacar el perfil |

| Empresa gana | Trabajador gana |
|---|---|
| Verificar la empresa, responder postulantes dentro del plazo, cerrar un puesto con contratación confirmada | Perfil completo, verificar documentos, experiencia y certificados, responder invitaciones, referir a otros, bono de bienvenida |

Mecanismos para no molestar:

- Cuota mensual gratuita de publicaciones y postulaciones.
- **Devolución automática** de monedas si la otra parte no responde en el plazo.
- Bono de bienvenida suficiente para probar todo el flujo.
- Tope de gasto diario y confirmación solo cuando el costo es relevante.
- Ninguna acción esencial (por ejemplo, aceptar una oferta o responder a quien
  ya te escribió) queda bloqueada por falta de saldo.

El catálogo final, con montos, lo fija el dueño del producto en el alcance M2.

## Puesto fijo y proceso de contrato

Estados del proceso de selección:

`Postulado → Preseleccionado → Entrevista → Oferta → Aceptada → Contratado`
(con `Rechazado` y `Retirado` como salidas).

Datos del puesto: modalidad (tiempo completo o parcial), sueldo o rango,
ubicación o remoto, requisitos, beneficios, tipo de contrato y fecha de ingreso.

Alcance inicial del contrato: la empresa registra la oferta, el trabajador la
acepta en la plataforma y queda constancia con fecha, condiciones y documento
adjunto. La **firma digital** y la integración con planilla son una etapa
posterior.

**Riesgo legal a validar antes de operar:** al intermediar empleo formal,
Chambeaya puede quedar bajo el marco peruano de agencias y bolsas de empleo y
sus obligaciones, y la contratación laboral (contrato, planilla, T-Registro)
sigue siendo responsabilidad de la empresa. Requiere revisión legal; no es
asesoría.

## Qué se reutiliza

| Existe hoy | Uso en el nuevo enfoque |
|---|---|
| `ShiftApplication` y `ShiftAssignment` | Patrón de la postulación y del embudo de selección |
| `WorkerTalentProfile`, experiencia, certificaciones, idiomas, documentos | Perfil del candidato y premios por completarlo |
| `TalentInvitation` | Invitación proactiva (acción con costo) |
| `Conversation` y `Message` | Chat de entrevista |
| `AssignmentReview` | Calificación posterior a la contratación |
| `ShiftEvent` | Línea de tiempo y auditoría del proceso |
| `WalletMovement` (solo trabajadores) | Se generaliza o reemplaza por el libro mayor único |
| `PlatformSettings` y `PlatformSettingChange` | Costos y premios configurables con historial |
| Adaptadores de pago | Compra de monedas en el alcance M7 |

## Alcances

Cada alcance lo programa Codex, se registra en `PROGRESO.md` y se cierra solo
con una auditoría `APROBADO`.

| ID | Alcance | Entrega |
|---|---|---|
| **M0** | Decisiones y congelamiento | Este documento, bandera que desactiva los turnos temporales y pausa de G a J |
| **M1** | Libro mayor de monedas | Cuenta por usuario y por empresa, movimientos inmutables, saldo derivado, idempotencia, concurrencia sin gasto doble, ajustes del admin, API de saldo y movimientos |
| **M2** | Catálogo de costos y premios | Tabla configurable por el admin con historial, cuotas gratuitas y reglas de devolución |
| **M3** | Puestos fijos | Modelo de puesto y embudo de selección con oferta y aceptación |
| **M4** | Acciones conectadas | Aplicar el catálogo de M2 a publicar, postular, destacar, invitar y desbloquear contacto |
| **M5** | Interfaces | Panel web de empresa y trabajador y Flutter con saldo, movimientos y proceso de selección |
| **M6** | Ganar monedas | Premios por perfil completo, verificaciones, referidos y constancia |
| **M7** | Compra de monedas | Reutiliza la capa de adaptadores; requiere el pronunciamiento legal sobre la moneda |

M2 y M3 pueden avanzar en paralelo con M1; se unen en M4.

## Pendientes del dueño del producto

1. Confirmar el nombre final de la moneda y su identidad visual.
2. Fijar el catálogo de M2: qué acciones cuestan o rinden y cuánto, cuotas
   gratuitas y plazo de devolución.
3. Definir qué datos y documentos exige el proceso de contrato de un puesto fijo.
4. Consultar a un abogado laboral y financiero sobre la moneda y sobre la
   intermediación de empleo formal.
