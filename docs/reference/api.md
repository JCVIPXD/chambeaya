# API CRUD empresarial

## Autenticación

Todas las rutas bajo `/api/business` requieren una sesión válida de tipo `BUSINESS`:

```http
Authorization: Bearer <token>
```

El API obtiene el propietario desde la sesión. No acepta un `companyId` enviado por el cliente, evitando que una empresa acceda a registros de otra.

## Superadmin: cuentas empresariales

Las rutas bajo `/api/admin` requieren una sesión `ADMIN` y permiten gestionar el alta de empresas que ya entregaron sus datos a Chambeaya:

- `GET /api/admin/overview`: métricas operativas.
- `GET /api/admin/companies`: listado con propietario y suscripción.
- `POST /api/admin/companies`: crea en una transacción la cuenta `BUSINESS` y su empresa.
- `PATCH /api/admin/companies/:id`: actualiza datos operativos (RUC, correo y contraseña no se modifican aquí).
- `DELETE /api/admin/companies/:id`: elimina la empresa y su cuenta propietaria; no permite eliminar la cuenta del administrador actual.
- `GET /api/admin/workers`: listado global de cuentas `WORKER` con su contacto por empresa.
- `DELETE /api/admin/workers/:id`: elimina una cuenta `WORKER` (`404 WORKER_NOT_FOUND` si el id no existe o no corresponde a un trabajador). Antes de borrar la cuenta, elimina del almacenamiento privado el CV y la foto de perfil del trabajador, si existían; el resto de filas asociadas (aplicaciones, asignaciones, sesiones, identidades externas) se elimina en cascada a nivel de base de datos.

El alta exige nombre comercial, RUC de 11 dígitos, correo y contraseña inicial (mínimo 8 caracteres, con mayúscula y número). Los datos de contacto y razón social pueden completarse o editarse después desde el panel.

## Empresa

- `GET /api/business/company`: obtiene el perfil. Si la cuenta es anterior a esta implementación, crea el perfil empresarial automáticamente con el nombre y RUC registrados.
- `PATCH /api/business/company`: actualiza nombre comercial, razón social, industria, teléfono, dirección o distrito.

## Turnos

- `GET /api/business/shifts`
- `POST /api/business/shifts`
- `GET /api/business/shifts/:id`
- `PATCH /api/business/shifts/:id`
- `DELETE /api/business/shifts/:id`

Ejemplo de creación:

```json
{
  "title": "Mozo de salón",
  "location": "Miraflores",
  "startsAt": "2026-08-24T18:00:00.000Z",
  "endsAt": "2026-08-25T00:00:00.000Z",
  "payCents": 10000,
  "requiredWorkers": 4,
  "screeningQuestions": [
    "¿Tienes disponibilidad durante todo el horario indicado?"
  ],
  "notes": "Ingreso por puerta de personal"
}
```

Estados: `PUBLISHED`, `ASSIGNED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`. No existe ninguna transición automática por tiempo: un turno cuyo `endsAt` ya pasó conserva su último estado persistido (típicamente `PUBLISHED` o `ASSIGNED`) hasta que la empresa lo cancele; la fecha, no el estado, es lo que determina si sigue operativo.

El estado y `confirmedWorkers` son derivados por el servidor. No se aceptan en los formularios de creación o edición. Un turno con actividad no se puede borrar y, una vez iniciado el check-in, tampoco se puede editar ni cancelar destruyendo su historial.

`POST` y `PATCH` rechazan con `400` un `endsAt` que ya pasó (además del rechazo existente cuando `endsAt` no es posterior a `startsAt`): un turno no puede publicarse ni guardarse ya vencido. Ambas reglas viajan directo en el campo `error` de la respuesta -no anidadas en `issues[]` como una violación de esquema genérica-, igual que `SHIFT_NOT_EDITABLE`:

```json
{ "error": "SHIFT_ALREADY_ENDED" }
```
```json
{ "error": "INVALID_DATE_RANGE" }
```

`SHIFT_ALREADY_ENDED` señala que el `endsAt` enviado ya pasó; `INVALID_DATE_RANGE`, que `endsAt` no es posterior a `startsAt`. Un cliente puede distinguir cualquiera de las dos entre sí y de cualquier otro dato inválido (que sí llega como `{ "error": "INVALID_INPUT", "issues": [...] }`, la violación de esquema genérica de Zod) leyendo solo el campo `error`.

Es válido crear o editar un turno cuyo `startsAt` ya pasó mientras su `endsAt` siga en el futuro: un turno en curso todavía admite cobertura, y el resto del sistema (búsqueda, postulación, aceptación, check-in) filtra siempre por `endsAt`, nunca por `startsAt`. La hora de referencia es siempre la del servidor.

`PATCH` además responde `400 SHIFT_NOT_EDITABLE` para **cualquier** edición, incluida una que no toque fechas, sobre un turno cuyo `endsAt` ya pasó; es el mismo código que ya se usaba para un turno terminal o con check-in en curso. Cancelar (`POST /api/business/shifts/:id/cancel`) sigue permitido sobre un turno vencido que nunca se cubrió, para poder cerrar el registro.

El panel web deshabilita el botón "Editar" y muestra una insignia "Vencido" cuando `isShiftExpired` (cliente) detecta que el turno ya pasó su `endsAt`; si de todas formas la petición llega al servidor (p. ej. por una condición de carrera de UI) y falla con `SHIFT_ALREADY_ENDED`/`SHIFT_NOT_EDITABLE`, el mensaje se lo explica al operador en vez de mostrar un error genérico.

Cada creación, edición o eliminación de un turno notifica inmediatamente al feed del marketplace. Solo los turnos `PUBLISHED` que todavía no finalizaron aparecen para trabajadores.

`screeningQuestions` es opcional y acepta hasta tres preguntas de 10 a 240 caracteres. No debe utilizarse para solicitar DNI, información de salud ni otros datos sensibles.

### Postulaciones y decisión de la empresa

- `GET /api/business/shifts/:id/applications`: postulaciones del turno, con el mismo `nextAction` que ve el trabajador.
- `GET /api/business/applications/pending`: total y turnos con postulaciones `PENDING` de la empresa.
- `PATCH /api/business/shifts/:id/applications/:applicationId`: decide una postulación `PENDING`. Cuerpo `{ "decision": "ACCEPTED" | "REJECTED", "reason"?: "…" }` (`reason` obligatorio si `decision` es `REJECTED`, opcional en `ACCEPTED`).

Aceptar crea la asignación (`ShiftAssignment`) dentro de una transacción `Serializable` con reintento automático ante conflicto de serialización: si dos aceptaciones para el último cupo disponible llegan a la vez, la base de datos garantiza que solo una lea y reserve ese cupo; la otra recibe `400 SHIFT_FULL` en la misma respuesta, sin sobrecupo ni asignación duplicada. `400 SHIFT_NOT_ASSIGNABLE` rechaza decidir sobre un turno terminal, con check-in en curso o cuyo `endsAt` ya pasó (un turno vencido no puede ganar una nueva asignación aunque la postulación sea anterior a su vencimiento). `400 APPLICATION_ALREADY_DECIDED` cubre una segunda decisión sobre la misma postulación.

## Marketplace para trabajadores

- `GET /api/shifts`: devuelve los turnos publicados desde PostgreSQL.
- `GET /api/shifts/events`: stream público de Server-Sent Events (SSE).

Cada turno del marketplace (en este endpoint, en el feed SSE y en el `shift` embebido de `GET /api/workers/applications`) incluye `endsAt` (ISO 8601): es el único dato de fecha real que se expone a los clientes -`dateLabel` es solo texto formateado- y la única forma de que un cliente sepa si una asignación aceptada ya venció, dado que no existe transición automática por tiempo. Flutter lo usa para dejar de ofrecer "Confirmar asistencia"/"Confirmar llegada" sobre un turno cuyo `endsAt` ya pasó sin que el trabajador llegara a hacer check-in (una vez hecho el check-in, `checkOut` no tiene ventana de tiempo propia y sigue siendo válido más allá de `endsAt`).
- `POST /api/shifts/:id/applications`: crea una postulación autenticada. Si el turno tiene preguntas de filtro, recibe todas las respuestas en `answers`.

```json
{
  "answers": [
    {
      "question": "¿Tienes disponibilidad durante todo el horario indicado?",
      "answer": "Sí, tengo disponibilidad completa."
    }
  ]
}
```

La pregunta debe coincidir con la publicada y cada respuesta admite hasta 1000 caracteres. El API rechaza respuestas faltantes, duplicadas o ajenas al turno.

Rutas operativas autenticadas del trabajador:

- `GET /api/workers/applications`: incluye asignación persistida y `nextAction` con actor, código y texto explicativo.
- `POST /api/shifts/:id/confirm`: confirma la asignación antes del ingreso. Responde `404 ASSIGNMENT_NOT_FOUND` si la asignación no existe o su turno ya venció (`shift.endsAt` ya pasó).
- `POST /api/shifts/:id/check-in`: exige confirmación y la credencial temporal vigente. Responde `409 SHIFT_UNAVAILABLE` si el turno ya venció o quedó en un estado terminal.
- `POST /api/shifts/:id/check-out`: exige check-in y completa solo la asignación del trabajador. El turno completo se cierra cuando terminan todos sus cupos. No tiene ninguna ventana de tiempo propia: sigue siendo válido aunque el turno ya haya pasado su `endsAt` nominal.
- `POST /api/shifts/:id/cancel`: permite cancelar antes del check-in y conserva motivo, actor y fecha.

La app Flutter (`HttpWorkerMarketplaceRepository`) propaga el código real de `confirm`/`check-in`/`check-out` mediante `MarketplaceApiException` en vez de un error genérico: si el código indica que el turno ya no existe o está disponible (`ASSIGNMENT_NOT_FOUND`, `SHIFT_UNAVAILABLE`, `SHIFT_NOT_FOUND`), la pantalla de postulaciones (`WorkerApplicationsPage`) explica el motivo y recarga de inmediato en vez de dejar un botón que siempre va a fallar.

La empresa recibe el mismo `nextAction` al consultar `/api/business/shifts/:id/applications`, evitando que web y Flutter calculen reglas contradictorias.

El endpoint histórico `PUT /api/shifts/:id/accept` solo se conserva para la demostración en memoria. En modo persistente responde `410 DIRECT_ASSIGNMENT_DISABLED`; toda asignación real debe originarse en una postulación revisada por la empresa.

El stream envía eventos `shifts` con una fotografía completa de las oportunidades vigentes. Flutter mantiene la conexión abierta, actualiza la lista sin recargar y vuelve a conectarse automáticamente si se interrumpe la red.

La reemisión ocurre por dos vías independientes: inmediatamente después de que una empresa publica, edita, cancela o decide una postulación (`onShiftsChanged`), y además cada 60 segundos por defecto (configurable solo para pruebas mediante la opción interna `marketplaceFeedRefreshIntervalMs` de `createApp`), para que un turno que simplemente venció por el paso del tiempo -sin que ninguna empresa haya tocado nada- también se retire del feed de los clientes ya conectados en un plazo acotado.

```text
event: shifts
data: [{"id":"...","role":"Mozo de salón",...}]
```

## Trabajadores del directorio

- `GET /api/business/workers`
- `POST /api/business/workers`
- `GET /api/business/workers/:id`
- `PATCH /api/business/workers/:id`
- `DELETE /api/business/workers/:id`

El directorio corresponde a `CompanyWorkerContact`: incluye únicamente contacto, rol, habilidades y disponibilidad para la operación de esa empresa. No controla reputación, compatibilidad, trabajos completados ni verificación global.

Estados: `AVAILABLE`, `ON_SHIFT`, `UNAVAILABLE`.

## Perfil global, búsqueda y reseñas

- `GET /api/workers/me/profile`: perfil profesional del trabajador autenticado. Incluye siempre el contenido completo de todas las secciones, aunque estén ocultas del directorio (`isExperienceVisible`, `isCertificationsVisible`, `isLanguagesVisible`, `isWorkAreaVisible` en `false`); ocultar una sección nunca la borra ni la vacía para su propio dueño.
- `PATCH /api/workers/me/profile`: actualiza presentación, distrito, disponibilidad, visibilidad y especialidades. La disponibilidad recibe `availabilityDays` (`MONDAY` a `SUNDAY`), `availabilityPeriods` (`MORNING`, `AFTERNOON`, `EVENING`, `OVERNIGHT`) y una nota opcional. Cada elemento de `specialties` incluye `specialtyId`, `proficiency` (`BEGINNER`, `INTERMEDIATE`, `ADVANCED`) y `yearsExperience` opcional.

### Perfil ampliado (Alcance 6 del plan de refuerzo): experiencia, certificaciones, idiomas y radio/distritos de trabajo

`PATCH /api/workers/me/profile` admite además, todos opcionales e independientes entre sí:

- `experiences`: arreglo de hasta 20 entradas `{ role, employer, description?, startDate, endDate? }` (fechas ISO 8601; `endDate` ausente significa puesto vigente; `startDate` no puede ser posterior a `endDate`). Cada `PATCH` que incluya `experiences` **reemplaza la lista completa** (igual que `specialties` hoy); para editar una entrada, se reenvía el arreglo completo con esa entrada modificada.
- `certifications`: arreglo de hasta 20 entradas `{ name, issuer?, issueDate?, expirationDate?, credentialId? }`, mismo reemplazo completo por `PATCH`. **Son metadatos declarados por el trabajador, nunca una verificación**: la API no acepta (`.strict()`, rechaza con `400`) ningún campo de verificación como `verified` o `isVerified`, y ninguna respuesta de esta API incluye jamás una clave de ese tipo. La verificación de certificaciones es un ítem distinto y futuro del Bloque 4 del plan maestro.
- `languages`: arreglo de hasta 20 entradas `{ language, proficiency }` (`proficiency`: `BASIC`, `CONVERSATIONAL`, `FLUENT`, `NATIVE`), mismo reemplazo completo por `PATCH`. No admite dos entradas con el mismo idioma (comparación insensible a mayúsculas) en el mismo envío; el servidor responde `400`.
- `workRadiusKm`: entero de 1 a 200, o `null` para borrarlo. Radio de trabajo declarado, informativo (no alimenta ninguna regla de matching automática todavía).
- `workDistricts`: arreglo de hasta 10 distritos adicionales donde el trabajador acepta trabajar, distinto de `district` (su distrito principal declarado).
- `isExperienceVisible`, `isCertificationsVisible`, `isLanguagesVisible`, `isWorkAreaVisible`: booleanos que ocultan o recuperan cada sección **solo** en el resultado público (`GET /api/business/talent`); no afectan lo que ve el propio trabajador en `GET /api/workers/me/profile`. Por defecto las cuatro son `true`.

`GET /api/business/talent` expone estas secciones en cada tarjeta como `experiences`, `certifications`, `languages` (mismas formas que en el perfil propio, sin ningún campo de verificación) y `workArea: { workRadiusKm, workDistricts } | null`. Cuando la sección correspondiente está oculta (`isXVisible: false`), la tarjeta la devuelve vacía (`[]`) o `null` para `workArea`, nunca omitida: el conjunto de claves de la tarjeta es siempre el mismo, oculta o no.

`completion` (en ambas respuestas) se calcula sobre 13 señales de contenido con el mismo peso: `headline`, `bio`, `district`, `availabilityText`, `availabilityDays`, `availabilityPeriods`, `specialties`, CV, foto, radio/distritos de trabajo, experiencia, certificaciones e idiomas. Un perfil con las 13 señales completas llega a 100%; uno sin ninguna, a 0%. (Antes de este alcance el divisor estaba fijo en 9 con un máximo real de 8 señales, por lo que nunca podía llegar a 100%; queda corregido.)
- `PUT /api/workers/me/cv`: carga o reemplaza el CV privado. Recibe un cuerpo PDF de hasta 5 MB, `Content-Type: application/pdf` y el encabezado `X-File-Name` codificado. Devuelve el perfil actualizado.
- `GET /api/workers/me/cv/download`: descarga el PDF únicamente para el trabajador autenticado; usa `Cache-Control: private, no-store`.
- `PUT /api/workers/me/photo`: carga o reemplaza una foto privada de perfil JPG, PNG o WebP de hasta 3 MB. Exige `X-File-Name` y devuelve el perfil actualizado.
- `GET /api/workers/me/photo`: devuelve la foto solo al trabajador autenticado, con `Cache-Control: private, no-store`.
- `GET /api/specialties`: catálogo activo de especialidades.
- `GET /api/business/talent`: perfiles visibles; acepta `specialtyId`, `district`, `query`, `availableOnly`, `cursor` y `limit`. `district` filtra por coincidencia exacta insensible a mayúsculas; `query` (hasta 100 caracteres) busca coincidencia parcial insensible a mayúsculas en `user.name`, `headline` y `district` a la vez, combinable con el resto de filtros. El orden es siempre `id` ascendente y la paginación por cursor se mantiene estable con cualquier combinación de filtros. No existe índice específico para `query`: con el volumen del piloto el costo de un `contains` insensible sin índice es aceptable; si el catálogo de talento crece, evaluar un índice `pg_trgm` (requiere extensión y migración).
- `POST /api/assignments/:id/reviews`: crea una reseña con `rating` de 1 a 5 y `comment` opcional.

La reseña requiere una asignación completada. Solo pueden crearla el trabajador asignado y la empresa propietaria; cada autor puede reseñar una vez esa asignación. La respuesta de búsqueda expone solo agregados `reputation.averageRating` y `reputation.reviewCount`; un perfil sin reseñas devuelve `null` y `0`.

## Invitaciones de talento (`TalentInvitation`)

Persisten el contacto inicial entre una empresa y un perfil del directorio de talento. Sustituyen la acción simulada "Invitar por enlace" retirada en un alcance anterior: ningún botón de invitación puede mostrar éxito sin una respuesta `2xx` real de estas rutas.

- `POST /api/business/talent-invitations` (sesión `BUSINESS`): crea una invitación. Cuerpo: `{ "workerTalentProfileId": "…", "shiftId": "…"?, "message": "…"? }`. `workerTalentProfileId` es el mismo identificador de perfil que ya devuelve `GET /api/business/talent` (`WorkerTalentProfile.id`, **no** el `userId` del trabajador); el servidor resuelve el `userId` internamente y nunca lo incluye en ninguna respuesta de invitación. `message` admite hasta 500 caracteres. `expiresAt` no se recibe del cliente: el servidor la calcula siempre como `createdAt + 7 días`.
- `GET /api/business/talent-invitations` (sesión `BUSINESS`): lista solo las invitaciones emitidas por la empresa de la sesión.
- `GET /api/workers/me/talent-invitations` (sesión `WORKER`): lista solo las invitaciones dirigidas al trabajador autenticado.
- `POST /api/workers/me/talent-invitations/:id/accept` (sesión `WORKER`): acepta una invitación propia `PENDING` y no vencida.
- `POST /api/workers/me/talent-invitations/:id/decline` (sesión `WORKER`): rechaza una invitación propia `PENDING` y no vencida.

Estados: `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `CANCELLED`. Esta entrega implementa las transiciones `PENDING → ACCEPTED` y `PENDING → DECLINED` (ambas solo por el trabajador destinatario) y la transición automática `PENDING → EXPIRED`, evaluada siempre en el servidor (nunca a partir de un `expiresAt` calculado en el cliente): al listar o al intentar responder una invitación vencida, el servidor la transiciona primero y luego aplica la regla, de forma que una invitación vencida nunca puede aceptarse. `CANCELLED` queda reservada en el modelo para una cancelación futura iniciada por la empresa; no hay todavía ninguna ruta que la produzca.

**Duplicados:** no puede existir más de una invitación *activa* (`PENDING` o `ACCEPTED`) para el mismo par empresa/perfil de talento (y turno, si se indicó uno). El intento duplicado responde `409 INVITATION_ALREADY_ACTIVE`, tanto si lo detecta la comprobación previa del servidor como si lo detecta el índice único parcial de la base de datos ante una carrera concurrente; nunca se crea un segundo registro. Tras `DECLINED`, `EXPIRED` o `CANCELLED`, una nueva invitación para el mismo par vuelve a ser posible.

**No enumeración:** invitar a un `workerTalentProfileId` que no existe y a uno que existe pero tiene `isVisible: false` responden exactamente igual, `404 TALENT_PROFILE_NOT_AVAILABLE`, por la misma consulta en el servidor; el cuerpo de la respuesta no permite distinguir ambos casos.

**Aislamiento:** una empresa solo puede listar sus propias invitaciones (nunca las de otra empresa: no existe ninguna ruta para leer o modificar una invitación por id desde una sesión `BUSINESS`). Un trabajador solo puede listar, aceptar o rechazar las invitaciones dirigidas a él: una invitación ajena responde `404 INVITATION_NOT_FOUND`, el mismo código que una invitación inexistente.

**Consentimiento y conversaciones:** crear una invitación **no** abre ninguna conversación por sí sola, la acepte o no el trabajador. Abrir una conversación sigue exigiendo el camino ya existente, `POST /api/business/conversations`, que requiere un `CompanyWorkerContact` de esa misma empresa; esta entrega no crea ni modifica esa ruta ni la enlaza automáticamente con una invitación aceptada. Una invitación aceptada es un registro de consentimiento de contacto, no una apertura de conversación.

Errores propios de estas rutas: `403 BUSINESS_ACCOUNT_REQUIRED` / `403 WORKER_ACCOUNT_REQUIRED` (rol incorrecto), `404 TALENT_PROFILE_NOT_AVAILABLE` (perfil inexistente o no visible), `404 SHIFT_NOT_FOUND` (el turno indicado no existe o no pertenece a la empresa), `409 INVITATION_ALREADY_ACTIVE` (duplicado activo), `404 INVITATION_NOT_FOUND` (invitación inexistente o de otro trabajador/empresa), `409 INVITATION_EXPIRED` (intento de responder una invitación ya vencida), `409 INVITATION_NOT_PENDING` (intento de responder una invitación que ya no está `PENDING`, por ejemplo una segunda respuesta).

## Acceso con Google

- `GET /api/auth/providers`: informa si Google está configurado.
- `POST /api/auth/google`: recibe `{ "idToken": "…" }` y verifica la identidad. Para una cuenta nueva responde `202` con un `profileSetupToken` temporal; el cliente solicita entonces DNI y una contraseña nueva de Chambeaya, y usa `POST /api/auth/google/complete` con `{ "profileSetupToken", "dni", "password" }`. Así el ID token de Google se valida una sola vez. La contraseña de Google nunca se recibe ni se almacena.
- `POST /api/auth/password`: requiere sesión Bearer y permite que una cuenta Google creada antes de este paso defina una vez su contraseña exclusiva de Chambeaya. Recibe `{ "password": "…" }`. La sesión expone `requiresPasswordSetup: true` hasta que lo haga; Flutter bloquea el acceso al panel hasta completar ese paso.

Las cuentas por correo existentes no se fusionan automáticamente con Google. Sin credenciales configuradas, el proveedor responde como no disponible. El cambio y recuperación de contraseña requerirán una sesión autenticada o un mecanismo de recuperación de correo verificado antes de abrirse al público.

### Límite de intentos

`POST /api/auth/login`, `/register`, `/google`, `/google/complete` y `/password` comparten un limitador en memoria por IP (`AUTH_RATE_LIMIT_WINDOW_MS`, por defecto 900000 ms; `AUTH_RATE_LIMIT_MAX`, por defecto 20 intentos). Al superar el máximo dentro de la ventana, la API responde `429 AUTH_RATE_LIMITED` con únicamente `{ "error": "AUTH_RATE_LIMITED" }`: nunca indica si el correo existe, cuál fue el error de validación ni ningún otro dato de la cuenta. Otras rutas (`GET /api/auth/session`, `DELETE /api/auth/session`, `GET /api/auth/providers`, y el resto de la API) no están sujetas a este límite.

El almacén del limitador es en memoria y por instancia: no se comparte entre réplicas ni sobrevive a un reinicio del proceso. Con varias instancias de la API detrás de un balanceador, el límite efectivo por IP se multiplica por el número de instancias.

Si la API corre detrás de un proxy inverso, `API_TRUST_PROXY` debe configurarse (ver `.env.production.example`) para que el conteo use la IP real del cliente (`X-Forwarded-For`) en lugar de la IP del proxy; sin esa variable, todas las solicitudes de un mismo proxy comparten un único cupo.

## Conversaciones y mensajes

- `GET /api/business/conversations`
- `POST /api/business/conversations`
- `GET /api/business/conversations/:id`
- `PATCH /api/business/conversations/:id`
- `DELETE /api/business/conversations/:id`
- `POST /api/business/conversations/:id/messages`
- `PATCH /api/business/conversations/:id/messages/:messageId`
- `DELETE /api/business/conversations/:id/messages/:messageId`

Una conversación pertenece a un trabajador del directorio y puede asociarse a un turno. La empresa solo puede editar o eliminar mensajes cuyo remitente sea `BUSINESS`.

## Pagos y movimientos

- `GET /api/business/payments`
- `POST /api/business/payments`
- `GET /api/business/payments/:id`
- `PATCH /api/business/payments/:id`
- `DELETE /api/business/payments/:id`

Los montos se reciben en céntimos mediante `amountCents` para evitar errores de punto flotante.

Estados: `PENDING`, `SCHEDULED`, `PROCESSED`, `CANCELLED`.

## Respuestas de error

- `400 INVALID_INPUT`: payload o regla de negocio inválida.
- `401 INVALID_SESSION`: token ausente, inválido o vencido.
- `403 BUSINESS_ACCOUNT_REQUIRED`: la sesión no corresponde a una empresa.
- `403 ADMIN_ACCOUNT_REQUIRED`: la sesión no corresponde a un administrador (rutas `/api/admin`).
- `403 MESSAGE_NOT_OWNED`: intento de modificar un mensaje del trabajador.
- `404 *_NOT_FOUND`: el recurso no existe o pertenece a otra empresa.
- `409 DUPLICATE_RECORD`: correo, referencia u otro campo único duplicado.
- `429 AUTH_RATE_LIMITED`: se superó el límite de intentos en una ruta de autenticación (ver "Límite de intentos" arriba).

## CORS

El origen permitido se define en `CORS_ALLOWED_ORIGINS` (lista separada por comas; ver `.env.example` y `.env.production.example`). Fuera de producción, si la variable no está definida se conserva el comportamiento permisivo previo (cualquier origen) para no romper el desarrollo local ni Flutter. En producción, si la variable no está definida, la API bloquea todos los orígenes de navegador (registra un error visible en el log) en lugar de abrir el acceso en silencio.
