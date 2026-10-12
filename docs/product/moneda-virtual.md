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

El catálogo final, con montos, lo fija el dueño del producto. M2 entrega la
tabla configurable con valores **provisionales** (ver la sección siguiente).

## Valores provisionales del catálogo (M2)

M2 siembra estos valores **PROVISIONALES** para poder probar el flujo; el dueño
del producto los ajustará desde la API de administración (cada entrada queda con
`isProvisional = true` hasta su primera edición, y cada cambio guarda quién,
cuándo, motivo y valor anterior/nuevo). Desde M4 los usan publicar, postular, destacar, invitar y desbloquear
contacto; los premios, salvo el bono de bienvenida, se otorgan desde M6 (ver «Ganar monedas»). Fuente: `apps/api/src/modules/currency/currency.catalog.ts` y la
migración `20261005120000_currency_catalog`.

| Acción | Actor | Tipo | Monto | Cuota gratis/mes | Devolución |
|---|---|---|---|---|---|
| Publicar más allá de la cuota (`JOB_PUBLISH_EXTRA`) | Empresa | Costo | 10 | 3 | no |
| Destacar un puesto (`JOB_HIGHLIGHT`) | Empresa | Costo | 10 | 0 | no |
| Invitar a un candidato (`TALENT_INVITE`) | Empresa | Costo | 5 | 0 | 72 h |
| Desbloquear contacto (`CANDIDATE_CONTACT_UNLOCK`) | Empresa | Costo | 10 | 0 | no |
| Postular más allá de la cuota (`APPLICATION_EXTRA`) | Trabajador | Costo | 5 | 10 | 72 h |
| Postulación con prioridad (`APPLICATION_PRIORITY`) | Trabajador | Costo | 10 | 0 | 72 h |
| Destacar el perfil (`PROFILE_HIGHLIGHT`) | Trabajador | Costo | 10 | 0 | no |
| Perfil completo (`PROFILE_COMPLETE`) | Trabajador | Premio | 20 | | |
| Documento verificado (`DOCUMENT_VERIFIED`) | Trabajador | Premio | 10 | | |
| Invitación respondida (`INVITATION_RESPONDED`) | Trabajador | Premio | 5 | | |
| Referido (`REFERRAL`) | Trabajador | Premio | 20 | | |
| Empresa verificada (`COMPANY_VERIFIED`) | Empresa | Premio | 20 | | |
| Postulantes respondidos a tiempo (`APPLICANTS_RESPONDED_ON_TIME`) | Empresa | Premio | 5 | | |
| Contratación confirmada (`HIRE_CONFIRMED`) | Empresa | Premio | 20 | | |
| Bono de bienvenida (`WELCOME_BONUS`) | Ambos (50 c/u) | Premio | 50 | | |

Reglas: la cuota gratuita cuenta por mes calendario de **Lima**; la devolución
de 72 h se sembró solo en las acciones donde la otra parte puede no responder
(invitar y postular) y la ejecuta M4. Lo básico sigue siendo gratis y
una acción inactiva o sin entrada nunca se bloquea.

### Valores provisionales nuevos de M4

Editables por el admin con historial (`/api/admin/currency/settings`), sembrados
con `isProvisional = true`:

| Ajuste | Valor |
|---|---|
| `DAILY_SPEND_CAP_WORKER` (tope diario del trabajador, día de Lima) | 200 monedas |
| `DAILY_SPEND_CAP_COMPANY` (tope diario de la empresa) | 200 monedas |
| `JOB_HIGHLIGHT_DURATION_HOURS` (duración de un puesto destacado) | 168 h (7 días) |

También son provisionales el intervalo de la tarea de devolución (5 min, por
`CURRENCY_REFUND_INTERVAL_MS`) y la ventana de 72 h. `PROFILE_HIGHLIGHT`, diferido
en M4 porque la búsqueda de talento no tenía campo de destacado, se resuelve en M6.

## Ganar monedas (M6, cerrado: `CN-20261012-047`, auditoría `CN-20261012-048`)

Premios automáticos, solo API y datos (las interfaces son M5). Todos los montos son los
**provisionales** del catálogo de M2 y todos los ajustes siguientes son **provisionales**
(editables por el admin con historial). Detalle técnico en
[api.md](../reference/api.md#ganar-monedas-premios-automáticos-m6).

| Premio | Quién | Cuándo se gana | Tope contra granjas |
|---|---|---|---|
| Perfil completo | Trabajador | Al cumplir **todas** las secciones obligatorias: titular (≥ 10 caracteres), presentación (≥ 40), distrito, disponibilidad (día y periodo), una especialidad, una experiencia, CV y foto | Una sola vez por trabajador aunque edite, borre y vuelva a completar |
| Documento verificado | Trabajador | El admin verifica el CV o la foto (con autor y fecha) | Un premio por **tipo** de documento (máximo 2); reemplazar el archivo quita la verificación sin repetir el premio |
| Invitación respondida | Trabajador | Aceptar o rechazar una invitación dentro del plazo | Una vez por invitación; una anulada, vencida o ya respondida no paga |
| Referido | Trabajador | Cuando la persona que registró con su código **completa su perfil** (no al registrarse) | Referido único, sin auto-referido, límite mensual por referidor y topes de premios |
| Empresa verificada | Empresa | El admin verifica la empresa (autor y fecha) | Una vez por empresa |
| Postulantes respondidos a tiempo | Empresa | Mover una postulación fuera de «Postulado» dentro del plazo | Una vez por postulación y tope mensual por empresa |
| Contratación confirmada | Empresa | Al confirmar «Contratado» | Una vez por contratación |

**Reglas de todos los premios.** Atómicos con el hecho que los dispara (si el hecho se
revierte no queda premio; si el premio falla por un error técnico, el hecho se conserva y el
premio se reintenta cuando el hecho vuelva a evaluarse); idempotentes por hecho (nunca doble
premio, ni con acciones simultáneas); una entrada inactiva o ausente del catálogo significa «sin
premio»; no gastan ni dejan saldo negativo; **no cuentan para el tope de gasto** diario; y quedan
en el libro con su acción y la entidad relacionada. La lista de premios disponibles de cada actor,
con su estado (ganado o disponible) y lo que falta, se lee por API para que M5 la muestre.

**Reglas anti-fraude vigentes:** tope diario y mensual de monedas ganadas por premios por
titular (el bono de bienvenida no cuenta); un premio por hecho (clave única); un premio por tipo de
documento; referidos únicos, sin auto-referido y pagados solo con perfil completo, con límite
mensual; respuesta a tiempo una vez por postulación con tope mensual por empresa; las verificaciones
solo las hace el admin. Riesgo declarado: una misma persona puede crear cuentas con DNI y correo
distintos; el costo de completar cada perfil y los topes acotan el beneficio, y no hay detección de
duplicados por persona.

### Valores provisionales nuevos de M6

| Ajuste | Valor |
|---|---|
| `REWARD_CAP_DAILY_WORKER` / `REWARD_CAP_DAILY_COMPANY` (monedas ganadas por premios por día de Lima) | 100 / 100 |
| `REWARD_CAP_MONTHLY_WORKER` / `REWARD_CAP_MONTHLY_COMPANY` (por mes de Lima) | 600 / 600 |
| `REFERRAL_MONTHLY_LIMIT` (referidos premiados por referidor y mes) | 5 |
| `APPLICANT_RESPONSE_WINDOW_HOURS` (plazo para responder una postulación) | 72 h |
| `APPLICANT_RESPONSE_MONTHLY_LIMIT` (premios de respuesta por empresa y mes) | 20 |
| `PROFILE_HIGHLIGHT_DURATION_HOURS` (duración de un perfil destacado) | 168 h (7 días) |

Los umbrales de «perfil completo» (longitudes mínimas de titular y presentación y la lista de
secciones) son decisiones de diseño del código, no ajustes: cambiarlos requiere un cambio de código.

**Destacar el perfil (`PROFILE_HIGHLIGHT`, cerrado en M6).** El trabajador paga el costo del
catálogo (10 monedas provisional) y su perfil aparece primero en la búsqueda de talento durante
la duración configurada. La paginación de la búsqueda usa un cursor que fija el instante de la
primera página, así que un destacado que vence a mitad de la paginación no repite ni salta perfiles.
Un perfil oculto no se puede destacar.

**Verificaciones del admin (decisión de diseño).** No existía un flujo de verificación: M6 agrega
las rutas mínimas del admin para marcar verificado un documento del trabajador o una empresa, con
autor y fecha, y para quitar la verificación (quitarla no devuelve ni descuenta monedas).

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

Decisiones de producto del diseño de M3 (detalle técnico en
[api.md](../reference/api.md#puestos-fijos-y-embudo-de-selección-m3)):

- El trabajador que rechaza una oferta sale como **Retirado**: **Rechazado**
  es siempre una decisión de la empresa. El motivo del rechazo es una nota
  interna que el trabajador no ve.
- Las **vacantes cubiertas** no se editan: solo suben con cada contratación
  confirmada; al llenarse, el puesto pasa a **Cubierto** y deja de recibir
  postulaciones.
- Una oferta nueva crea una **versión**; al aceptarse, las condiciones quedan
  congeladas (constancia con fecha, empresa, trabajador, condiciones y huella
  del documento adjunto) y no se pueden modificar.
- **Re-postulación flexible (decisión del dueño, resuelta en M4):** quien se
  retiró (incluido rechazar una oferta) puede volver a postular al mismo puesto;
  se reactiva la misma postulación con su historial y no se cobra de nuevo.
  Quien fue rechazado por la empresa no puede. Tampoco se reabre una postulación
  que ya tiene una oferta aceptada (`409 APPLICATION_HAS_ACCEPTED_OFFER`): la
  constancia es inmutable.
- El total de vacantes de un puesto abierto siempre supera lo cubierto: no se
  puede bajar hasta igualarlo, y publicar o postular exige una vacante libre.
- Al **cerrar** o **cubrir** un puesto, las ofertas sin responder se retiran y
  esas postulaciones pasan a **Rechazado**, con aviso al trabajador
  (interpretación a confirmar). Desde M4 también las postulaciones
  **aceptadas** y no contratadas pasan a **Rechazado** con el motivo del cierre
  o la cobertura (`autoClosedReason`) y aviso al trabajador (ver «caducados
  ocultos» abajo); las aceptadas que ya estaban sobre un puesto cerrado antes de
  M4 no se resuelven solas. Las demás postulaciones abiertas no cambian.
- **Decisiones del dueño resueltas en M4:** (1) la empresa ve el DNI del
  trabajador solo tras la aceptación de la oferta, sin costo de moneda; (2) la
  **constancia se conserva**: no se borra por cascada y el borrado de la cuenta
  se bloquea con `409 CONTRACT_RECORDS_RETAINED` mientras haya ofertas aceptadas
  (se guarda como evidencia del acuerdo, soporte y disputas, retención legal y
  antifraude; la anonimización es alcance futuro); (3) **lo caducado no se
  muestra**: las postulaciones aceptadas sobre un puesto cerrado o cubierto se
  rechazan automáticamente con aviso y las listas del trabajador las ocultan
  salvo con el filtro de historial.
- **Bono de bienvenida y borrado de cuentas (decisión del dueño, CN-20261007-045):**
  el bono por sí solo no retiene el borrado. Una cuenta cuyo único movimiento es
  el `WELCOME_BONUS` se puede borrar desde el superadmin y el bono desaparece con
  ella; cualquier otro movimiento (gasto, otro premio, devolución, ajuste) sigue
  dando `409 CURRENCY_LEDGER_RETAINED`. **Consecuencia desde M6** (`CN-20261012-048`):
  los premios automáticos también son «otro premio», así que basta con completar
  el perfil, recibir una verificación del admin o responder una invitación para
  que la cuenta quede retenida. Es coherente con esta decisión, pero amplía mucho
  el número de cuentas que el superadmin ya no puede borrar; si el dueño necesita
  atender pedidos de eliminación de datos, la salida es la anonimización
  (alcance futuro), no el borrado.
- **Decisiones vigentes aceptadas tal cual (observaciones de `CN-20261007-044`,
  decisión del dueño, sin cambio de comportamiento):** (a) un puesto pagado puede
  reutilizarse: pausar, editar y volver a publicar no cobra de nuevo, porque solo
  la primera publicación de un puesto cuenta como extra; (b) la prioridad de una
  postulación se conserva al re-postular, sin nuevo cobro; (c) el desbloqueo de
  contacto de un candidato es permanente, aunque después la empresa rechace la
  postulación que lo originó.
- El chat de la postulación y las interfaces quedan para M5.

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
| **M4** | Acciones conectadas | Aplicar el catálogo de M2 a publicar, postular, destacar, invitar y desbloquear contacto; cuota gratuita, tope diario, devolución automática y bono de bienvenida (cerrado: `CN-20261007-043`/`045`, auditoría `CN-20261007-046`; `PROFILE_HIGHLIGHT` diferido en M4 y resuelto en M6) |
| **M5** | Interfaces | Panel web de empresa y trabajador y Flutter con saldo, movimientos y proceso de selección |
| **M6** | Ganar monedas | Premios por perfil completo, verificaciones, referidos y constancia (cerrado: `CN-20261012-047`, auditoría `CN-20261012-048`; incluye `PROFILE_HIGHLIGHT` y el cierre de BAJO-A) |
| **M7** | Compra de monedas | Reutiliza la capa de adaptadores; requiere el pronunciamiento legal sobre la moneda |

M2 y M3 pueden avanzar en paralelo con M1; se unen en M4.

## Pendientes del dueño del producto

1. Confirmar el nombre final de la moneda y su identidad visual.
2. Fijar el catálogo de M2: qué acciones cuestan o rinden y cuánto, cuotas
   gratuitas y plazo de devolución.
3. Definir qué datos y documentos exige el proceso de contrato de un puesto fijo.
4. Consultar a un abogado laboral y financiero sobre la moneda y sobre la
   intermediación de empleo formal.
