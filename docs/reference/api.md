# API CRUD empresarial

## Autenticación

Todas las rutas bajo `/api/business` requieren una sesión válida de tipo `BUSINESS`:

```http
Authorization: Bearer <token>
```

El API obtiene el propietario desde la sesión. No acepta un `companyId` enviado por el cliente, evitando que una empresa acceda a registros de otra.

## Moneda virtual (M1)

La moneda virtual es crédito cerrado. Su nombre se toma de
`VIRTUAL_CURRENCY_NAME` (por defecto, `Chambitas`) y siempre se devuelve en
la respuesta como `currency`. No hay rutas para retirar dinero ni transferir
crédito entre cuentas.

El saldo no está almacenado como una columna editable: se deriva del último
movimiento del libro mayor. Cada movimiento contiene cantidad con signo,
saldo resultante, acción, relación, actor y fecha. Las respuestas no exponen
la clave de idempotencia, pero el servidor la exige al crear ajustes y la
protege con un índice único global.

### Trabajador

Ambas rutas requieren sesión `WORKER` y operan exclusivamente sobre la cuenta
del usuario autenticado:

- `GET /api/workers/currency/balance` → `{ currency, balance }`.
- `GET /api/workers/currency/movements?limit=25&cursor=<id>` →
  `{ currency, items, nextCursor }`. `limit` es un entero entre 1 y 100 y
  `nextCursor` es `null` al llegar al final.

### Empresa

Ambas rutas requieren sesión `BUSINESS` y resuelven la empresa por el dueño de
la sesión, nunca por un identificador enviado por el cliente:

- `GET /api/business/currency/balance`.
- `GET /api/business/currency/movements?limit=25&cursor=<id>`.

Sus respuestas tienen el mismo formato que las rutas de trabajador. Una
cuenta sin movimientos devuelve saldo `0` y una lista vacía; una lectura no
crea una cuenta ni modifica el libro mayor.

### Ajustes del administrador

Solo una sesión `ADMIN` puede registrar movimientos en M1:

- `POST /api/admin/currency/workers/:workerId/adjustments`
- `POST /api/admin/currency/companies/:companyId/adjustments`

El cuerpo es:

```json
{
  "quantity": 25,
  "reason": "Bono de bienvenida autorizado",
  "idempotencyKey": "admin-bonus-worker-20261001-001"
}
```

`quantity` es un entero no nulo entre `-1000000` y `1000000`; un valor
negativo nunca puede dejar el saldo bajo cero (`409
INSUFFICIENT_CURRENCY_BALANCE`). `reason` es obligatorio (3 a 500 caracteres)
y `idempotencyKey` es obligatorio (8 a 128 caracteres). Repetir exactamente la
misma solicitud devuelve el movimiento original con `200` e `idempotent:
true`; reutilizar la clave para otra cuenta o con datos diferentes devuelve
`409 IDEMPOTENCY_KEY_REUSED`. Un ajuste nuevo devuelve `201`.

El movimiento queda registrado como `ADMIN_ADJUSTMENT`, con el administrador
en `actor` y el motivo (`relatedEntity` es `null` en un ajuste: el actor ya
consta en `createdById`); no hay actualización ni borrado de filas del libro
mayor. Las escrituras usan una transacción `Serializable` con reintento
(`withSerializableRetry`). Lo que impide el saldo negativo y el gasto doble no
es el `SELECT ... FOR UPDATE` de la cuenta (bajo `Serializable` la
instantánea se fija en esa primera sentencia, antes de esperar el bloqueo, así
que solo reduce conflictos), sino la detección de conflictos de serialización
(`40001`, que se reintenta), el índice único `(accountId, sequence)` y el
`CHECK balanceAfter >= 0`. Con mucha contención sobre una misma cuenta los 6
intentos pueden agotarse y la ruta responde `500`; en ese caso no se aplicó
nada y repetir la solicitud (misma clave) es seguro.

Otros códigos de estas rutas: `403 WORKER_ACCOUNT_REQUIRED`,
`BUSINESS_ACCOUNT_REQUIRED` o `ADMIN_ACCOUNT_REQUIRED` si la sesión tiene otro
rol; `404 WORKER_NOT_FOUND` / `COMPANY_NOT_FOUND` si el titular del ajuste no
existe (o el id de trabajador no es de rol `WORKER`); `409
CURRENCY_BALANCE_LIMIT_EXCEEDED` si el saldo resultante superaría
`2147483647` (columna `Int` de 32 bits); `400 INVALID_CURSOR` si `cursor` no es
un movimiento de la propia cuenta. `idempotencyKey` solo admite letras, dígitos
y `._:-`, y debe empezar por letra o dígito.

Garantías en la base (migración `20261001100000_virtual_currency_ledger`): un
trigger rechaza todo `UPDATE` y `DELETE` sobre `CurrencyMovement`
(`CURRENCY_MOVEMENT_APPEND_ONLY`); `CHECK` impide `quantity = 0`,
`balanceAfter < 0` y una cuenta sin titular o con los dos; `(accountId,
sequence)` es único, de modo que dos escrituras concurrentes nunca encadenan
sobre el mismo saldo. Las claves foráneas hacia `User`, `Company` y
`CurrencyAccount` son `RESTRICT` (esquema y migraciones coinciden; la
migración `20261005100000_currency_ledger_cleanup` quita el índice duplicado
`CurrencyMovement_accountId_sequence_idx`).

**Borrado de titulares (`CN-20261001-035`).** El libro es inmutable, así que
una cuenta con movimientos no puede desaparecer sin destruir la auditoría.
`DELETE /api/admin/workers/:id` y `DELETE /api/admin/companies/:id` responden
`409 CURRENCY_LEDGER_RETAINED` si el titular tiene al menos un movimiento
(aunque el saldo sea `0`), sin borrar filas ni archivos. Una cuenta sin
movimientos se elimina junto con el titular. **Excepción (CN-20261007-045):** si
el único movimiento de la cuenta es el `WELCOME_BONUS` (acción `REWARD`, clave
`WELCOME_BONUS`; sin gastos, otros premios, devoluciones ni ajustes), el borrado
responde `204` y el bono desaparece con la cuenta. El libro sigue siendo
inmutable: la migración `20261007120000_welcome_bonus_deletable` solo permite
borrar ese movimiento dentro de la transacción de borrado del titular, que
declara la cuenta con `set_config('chambeaya.welcome_bonus_delete_account', <id>,
true)` (local a la transacción) y solo si la cuenta no tiene ningún otro
movimiento (el trigger vuelve a comprobarlo). Cualquier otro `DELETE` o
`UPDATE`, o un `DELETE` sin ese permiso, sigue fallando con
`CURRENCY_MOVEMENT_APPEND_ONLY`. La cuenta se bloquea (`FOR UPDATE`) antes de
contar, así que la carrera con un movimiento nuevo se resuelve igual que antes
(`409`, nada se borra). La verificación y el borrado van
en una sola transacción que bloquea primero la cuenta (`SELECT ... FOR UPDATE`)
y cuenta después: un ajuste que ya tenía la cuenta bloqueada termina antes y su
movimiento se ve en el conteo. Si un movimiento o una cuenta se confirma de
todos modos entre el conteo y el borrado (por ejemplo, una cuenta que aún no
existía al contar), la clave `RESTRICT` aborta la transacción con SQLSTATE
`23001` (`restrict_violation`), que Prisma entrega como error desconocido y no
como `P2003`; el `guard` reconoce ese código y la restricción de moneda y
responde `409 CURRENCY_LEDGER_RETAINED` (corrección de BAJO-4 de
`CN-20261001-036`, con pruebas de integración de la carrera). No se borra nada
y los archivos solo se eliminan después de confirmar. Cualquier otra violación
`RESTRICT` o `P2003` responde `409 RELATED_RECORDS_EXIST`. Anonimizar o desactivar al titular
queda como alcance futuro; mientras tanto, para retirar a un titular con
historial hay que dejar su saldo documentado y conservar la cuenta. `ADMIN` que
registró ajustes tampoco puede borrarse (`createdById` es `RESTRICT`). `WalletMovement` no se modificó: sigue siendo el
historial legado de pagos en céntimos y no forma parte de la moneda virtual.

### Catálogo de costos y premios (M2)

Tabla configurable por el administrador que define qué acciones cuestan moneda
(`COST`) o la otorgan (`REWARD`). **M2 solo configura y resuelve: ninguna
acción real cobra ni premia todavía** (eso es M4/M6) y no escribe en el libro.
Principio de producto: lo básico es siempre gratis; el catálogo nunca bloquea
una acción esencial.

Cada entrada es única por (`actionKey`, `actor`). `actor` usa los valores del
libro: `WORKER` (trabajador) o `COMPANY` (empresa); `WELCOME_BONUS` existe una
vez por actor. Claves estables (`CURRENCY_ACTION_KEYS`):

| Actor | `COST` | `REWARD` |
|---|---|---|
| `COMPANY` | `JOB_PUBLISH_EXTRA`, `JOB_HIGHLIGHT`, `TALENT_INVITE`, `CANDIDATE_CONTACT_UNLOCK` | `COMPANY_VERIFIED`, `APPLICANTS_RESPONDED_ON_TIME`, `HIRE_CONFIRMED`, `WELCOME_BONUS` |
| `WORKER` | `APPLICATION_EXTRA`, `APPLICATION_PRIORITY`, `PROFILE_HIGHLIGHT` | `PROFILE_COMPLETE`, `DOCUMENT_VERIFIED`, `INVITATION_RESPONDED`, `REFERRAL`, `WELCOME_BONUS` |

Campos editables: `amount` (entero 1 a 1000000), `active`, `freeMonthlyQuota`
(entero 0 a 10000: usos gratis por mes calendario de **Lima**, UTC-5, solo en
`COST`) y `refundWindowHours` (entero 1 a 8760 o `null` = sin devolución; plazo
de devolución automática que usará M4, solo en `COST`). `actionKey`, `actor` y
`kind` son fijos. Una entrada inactiva se trata como gratuita y no otorga nada.

**Administrador** (sesión `ADMIN`; otro rol responde `403`):

- `GET /api/admin/currency/catalog` → `{ currency, items }` con todas las
  entradas (`id`, `actionKey`, `actor`, `kind`, `amount`, `active`,
  `freeMonthlyQuota`, `refundWindowHours`, `isProvisional`, `updatedAt`,
  `updatedBy`).
- `PATCH /api/admin/currency/catalog/:entryId` con cuerpo estricto (campos
  desconocidos rechazados) `{ amount?, active?, freeMonthlyQuota?,
  refundWindowHours?, reason }`: `reason` (3 a 500 caracteres) es obligatorio y
  debe cambiar al menos un campo. Responde `{ changed, entry }`; `changed` lista
  los campos que de verdad cambiaron (un cambio sin diferencias no escribe
  historial). `400 INVALID_INPUT` si falla la validación; `400
  CATALOG_FIELD_NOT_APPLICABLE` si se manda una cuota o devolución a un
  `REWARD`; `404 CATALOG_ENTRY_NOT_FOUND`. La primera edición pone
  `isProvisional` en `false`. Las ediciones simultáneas de una entrada se
  encadenan con `SELECT ... FOR UPDATE`.
- `GET /api/admin/currency/catalog/changes?limit=25&cursor=<id>&entryId=<id>`
  → `{ items, nextCursor }`, del más reciente al más antiguo. Una fila por
  campo modificado (`CurrencyCatalogChange`): `field`, `oldValue`, `newValue`,
  `reason`, `changedBy`, `createdAt` (igual que `PlatformSettingChange`; si se
  borra al administrador, `changedBy` queda `null` y la fila se conserva).
  `oldValue` y `newValue` son texto: números y booleanos en su forma literal
  (`"10"` o `"true"`). Una devolución sin plazo se guarda como `"null"`.

**Trabajador y empresa** (solo lectura, solo entradas activas de su propio
actor, sin ids, autor ni `isProvisional`):

- `GET /api/workers/currency/catalog` (sesión `WORKER`) y
  `GET /api/business/currency/catalog` (sesión `BUSINESS`) →
  `{ currency, items }`, con `{ actionKey, kind, amount }` y, en `COST`,
  `freeMonthlyQuota`, `freeRemaining` (cuota restante este mes de Lima) y
  `refundWindowHours`.

**Servicio de resolución** (`CurrencyCatalogService.resolve(actionKey, actor,
userId)` y la función pura `resolveCatalogAction`): devuelve el costo o premio
vigente, la cuota gratuita restante del mes de Lima (ventana `[inicio, fin)` en
UTC) y `charge` (si la acción debe cobrarse ahora: solo un `COST` activo con la
cuota agotada). No escribe en el libro. Los usos del mes los entrega un
`CurrencyUsageCounter`; en M2 ninguna acción real lo alimenta, así que el valor
por defecto devuelve `0` y `freeRemaining` es igual a la cuota. M4 aporta el
contador real.

**Migración `20261005120000_currency_catalog`** (solo agrega): tipo
`CurrencyCatalogKind`, tablas `CurrencyCatalogEntry` y `CurrencyCatalogChange`,
`CHECK` (monto > 0, cuota >= 0, devolución > 0 o nula, y sin cuota ni
devolución en `REWARD`) y la siembra de los valores **provisionales** (ver
[moneda-virtual.md](../product/moneda-virtual.md#valores-provisionales-del-catálogo-m2)).
`TRUNCATE "User" CASCADE` (pruebas) también vacía el catálogo por su FK a
`User`; las pruebas de integración lo restablecen desde
`DEFAULT_CURRENCY_CATALOG`.

## Puestos fijos y embudo de selección (M3)

Flujo principal del producto nuevo; no usa ni modifica los turnos temporales
(siguen detrás de `TEMPORARY_SHIFTS_ENABLED`). Solo API: sin interfaz web ni
Flutter (M5) y sin cobrar ni devolver monedas (M4). Código en
`apps/api/src/modules/jobs/` (máquina de estados en `job-state.ts`).

Los valores de los enums van en inglés, como el resto del esquema:

| Término de producto | Valor |
| --- | --- |
| Borrador, publicado, pausado, cerrado, cubierto | `DRAFT`, `PUBLISHED`, `PAUSED`, `CLOSED`, `FILLED` |
| Postulado, preseleccionado, entrevista, oferta, aceptada, contratado | `APPLIED`, `SHORTLISTED`, `INTERVIEW`, `OFFER`, `ACCEPTED`, `HIRED` |
| Rechazado, retirado | `REJECTED`, `WITHDRAWN` |
| Presencial, remoto, híbrido | `ONSITE`, `REMOTE`, `HYBRID` |
| Tiempo completo, parcial | `FULL_TIME`, `PART_TIME` |
| Plazo indefinido, plazo fijo, prácticas, otro | `INDEFINITE`, `FIXED_TERM`, `INTERNSHIP`, `OTHER` |

### Reglas comunes

- Sesión Bearer. `403 BUSINESS_ACCOUNT_REQUIRED` / `WORKER_ACCOUNT_REQUIRED` si el
  rol no corresponde; `401 INVALID_SESSION` sin sesión. La empresa se resuelve por
  el dueño de la sesión: ningún cuerpo ni ruta acepta `companyId` ni `workerId`.
- Aislamiento: un recurso de otra empresa o de otro trabajador responde `404`
  (`JOB_POSTING_NOT_FOUND`, `JOB_APPLICATION_NOT_FOUND`, `JOB_OFFER_NOT_FOUND`),
  igual que uno inexistente. Un borrador no existe para los trabajadores.
- Validación estricta (`400 INVALID_INPUT` con `issues`): cuerpos `.strict()`
  (cualquier campo extra, como `status`, `companyId` o `filledVacancies`, se
  rechaza), textos con longitud máxima, enteros acotados. Dinero siempre en
  céntimos de la moneda del puesto (`PEN`).
- Paginación: `limit` 1 a 100 (25 por defecto) y `cursor` opaco devuelto en
  `nextCursor` (`null` al final). Cursor inválido: `400 INVALID_CURSOR`.
- Todas las escrituras corren en `Serializable` con reintento (como el resto del
  código) sobre filas bloqueadas con `FOR UPDATE`. Orden de bloqueo: postulación
  y después puesto. Repetir una petición que ya tuvo efecto responde `200` con
  `idempotent: true` y no escribe de nuevo; un conflicto real responde `409`.
- Errores `409` frecuentes: `INVALID_STATE_TRANSITION` (con `status` actual y
  `requested`), `POSTING_NOT_PUBLISHED`, `POSTING_NOT_OPEN`, `POSTING_FILLED`,
  `POSTING_NOT_EDITABLE`, `POSTING_HAS_APPLICATIONS`, `ALREADY_APPLIED`,
  `OFFER_NOT_PENDING`, `TOO_MANY_PENDING_UPLOADS`.

### Estados del puesto

`DRAFT → PUBLISHED ⇄ PAUSED → CLOSED`; `PUBLISHED`/`PAUSED → FILLED` solo por la
última contratación confirmada (no hay ruta pública). `CLOSED` y `FILLED` son
terminales. Un puesto solo se edita en `DRAFT` o `PAUSED` (`409
POSTING_NOT_EDITABLE`); las preguntas de filtro no cambian si ya hay
postulaciones (`409 POSTING_HAS_APPLICATIONS`); `vacancies` no baja de lo ya
cubierto ni lo igualan (`400 VACANCIES_BELOW_FILLED`): mientras el puesto siga
abierto el total debe superar lo cubierto; para cerrar un puesto cubierto se usa
la transición a `FILLED`/`CLOSED`. Publicar o postular exige al menos una
vacante libre (`409 POSTING_FILLED`). Solo un puesto `PUBLISHED` recibe
postulaciones y aparece en la búsqueda. `filledVacancies` es derivado: lo
incrementa únicamente la confirmación de una contratación, en la misma
transacción, con `UPDATE ... WHERE filledVacancies < vacancies` y
`CHECK (filledVacancies <= vacancies)`.

Al pasar a `CLOSED` (cierre manual) o `FILLED` (última contratación), en la
misma transacción cada postulación en `OFFER` con oferta `PENDING` retira esa
oferta (`WITHDRAWN`) y pasa a `REJECTED`. La línea de tiempo registra un
evento `REJECTED` con detalle `POSTING_CLOSED` o `POSTING_FILLED` (el
trabajador no ve el detalle de un `REJECTED`, pero sí el estado del puesto) y
se emite el aviso SSE al trabajador. Las demás postulaciones abiertas
(`APPLIED`, `SHORTLISTED`, `INTERVIEW`, `ACCEPTED`) no se tocan: una
postulación `ACCEPTED` sin contratar queda así, sin aviso, sobre un puesto
`CLOSED`/`FILLED` (no se puede contratar, `409`; la empresa puede rechazarla).
Si el cierre o la última contratación compiten con una aceptación o una oferta
simultáneas, `Serializable` decide un solo orden: o la aceptación gana y queda
`ACCEPTED`, o pierde con `409` y la postulación queda `REJECTED` con la oferta
`WITHDRAWN`; nunca queda una oferta `PENDING` en un puesto cerrado o cubierto.

Pendiente de decisión de producto (sin cambio en código): el DNI visible para la
empresa en la constancia de aceptación y el borrado en cascada de la constancia
al eliminar una cuenta.

### Embudo de la postulación

`APPLIED → SHORTLISTED → INTERVIEW → OFFER → ACCEPTED → HIRED`, con salidas
`REJECTED` (decide la empresa) y `WITHDRAWN` (decide el trabajador). La empresa
puede saltarse etapas hacia `INTERVIEW` u `OFFER` y nunca retrocede; el
trabajador solo se retira o acepta la oferta vigente; `ACCEPTED → HIRED` solo
lo confirma la empresa. `HIRED`, `REJECTED` y `WITHDRAWN` son terminales. La
tabla de transiciones por actor está en `job-state.ts`.

### Empresa (`/api/business`)

| Ruta | Efecto |
| --- | --- |
| `POST /job-postings` | Crea un borrador (`201`). Campos: `title` (5-120), `description` (20-5000), `responsibilities`/`requirements`/`benefits` (opcionales, hasta 3000), `modality`, `workload`, `salaryMinCents`/`salaryMaxCents` (1 a 10 000 000, mínimo <= máximo, `400 INVALID_SALARY_RANGE`), `location`, `contractType`, `expectedStartDate` (`YYYY-MM-DD`, no pasada en Lima), `vacancies` (1-500), `screeningQuestions` (hasta 5, 10-240 caracteres, sin repetidas). |
| `GET /job-postings?status=&limit=&cursor=` | Mis puestos, con `applicationsCount`. |
| `GET /job-postings/:id` | Detalle con `applicantCounts` por etapa. |
| `PATCH /job-postings/:id` | Edita un borrador o puesto en pausa; al menos un campo. |
| `POST /job-postings/:id/publish` / `pause` / `close` | Cambia el estado (idempotente). Publicar guarda `publishedAt` la primera vez y solo esa primera publicación cuenta para `JOB_PUBLISH_EXTRA` (ver M4). |
| `POST /job-postings/:id/highlight` | Destaca el puesto (`JOB_HIGHLIGHT`) por `JOB_HIGHLIGHT_DURATION_HOURS`; mientras siga vigente repetirlo no cobra. |
| `GET /job-postings/:id/applications?status=APPLIED,SHORTLISTED&limit=&cursor=` | Postulantes (con prioridad primero, `isPriority`; filtro por una o varias etapas): nombre, titular y distrito del perfil, `hasCv`, entrevista y estado de la última oferta. Nunca correo ni teléfono; el número de DNI solo aparece, tras la aceptación, dentro de `acceptanceSnapshot` (ver Constancia de aceptación). |
| `GET /job-applications/:id` | Detalle: respuestas de filtro, ofertas (todas las versiones), línea de tiempo y motivo de decisión. |
| `POST /job-applications/:id/stage` `{status}` | `SHORTLISTED` o `INTERVIEW` (sin fecha). La oferta, la contratación y el rechazo tienen su propia ruta. |
| `POST /job-applications/:id/interview` `{scheduledAt, mode?, note?}` | Programa o reprograma la entrevista (`mode`: `ONSITE`/`VIDEO`/`PHONE`); la fecha debe ser futura y de hasta un año (`400 INVALID_INTERVIEW_DATE`). Pasa a `INTERVIEW`. |
| `PUT /job-applications/:id/offer-documents` | Sube el PDF de la oferta (cuerpo binario `application/pdf`, hasta 5 MB, cabecera `X-File-Name` con extensión `.pdf`, firma `%PDF-` verificada; `400 INVALID_OFFER_DOCUMENT`, `413 OFFER_DOCUMENT_TOO_LARGE`). Devuelve `{id, name, mediaType, sizeBytes, sha256}`. Se guarda en el almacenamiento privado; hasta 5 sin usar por postulación. |
| `POST /job-applications/:id/offers` `{salaryCents, contractType, startDate, note?, documentId?}` | Emite una oferta (`201`) y pasa a `OFFER`. Una oferta nueva crea la versión siguiente y deja la pendiente en `SUPERSEDED`. Reenviar una oferta idéntica a la pendiente responde `200` sin versión nueva. `documentId` consume el PDF subido (`400 OFFER_DOCUMENT_NOT_AVAILABLE` si no existe, es de otra postulación o ya se usó). Fecha de ingreso no pasada (Lima). |
| `POST /job-applications/:id/hire` | Confirma la contratación de una postulación `ACCEPTED`: la pasa a `HIRED`, suma una vacante cubierta y, al llenarse, deja el puesto en `FILLED`. Dos confirmaciones simultáneas por la última vacante: una responde `200` y la otra `409 POSTING_FILLED`. |
| `POST /job-applications/:id/reject` `{reason?}` | Rechaza (`REJECTED`) desde cualquier etapa abierta, incluida `ACCEPTED`; una oferta pendiente queda `WITHDRAWN`. El motivo (hasta 500) es interno: el trabajador no lo ve. |
| `GET /job-applications/:id/cv` | CV del postulante (PDF, `no-store`) solo mientras siga en proceso (no `REJECTED`/`WITHDRAWN`) y su perfil sea visible; si no, `404 JOB_DOCUMENT_NOT_FOUND`. |
| `GET /job-applications/:id/offers/:offerId/document` | PDF de la oferta; `404 JOB_DOCUMENT_NOT_FOUND` si esa versión no tiene documento. |

Con el puesto `CLOSED` o `FILLED` la empresa ya no avanza, programa ni ofrece
(`409 POSTING_NOT_OPEN`) ni contrata, pero sí puede rechazar.

### Trabajador (`/api/workers`)

| Ruta | Efecto |
| --- | --- |
| `GET /job-postings?query=&modality=&workload=&contractType=&minSalaryCents=&location=&limit=&cursor=` | Busca puestos `PUBLISHED`: primero los destacados vigentes (`isHighlighted`), luego del más reciente al más antiguo (cursor estable entre ambos tramos). `minSalaryCents` exige que el máximo del rango lo alcance; `query`/`location` no distinguen mayúsculas. Cada puesto trae `vacanciesRemaining`, `company.name` y `myApplication`. No expone `vacancies`, `filledVacancies` ni datos de otros candidatos. |
| `GET /job-postings/:id` | Detalle público (`404` si no está publicado). |
| `POST /job-postings/:id/applications` `{answers:[{question, answer}]}` | Postula (`201`). Debe responder exactamente las preguntas de filtro (`400 INVALID_SCREENING_ANSWERS`). Repetir mientras sigue `APPLIED` responde `200` con la misma postulación. **Re-postulación (M4):** si estaba `WITHDRAWN` (incluido el rechazo de una oferta) se reactiva la MISMA fila (`APPLIED`, historial conservado, evento `APPLICATION_REOPENED`, responde `200` con `reopened: true`) y no vuelve a cobrar monedas (la clave de cobro es por puesto y trabajador); quien fue `REJECTED` por la empresa, o está en otra etapa, recibe `409 ALREADY_APPLIED` con su `status`; si la postulación `WITHDRAWN` conserva una oferta aceptada, `409 APPLICATION_HAS_ACCEPTED_OFFER` (no se reabre). Cuerpo opcional `priority: true` para postular con prioridad. Seis envíos simultáneos crean una sola. Puesto no publicado: `409 POSTING_NOT_PUBLISHED`; cubierto: `409 POSTING_FILLED`. |
| `GET /job-applications?status=&history=&limit=&cursor=` | Mis postulaciones. Por defecto **no** incluye las resueltas automáticamente por el cierre o la cobertura del puesto (`autoClosedReason`); `history=true` las incluye. |
| `POST /job-applications/:id/priority` | Compra la prioridad de una postulación propia que la empresa aún no movió (`APPLICATION_PRIORITY`). Idempotente; `409 PRIORITY_NOT_AVAILABLE` si ya no aplica. |
| `GET /job-applications/:id` | Detalle propio: puesto, entrevista, `currentOfferId`, ofertas con su constancia y línea de tiempo (sin el motivo de rechazo). |
| `POST /job-applications/:id/withdraw` | Se retira (`WITHDRAWN`) desde cualquier etapa abierta, también tras aceptar la oferta si aún no la contrataron. |
| `POST /job-applications/:id/offers/:offerId/accept` | Acepta la oferta vigente (`PENDING`): oferta `ACCEPTED`, postulación `ACCEPTED` y constancia. Una versión reemplazada responde `409 OFFER_NOT_PENDING`. |
| `POST /job-applications/:id/offers/:offerId/decline` | Rechaza la oferta: oferta `DECLINED` y postulación `WITHDRAWN` (rechazar una oferta es una retirada del trabajador; `REJECTED` es siempre decisión de la empresa), con el evento `OFFER_DECLINED`. |
| `GET /job-applications/:id/offers/:offerId/document` | PDF de la oferta propia. |

### Constancia de aceptación

Al aceptar se guarda `acceptanceSnapshot` en la oferta: fecha de aceptación,
versión, empresa (nombre, razón social, RUC), trabajador (nombre y número de DNI,
visibles para la empresa desde ese momento),
puesto (título, modalidad, jornada, lugar, rango), condiciones ofrecidas
(salario, moneda, tipo de contrato, fecha de ingreso, nota) y metadatos y
`sha256` del documento adjunto. Un trigger de PostgreSQL
(`JobOffer_accepted_is_immutable`) rechaza cualquier `UPDATE` posterior de una
oferta `ACCEPTED`; emitir una oferta nueva sobre una postulación aceptada da
`409`. **Constancia conservada (M4):** la oferta aceptada, su postulación, el
puesto y la empresa ya no se borran por cascada. Las FK `JobPosting.companyId`,
`JobApplication.postingId` y `JobApplication.workerId` son `RESTRICT`, y el borrado
administrativo de una empresa o de un trabajador responde
`409 CONTRACT_RECORDS_RETAINED` (sin borrar nada) si el titular tiene ofertas
aceptadas; también se mapea el `23001` de las FK `RESTRICT` ante una aceptación
que llegue entre la comprobación y el borrado (misma política que el libro de
monedas). Sin ofertas aceptadas, el borrado retira antes los puestos,
postulaciones y PDF de la cuenta. La constancia se conserva como evidencia del
acuerdo, soporte y disputas, retención legal y antifraude; el DNI visible para la
empresa tras la aceptación es decisión confirmada del dueño del producto. La
**anonimización** posterior es alcance futuro. La firma digital y la integración
con planilla siguen fuera de alcance.

### Línea de tiempo y avisos en tiempo real

Cada cambio escribe un `JobApplicationEvent` (quién, qué, estado anterior y
nuevo, cuándo; el autor pasa a nulo si se borra la cuenta). Tipos: `APPLIED`,
`SHORTLISTED`, `INTERVIEW_SCHEDULED`, `OFFER_ISSUED`, `OFFER_ACCEPTED`,
`OFFER_DECLINED`, `HIRED`, `REJECTED`, `WITHDRAWN`, `APPLICATION_REOPENED` (M4).

`GET /api/job-events` (cualquier sesión válida) es un flujo SSE con el mismo
patrón del feed de turnos. Tras confirmar cada cambio, el servicio avisa solo a
la contraparte con `event: job` y `{type, applicationId, postingId, status, at}`.
El bus es en proceso: con varias instancias de la API el aviso solo llega a los
clientes conectados a la instancia que atendió el cambio (igual que el feed de turnos).

### Puntos de extensión para M4

`JobService` acepta `JobHooks` (`beforePublish`, `beforeApply`, `chargePriority`,
`chargeHighlight`, `afterHire`) que se ejecutan dentro de la transacción de la
operación con el cliente transaccional. Desde M4 `createJobCurrencyHooks`
(`currency.hooks.ts`) los conecta con el cobro; sus errores se traducen a `409`
(ver «Acciones conectadas a la moneda virtual»). Como la operación se reintenta
ante conflictos de `Serializable`, un gancho puede ejecutarse más de una vez:
solo escribe con `tx` y es idempotente por clave de instancia.

**Postulaciones aceptadas sobre un puesto que se cierra o se cubre (M4):** al
cerrar o cubrir un puesto, además de retirar las ofertas `PENDING`, las
postulaciones `ACCEPTED` no contratadas pasan a `REJECTED` en la misma
transacción, con `autoClosedReason` (`POSTING_CLOSED` o `POSTING_FILLED`), evento
con ese detalle y aviso SSE al trabajador. La constancia de la oferta aceptada se
conserva. Las listas del trabajador las ocultan salvo `history=true`.

### Diferido

- Chat de la postulación: `Conversation` exige un `CompanyWorkerContact`
  (directorio de la empresa) y está atada a turnos; reutilizarla obliga a
  crear contactos y a ampliar el modelo, así que se difiere a M5.
- Interfaces web y Flutter (M5) y firma digital.
- Los PDF de ofertas se retiran del almacenamiento privado al borrar una cuenta
  sin ofertas aceptadas; los de una cuenta con constancia se conservan (el
  borrado se bloquea, ver «Constancia de aceptación»).

**Migración `20261006100000_job_postings`** (solo agrega): enums, tablas
`JobPosting`, `JobApplication`, `JobOffer`, `JobOfferUpload` y
`JobApplicationEvent`; `CHECK` de rango salarial, vacantes y salario ofertado;
índice único parcial (una oferta abierta o aceptada por postulación) y el
trigger de inmutabilidad.

## Acciones conectadas a la moneda virtual (M4)

Solo API y datos (las interfaces son M5). Usa el catálogo de M2 y el libro de M1.

**Principio:** lo básico es gratis y nunca se bloquea por saldo (aceptar o
rechazar una oferta, retirarse, responder una invitación, ver el proceso, leer el
saldo). Solo cobran las acciones del catálogo listadas abajo.

**Cobro atómico.** El débito ocurre dentro de la misma transacción `Serializable`
de la acción (`CurrencyActionService.charge`, sin transacción propia): si la
acción falla no queda cobro, y si el cobro falla no queda la acción. Cada
instancia tiene una clave de idempotencia (`job-publish:{postingId}`,
`job-apply:{postingId}:{workerId}`, `job-priority:{applicationId}`,
`job-highlight:{postingId}:{n}`, `talent-invite:{id}`,
`contact-unlock:{companyId}:{workerUserId}`) guardada en `CurrencyActionUse`
(único): reintentos y clics repetidos nunca cobran dos veces. La cuenta se
bloquea con `SELECT ... FOR UPDATE` y el saldo nunca queda negativo.

**Cuota gratuita.** Contador real por usuario, acción y **mes calendario de
Lima** (`JOB_PUBLISH_EXTRA`: 3/mes empresa; `APPLICATION_EXTRA`: 10/mes
trabajador). Dentro de la cuota se registra el uso con cobro 0; fuera, se cobra
el monto del catálogo.

**Errores (409):** `INSUFFICIENT_CURRENCY` `{cost, balance}` (sin efectos
secundarios), `DAILY_SPEND_CAP_REACHED` `{cost, dailyCap, spentToday}`,
`IDEMPOTENCY_KEY_REUSED`.

**Tope de gasto diario.** `DAILY_SPEND_CAP_WORKER` y `DAILY_SPEND_CAP_COMPANY`
(provisional 200 monedas por día de Lima y por actor). Suma lo cobrado en el
día; nunca aplica a devoluciones, premios ni acciones gratuitas.

| Acción (clave) | Ruta | Notas |
| --- | --- | --- |
| `JOB_PUBLISH_EXTRA` | `POST /api/business/job-postings/:id/publish` | Solo la primera publicación cuenta; reanudar un puesto pausado es gratis. |
| `JOB_HIGHLIGHT` | `POST /api/business/job-postings/:id/highlight` | Fija `highlightedUntil` (duración editable); los destacados salen primero en la búsqueda de puestos. Con uno vigente no cobra. |
| `APPLICATION_EXTRA` | `POST /api/workers/job-postings/:id/applications` | Una vez por (puesto, trabajador): re-postular no cobra de nuevo. |
| `APPLICATION_PRIORITY` | `priority: true` al postular, o `POST /api/workers/job-applications/:id/priority` | Marca `isPriority`; la empresa la ve primero. Solo mientras la empresa no la haya movido. Atómico con la postulación. |
| `TALENT_INVITE` | `POST /api/business/talent-invitations` | Cobra al crear la invitación; con devolución. |
| `CANDIDATE_CONTACT_UNLOCK` | `POST /api/business/talent/:profileId/unlock-contact` | Idempotente por (empresa, candidato): `201` la primera vez, `200` después, sin cobrar. Habilita `GET /api/business/talent/:profileId/contact` y `.../cv`; `GET /api/business/talent-unlocks` lista los desbloqueos. Sin desbloqueo, `CONTACT_NOT_UNLOCKED`. |

**Cotización sin efectos.** `GET /api/workers/currency/quote` y
`GET /api/business/currency/quote` con `?actionKey=&targetId=` (opcional: puesto,
postulación o perfil) devuelven `{currency, actionKey, cost, reason
(CHARGE|FREE_QUOTA|ALREADY_REGISTERED|FREE_ACTION), freeQuota, balance,
sufficientBalance, dailyCap, withinDailyCap, canExecute, refundWindowHours}`. No
escribe nada ni crea cuentas. Acción no cotizable: `404 ACTION_NOT_QUOTABLE`.

**Bono de bienvenida (`WELCOME_BONUS`).** Se otorga al registrar un trabajador y
al crear la cuenta de una empresa (admin), con clave `welcome-bonus:{actor}:{id}`:
un solo bono por cuenta; si falla no deshace el alta. Para cuentas anteriores:
`POST /api/admin/currency/welcome-bonus/backfill` (idempotente; informa cuántas
cuentas lo recibieron y cuántas ya lo tenían). Una cuenta con el movimiento del
bono cuenta como «ya lo tenía» aunque el monto de `WELCOME_BONUS` se haya
editado después (no hay `409 IDEMPOTENCY_KEY_REUSED` y la pasada continúa;
CN-20261007-045). No hay migración masiva automática.

**Devolución automática.** Tarea programada en proceso (`server.ts`,
`CURRENCY_REFUND_INTERVAL_MS`, 5 min por defecto; `0`/`off` la desactiva y no
corre bajo pruebas). Para `TALENT_INVITE`, `APPLICATION_EXTRA` y
`APPLICATION_PRIORITY` cobradas, al cumplirse `refundWindowHours` del catálogo
(72 h provisional, congelado al cobrar) devuelve el costo si la otra parte no
respondió (invitación sin respuesta; postulación todavía `APPLIED` sin
movimiento de la empresa ni retirada). Un movimiento `ACTION_REFUND` enlazado al
cobro (`refundOfId`, único) y la clave `refund:{movimiento}` garantizan una sola
devolución por cobro; cada cobro se reclama con `FOR UPDATE SKIP LOCKED`, seguro
con varias instancias de la API. `POST /api/admin/currency/refunds/run` ejecuta
una pasada.

**Ajustes del administrador** (con historial, como el catálogo):
`GET /api/admin/currency/settings`, `GET /api/admin/currency/settings/changes` y
`PATCH /api/admin/currency/settings/:key {value, reason}` para
`DAILY_SPEND_CAP_WORKER`, `DAILY_SPEND_CAP_COMPANY` y
`JOB_HIGHLIGHT_DURATION_HOURS` (los de premios de M6 se listan en su sección).

**Diferido en M4, resuelto en M6:** `PROFILE_HIGHLIGHT` (destacar el perfil del
trabajador) y los premios por perfil completo, documentos, referidos, empresa
verificada, respuesta a tiempo y contratación confirmada se implementaron en M6
(ver «Ganar monedas: premios automáticos (M6)»).

**Migración `20261007100000_currency_actions`:** agrega `CurrencyActionUse`,
`CurrencySetting`, `CurrencySettingChange` y `CandidateContactUnlock`; las
columnas `CurrencyMovement.actionKey/refundOfId`, `JobPosting.highlightedUntil` y
`JobApplication.isPriority/prioritizedAt/autoClosedReason`; valores de enum
nuevos; y cambia tres FK a `RESTRICT`. La única sentencia de datos rellena
`autoClosedReason` en las postulaciones que M3 ya había rechazado al cerrar o
cubrir un puesto (evento `REJECTED` con ese detalle y sin `decisionReason`); no
borra filas. Las postulaciones `ACCEPTED` que ya estuvieran sobre un puesto
cerrado o cubierto antes de M4 no se resuelven solas.

**Bono de bienvenida y borrado (decisión del dueño, CN-20261007-045):** el bono
por sí solo no retiene el borrado. `DELETE /api/admin/workers/:id` y
`DELETE /api/admin/companies/:id` responden `204` para una cuenta cuyo único
movimiento es el `WELCOME_BONUS`; con cualquier otro movimiento siguen
respondiendo `409 CURRENCY_LEDGER_RETAINED` (ver «Borrado de titulares»).
Límite conocido de `CN-20261007-046` (BAJO-A), **cerrado en M6
(`CN-20261012-047`)**: borrados simultáneos del mismo titular o un borrado
simultáneo con una acción del propio titular ya no responden `500` (ver «Borrado de
titulares bajo concurrencia» en la sección de M6).

**Postulación con oferta aceptada (CN-20261007-045):** una oferta `ACCEPTED` es
una constancia inmutable. Si el trabajador se retira después de aceptarla,
`POST /api/workers/job-postings/:id/applications` no reabre la postulación y
responde `409 APPLICATION_HAS_ACCEPTED_OFFER` (la postulación queda `WITHDRAWN`
y la oferta, intacta). Emitir una oferta sobre una postulación que ya tiene una
aceptada responde el mismo `409`, nunca `500`.

**Devolución y concurrencia (CN-20261007-045):** cada devolución se procesa en una
transacción `Serializable` con reintento; un cobro simultáneo sobre la misma
cuenta ya no produce `500` por `(accountId, sequence)`.

## Ganar monedas: premios automáticos (M6)

Solo API y datos (las interfaces son M5). Los montos salen siempre del catálogo
de M2 (entradas `REWARD`, valores provisionales); el código nunca los fija.

**Reglas comunes de todo premio** (`CurrencyRewardService`, `currency.rewards.ts`):

- **Un premio nace de un hecho** con clave estable `{actionKey}:{hecho}` guardada
  en `CurrencyRewardGrant.factKey` (**único**) y como clave de idempotencia del
  movimiento (`reward:{factKey}`). El mismo hecho nunca paga dos veces, aunque
  lo procesen dos transacciones a la vez (la cuenta se bloquea, el único lo
  garantiza y `Serializable` reintenta al perdedor).
- **Atómico con el hecho.** El premio se escribe en la misma transacción
  `Serializable` que el hecho que lo dispara (guardar el perfil, verificar,
  responder, contratar): si el hecho se revierte no queda premio. Una regla de
  negocio que impide pagar (entrada inactiva, tope) **no** revierte el hecho; un
  fallo técnico del premio tampoco: corre dentro de un `SAVEPOINT`, se revierte
  solo el premio, se registra `REWARD_FAILED` en el log y el hecho se conserva.
  Los conflictos de serialización y los interbloqueos sí se propagan para que
  se reintente la transacción completa (hecho y premio juntos).
- **Catálogo:** una entrada ausente, inactiva o que no sea `REWARD` significa
  «sin premio» (el hecho ocurre igual). El libro registra `action = REWARD`,
  `actionKey` y la entidad relacionada del hecho.
- **Tope de premios** (defensa contra granjas, editable con historial):
  `REWARD_CAP_DAILY_WORKER`/`REWARD_CAP_DAILY_COMPANY` (provisional 100
  monedas por día de Lima y titular) y `REWARD_CAP_MONTHLY_WORKER`/
  `REWARD_CAP_MONTHLY_COMPANY` (600 por mes de Lima). Suma lo ganado por premios
  (`CurrencyRewardGrant`); excluye el bono de bienvenida. Un premio que no cabe
  entero **no se otorga** (`CAP_REACHED_DAILY|MONTHLY`). Los premios **no cuentan
  para el tope de gasto** (`CurrencyActionUse`) ni al revés.
- **Sin gasto ni saldo negativo:** un premio solo suma (el CHECK del libro y el
  tope de saldo máximo siguen vigentes).
- **Reintento natural:** si el hecho puede volver a evaluarse (perfil, documento,
  empresa verificada, referido), un premio que antes no cupo o no existía en el
  catálogo se otorga la próxima vez que se repita la evaluación; cada hecho sigue
  pagando una sola vez.

| Premio (`actionKey`) | Actor | Hecho y clave | Cuándo | Anti-fraude |
| --- | --- | --- | --- | --- |
| `PROFILE_COMPLETE` | Trabajador | `PROFILE_COMPLETE:{userId}` | Al guardar el perfil o subir CV/foto y cumplirse **todas** las secciones obligatorias (abajo) | Una sola vez por trabajador aunque borre y vuelva a completar |
| `DOCUMENT_VERIFIED` | Trabajador | `DOCUMENT_VERIFIED:{userId}:{tipo}` | El admin marca verificado el CV o la foto | **Un premio por tipo** (máximo 2); reemplazar el archivo quita la verificación pero no vuelve a pagar |
| `INVITATION_RESPONDED` | Trabajador | `INVITATION_RESPONDED:{invitationId}` | Al aceptar **o** rechazar una invitación `PENDING` y no vencida | Una vez por invitación; una anulada, vencida o ya respondida no paga |
| `REFERRAL` | Trabajador (referidor) | `REFERRAL:{referralId}` | Cuando el referido completa su perfil | Ver «Referidos» |
| `COMPANY_VERIFIED` | Empresa | `COMPANY_VERIFIED:{companyId}` | El admin marca verificada la empresa | Una vez por empresa; quitar y volver a poner la verificación no repite |
| `APPLICANTS_RESPONDED_ON_TIME` | Empresa | `APPLICANTS_RESPONDED_ON_TIME:{applicationId}` | La empresa mueve una postulación fuera de `APPLIED` (preseleccionar, entrevista, oferta o rechazo) dentro de `APPLICANT_RESPONSE_WINDOW_HOURS` desde que llegó o se reabrió | Una vez por postulación (mover y devolver, o retirarse y re-postular, no repite) y tope mensual por empresa |
| `HIRE_CONFIRMED` | Empresa | `HIRE_CONFIRMED:{applicationId}` | Al confirmar `HIRED`, dentro de la transacción de la contratación (gancho `afterHire`) | Una por contratación; si la contratación falla no hay premio |

### Perfil completo (criterio objetivo)

Fuente: `apps/api/src/modules/talent/profile-completeness.ts`. El perfil está
completo cuando cumple **todas** estas secciones obligatorias (lista fija, no
un porcentaje): `headline` (≥ 10 caracteres), `bio` (≥ 40), `district`,
`availability` (al menos un día **y** un periodo), `specialties` (≥ 1),
`experience` (≥ 1), `cv` y `photo`. Son opcionales (no se exigen) las
certificaciones, los idiomas, la zona de trabajo y el texto libre de
disponibilidad; el porcentaje `completion` del perfil no cambia. El criterio
mide que los datos existan; la calidad de los documentos la valida el
administrador (`DOCUMENT_VERIFIED`). Se evalúa **dentro de la misma transacción**
de `PATCH /api/workers/me/profile`, `PUT /api/workers/me/cv` y
`PUT /api/workers/me/photo`. Dos guardados simultáneos pagan una sola vez.

### Verificaciones del administrador

Solo `ADMIN` (`403` otro rol, `401` sin sesión). Marcar verificado guarda **autor y
fecha** (`verifiedById`, `verifiedAt`); repetirlo es idempotente (conserva el autor
y la fecha originales) y reintenta el premio si antes no cupo.

**Revisión del documento (CN-20261012-049, BAJO-3).** La verificación queda ligada al
archivo concreto que el admin revisó:

- `GET /api/admin/workers/:workerId/documents` → `{documents: [{kind, id, version,
  originalName, mediaType, sizeBytes, uploadedAt, verified, verifiedAt, verifiedById,
  history: [{action, reason, changedById, documentVersion, createdAt}]}]}` (el más
  reciente primero; se leen los 40 cambios más recientes del trabajador entre ambos tipos
  y se muestran hasta 20 por tipo, así que con muchos cambios de un tipo el historial del
  otro puede salir recortado; no hay paginación todavía). `version` es un identificador opaco
  (hash de la clave de almacenamiento): cambia con cada archivo nuevo y **nunca se
  expone la clave de almacenamiento**. `uploadedAt` es la fecha de subida del archivo
  vigente (en filas anteriores a la migración `20261012200000`, la de creación).
  `404 WORKER_NOT_FOUND` si la cuenta no es un trabajador.
- `GET /api/admin/workers/:workerId/documents/:kind/file`: descarga el archivo
  (`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `inline`)
  y devuelve su `version` en `X-Document-Version`. Control estricto de rol `ADMIN`:
  ni el propio trabajador ni una empresa pueden usarla (`403`); `404 DOCUMENT_NOT_FOUND`
  / `404 DOCUMENT_FILE_NOT_FOUND`; `409 DOCUMENT_CHANGED` si lo reemplazaron mientras se
  leía.
- `POST /api/admin/workers/:workerId/documents/:kind/verification` con `kind` =
  `CV` o `PROFILE_PHOTO` y cuerpo `{documentVersion}` (obligatorio, la `version` del
  archivo revisado) → `{verified, alreadyVerified, verifiedAt, verifiedById,
  documentVersion, reward: {granted, amount, reason?}}`. **`409 DOCUMENT_CHANGED`** si
  el archivo vigente ya no es el revisado (el trabajador lo reemplazó): no verifica
  nada, no paga y no escribe historial. `400` si falta la versión, hay campos de más
  o el tipo no existe; `404 DOCUMENT_NOT_FOUND` si el trabajador no tiene ese
  documento. La comprobación ocurre bajo el bloqueo de la fila del documento, así que
  un reemplazo simultáneo nunca deja verificado un archivo distinto del revisado.
- `DELETE /api/admin/workers/:workerId/documents/:kind/verification` con cuerpo
  `{reason}` (3 a 500 caracteres, obligatorio) → `{verified: false, alreadyUnverified}`.
  Guarda autor, fecha y motivo en el historial (`WorkerDocumentVerificationChange`);
  si no estaba verificado no escribe nada (idempotente). No descuenta nada: el libro es
  solo de suma, y volver a verificar no vuelve a pagar (un premio por tipo y trabajador,
  así que verificar y retirar en bucle no permite farmear premios: máximo 2 por trabajador).
- `POST /api/admin/companies/:companyId/verification` (idempotente) y
  `DELETE /api/admin/companies/:companyId/verification` con cuerpo `{reason}` →
  `{verified: false, alreadyUnverified}` (`404 COMPANY_NOT_FOUND`). Mismo historial
  (`CompanyVerificationChange`, con autor, fecha y motivo al retirar). Todavía no hay ruta
  para leer el historial de la empresa: se consulta en la base hasta que M5 lo necesite.

El historial no es de solo lectura por trigger: el autor pasa a `null` si la cuenta del
admin se borra (`ON DELETE SET NULL`); la fila se conserva. Subir un archivo nuevo (CV o
foto) borra su verificación (sin fila de historial: lo hace el trabajador, no un admin); el
premio ya pagado por ese tipo no se vuelve a pagar al verificarlo de nuevo.

### Referidos

- `GET /api/workers/me/referral` (sesión `WORKER`) → `{code, referred, rewarded,
  monthly: {limit, used, remaining}}`. Crea el código propio la primera vez
  (8 caracteres aleatorios sin ambiguos, `User.referralCode` único); solo datos
  propios, nunca revela referidos de otros.
- `POST /api/auth/register` acepta `referralCode` (opcional, no distingue
  mayúsculas). Un código inexistente o mal formado responde
  `400 INVALID_REFERRAL_CODE` y **no crea la cuenta**. Con un código válido la
  cuenta y su `WorkerReferral` se crean en una sola transacción. El registro con
  Google no admite código en esta entrega.
- **El premio no se paga al registrarse**: se paga al referidor cuando el referido
  cumple el criterio de perfil completo (mismo evento que `PROFILE_COMPLETE`),
  una sola vez por referido.

**Reglas anti-fraude de referidos:** (1) el referido es único (`referredId`
único): una cuenta cuenta una sola vez y no puede reasignarse a otro referidor;
(2) sin auto-referido: el código solo existe para una cuenta ya creada, el
referido es siempre una cuenta nueva y la base lo refuerza con
`CHECK (referrerId <> referredId)`; (3) pagar exige perfil completo (CV, foto,
experiencia, etc.), así crear cuentas vacías no rinde nada; (4) límite mensual
por referidor `REFERRAL_MONTHLY_LIMIT` (provisional 5 por mes de Lima, editable
con historial): un referido que no cabe queda **pendiente** y se premia la
próxima vez que guarde su perfil con cupo; (5) los topes diario y mensual de
premios del referidor; (6) dos registros simultáneos con el mismo código crean dos
referidos distintos y, con límite 1, solo uno paga. Límite conocido: nada impide
que una misma persona cree cuentas con DNI y correo distintos; el costo de cada
cuenta (perfil completo) y los topes acotan el beneficio.

### Lista de premios del actor

- `GET /api/workers/currency/rewards` (sesión `WORKER`) y
  `GET /api/business/currency/rewards` (sesión `BUSINESS`) →
  `{currency, items, caps}`. Cada item: `{actionKey, amount, repeatable,
  earnedCount, earnedAmount, status: EARNED|AVAILABLE, ...}` con datos extra por
  premio: `PROFILE_COMPLETE` → `requiredSections` y `missingSections`;
  `DOCUMENT_VERIFIED` → `maxRewards` y `documents[{kind, uploaded, verified,
  rewarded}]`; `REFERRAL` y `APPLICANTS_RESPONDED_ON_TIME` → `monthly {limit,
  used, remaining}` (el segundo, además `windowHours`); `COMPANY_VERIFIED` →
  `verified`. `caps` trae lo ganado y lo que queda hoy y este mes. Solo aparecen los
  premios activos del catálogo del actor, nunca claves internas de hechos ni
  movimientos, y cada rol solo ve los suyos.

### Destacar el perfil (`PROFILE_HIGHLIGHT`)

- `POST /api/workers/me/profile/highlight` (sesión `WORKER`) cobra `PROFILE_HIGHLIGHT`
  (10 monedas provisional, con su cuota gratuita y el tope de gasto diario) y fija
  `highlightedAt/highlightedUntil` en la misma transacción; duración
  `PROFILE_HIGHLIGHT_DURATION_HOURS` (168 h provisional, editable). Mientras el
  destacado esté vigente repetirlo no cobra ni extiende (`idempotent: true`). Un
  perfil oculto (`isVisible: false`) responde `409 PROFILE_NOT_VISIBLE` sin cobrar;
  sin saldo, `409 INSUFFICIENT_CURRENCY`. Cotizable con
  `GET /api/workers/currency/quote?actionKey=PROFILE_HIGHLIGHT&targetId=<perfil propio>`.
- `GET /api/business/talent` ordena primero los perfiles destacados vigentes
  (`isHighlighted: true` en la tarjeta) y luego el resto, por `id` ascendente en
  cada tramo. **El `nextCursor` es opaco** y recuerda tramo, último `id` y el
  instante de la primera página: la partición destacados/resto se calcula siempre
  con ese instante (`highlightedAt <= instante < highlightedUntil`), así que un
  destacado que vence o se compra a mitad de la paginación no repite ni salta filas.
  Un cursor antiguo (un `id` simple) se acepta y continúa en el tramo resto. El perfil
  propio devuelve `highlightedUntil`.

### Ajustes nuevos (administrador, con historial, provisionales)

Mismas rutas que M4 (`GET/PATCH /api/admin/currency/settings`): `REWARD_CAP_DAILY_WORKER` 100,
`REWARD_CAP_MONTHLY_WORKER` 600, `REWARD_CAP_DAILY_COMPANY` 100,
`REWARD_CAP_MONTHLY_COMPANY` 600, `REFERRAL_MONTHLY_LIMIT` 5,
`APPLICANT_RESPONSE_WINDOW_HOURS` 72, `APPLICANT_RESPONSE_MONTHLY_LIMIT` 20 (premios de
respuesta por empresa y mes de Lima) y `PROFILE_HIGHLIGHT_DURATION_HOURS` 168.

### Datos y migración

Migración `20261012100000_currency_rewards` (solo agrega): `CurrencyRewardGrant`
(único `factKey`), `WorkerReferral`, `User.referralCode`, `WorkerDocument.verifiedAt/
verifiedById`, `Company.verifiedAt/verifiedById`, `WorkerTalentProfile.highlightedAt/
highlightedUntil` y las 8 filas de ajustes. No modifica ni borra filas existentes.
Los ganchos de `JobHooks` nuevos: `afterCompanyResponse` y el contexto de `afterHire` con
`userId`.

Migración `20261012200000_verification_history` (`CN-20261012-049`, solo agrega): el tipo
`VerificationChangeAction` (`VERIFIED`/`UNVERIFIED`), `WorkerDocument.uploadedAt` (nula en filas
anteriores) y las tablas `WorkerDocumentVerificationChange` y `CompanyVerificationChange`
(autor `ON DELETE SET NULL`, cascada con el trabajador o la empresa). No modifica ni borra filas
existentes.

### Borrado de titulares bajo concurrencia (BAJO-A de `CN-20261007-046`, cerrado)

`DELETE /api/admin/workers/:id` y `DELETE /api/admin/companies/:id` bloquean **primero**
la fila de `User` (`FOR UPDATE`) y luego la cuenta de moneda, las postulaciones y el
borrado, dentro de una transacción `Serializable` con reintento. Resultado: borrados
simultáneos del mismo titular dan un `204` y el resto `404` (`WORKER_NOT_FOUND` /
`COMPANY_NOT_FOUND`; el `P2025` ya no llega como `500`); un borrado simultáneo con una
acción del propio titular termina sin interbloqueo (`40P01` se reintenta) y sin `500`: si
el borrado gana, la acción responde `404 RESOURCE_NO_LONGER_EXISTS` (la FK `P2003` de un
puesto o titular ya borrado se traduce en `JobService`); si la acción gana, el borrado
sigue (`204`) o se bloquea con `409` si dejó un movimiento. No queda borrado parcial ni
libro corrupto. Límite: la traducción de `P2003` cubre las acciones de puestos fijos. En las
rutas de talento (perfil, CV, foto, destacar), una acción que llega con la cuenta ya borrada
(`P2003`/`P2025`) responde `404 RESOURCE_NO_LONGER_EXISTS` (antes `400 INVALID_TALENT_REQUEST`,
`CN-20261012-048`, BAJO-2; corregido en `CN-20261012-049`). Un guardado de perfil cuyos
reintentos `Serializable` se agotan responde `503 SERIALIZATION_RETRY_EXHAUSTED`
(ver «Reintentos de serialización agotados»); en ambos casos no queda ningún efecto aplicado.

### Reintentos de serialización agotados (`503 SERIALIZATION_RETRY_EXHAUSTED`)

Las rutas de moneda (`/api/workers/currency/*`, `/api/business/currency/*`, `/api/admin/currency/*`
y las verificaciones), de puestos fijos (`/api/business/job-*`, `/api/workers/job-*`), de talento y
de administración comparten un único mapeo (`apps/api/src/modules/operations/transaction-errors.ts`,
`CN-20261012-049`, BAJO-1 y BAJO-2): cuando `withSerializableRetry` agota sus 6 intentos (`P2034`, o
`40001`/`40P01` sin recuperar) la respuesta es **`503 SERIALIZATION_RETRY_EXHAUSTED`** con
`Retry-After: 1` y cuerpo `{error, message, retryable: true}` en lugar de un `500`. La transacción se
revirtió entera: no queda ningún efecto aplicado y repetir la misma petición es seguro (las acciones
con cobro son idempotentes por su clave). En talento, `400` queda reservado a la validación de
entrada, `404 RESOURCE_NO_LONGER_EXISTS` a la cuenta o registro ya borrado y `500 INTERNAL_ERROR` a un
fallo inesperado. Las rutas del trabajador del módulo de turnos conservan su contrato histórico
`409 CONCURRENT_UPDATE`. La prueba de estrés `currency-actions … (BAJO-1)` acepta ahora `201` o este
`503` (y comprueba que un `503` no dejó postulación y que el libro queda consistente).

### Límites conocidos de M6 (sin cambio, solo documentados)

- **Oráculo de referidos:** al registrar un correo ya existente, un `referralCode` válido responde
  `409 DUPLICATE_ACCOUNT` y uno inválido `400 INVALID_REFERRAL_CODE`; permite probar códigos. El
  espacio es de 32^8 códigos, el registro tiene límite de intentos y el código no expone datos
  personales.
- **`referralCode` no textual** (p. ej. un número) se ignora sin error y la cuenta se crea sin
  referido.
- **`HIRE_CONFIRMED` sin límite propio:** con cuentas cómplices una empresa puede acumular premios
  de contratación hasta el tope global `REWARD_CAP_MONTHLY_COMPANY`. Entra en el riesgo declarado de
  cuentas múltiples por persona.

## Superadmin: cuentas empresariales

Las rutas bajo `/api/admin` requieren una sesión `ADMIN` y permiten gestionar el alta de empresas que ya entregaron sus datos a Chambeaya:

- `GET /api/admin/overview`: métricas operativas.
- `GET /api/admin/companies`: listado con propietario y suscripción.
- `POST /api/admin/companies`: crea en una transacción la cuenta `BUSINESS` y su empresa.
- `PATCH /api/admin/companies/:id`: actualiza datos operativos (RUC, correo y contraseña no se modifican aquí).
- `DELETE /api/admin/companies/:id`: elimina la empresa y su cuenta propietaria; no permite eliminar la cuenta del administrador actual; `409 CURRENCY_LEDGER_RETAINED` si la empresa tiene movimientos de moneda virtual distintos del bono de bienvenida (el bono por sí solo no retiene: `204`); `409 CONTRACT_RECORDS_RETAINED` si alguna postulación a sus puestos tiene una oferta aceptada. Sin ellas, borra antes sus puestos, postulaciones y los PDF de ofertas.
- `GET /api/admin/workers`: listado global de cuentas `WORKER` con su contacto por empresa.
- `DELETE /api/admin/workers/:id`: elimina una cuenta `WORKER` (`404 WORKER_NOT_FOUND` si el id no existe o no corresponde a un trabajador). Borra primero en la base (transacción) y solo después elimina del almacenamiento privado el CV y la foto de perfil del trabajador, si existían (un fallo del almacenamiento tras confirmar el borrado se registra en el log y no deshace la baja: solo quedan archivos huérfanos); si el trabajador tiene movimientos de moneda virtual distintos del bono de bienvenida (el bono por sí solo no retiene: `204`) responde `409 CURRENCY_LEDGER_RETAINED` sin tocar archivos, y si tiene una oferta de puesto fijo aceptada, `409 CONTRACT_RECORDS_RETAINED`. Sus postulaciones a puestos fijos se borran explícitamente en la misma transacción (FK `RESTRICT`, M4) y sus PDF de oferta se retiran tras confirmar. El resto de filas asociadas (postulaciones a turnos, asignaciones, sesiones, identidades externas) se elimina en cascada a nivel de base de datos.

El alta exige nombre comercial, RUC de 11 dígitos, correo y contraseña inicial (mínimo 8 caracteres, con mayúscula y número). Los datos de contacto y razón social pueden completarse o editarse después desde el panel.

### Cómo se crea la propia cuenta `ADMIN`

Ninguna ruta HTTP crea una cuenta `ADMIN`: `POST /api/auth/register` responde `403 BUSINESS_REGISTRATION_DISABLED` para cualquier `role` distinto de `WORKER` (incluido `ADMIN`), y `AuthService.register`/`normalizeRegistration` (`apps/api/src/modules/auth/auth.service.ts`) rechaza explícitamente `role: "ADMIN"` con `INVALID_REGISTRATION`. El primer superadmin (y cualquiera adicional) se crea fuera de la API HTTP, con el comando `apps/api/src/cli/superadmin.ts` (compilado a `dist/src/cli/superadmin.js`), que corre dentro del contenedor `api`:

- `scripts/instalar-produccion.sh` lo invoca automáticamente al final de una instalación nueva, solo si todavía no existe ningún `ADMIN`.
- `scripts/crear-superadmin.sh --email <correo> [--reset]` lo invoca después, para un superadmin adicional o para restablecer una contraseña olvidada.

Su `identifier` (obligatorio y único en `User`, igual que el DNI del trabajador o el RUC de la empresa) tiene el formato `ADMIN-<12 caracteres hexadecimales>` — nunca coincide con un DNI (8 dígitos) ni un RUC (11 dígitos) real, porque ambos son exclusivamente numéricos. La contraseña se genera dentro del comando (nunca se acepta por argumento ni por variable de entorno) y se imprime una sola vez por stdout; no queda registrada en ningún archivo ni log. Ver la sección "Primer acceso" de [la guía de despliegue](../guides/deployment.md#primer-acceso).

### Ajuste global de comisión e IGV (`PlatformSettings`)

Chambeaya cobra una comisión por cada pago al trabajador, además de las suscripciones (que no cambian). La paga la empresa, **encima** del monto del trabajador; el trabajador siempre recibe el 100% de lo publicado.

- `GET /api/admin/settings` → `{ commissionBps, taxBps, updatedAt, updatedBy: {id, name} | null }`.
- `PATCH /api/admin/settings` con `{ "commissionBps": <entero> }`: entero entre 0 y 5000 (0,00% a 50,00%), validado con Zod (`400 INVALID_INPUT` fuera de rango). `taxBps` es de **solo lectura** en este alcance: ningún endpoint lo modifica.

Ambos requieren sesión `ADMIN` (`403 ADMIN_ACCOUNT_REQUIRED` en cualquier otro rol). Cada `PATCH` exitoso escribe una fila de auditoría inmutable en `PlatformSettingChange` (`field`, `oldValue`, `newValue`, `changedById`, `createdAt`), incluso si el valor nuevo es igual al anterior: el admin confirmó la acción explícitamente. La transacción bloquea la fila `global` (`SELECT … FOR UPDATE`) antes de leer `oldValue`, así que varios `PATCH` simultáneos dejan una cadena `oldValue → newValue` coherente. Si se borra el usuario que hizo el cambio, la fila de auditoría se conserva con `changedById` en `null` (`onDelete: SetNull`).

`PlatformSettings` es una fila única (`id: 'global'`), con valores iniciales `commissionBps: 1000` (10,00%) y `taxBps: 1800` (18,00%, el IGV sobre la comisión). **Cambiar este ajuste nunca altera un turno ya publicado**: la comisión y el IGV vigentes se copian a `Shift.commissionBps`/`taxBps` al publicarlo (`POST /api/business/shifts`) y quedan fijos ahí para siempre, incluida cualquier edición posterior del turno (`PATCH /api/business/shifts/:id` nunca los recalcula). Los dos puntos donde nace un `Payment` automático (el check-out del trabajador y el cierre manual de una asignación `NO_SHOW`/`ABANDONED`, ver "Pagos y movimientos" más abajo) copian esos valores del turno, no el ajuste global vigente en ese momento.

### `GET /api/admin/commissions` (Alcance D: cuánto facturar a cada empresa)

Sesión `ADMIN`. Query opcional `from`/`to`, **estrictamente `"AAAA-MM-DD"`** (`400 INVALID_INPUT` para cualquier otro formato, incluida una hora completa: la fecha con hora se prestaba a ambigüedad y se retiró en la corrección de `CN-20260926-020`). Sin ninguno de los dos, cubre todo el historial. `400 INVALID_INPUT` si `from` es posterior a `to`.

**La fecha debe existir en el calendario** (corrección de BAJO-1 de `CN-20260926-022`): el formato `"AAAA-MM-DD"` por sí solo no bastaba — `"2026-02-30"` pasaba el regex y `Date` la corría en silencio al 2 de marzo (200 con el día equivocado), y `"2026-13-01"` llegaba como `Invalid Date` hasta Prisma (`500`, no `400`). `isRealCalendarDate` (`admin.routes.ts`) reconstruye la fecha en UTC a partir de año/mes/día y compara los tres componentes contra lo recibido; cualquier desborde de mes o de día (incluidos los años bisiestos: `"2024-02-29"` se acepta, `"2026-02-29"` no) responde `400 INVALID_INPUT` con `"INVALID_CALENDAR_DATE"` en `issues`.

**`from`/`to` son fechas de calendario de Lima, nunca un instante UTC** (corrección de ALTO-1 de `CN-20260926-020`: la versión anterior interpretaba `"AAAA-MM-DD"` como medianoche UTC —05:00 de Lima— y usaba `to` como límite inclusivo (`lte`) de ese instante, así que un reporte mensual perdía todo lo ocurrido entre las 19:00 del penúltimo día y las 19:00 del último día hora Lima: comisión real que nunca se facturaba). Ahora:

- `from` cubre desde las 00:00 de Lima de ese día (inclusivo).
- `to` cubre el día completo: internamente se convierte a un límite **exclusivo** en las 00:00 de Lima del día siguiente (nunca `lte`, que redondearía hacia abajo).
- Perú no observa horario de verano (`-05:00` todo el año), así que la conversión es una función pura y determinista (`limaDayStartUtc`/`limaNextDayStartUtc` en `admin.routes.ts`), nunca "restar 5 horas" repetido en varios sitios.

Responde:

```json
{
  "period": { "from": "2026-09-01", "to": null, "fromUtc": "2026-09-01T05:00:00.000Z", "toUtcExclusive": null },
  "totals": { "toInvoiceCents": 0, "toInvoiceTaxCents": 0, "collectedCents": 0, "pendingCollectionCents": 0, "payments": 0, "pendingResolution": 0 },
  "companies": [
    { "companyId": "…", "name": "…", "ruc": "…", "toInvoiceCents": 0, "toInvoiceTaxCents": 0, "collectedCents": 0, "pendingCollectionCents": 0, "payments": 0, "closedWithoutPayment": 0, "pendingResolution": 0 }
  ]
}
```

`period` devuelve tanto las fechas de Lima recibidas (`from`/`to`, o `null` si no se pasaron) como los instantes UTC efectivos de la consulta (`fromUtc`, y `toUtcExclusive`: el límite es **exclusivo**, nombrado así a propósito para que no haya ambigüedad sobre si incluye o no ese instante).

**Filtra por `Payment.createdAt`, nunca por `processedAt`**: en modo manual la comisión "por facturar" existe desde que se completa la asignación, esté o no marcada como pagada; filtrar por `processedAt` (`null` mientras siga `PENDING`) excluiría del período justo los pagos que todavía no se marcaron, que son los que más importa facturar.

Reglas por bucket (los pagos `'legacy'` nunca aportan a ninguno: nacieron con comisión e IGV en 0):

- **`toInvoiceCents`/`toInvoiceTaxCents` ("por facturar"):** suma de `commissionCents`/`taxCents` de todo pago `provider: 'manual'` que no esté `CANCELLED`, pagado o no. Es el modo vigente en producción (sin proveedor contratado): Chambeaya no cobra nada por la app, así que todo lo que corresponde facturar queda aquí.
- **`collectedCents` ("cobrada"):** suma de `commissionCents + taxCents` de pagos con un proveedor de pasarela (Alcance E; cualquier `provider` que no sea `'manual'` ni `'legacy'`) que ya estén `PROCESSED`. Hoy siempre `0`: no existe ningún proveedor contratado.
- **`pendingCollectionCents` ("por cobrar"):** lo mismo que arriba, para pagos de pasarela `PENDING`/`SCHEDULED`. Hoy siempre `0`.
- **`payments`:** cantidad de pagos que aportaron a cualquiera de los tres buckets anteriores.
- **`closedWithoutPayment`:** asignaciones que esa empresa cerró sin pagar dentro del período — ver "Asignaciones cerradas sin pago" más abajo. Sirve para detectar evasión de la comisión: una empresa que cierra trabajo hecho como "sin pago" en vez de completarlo nunca genera el `Payment` sobre el que se calcula la comisión. Filtra por `ShiftAssignment.closedWithoutPaymentAt`, nunca por ningún texto.
- **`pendingResolution`:** asignaciones `NO_SHOW`/`ABANDONED` que esa empresa todavía no resolvió (ni `resolveAssignment` ni `cancelShift`), **sin filtrar por período**: es un estado actual, no un evento con fecha. Corrección de MEDIO-1 de `CN-20260926-020`: antes, dejar sin resolver una asignación la sacaba por completo del reporte (ni sumaba a `closedWithoutPayment` ni a ningún otro bucket); ahora queda visible mientras siga pendiente, para que no resolverla no sea una forma de esconderla.
  - **No depende de que el estado ya esté persistido** (corrección de MEDIO-1 nuevo de `CN-20260926-022`): `NO_SHOW`/`ABANDONED` son perezosos (`resolveAssignmentLifecycle` los calcula la próxima vez que algo toca esa asignación puntual — check-in, check-out, o abrir el turno en el panel —, nunca un job de fondo), así que una asignación cuya ventana de check-in ya venció pero que nadie volvió a tocar sigue `ASSIGNED` en la base. Este reporte nunca escribe (es una ruta de solo lectura); en vez de persistir el ciclo de vida antes de contar, aplica la misma función pura `resolveAssignmentLifecycle` -sin guardar nada- sobre las `ASSIGNED` candidatas, junto con las `NO_SHOW`/`ABANDONED` ya persistidas. Prefiltro de rendimiento: solo trae `ASSIGNED` cuyo turno empezó hace más de `CHECK_IN_LATE_LIMIT_MS` (60 min), porque ninguna puede calificar antes de eso.

`companies` incluye toda empresa con alguna actividad en el período (al menos un pago) **o** con `closedWithoutPayment`/`pendingResolution` mayor que cero (estos dos, sin filtro de período para `pendingResolution`); `totals` es la suma de esos mismos campos sobre todas las filas de `companies`.

## Empresa

- `GET /api/business/company`: obtiene el perfil. Si la cuenta es anterior a esta implementación, crea el perfil empresarial automáticamente con el nombre y RUC registrados.
- `PATCH /api/business/company`: actualiza nombre comercial, razón social, industria, teléfono, dirección o distrito.
- `GET /api/business/subscription`: si la empresa ya activó explícitamente un plan, devuelve la fila real de `CompanySubscription`. Si nunca activó nada, **no crea ninguna fila de `CompanySubscription`** -antes hacía un `upsert` que dejaba una fila `TRIAL` real persistida desde la primera consulta, aunque nadie hubiera activado algo- y en su lugar devuelve un objeto sintético en memoria (`{ companyId, plan: 'PILOT', status: 'INACTIVE', startsAt: null, endsAt: null, trialEndsAt: null }`, sin `id`, `createdAt` ni `updatedAt`) que declara explícitamente que no hay plan activo. Hoy no existe ningún endpoint de activación; cuando exista, será el único punto que persista una fila real.
  - `INACTIVE` **no es un valor del enum `SubscriptionStatus` de Prisma** (que solo admite `TRIAL`/`ACTIVE`/`PAUSED`/`EXPIRED`/`CANCELLED`): existe únicamente en la respuesta sintética y nunca puede persistirse. Un cliente que mapee `status` debe tratarlo como un sexto caso; el panel de empresa (`apps/web`) lo muestra como "Sin plan activo" en la insignia de Membresías, "Sin plan activado" en el titular de esa sección y en la barra lateral, y no marca ninguna tarjeta como "Actual"; mientras no haya respuesta de la API la barra lateral dice "Plan sin confirmar" en vez de afirmar un plan. Los botones "Quiero conocerlo" avisan que los planes todavía no se activan desde el panel.
  - Como todos los endpoints de empresa, este `GET` sigue resolviendo la `Company` de la sesión con un `upsert` (`business.service.ts#companyFor`), así que puede crear la fila `Company` si la cuenta es anterior a esa implementación. Lo que dejó de crear es la suscripción.
  - **Filas fantasma previas al cambio (limitación conocida, sin limpieza).** Cualquier base donde corrió la versión anterior conserva las filas `PILOT/TRIAL` que ese `upsert` creó sin activación explícita. No se borran solas, y **tampoco existe un criterio seguro para borrarlas con un script**: el `upsert` antiguo escribía exactamente lo mismo que `demo.seed.ts` (`plan: PILOT`, `status: TRIAL`, `trialEndsAt` = ahora + 30 días, `endsAt` nulo) y que una fila creada a mano con los valores por defecto del esquema; en las tres, `startsAt` y `createdAt` coinciden y `updatedAt` es igual a `createdAt`, y no hay ninguna columna que registre quién ni por qué se creó la fila (verificado en una transacción con rollback sobre `chambeaya_test`, ver `CN-20260918-009`). Como la activación de un plan es manual (`docs/product/memberships.md`), una fila real hecha a mano es indistinguible de una fantasma, y borrarla por suposición quitaría un plan que alguien sí activó. Por eso esas empresas seguirán viendo "Piloto activo" y una fecha de fin de prueba hasta que un operador las revise. Punto de partida para esa revisión manual, de solo lectura (una fila que cumple esto es *candidata*, no fantasma confirmada): `SELECT c."name", s."companyId", s."createdAt", s."trialEndsAt" FROM "CompanySubscription" s JOIN "Company" c ON c."id" = s."companyId" WHERE s."plan" = 'PILOT' AND s."status" = 'TRIAL' AND s."endsAt" IS NULL AND s."updatedAt" = s."createdAt" ORDER BY s."createdAt";`. Decidir empresa por empresa; ninguna migración ni script del repositorio borra estas filas.
- `GET /api/business/payment-settings` → `{ commissionBps, taxBps, currency: 'PEN', mode }`: el ajuste global vigente que se congelaría en un turno nuevo (`GET /api/admin/settings` sin el detalle de auditoría). El panel lo usa para la vista previa en vivo del formulario de publicación. Desde el Alcance E, `mode` es el nombre del proveedor de pago **activo** (`PAYMENT_PROVIDER`, ver [Despliegue con Docker](../guides/deployment.md)): `'manual'` en producción hoy (sin proveedor contratado), o `'simulated'` en desarrollo/QA.

## Turnos

**Pausa de turnos temporales (M0, `CN-20261001-032`).** Los turnos temporales
quedan inactivos por defecto. Mientras la API no reciba
`TEMPORARY_SHIFTS_ENABLED=true` (valor literal), `POST /api/business/shifts` y
`POST /api/shifts/:id/applications` responden `503 { "error":
"TEMPORARY_SHIFTS_DISABLED" }` antes de validar el cuerpo o tocar datos. El
resto de rutas de turnos (consultar, editar, cancelar, aceptar postulaciones,
confirmar, check-in/check-out, resolver) sigue operando para cerrar lo ya
publicado; no se borra código ni datos. El panel web oculta "Publicar turno" y
"Nuevo turno" salvo `NEXT_PUBLIC_TEMPORARY_SHIFTS_ENABLED=true` (se fija al
compilar el panel), y Flutter oculta "Postular" salvo
`--dart-define=TEMPORARY_SHIFTS_ENABLED=true`. Las suites de API y Playwright
activan la bandera para conservar su cobertura.

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
  "expectedCommissionBps": 1000,
  "expectedTaxBps": 1800,
  "screeningQuestions": [
    "¿Tienes disponibilidad durante todo el horario indicado?"
  ],
  "notes": "Ingreso por puerta de personal"
}
```

`expectedCommissionBps` y `expectedTaxBps` son obligatorios y deben copiarse de `GET /api/business/payment-settings` justo antes de publicar. Los valores del ejemplo son los iniciales (10% y 18%).

Estados: `PUBLISHED`, `ASSIGNED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`. No existe ninguna transición automática por tiempo: un turno cuyo `endsAt` ya pasó conserva su último estado persistido (típicamente `PUBLISHED` o `ASSIGNED`) hasta que la empresa lo cancele; la fecha, no el estado, es lo que determina si sigue operativo.

El estado y `confirmedWorkers` son derivados por el servidor. No se aceptan en los formularios de creación o edición. Un turno con actividad no se puede borrar y, una vez iniciado el check-in, tampoco se puede editar ni cancelar destruyendo su historial.

Cada turno expone `commissionBps`/`taxBps`: la comisión de Chambeaya y el IGV sobre esa comisión, en puntos básicos enteros (1000 = 10,00%), copiados del ajuste global vigente (`PlatformSettings`) al publicarlo. Tampoco se aceptan en el formulario ni cambian con `PATCH`: quedan fijos para siempre, incluso si el admin cambia el ajuste global después o si la empresa edita el turno (incluido su `payCents`). Ambos son obligatorios (`NOT NULL`): la migración `20260926180000_payment_commission` dejó en `0`/`0` (sin comisión) los turnos publicados antes de que existiera la comisión, por decisión del usuario.

`POST /api/business/shifts` exige además `expectedCommissionBps` y `expectedTaxBps` (obligatorios desde `CN-20260926-015`, enteros 0-5000; si falta alguno responde `400 INVALID_INPUT`; `PATCH` no los admite): los bps que el formulario mostró en la vista previa. Si no coinciden con el ajuste vigente, responde `409 { "error": "COMMISSION_CHANGED", "commissionBps": <vigente>, "taxBps": <vigente> }` sin crear el turno. El valor comparado es el mismo que se fija en el turno, así que un turno creado nunca queda con bps distintos de los que se validaron. El panel los toma de `GET /api/business/payment-settings` y, ante el `409`, refresca la vista previa y pide confirmar de nuevo. Si esa lectura falla, el formulario de publicación no muestra ningún porcentaje y deshabilita la publicación hasta que "Reintentar" la recupere; el resto del panel sigue funcionando. `payCents` admite como máximo `10000000` (S/ 100 000); por encima responde `400 INVALID_INPUT`.

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

- `GET /api/business/shifts/:id/applications`: postulaciones del turno, con el mismo `nextAction` que ve el trabajador. Cada postulación aceptada incluye su `assignment` completo (`id`, `status` -también `NO_SHOW`/`ABANDONED`-, `workerConfirmedAt`, `checkedInAt`, `checkedOutAt`); el panel web usa `assignment.status` y `assignment.id` para ofrecer el cierre manual (ver "Interfaz del panel web para `resolve`" más abajo). `worker` trae `{ id, name, email, identifier, hasCv }` y nada más: `hasCv` es un booleano que ya aplica toda la regla de acceso al CV (ver "CV de un postulante" abajo), no el archivo ni su nombre ni su tamaño. La visibilidad del perfil y las filas de documento se leen para calcularlo, pero nunca salen en la respuesta.
- `GET /api/business/applications/pending`: total y turnos con postulaciones `PENDING` de la empresa.
- `PATCH /api/business/shifts/:id/applications/:applicationId`: decide una postulación `PENDING`. Cuerpo `{ "decision": "ACCEPTED" | "REJECTED", "reason"?: "…" }` (`reason` obligatorio si `decision` es `REJECTED`, opcional en `ACCEPTED`).

Aceptar crea la asignación (`ShiftAssignment`) dentro de una transacción `Serializable` con reintento automático ante conflicto de serialización: si dos aceptaciones para el último cupo disponible llegan a la vez, la base de datos garantiza que solo una lea y reserve ese cupo; la otra recibe `400 SHIFT_FULL` en la misma respuesta, sin sobrecupo ni asignación duplicada. `400 SHIFT_NOT_ASSIGNABLE` rechaza decidir sobre un turno terminal, con check-in en curso o cuyo `endsAt` ya pasó (un turno vencido no puede ganar una nueva asignación aunque la postulación sea anterior a su vencimiento). `400 APPLICATION_ALREADY_DECIDED` cubre una segunda decisión sobre la misma postulación.

Cada asignación recibe su propia credencial de check-in aleatoria (`checkInCredential`), generada con `crypto.randomBytes` y sin relación con `shiftId`, `workerId` ni ningún otro dato del turno. Antes, la credencial se derivaba solo de `shiftId`, así que un turno con `requiredWorkers > 1` dejaba a todas sus asignaciones compartiendo literalmente la misma credencial; cada trabajador de un turno multi-cupo recibe ahora una credencial distinta e impredecible a partir de la del resto.

`checkInCredential` **no es hoy una prueba de presencia**: el propio trabajador la recibe del servidor en `GET /api/workers/applications` (`assignment.checkInCredential`) y en `GET /api/workers/active-shift`, y `POST /api/shifts/:id/check-in` resuelve la asignación por el `workerId` de la sesión, no por la credencial. Sirve para que el trabajador y la persona de la sede comparen un mismo código en el momento del ingreso, y para que ese código no se repita entre cupos del mismo turno. No tiene expiración ni rotación, y el endpoint de check-in no aplica límite de intentos; endurecerla (expiración, rotación, prueba real de presencia) sigue pendiente en el bloque "Endurecer asistencia" de `docs/product/project-master-plan.md`.

### CV de un postulante (lectura de la empresa)

- `GET /api/business/shifts/:id/applications/:applicationId/cv` (sesión `BUSINESS`): devuelve el PDF que subió el trabajador con `PUT /api/workers/me/cv`. Solo lectura, un archivo por petición y siempre con la cabecera `Authorization: Bearer`; no existe ninguna URL pública ni firmada del CV.

Regla de acceso (una sola implementación, `apps/api/src/modules/talent/cv_access.ts`, compartida por esta descarga y por `hasCv` de la lista de postulantes, de modo que nunca discrepan). La empresa ve el CV solo si se cumplen **las dos** condiciones:

1. El trabajador tiene una postulación **vigente** (`PENDING` o `ACCEPTED`) a un turno **de esa empresa** (`shift.company.ownerId` = usuario de la sesión). `REJECTED`, `WITHDRAWN` y `CANCELLED` retiran el acceso.
2. Su `WorkerTalentProfile` existe y tiene `isVisible: true`. Un perfil oculto o inexistente nunca expone el CV, aunque exista la postulación.

La regla se evalúa en cada petición: ocultar el perfil o rechazar la postulación retira el acceso de inmediato, sin trabajo diferido. El CV **no** se expone en el directorio (`GET /api/business/talent`) ni en ninguna otra respuesta; solo `GET /api/workers/me/cv/download` (el propio trabajador) y esta ruta entregan bytes.

Respuestas:

- `200`: `Content-Type: application/pdf` fijo (no el `mediaType` guardado), `Content-Disposition: inline; filename*=UTF-8''…` con el nombre —que controla el trabajador— codificado también en `'`, `(`, `)` y `*`, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`.
- `401` sin sesión o con token inválido; `403 BUSINESS_ACCOUNT_REQUIRED` para cualquier sesión `WORKER`, incluido el dueño del CV (esa ruta es `GET /api/workers/me/cv/download`).
- `404 APPLICATION_NOT_FOUND`: la postulación no existe, no pertenece a un turno de esta empresa o se consulta bajo otro `:id` de turno. Misma respuesta en los tres casos, para no permitir enumeración.
- `404 CV_NOT_AVAILABLE`: la postulación sí es de esta empresa pero el archivo no se entrega (no hay CV, el perfil está oculto o no existe, la postulación ya no está vigente, o el archivo falta en el almacenamiento privado). La respuesta es deliberadamente uniforme para no revelar que un perfil oculto tiene CV.

Límites vigentes: no hay bitácora de accesos (no se registra quién abrió qué CV ni cuándo), no hay límite de tasa en esta ruta, no hay caducidad del acceso mientras la postulación siga vigente, y el PDF solo se valida por la firma `%PDF-` en la carga (sin antimalware ni comprobación de estructura). El consentimiento es grueso: `isVisible` gobierna a la vez el directorio y el CV; no existe una bandera propia del CV.

### Ciclo de vida de una asignación: `NO_SHOW` y `ABANDONED`

`ShiftAssignment.status` admite dos valores adicionales a `ASSIGNED`/`CANCELLED`/`COMPLETED`, calculados por el servidor (nunca enviados por el cliente):

- `NO_SHOW`: la asignación seguía `ASSIGNED` y nunca llegó a tener `checkedInAt`, y ya pasó la ventana de check-in (ver abajo).
- `ABANDONED`: la asignación sí tiene `checkedInAt` pero nunca `checkedOutAt`, y ya pasaron 60 minutos desde `endsAt`.

Ninguna de las dos transiciones ocurre en segundo plano ni por un job programado: se calculan y persisten "al tocar" esa asignación puntual (`check-in`, `check-out`, o cuando la empresa abre ese turno o su lista de postulaciones en el panel). Los endpoints de listado masivo (`GET /api/shifts`, `GET /api/business/shifts`, `GET /api/workers/applications`, el feed SSE) nunca disparan esta resolución, para no agregar una escritura en cada refresco; pueden mostrar por un momento una asignación `ASSIGNED` cuya ventana ya cerró, hasta que algo la toque puntualmente.

Ambos estados quedan excluidos del cálculo agregado de `Shift.status` (igual que `CANCELLED`), de modo que el cupo vuelve a quedar libre sin que la empresa tenga que cancelar el turno completo. Lo que el turno hace con ese cupo liberado depende de si `endsAt` ya pasó y de si quedan otras asignaciones vivas; está descrito más abajo, en "Estado agregado del turno cuando un cupo queda liberado".

Ninguna de las dos (`NO_SHOW` o `ABANDONED`) **se completa ni se cancela automáticamente** (evita generar, o destruir, un pago sin decisión humana): la empresa debe resolverla explícitamente:

- `POST /api/business/shifts/:id/assignments/:assignmentId/resolve`: cuerpo `{ "outcome": "COMPLETED" | "CANCELLED", "reason"?: "…" }`. Solo la empresa dueña del turno puede llamarlo (sesión `BUSINESS` y turno de su propia `Company`; en cualquier otro caso responde `404 SHIFT_NOT_FOUND`). Responde `404 ASSIGNMENT_NOT_FOUND` si la asignación no existe en ese turno, y `400 ASSIGNMENT_NOT_RESOLVABLE` si no está en `ABANDONED` ni en `NO_SHOW` (por ejemplo, ya se resolvió antes, o sigue `ASSIGNED`). `COMPLETED` marca la asignación como completada y genera su `Payment` con la misma forma que genera `check-out` (reporte manual, `status: PENDING`); `CANCELLED` la cierra sin generar ningún pago. Cualquiera de los dos recalcula el estado agregado del turno, siempre a partir del turno ya puesto al día por el ciclo de vida (no de la lectura previa) y con la regla de reapertura descrita en "Estado agregado del turno cuando un cupo queda liberado".
- Un trabajador `NO_SHOW` (llegó más de 60 minutos tarde y ya no pudo hacer check-in) **sí** tiene una ruta para cobrar si igual trabajó el turno: la empresa lo resuelve con `outcome: "COMPLETED"` y `reason` explicando por qué (por ejemplo, un problema con la app o la señal). Es una decisión humana explícita, no un cálculo automático: el sistema nunca decide por sí solo si un `NO_SHOW` cobra.
- Cada transición automática a `NO_SHOW`/`ABANDONED` deja un `ShiftEvent` (`type: CANCELLED`, `actorRole: SYSTEM`) con el detalle de cuál de los dos ocurrió, además del evento que crea `resolve` (`COMPLETED`/`CANCELLED`, actor `BUSINESS`) al cerrarla manualmente.
- **Concurrencia entre `resolve` y `cancel` (`CN-20260920-004`, BAJO-1 y BAJO-2).** `POST /api/business/shifts/:id/cancel` y `resolve` corren en una transacción `Serializable` con reintento automático ante conflicto de serialización (`P2034`, hasta 6 intentos con espera aleatoria entre ellos; ver "Contención entre operaciones de empresa"), y las dos **leen dentro de cada intento** lo que deciden: `cancel` relee el estado del turno y si hay algún check-in (`400 SHIFT_NOT_CANCELLABLE`), y `resolve` relee la asignación y el turno (`current`) antes de escribir. Si las dos llegan a la vez sobre la misma asignación `NO_SHOW`, el resultado es el de una ejecución en serie: o gana la cancelación (asignación y turno `CANCELLED`, sin pago; `resolve` responde `400 ASSIGNMENT_NOT_RESOLVABLE`) o gana la resolución con `COMPLETED` (asignación y turno `COMPLETED`, un pago; `cancel` responde `400 SHIFT_NOT_CANCELLABLE`). Nunca responden `200` las dos ni queda un pago sobre un turno `CANCELLED`. Fijado contra PostgreSQL real por `apps/api/tests/integration/shift-cancel-resolve-race.integration.test.ts` (12 rondas simultáneas) y con Prisma simulado en `business.service.test.ts`. La carrera real es probabilística y casi siempre la gana la cancelación (en la auditoría `CN-20260923-009`, 23 de 24 rondas): fija sobre todo la relectura de `resolve` (contra el código anterior falla en la primera ronda); el aislamiento `Serializable` de `cancel` lo fija la prueba unitaria que comprueba `isolationLevel`, no la carrera (quitarlo sobrevivió a 4 corridas de la suite real). Si los 6 intentos chocan, el error `P2034` no se traduce y la API responde `500` (comportamiento común a todas las rutas de empresa con `withSerializableRetry`). La semántica de `CN-20260922-013` no cambia: `cancel` sigue cancelando también las asignaciones `NO_SHOW`. **Alcance real de esta garantía antes de `CN-20260923-016`** (comprobado en la auditoría `CN-20260923-017`): la prueba de 12 rondas parte de un `NO_SHOW` ya persistido. Si la asignación seguía `ASSIGNED` con la ventana ya cerrada (el `NO_SHOW` aún sin persistir, porque nadie había abierto el turno) y `resolve` era el primer toque, su paso previo de ciclo de vida (`resolveShiftAssignmentsLifecycle`) escribía `NO_SHOW` y el estado del turno calculados con una lectura hecha antes de una `cancel` concurrente ya confirmada: con una barrera determinista contra `0eda3b1`, `cancel` y `resolve` respondían `200` las dos, quedaba un pago y el turno terminaba `COMPLETED` con su `ShiftCancellation` registrada. Desde `CN-20260923-016` el ciclo de vida relee dentro de su transacción (ver "Ciclo de vida de la empresa" más abajo) y la misma barrera da `cancel=200`, `resolve=400 ASSIGNMENT_NOT_RESOLVABLE`, sin pago y todo `CANCELLED`. Ese caso tiene prueba permanente desde `CN-20260923-018` (`business-lifecycle-revalidation.integration.test.ts`, `cancelShift` dentro de la barrera con `resolve` como primer toque de una asignación vencida `ASSIGNED`; contra `business.service.ts` de `0eda3b1` falla en su primera aserción, `resolve` `200` en vez de `400`; el estado que dejaría es el descrito arriba: un pago y el turno `COMPLETED`; reproducido en la auditoría `CN-20260923-019`). Para buscar datos afectados en una base que haya corrido código anterior: turnos con una fila en `ShiftCancellation` de actor `BUSINESS` cuyo estado no sea `CANCELLED`, o con asignaciones `NO_SHOW`/`COMPLETED`/pagos posteriores a esa cancelación.

### Estado agregado del turno cuando un cupo queda liberado

Un turno que se quedaría **sin ninguna asignación viva** (ninguna `ASSIGNED`, ninguna con `checkedInAt` y ninguna `COMPLETED`) porque todas terminaron `CANCELLED`/`NO_SHOW`/`ABANDONED` se comporta así:

- Si `endsAt` **todavía no pasó**: el turno vuelve a `PUBLISHED` y el cupo puede cubrirse con una nueva asignación por el flujo normal de postulación/aceptación. Es el caso típico de un `NO_SHOW`, que se detecta 60 minutos después de `startsAt`. Límite comprobado en la auditoría `CN-20260923-001`: la ventana de check-in se mide desde `startsAt`, que para entonces ya cerró, así que un reemplazo aceptado en ese momento no puede hacer check-in (su asignación pasa a `NO_SHOW` la próxima vez que se toca) y solo cobra si la empresa lo confirma con `resolve`.
- Si `endsAt` **ya pasó**: el turno **no reabre a `PUBLISHED`**; se cierra como `CANCELLED` en el mismo movimiento, para no quedar "fantasma" (visible como activo pero inalcanzable desde `cancelShift`/`deleteShift`/`updateShift`, y sin que nadie pueda postular ni hacer check-in sobre un `endsAt` vencido). Es siempre el caso de un `ABANDONED`, que solo se detecta 60 minutos después de `endsAt`. Cerrar el turno no bloquea resolver la asignación: `resolve` no depende del estado del turno, así que la empresa igual puede decidir si paga, y hacerlo con `outcome: "COMPLETED"` genera igualmente el `Payment` pendiente. **Qué hace `resolve` con el estado del turno (BAJO-5 de `CN-20260918-004`, corregido en `CN-20260920-003` y ajustado en `CN-20260920-005`).** `resolveAssignment` recalcula el estado con el turno que devuelve el ciclo de vida (el que ya pudo cerrarse como `CANCELLED` en esa misma llamada o en una lectura previa), nunca con una lectura anterior a él, así que el resultado ya no depende de si la empresa abrió antes las postulaciones. La regla:
  - **Regla vigente desde `CN-20260922-013`** (antes exigía que **todos** los cupos quedaran `COMPLETED`; ver la nota histórica al final de esta lista). Sobre un turno `CANCELLED` **cerrado por el propio vencimiento** ("sin asignaciones viables"), al resolver un cupo -con cualquiera de los dos `outcome`, no solo `COMPLETED`: el cupo que faltaba puede ser justo el que se cierra sin pago mientras otro ya había completado antes- el turno **pasa a `COMPLETED`** en cuanto, tras esa resolución, ya no queda **ninguna** asignación pendiente de decisión (ninguna `ASSIGNED` activa, ninguna `NO_SHOW`/`ABANDONED` sin resolver) **y al menos una** terminó `COMPLETED`. Los demás cupos pueden haber terminado `CANCELLED` (sin pago): eso ya no bloquea la reapertura, refleja que el turno se prestó parcialmente. **Si todavía queda algún cupo sin resolver** (el recálculo daría `CHECKED_IN`), el turno **se mantiene `CANCELLED`**: reabrirlo a `CHECKED_IN` lo dejaría inalcanzable (`cancelShift`, `updateShift` y `deleteShift` lo rechazan y ningún endpoint lo mueve), el "turno fantasma" que ya se cerró en `CN-20260918-002`. **Si ningún cupo llegó a completar** (todos terminaron `CANCELLED`), el turno sigue `CANCELLED`. La asignación que esta llamada resuelve siempre queda en el `outcome` pedido y, si es `COMPLETED`, genera su `Payment` pendiente, independientemente de si el turno se reabre. Reabrir deja un `ShiftEvent` `UPDATED` (actor `BUSINESS`) con la transición `CANCELLED → COMPLETED`, cuyo detalle nombra lo que hizo la llamada: "al confirmar la empresa el trabajo de la asignación X" si el `outcome` fue `COMPLETED`, o "al cerrar la empresa sin pago la asignación X, sin quedar ninguna asignación pendiente de decisión y con otro cupo ya completado" si fue `CANCELLED` (`CN-20260923-002`), además del evento `COMPLETED`/`CANCELLED` que ya crea `resolve` para esa asignación puntual.
  - **No se reabre** un turno que la empresa canceló con `cancelShift` (deja un `ShiftCancellation` a nivel de turno, con `assignmentId` nulo y `actorRole: BUSINESS`), ni un turno `CANCELLED` cuyo `endsAt` aún no pasó (un cierre por vencimiento exige `endsAt` vencido), ni uno donde ningún cupo llegó a completar. En esos casos la asignación resuelta queda en su `outcome` y el `Payment` correspondiente (si aplica) queda registrado, pero el turno sigue `CANCELLED`.
  - **Cómo se distingue "cancelado por la empresa".** Por la **existencia** de un `ShiftCancellation` con `actorRole: BUSINESS` sobre ese turno, no por un dato explícito de "cierre por vencimiento" (no existe en el esquema). Solo `cancelShift` escribe ese rol (siempre con el turno completo y sin `assignmentId`); la cancelación de un trabajador (`POST /api/shifts/:id/cancel`, `marketplace.cancelAssignment`) escribe `actorRole: WORKER` y **no cuenta**, incluso cuando su `assignmentId` es nulo (postulación todavía `PENDING`, sin asignación creada) o queda nulo por el `onDelete: SetNull` de `ShiftCancellation.assignmentId` si su `ShiftAssignment` se borra. Ninguna otra ruta de código pone hoy un turno en `CANCELLED` (fuera del cierre por vencimiento de `deriveShiftStatus`), así que el criterio no reabre un turno que la empresa canceló. Límite conocido: una fila `CANCELLED` con `endsAt` vencido sembrada a mano, o anterior a la tabla `ShiftCancellation`, y sin esa fila se trataría como cierre por vencimiento. Si algún día la empresa pudiera cancelar una sola asignación con `actorRole: BUSINESS`, el criterio debe revisarse. Ver `CN-20260920-004` (MEDIO-1, que corrigió el filtro anterior por `assignmentId` nulo) y `CN-20260920-005`.
  - Como el panel solo ve `status: "CANCELLED"` (la API no expone quién lo canceló), no puede anticipar cuál de los casos aplica (cierre por vencimiento que se reabre, cancelado por la empresa, o multi-cupo con un cupo todavía sin resolver); su aviso no promete el resultado y explica todos. Un cliente no debe prometer que cobrar reabre siempre el turno.
  - **Nota histórica (comportamiento previo a `CN-20260922-013`).** Antes, la reapertura exigía `outcome: "COMPLETED"` de la llamada en curso y que **todos** los cupos quedaran `COMPLETED` (`requiredWorkers` asignaciones efectivas y todas `COMPLETED`); con algún cupo `CANCELLED`/`NO_SHOW`/`ABANDONED` -resuelto o no- el turno se mantenía `CANCELLED` para siempre, con su pago pendiente registrado pero sin reflejar que otro cupo sí se había trabajado. Era el "límite conocido en turnos multi-cupo" documentado en esta sección hasta esa corrección; ver `CN-20260918-004`, `CN-20260920-004/005/006` para el contexto histórico completo.
  Esta regla está cubierta por pruebas de servicio con Prisma simulado (incluida la reapertura con `outcome: "CANCELLED"` sobre el último cupo pendiente cuando otro ya había completado antes) y por la suite Playwright rápida con API simulada. Contra API y PostgreSQL reales (`apps/web/e2e-real/assignment-resolution.spec.ts`, `npm run test:web:admin-real`), solo el caso de **un solo cupo** está cubierto (confirmar el trabajo tras un `NO_SHOW` deja el turno `COMPLETED`; cerrar sin pago lo deja `CANCELLED`); el caso multi-cupo con completado parcial descrito arriba no se ejecutó contra base real en `CN-20260922-013`, pero la auditoría `CN-20260923-001` lo ejecutó con una sonda de integración desechable (API Express real + PostgreSQL real, base `chambeaya_test`, no incorporada al repositorio): un cupo `COMPLETED` por check-out y el otro `NO_SHOW` o `ABANDONED` resuelto `CANCELLED` deja el turno `COMPLETED`; un turno de dos cupos cerrado por vencimiento, con un cupo confirmado `COMPLETED` y el último resuelto `CANCELLED`, reabre a `COMPLETED` con su `ShiftEvent` `UPDATED`; y `cancelShift` deja `CANCELLED` las asignaciones `NO_SHOW` (luego `resolve` responde `400 ASSIGNMENT_NOT_RESOLVABLE` y no se crea `Payment`). La misma sonda falla contra el código anterior a esa corrección. Siguen sin prueba permanente contra base real: la suite `apps/api/tests/integration` y `apps/web/e2e-real` no incluyen un escenario multi-cupo.

**Turnos multi-cupo parcialmente cubiertos.** Desde `CN-20260922-013`, `Shift.status` puede llegar a `COMPLETED` con solo **algunos** de sus cupos efectivamente trabajados (los demás terminaron `CANCELLED`): el criterio es "ya no queda ninguna asignación pendiente de decisión, y al menos una completó", no "todas completaron". La API no agrega un campo nuevo para distinguir completado total de parcial: se reconstruye contando las asignaciones `COMPLETED` de `GET /api/business/shifts/:id/applications` frente a `requiredWorkers`, y cada cupo trabajado tiene su propio `Payment`. `confirmedWorkers` **no** sirve para esto: cuenta solo las asignaciones `ASSIGNED` y vale `0` una vez que todos los cupos terminaron. Dos consecuencias de la misma regla, además del caso de un cupo resuelto `CANCELLED`: (1) un turno multi-cupo en el que solo se llegó a asignar parte de los cupos y todos los asignados completaron pasa a `COMPLETED` (antes se quedaba `CHECKED_IN` sin salida, porque un turno `CHECKED_IN` ya no admite nuevas aceptaciones); (2) una asignación `NO_SHOW`/`ABANDONED` sin resolver bloquea el cierre aunque su cupo ya se haya cubierto con un reemplazo que completó: el turno queda `CHECKED_IN` hasta que la empresa resuelva esa asignación (antes pasaba a `COMPLETED` en cuanto el reemplazo completaba). **Un cliente que asuma que `status: "COMPLETED"` implica que todos los cupos trabajaron debe corregirse**: es la causa de una regresión real encontrada y corregida en el mismo cierre (`apps/mobile_flutter`, ver más abajo). Antes de esta corrección, un turno multi-cupo con un cupo completado y otro `NO_SHOW`/`ABANDONED` resuelto explícitamente como `CANCELLED` nunca salía de `CHECKED_IN` (el bug raíz); `cancelShift` tampoco tocaba una asignación `NO_SHOW` que hubiera quedado sin resolver, dejándola resoluble -y generando un `Payment`- sobre un turno ya `CANCELLED` (ambos corregidos en el mismo cierre: `deriveShiftStatus` ahora distingue una asignación sin resolver de una ya resuelta a `CANCELLED`, y el `updateMany` de `cancelShift` incluye `NO_SHOW` junto con `ASSIGNED`).

**Interfaz del panel web para `resolve`.** En `Turnos` → `Postulaciones` del panel de la empresa (`apps/web/app/page.tsx`, `AssignmentResolutionPanel`), una postulación cuya asignación está `NO_SHOW` o `ABANDONED` muestra "No se presentó a tiempo" o "Sin salida registrada" y dos acciones, cada una con confirmación explícita antes de llamar a `resolve`: **"Confirmar que sí trabajó"** (`outcome: "COMPLETED"`) y **"Cerrar sin pago"** (`outcome: "CANCELLED"`, con motivo opcional de 3 a 500 caracteres; sin motivo no se envía `reason`). El panel decide por `assignment.status` que ya devuelve `GET /api/business/shifts/:id/applications` (no hizo falta ningún cambio en la API), no por `nextAction`, que en un turno ya `CANCELLED` dice "Proceso cerrado". Tras resolver, vuelve a leer el turno, sus postulaciones y `GET /api/business/payments` sin recargar el panel; la confirmación se mantiene en "Guardando…" hasta que terminan esas lecturas (desde `CN-20260923-008` toda petición del panel de empresa, `request()` de `apps/web/lib/business-api.ts`, se aborta a los 15 s con `ApiError(0, 'REQUEST_TIMEOUT')`, y el estado "ocupado" se libera siempre en un `finally`; una lectura colgada ya no deja la fila fija en "Guardando…", y "Guardando…" se anuncia además en una región `role="status"`). Un sondeo de postulaciones que falla con datos en pantalla los conserva y muestra un aviso `role="alert"`; sin datos previos muestra el estado de error. El sondeo de postulaciones (cada 4 s) se secuencia con `apps/web/lib/request-sequence.ts` para que una respuesta emitida antes del `POST` y entregada después no reponga las acciones de una asignación ya resuelta. También traduce `ASSIGNMENT_NOT_RESOLVABLE`, `ASSIGNMENT_NOT_FOUND`/`SHIFT_NOT_FOUND` y los fallos de red/servidor a avisos en español sin mostrar el código. En un turno multi-cupo cada asignación varada tiene su propio par de acciones; las demás no muestran nada. El copy deja claro que confirmar el trabajo solo registra un pago pendiente que la empresa paga directamente al trabajador: Chambeaya no cobra, guarda ni transfiere dinero. **La app Flutter (lado trabajador) no tiene ni necesita ese control**: `resolve` es una acción de la empresa. Si el turno figura `CANCELLED`, la confirmación de `COMPLETED` lo avisa sin prometer el resultado y explica los casos: un cierre automático por vencer sin asistencia registrada pasa a completado en cuanto ya no queda ningún cupo pendiente de decisión y al menos uno quedó confirmado como trabajado, y uno cancelado por la empresa sigue cancelado; el pago pendiente se registra en todos. La confirmación de "Cerrar sin pago" también lo avisa cuando el turno figura `CANCELLED` (desde `CN-20260923-002`): pasa a completado si, al cerrar esa asignación, ya no queda ningún cupo pendiente de decisión y otro cupo ya quedó confirmado como trabajado; si lo canceló la empresa, sigue cancelado. Con el turno sin cancelar no lleva ese aviso. Límites: el panel solo cubre las asignaciones que la API entrega en `NO_SHOW`/`ABANDONED`: no hay revisión de horas trabajadas ni monto distinto de `payCents` por persona.

### Ventana de tiempo del check-in

`POST /api/shifts/:id/check-in` solo tiene éxito entre 30 minutos antes y 60 minutos después de `Shift.startsAt`, **y nunca después de `Shift.endsAt`**. La ventana es la de **esa asignación** (no la del turno): si la asignación se creó después de `Shift.startsAt` (`ShiftAssignment.assignedAt`), por ejemplo un reemplazo aceptado tras un `NO_SHOW`, o una aceptación tardía con el turno ya en curso, se cierra 60 minutos después de `assignedAt` (constante `LATE_ASSIGNMENT_CHECK_IN_GRACE_MS`) **sin pasar de `Shift.endsAt`**; antes de `CN-20260923-006` esa asignación nueva quedaba `NO_SHOW` al primer toque porque la ventana se medía desde un `startsAt` ya vencido. `assignedAt` lo fija el servidor al aceptar la postulación (con el reloj del proceso de la API, no el de la base) y ningún endpoint lo modifica; como `ShiftAssignment` es única por `(shiftId, workerId)`, un trabajador tampoco puede obtener una asignación nueva en el mismo turno para reiniciar su margen. Una asignación creada antes de `startsAt` conserva exactamente la ventana original. La comparación usa el `startsAt` vigente: si la empresa edita el turno (`PATCH`, solo mientras no esté `CHECKED_IN` ni vencido) y adelanta `startsAt` por debajo de un `assignedAt` ya existente, esa asignación pasa a contarse como tardía (margen de 60 minutos desde `assignedAt`); si lo atrasa, vuelve a la ventana original respecto del nuevo `startsAt`. Al llegar a `endsAt` sin check-in, esa asignación tardía pasa a `NO_SHOW` como cualquier otra (la empresa puede resolverla). Las reglas de abajo se aplican a cada asignación por separado:

- Antes de esa ventana: `409 CHECK_IN_TOO_EARLY`.
- Después de esa ventana: la asignación ya quedó `NO_SHOW` (ver arriba) y el check-in responde `409 ASSIGNMENT_NOT_ACTIONABLE`.
- Si `endsAt` ya pasó pero la asignación todavía no llegó a `NO_SHOW` (turno más corto que la ventana de 60 minutos): `409 SHIFT_UNAVAILABLE`, el mismo guard directo contra `endsAt` que ya existía antes de introducir la ventana de tiempo.

En un turno de menos de 60 minutos de duración, `endsAt` puede pasar antes de que se cumpla la ventana relativa a `startsAt`: el guard directo contra `endsAt` cubre exactamente ese caso, así que un check-in posterior al fin del turno nunca se acepta.

**Turno multi-cupo ya `CHECKED_IN`.** Cada asignación evoluciona por separado: que otro trabajador ya haya hecho check-in (y el turno figure `CHECKED_IN`) no impide que los demás asignados confirmen (`POST /api/shifts/:id/confirm`) ni que hagan su propio check-in dentro de su ventana; el turno se mantiene `CHECKED_IN` hasta que ya no quede ninguna asignación pendiente de decisión (regla de `deriveShiftStatus`, sin cambios). Sí se rechaza, siempre por asignación o por turno terminal: quien no tiene asignación (`404 ASSIGNMENT_NOT_FOUND`), una asignación `CANCELLED`/`COMPLETED` (`404`), `NO_SHOW`/`ABANDONED` (`409 ASSIGNMENT_NOT_ACTIONABLE` en check-in, `404` en confirm) y cualquier turno `COMPLETED`/`CANCELLED`. Limitación vigente: la empresa no puede aceptar a un postulante en un turno `CHECKED_IN` (`400 SHIFT_NOT_ASSIGNABLE`) y ningún trabajador puede postular a él (`POST /api/shifts/:id/applications` solo admite turnos `PUBLISHED`), así que un cupo vacante de un multi-cupo no puede reponerse con un reemplazo mientras el turno siga `CHECKED_IN` (decisión abierta; ver el pendiente 1 del plan maestro).

`POST /api/shifts/:id/check-out` y `POST /api/shifts/:id/check-in` responden `409 ASSIGNMENT_NOT_ACTIONABLE` sobre cualquier asignación que ya haya quedado `NO_SHOW` o `ABANDONED`, en vez de proceder: ninguno de los dos endpoints puede "revivir" una asignación varada, que solo se recupera por el cierre manual (`resolve`, arriba) o por una nueva asignación tras reabrirse el turno.

**Concurrencia del trabajador sobre su propia asignación (`CN-20260923-010`, corregida por `CN-20260923-012`).** `confirm`, `check-in`, `check-out` y `cancel` (`POST /api/shifts/:id/...`) y la persistencia automática del ciclo de vida `NO_SHOW`/`ABANDONED` escriben dentro de una transacción `READ COMMITTED` que **bloquea las filas que van a decidir** (`SELECT ... FOR NO KEY UPDATE`, en este orden: la postulación —solo `cancel`—, la asignación del trabajador y el turno —todas menos `confirm`, que no escribe el turno—) y **recién después las lee y las escribe** (`lockedTransaction` en `apps/api/src/modules/marketplace/marketplace.service.ts`). La lectura previa a la transacción solo sirve para responder rápido y para persistir el ciclo de vida; nunca decide. Dos llamadas sobre la misma asignación (o sobre el mismo turno) se serializan y la que llega segunda relee el estado que dejó la primera; trabajadores en turnos distintos no se esperan. `withSerializableRetry` (`apps/api/src/modules/operations/serializable-retry.ts`, compartido con el módulo de empresa) sigue envolviendo la transacción y reintenta los dos errores con que PostgreSQL la aborta sin aplicar nada: `P2034` (que una transacción `READ COMMITTED` no produce en la práctica) y el interbloqueo `40P01` (ver "Orden de bloqueo global" abajo). El orden de los bloqueos (postulación → asignación → turno) es el mismo que siguen las operaciones de la empresa desde `CN-20260923-014`.

**Orden de bloqueo global e interbloqueos (`CN-20260923-014`, MEDIO-1 de `CN-20260923-013`).** Todas las operaciones que toman filas de `ShiftApplication`, `ShiftAssignment` y `Shift` deben tomarlas como una subsecuencia de este orden: **postulación → asignación → turno**. Dos transacciones que respetan el mismo orden no pueden esperarse en círculo; el defecto de `CN-20260923-013` era que `POST /api/business/shifts/:id/cancel` actualizaba primero las asignaciones y después las postulaciones, mientras `cancel` del trabajador bloquea la postulación y después la asignación: si coincidían sobre el mismo turno, PostgreSQL detectaba un interbloqueo (`40P01`) tras ~1 s y una de las dos respondía `500` (medido en `CN-20260923-013`: 4 de 4 entrelazados forzados; reproducido de nuevo con el código de `CN-20260923-012` en los dos sentidos: con el trabajador ya dueño de su postulación, la empresa respondió `500`; con la empresa ya dueña de su primera tabla, el trabajador respondió `500`). Orden de cada operación tras `CN-20260923-014`:

| Operación | Filas que toma, en orden |
| --- | --- |
| Trabajador: `cancel` | postulación → asignación → turno (bloqueos explícitos `FOR NO KEY UPDATE`) |
| Trabajador: `check-in`, `check-out` y persistencia del ciclo de vida | asignación → turno (bloqueos explícitos) |
| Trabajador: `confirm` | asignación (bloqueo explícito; no escribe el turno) |
| Empresa: `cancelShift` | postulaciones (`updateMany`) → asignaciones (`updateMany`) → turno (`update` final). Antes: asignaciones → postulaciones → turno (causa del defecto) |
| Empresa: aceptar una postulación (`decideShiftApplication`) | postulación (`update`) → asignación (`insert`, fila nueva que nadie más puede tener bloqueada) → turno (`update`). Rechazar: solo la postulación |
| Empresa: `resolveAssignment` | asignación (`update`) → pago (`insert`) → turno (`update`) |
| Empresa: ciclo de vida al abrir un turno (`getShift`, `listShiftApplications`, `resolveAssignment`) | dentro de una transacción `Serializable`: relee el turno (sin bloqueo) y las asignaciones ordenadas por `id`, y escribe asignaciones (por `id`) → turno. La lectura previa a la transacción no escribe nada (`CN-20260923-016`; ver "Ciclo de vida de la empresa" abajo) |
| Empresa: `PATCH`/`DELETE` del turno | solo el turno, en una sentencia: no retiene ninguna otra fila mientras espera |

Por qué **postulación primero** y no la asignación primero (la otra orientación posible): `decideShiftApplication` crea la asignación después de actualizar la postulación, así que con "asignación primero" una cancelación del trabajador sobre una postulación aún `PENDING` bloquearía cero asignaciones, esperaría la postulación, y podría tocar después una asignación recién creada por la empresa; si en ese instante otro `cancelShift` la hubiera bloqueado, el orden quedaba invertido. Con "postulación primero" eso es imposible (nadie crea la asignación sin tener antes la postulación). Reordenar `cancelShift` costó dos líneas y no cambia su semántica (las dos sentencias filtran por su propio estado).

Límites declarados del análisis (cada uno cubierto por el reintento de abajo, no por el orden):

- Dentro de una misma tabla, un `updateMany` de varias filas (`cancelShift`) no fija el orden entre ellas; dos `cancelShift` del mismo turno a la vez pueden en teoría tomarlas en órdenes distintos. En la práctica recorren el mismo orden físico y la segunda espera a la primera, y con `Serializable` la segunda termina en `P2034` (reintentado).
- Los `insert` de `ShiftEvent`, `ShiftCancellation` y `Payment` toman un bloqueo `FOR KEY SHARE` sobre la fila referenciada (turno, asignación); es compatible con `FOR NO KEY UPDATE` y nunca espera a las operaciones de arriba (solo choca con `FOR UPDATE`, que únicamente toma el `DELETE` del turno, y ese solo procede sobre un turno `PUBLISHED` sin postulaciones).
- Un tercero fuera de esta API (una migración, un script) que tome estas filas en otro orden no está cubierto por el orden.

**Reintento de `40P01` como red de seguridad.** `withSerializableRetry` (`apps/api/src/modules/operations/serializable-retry.ts`) reintenta ahora los dos errores con que PostgreSQL aborta una transacción sin haber aplicado nada: `P2034` (fallo de serialización) y el interbloqueo `40P01` en sus formas de Prisma: `P2010` con `meta.code` `40P01` (o `40001`) en una sentencia `$queryRaw` (los bloqueos del trabajador), y el error sin código cuyo mensaje trae `PostgresError { code: "40P01" ... }` en un `updateMany`/`update`/`create` (medido con Prisma 6.12 contra PostgreSQL 16). `isRetryableTransactionError` los clasifica y solo esos: un mensaje que menciona `40P01` de pasada no cuenta. Un reintento por interbloqueo **no es inmediato**: PostgreSQL espera `deadlock_timeout` (1 s por defecto) antes de detectarlo, así que cuesta ~1 s más la espera aleatoria. Si los 6 intentos se agotan, las rutas del trabajador responden `409 CONCURRENT_UPDATE` (ver abajo) y las de empresa `500 INTERNAL_ERROR`; en ambos casos no se aplicó nada y repetir la llamada es seguro.

**Cobertura** (`apps/api/tests/integration/worker-company-lock-order.integration.test.ts`, contra PostgreSQL real; espera a que `pg_stat_activity` informe una sesión bloqueada para decidir cuándo liberar la operación retenida, sin depender del reloj):

- Dos pruebas deterministas fuerzan el cruce `cancel` del trabajador x `cancelShift` de la empresa en los dos sentidos (el trabajador ya tiene su bloqueo de postulación / la empresa ya actualizó su primera tabla) y exigen que las dos respondan sin `500`, con el resultado de una ejecución en serie y sin que ningún servicio vea un `40P01` (prueban el **orden**, no el reintento). Contra el código de `CN-20260923-012` (orden inverso, sin reintento de `40P01`) las dos fallan: `{"worker":200,"company":500}` y `{"company":200,"worker":500}`.
- Dos pruebas fuerzan un interbloqueo real con una transacción de prueba que toma las filas en orden inverso (un tercero que el orden no puede evitar) y exigen que la operación abortada con `40P01` se reintente y responda como una llamada secuencial, una vez con la forma `P2010` (`cancel` del trabajador) y una con la forma sin código (`cancelShift`). Sin el reintento de `40P01` fallan con `500`.
- Una matriz de 16 pruebas lanza a la vez cada operación del trabajador (`confirm`, `check-in`, `check-out`, `cancel`) contra cada operación de la empresa (`decideShiftApplication`, `resolveAssignment`, `cancelShift`, `PATCH` del turno) sobre el mismo turno y exige que ninguna responda `500` ni vea un `40P01` (3 rondas por defecto, `CHAMBEAYA_LOAD_ROUNDS` para más). Es una comprobación de humo: la carrera es aleatoria y un pase no prueba la ausencia de ciclos (con el orden inverso la matriz no detectó el defecto en una corrida de 3 rondas; las pruebas deterministas sí). El análisis de la tabla de arriba es el argumento de que no hay más cruces con orden inverso.
- Robustez de esas pruebas (`CN-20260923-016`, BAJO-2 de `CN-20260923-015`): el margen con que la transacción de prueba entra al ciclo del interbloqueo forzado se **deriva de `SHOW deadlock_timeout`** (un tercio, entre 10 y 300 ms) y ya no es un fijo de 300 ms, así que las dos pruebas de interbloqueo forzado no dan un falso fallo si la base usa un `deadlock_timeout` menor (con el fijo de 300 ms y `deadlock_timeout = 200ms` la víctima pasaba a ser la transacción de prueba y las dos fallaban con "the test transaction must not be the deadlock victim"; con el margen derivado pasan con 100 ms, 200 ms, 500 ms y 1 s). La espera de "sesión bloqueada" solo cuenta las sesiones de la propia prueba (su cliente Prisma lleva un `application_name` propio) y no las de otros clientes de la misma base; una prueba lo fija con dos sesiones ajenas bloqueadas por un bloqueo consultivo. `isDeadlock` de la prueba y `isRetryableTransactionError` dependen del formato de mensaje del motor de Prisma 6 para reconocer `40P01` (el error sin código de `updateMany` solo lo trae en el texto `PostgresError { code: "40P01"`); si Prisma cambia ese formato, los interbloqueos forzados dejan de ver el `40P01` y la empresa vuelve a responder `500` en vez de reintentar. Está dicho también en el encabezado del archivo.
- Con Prisma simulado: `apps/api/tests/serializable-retry.test.ts` (clasificación de las tres formas, reintento y agotamiento) y `apps/api/tests/marketplace.routes.test.ts` (`40P01` agotado responde `409 CONCURRENT_UPDATE` en las 14 rutas).

**Ciclo de vida de la empresa (`resolveShiftAssignmentsLifecycle`, `CN-20260923-016`, BAJO-3 de `CN-20260918-002`).** Abrir un turno en el panel (`GET /api/business/shifts/:id`, `GET .../applications`, y el paso previo de `resolve`) marca `NO_SHOW`/`ABANDONED` las asignaciones vencidas. Antes decidía con una lectura de las asignaciones hecha **fuera** de la transacción y escribía esa decisión sin revalidar (también en cada reintento por `P2034`/`40P01`). Con una cancelación confirmada entre la lectura y la escritura pasaba, contra PostgreSQL real: una asignación `CANCELLED` por el trabajador volvía a `NO_SHOW` (y podía cerrarse con pago con `resolve`), un turno `CANCELLED` por la empresa volvía a `PUBLISHED`, y dos aperturas simultáneas registraban dos veces el evento `SYSTEM` de la misma transición. Ahora la lectura previa solo decide si hay algo que persistir (para no abrir una transacción `Serializable` en cada consulta cuando no hay cambios) y **nunca sirve de base para escribir**: cuando hay algo que persistir, la transacción `Serializable` (con `withSerializableRetry`) relee el turno y las asignaciones (por `id`), recalcula `NO_SHOW`/`ABANDONED` y el estado del turno (`deriveShiftStatus`, sin cambios) sobre esa lectura, y solo escribe lo que sigue vigente; si en ese momento ya no queda nada por cambiar (la asignación se canceló, la transición ya la registró otra apertura), no escribe ni crea eventos y devuelve el turno releído. El orden de bloqueo global no cambia (asignaciones por `id` → turno; el turno se lee sin bloqueo antes de las escrituras). Cubierto por `apps/api/tests/integration/business-lifecycle-revalidation.integration.test.ts` (barrera determinista entre la lectura y la escritura: cancelación del trabajador, cancelación del turno por la empresa, `cancelShift` contra `resolve` como primer toque de una asignación vencida `ASSIGNED` y dos aperturas simultáneas; sin la corrección fallan 4 de 5 pruebas) y por pruebas unitarias en `apps/api/tests/business.service.test.ts` (relectura por intento y sin escritura cuando la relectura ya no ve `ASSIGNED`).

**Tiempos de las pruebas de integración (`CN-20260923-016`, BAJO-1 de `CN-20260923-015`).** `apps/api/vitest.integration.config.mts` fija `testTimeout: 20_000` (antes 60 s global): una prueba colgada falla en ~20 s (medido: `Test timed out in 20000ms`). Las pruebas de carrera o carga con varias rondas, cuya duración depende del número de rondas y de la contención, fijan su propio `timeout` mayor en el archivo (`shift-cancel-resolve-race`, las pruebas `real:` de `worker-assignment-concurrency` y `worker-company-lock-order`: 60 s; `worker-assignment-load` y `business-routes-load`: 300 s). Una prueba nueva de ese tipo debe fijar el suyo.

Historia: `CN-20260923-010` resolvió el doble efecto con una transacción `Serializable` que releía dentro de cada intento; funcionaba con dos contendientes por asignación, pero con **4 o más trabajadores simultáneos** (cada uno sobre su propia asignación) los conflictos de serialización entre operaciones independientes agotaban los 3 reintentos inmediatos y la ráfaga respondía `401 INVALID_SESSION` a casi todos (hallazgo ALTO-1 de `CN-20260923-011`). Con el bloqueo de filas cada llamada abre **una sola transacción** (sin reintentos) y todas responden `200` cuando corresponde. El resultado de dos llamadas simultáneas sobre la misma asignación es el de una ejecución en serie, y la que pierde responde **lo mismo que una llamada secuencial repetida**:

- **Doble check-in:** las dos responden `200` con el mismo `checkedInAt` (el del ganador); hay un solo `ShiftEvent` `CHECKED_IN`.
- **Doble check-out:** una responde `200` y la otra `404 ASSIGNMENT_NOT_FOUND` (la asignación ya es `COMPLETED`); queda un solo `checkedOutAt`/`completedAt`, un solo `CHECKED_OUT`, un solo `COMPLETED` (si cierra el turno) y un solo `Payment` `PENDING`. Antes de `CN-20260923-010` las dos respondían `200` (y, por el código, la segunda sobrescribía `completedAt` y duplicaba los eventos; el pago ya era único por `assignmentId`).
- **Cancelar contra check-in:** un único ganador. Si gana el check-in, `cancel` responde `409 CANCELLATION_NOT_ALLOWED` y la asignación sigue `ASSIGNED` con su `checkedInAt`; si gana la cancelación, el check-in responde `404 ASSIGNMENT_NOT_FOUND` y la asignación queda `CANCELLED` sin `checkedInAt` y con el cupo libre. Antes podía responder `200` las dos y dejar una asignación `CANCELLED` con `checkedInAt`.
- **Cancelar contra confirmar:** si gana la cancelación, `confirm` responde `404` y no escribe `workerConfirmedAt` ni `ASSIGNMENT_CONFIRMED`; si gana la confirmación, ambas responden `200` y el evento de confirmación es anterior al de cancelación. Antes una confirmación podía aplicarse (y registrar su evento) sobre una asignación ya `CANCELLED`.
- **Doble cancelación:** una `200` y la otra `404 ASSIGNMENT_NOT_FOUND`; una sola fila `ShiftCancellation` y un solo evento `CANCELLED`.
- **Varios trabajadores del mismo turno multi-cupo:** el bloqueo del turno serializa la recomputación del agregado, así que `confirmedWorkers` y el estado del turno quedan correctos tras cancelaciones, check-ins o check-outs simultáneos de trabajadores distintos (con el código de `HEAD`, previo a `CN-20260923-010`, cancelaciones simultáneas dejaban `confirmedWorkers` corrupto en 5 de 5 rondas). Un solo `COMPLETED` por turno cuando el último check-out lo cierra.
- **Ciclo de vida:** la persistencia automática de `NO_SHOW`/`ABANDONED` también relee la asignación dentro de su transacción bloqueada y no sobrescribe un estado más reciente (por ejemplo, un `ABANDONED` calculado con una lectura obsoleta ya no pisa una asignación que otro check-out acaba de completar; en ese caso responde `404`).

Los códigos y estados HTTP de los caminos felices y de los errores ya existentes no cambian.

**Errores de las rutas del trabajador (`CN-20260923-012`, MEDIO-1 de `CN-20260923-011`).** `marketplace.routes.ts` traduce los errores así (antes, todo lo que no fuera un `MarketplaceError` respondía `401 INVALID_SESSION`, lo que presentaba un fallo del servidor como una sesión inválida):

- `MarketplaceError`: su propio estado y código (sin cambios).
- `AuthError` (token ausente, desconocido o vencido, de `authService.restore`): `401 INVALID_SESSION`. Es el **único** caso de `401 INVALID_SESSION` en estas rutas.
- Conflicto de serialización (`P2034`) o interbloqueo (`40P01`) que agota los 6 reintentos de `withSerializableRetry`: **`409 CONCURRENT_UPDATE`**, reintentable; la operación no se aplicó y repetirla es seguro (cada operación revalida el estado). Con el bloqueo de filas y el orden global casi nunca se alcanza: solo un interbloqueo repetido con una transacción ajena al orden (ver "Orden de bloqueo global" arriba; cubierto con un interbloqueo forzado que se reintenta y responde `200`, y por las pruebas de ruta que simulan el agotamiento).
- Cualquier otro error inesperado (base de datos caída, fallo de `authService.restore` que no sea `AuthError`, error de programación): `500 INTERNAL_ERROR` y el detalle en el registro del servidor, igual que las rutas de empresa.

Alcance: aplica a todas las rutas de `marketplace.routes.ts` salvo `PUT /api/shifts/:id/accept`, que ya relanzaba los errores inesperados y no se modificó. La app Flutter no cierra la sesión por ninguno de estos códigos (no hay manejo de `401` en el flujo del trabajador): `CONCURRENT_UPDATE` llega como `MarketplaceApiException` y `confirm`/`check-in`/`check-out` muestran "… Inténtalo otra vez." dejando la tarjeta accionable; `cancel` muestra "No pudimos cancelar la postulación." (cubierto por `marketplace_repository_test.dart` y `worker_applications_page_test.dart`).

**Medición de la contención entre trabajadores distintos** (contra `chambeaya_test`, `N` trabajadores lanzando la misma operación a la vez, cada uno sobre su asignación, en turnos distintos y en un mismo turno multi-cupo):

| Operación | `CN-20260923-010` (`Serializable`, 3 intentos inmediatos) | Bloqueo de filas (`CN-20260923-012`) |
| --- | --- | --- |
| check-in, check-out y cancelar, `N=4` (cancelar en el mismo turno: 3 canceladores, sin fallos) | 3 `200` y 1 `401` en cada ronda | `N` `200`, `N` transacciones |
| check-in, check-out y cancelar, `N=10` | 3 `200` y 7 `401` (cancelar en el mismo turno: 3 `200` y 6 `401` de 9) | `N` `200`, `N` transacciones |
| confirmar, `N=10` en el mismo turno | 5 `200` y 5 `401` (la auditoría midió 12 y 21 de 50 fallidas) | `N` `200`, `N` transacciones |
| confirmar, otros casos | `N` `200` | `N` `200` |

Alternativa medida y descartada: mantener `Serializable` y solo añadir espera aleatoria y 6 intentos a `withSerializableRetry`. También llegaba a `200` en todos los casos, pero con 27 a 33 transacciones para 10 llamadas (hasta 3 intentos por llamada), sin garantía de un solo reintento y desperdiciando trabajo; el bloqueo de filas usa exactamente una transacción por llamada. Fijado contra PostgreSQL real por `apps/api/tests/integration/worker-assignment-load.integration.test.ts` (las cuatro operaciones con 4 y 10 trabajadores, turnos distintos y mismo turno; exige `200` en todas, como máximo dos intentos de transacción por llamada y el estado final correcto; 3 rondas por defecto, `CHAMBEAYA_LOAD_ROUNDS` para más) y por `worker-assignment-concurrency.integration.test.ts` (variantes deterministas que retienen las filas bloqueadas con un `Proxy` de Prisma y comprueban que la otra llamada espera y luego responde como una llamada secuencial, y variantes con 8 rondas simultáneas por HTTP). Con Prisma simulado: `apps/api/tests/marketplace.service.test.ts` (orden de los bloqueos y reintento con el estado cambiado entre intentos) y `apps/api/tests/marketplace.routes.test.ts` (mapeo de errores).

**Contención entre operaciones de empresa** (`CN-20260923-012`, garantías reales fijadas en `CN-20260923-014`, MEDIO-2 de `CN-20260923-013`). `decideShiftApplication` (aceptar), `cancelShift` y `resolveAssignment` siguen usando transacciones `Serializable` sin bloqueo de filas: **su éxito bajo una ráfaga es probabilístico y la API no promete `200` en todas las llamadas simultáneas.** Con 3 reintentos inmediatos (`CN-20260923-010`) solo 3 de `N` llamadas respondían `200` y el resto `500` (`N=4`: 3 `200` y 1 `500`; `N=10`: 3 `200` y 7 `500`). `CN-20260923-012` puso en el `withSerializableRetry` compartido **6 intentos con espera aleatoria** (uniforme en `[0, 20 ms · 2^intento)`, espera acumulada máxima de ~1,2 s), que en las mediciones de `N=4` y `N=10` respondió `200` en todas casi siempre, pero no siempre: `CN-20260923-013` observó 1 fallo en 7 corridas completas con `N=10`. Medición de `CN-20260923-014` con `N=20` (una sola empresa, `CHAMBEAYA_LOAD_ROUNDS=3`; aceptar y resolver en turnos distintos y en el mismo turno, `cancelShift` en turnos distintos): 1 o 2 `500` de 20 llamadas en la mayoría de las ráfagas (9, 8 y 12 de las 15 ráfagas de cada una de tres corridas tuvieron al menos un `500`; el resto, `200` en las 20). El `500` es un `P2034` agotado sobre el `insert` de `ShiftEvent` o `ShiftCancellation` (falso positivo de detección de dependencias `Serializable` entre turnos distintos): la transacción se revierte entera y **no deja ningún efecto**, y repetir la llamada responde `200`.

Decisión (MEDIO-2 de `CN-20260923-013`): se **mantiene el diseño** y se cambia la prueba, en lugar de darle a estas rutas el bloqueo de filas del trabajador. Darles bloqueo implicaba reescribir cuatro transacciones de empresa (`decide`, `cancelShift`, `resolveAssignment` y el ciclo de vida) de `Serializable` a `READ COMMITTED` con bloqueos, sustituir las relecturas y la detección de conflictos que varias auditorías validaron (p. ej. `CN-20260920-004` y `CN-20260923-009`) y rehacer sus pruebas unitarias; el beneficio es una garantía sobre un patrón (20 mutaciones simultáneas de una sola empresa) que un flujo real de uso no produce y que además falla de forma segura. Se midió y descartó la hipótesis de que la contención viniera de recorridos secuenciales sobre tablas pequeñas: con `enable_seqscan = off` en la base de pruebas las cifras con `N=20` no bajaron (9 y 10 de 15 ráfagas con al menos un `500` en dos corridas). Si algún día se necesita esa garantía, la vía es el bloqueo de filas con el orden global de arriba, en un alcance aparte.

**Qué exige `business-routes-load` por defecto** (`apps/api/tests/integration/business-routes-load.integration.test.ts`, `N=4` y `N=10`, turnos distintos y mismo turno, 2 rondas por defecto): solo lo que el diseño garantiza siempre, sin importar cuántas llamadas fallen, así que no puede fallar al azar: toda respuesta es `200` o `500 INTERNAL_ERROR`; al menos una llamada gana; **atomicidad** (cada `200` dejó su efecto completo —postulación aceptada + asignación + evento y agregados del turno; asignación `COMPLETED` con un solo `Payment`; turno, asignación y postulación cancelados con una sola cancelación— y cada `500` no dejó ninguno, comprobado en la base fila por fila); y una llamada que respondió `500` se puede repetir y entonces responde `200`. La medición "todas responden `200`" es opt-in: `CHAMBEAYA_LOAD_STRICT=true` (con `CHAMBEAYA_LOAD_WORKERS=4,10,20` para elegir los tamaños de ráfaga) y es informativa, no una garantía; los `500` que aparecen se imprimen. Antes (`CN-20260923-012`) la prueba exigía `200` en todas y falló 1 de 7 corridas completas de `npm run test:integration`. Las operaciones del trabajador, con bloqueo de filas, respondieron `200` en todas las llamadas con `N=20` y `N=40`.

**Sesión vencida con peticiones simultáneas** (BAJO-1 de `CN-20260923-013`). `DatabaseAuthService.restore` (y `setInitialGooglePassword`) borran la sesión vencida con `deleteMany`, idempotente: dos peticiones simultáneas con el mismo token vencido responden las dos `401 INVALID_SESSION` (con `delete`, la segunda fallaba con `P2025` y las rutas del trabajador respondían `500`). Cubierto por `apps/api/tests/integration/expired-session-race.integration.test.ts` (una barrera sobre `authSession.findUnique` obliga a que las dos lean la sesión antes de que cualquiera la borre) y por `apps/api/tests/google_auth.service.test.ts`.

## Marketplace para trabajadores

- `GET /api/shifts`: devuelve los turnos publicados desde PostgreSQL.
- `GET /api/shifts/events`: stream público de Server-Sent Events (SSE).

Cada turno del marketplace (en este endpoint, en el feed SSE y en el `shift` embebido de `GET /api/workers/applications`) incluye `endsAt` (ISO 8601): es el único dato de fecha real que se expone a los clientes -`dateLabel` es solo texto formateado- y la única forma de que un cliente sepa si una asignación aceptada ya venció, dado que no existe transición automática por tiempo. Flutter lo usa para dejar de ofrecer "Confirmar asistencia"/"Confirmar llegada" sobre un turno cuyo `endsAt` ya pasó sin que el trabajador llegara a hacer check-in (una vez hecho el check-in, `checkOut` sigue siendo válido más allá de `endsAt`, hasta 60 minutos después; pasado ese margen la asignación queda `ABANDONED`, ver "Ciclo de vida de una asignación" arriba).
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
- `POST /api/shifts/:id/confirm`: confirma la asignación antes del ingreso. Responde `404 ASSIGNMENT_NOT_FOUND` si la asignación no existe, no está `ASSIGNED`, su turno ya venció (`shift.endsAt` ya pasó) o el turno está `COMPLETED`/`CANCELLED` (evaluado dentro de una transacción con la asignación bloqueada: una cancelación simultánea gana o pierde limpiamente, ver "Concurrencia del trabajador"). No depende de que el turno esté `CHECKED_IN` por otro trabajador: en un multi-cupo el resto de los asignados puede confirmar aunque ya haya un check-in (desde `CN-20260923-006`; antes recibían `404`). `confirm` no resuelve el ciclo de vida: una asignación cuya ventana de check-in ya venció pero todavía figura `ASSIGNED` en la base puede confirmar (`200`); el check-in posterior la marca `NO_SHOW` y responde `409 ASSIGNMENT_NOT_ACTIONABLE`. Confirmar no es prueba de presencia.
- `POST /api/shifts/:id/check-in`: exige confirmación, la credencial temporal vigente y estar dentro de la ventana de tiempo alrededor de `startsAt` o, en una asignación creada después de `startsAt`, de su `assignedAt` (ver "Ventana de tiempo del check-in" arriba: `409 CHECK_IN_TOO_EARLY` antes de que abra, `409 ASSIGNMENT_NOT_ACTIONABLE` si ya quedó `NO_SHOW`). `409 SHIFT_UNAVAILABLE` cubre: la asignación no fue confirmada por el trabajador, el turno está en estado terminal (`COMPLETED`/`CANCELLED`), o `endsAt` ya pasó (guard directo, independiente de la ventana relativa a `startsAt`; cubre los turnos de menos de 60 minutos donde `endsAt` puede vencer antes de que la asignación llegue a `NO_SHOW`). Un check-in repetido (o simultáneo) sobre una asignación que ya tiene `checkedInAt` responde `200` con el `checkedInAt` original y no escribe un segundo evento.
- `POST /api/shifts/:id/check-out`: exige check-in y completa solo la asignación del trabajador. El turno completo pasa a `COMPLETED` cuando ya no queda ninguna asignación `ASSIGNED`, `NO_SHOW` ni `ABANDONED` sin resolver y al menos una completó (ver "Turnos multi-cupo parcialmente cubiertos"). No tiene una ventana de tiempo propia respecto a `startsAt` (sigue siendo válido aunque el turno ya haya pasado su `endsAt` nominal), pero si pasan más de 60 minutos desde `endsAt` sin check-out la asignación queda `ABANDONED` y el check-out responde `409 ASSIGNMENT_NOT_ACTIONABLE`; a partir de ahí solo la empresa puede cerrarla (`POST .../assignments/:assignmentId/resolve`, arriba). Un segundo check-out (repetido o simultáneo) sobre una asignación ya `COMPLETED` responde `404 ASSIGNMENT_NOT_FOUND` y no duplica el `Payment` ni los eventos.
- `POST /api/shifts/:id/cancel`: permite cancelar antes del check-in y conserva motivo, actor y fecha. Corre en una transacción con la postulación, la asignación y el turno bloqueados: contra un check-in simultáneo hay un único ganador (`409 CANCELLATION_NOT_ALLOWED` si el check-in ya se registró) y una segunda cancelación responde `404 ASSIGNMENT_NOT_FOUND`.

La app Flutter (`HttpWorkerMarketplaceRepository`) propaga el código real de `confirm`/`check-in`/`check-out` mediante `MarketplaceApiException` en vez de un error genérico: si el código indica que el turno ya no existe o está disponible (`ASSIGNMENT_NOT_FOUND`, `SHIFT_UNAVAILABLE`, `SHIFT_NOT_FOUND`), la pantalla de postulaciones (`WorkerApplicationsPage`) explica el motivo y recarga de inmediato en vez de dejar un botón que siempre va a fallar.

`CHECK_IN_TOO_EARLY` y `ASSIGNMENT_NOT_ACTIONABLE` tienen manejo propio en `WorkerApplicationsPage._handleActionError` (`worker_secondary_pages.dart`), separado de `MarketplaceApiException.isShiftGone`: `CHECK_IN_TOO_EARLY` explica que la ventana de check-in todavía no abrió y **no** fuerza una recarga (no es un cierre permanente, el trabajador puede reintentar cuando abra); `ASSIGNMENT_NOT_ACTIONABLE` explica que la ventana ya cerró o el turno ya terminó y sí fuerza la recarga inmediata, igual que `isShiftGone`, porque es un cierre permanente para esa asignación.

La empresa recibe el mismo `nextAction` al consultar `/api/business/shifts/:id/applications`, evitando que web y Flutter calculen reglas contradictorias.

El endpoint histórico `PUT /api/shifts/:id/accept` solo se conserva para la demostración en memoria. En modo persistente responde `410 DIRECT_ASSIGNMENT_DISABLED`; toda asignación real debe originarse en una postulación revisada por la empresa.

El stream envía eventos `shifts` con una fotografía completa de las oportunidades vigentes. Flutter mantiene la conexión abierta, actualiza la lista sin recargar y vuelve a conectarse automáticamente si se interrumpe la red.

La reemisión ocurre por dos vías independientes: inmediatamente después de que una empresa publica, edita, cancela o decide una postulación (`onShiftsChanged`), y además cada 60 segundos por defecto (configurable solo para pruebas mediante la opción interna `marketplaceFeedRefreshIntervalMs` de `createApp`), para que un turno que simplemente venció por el paso del tiempo -sin que ninguna empresa haya tocado nada- también se retire del feed de los clientes ya conectados en un plazo acotado.

```text
event: shifts
data: [{"id":"...","role":"Mozo de salón",...}]
```

### Wallet del trabajador (reporte de pagos, no custodia)

- `GET /api/workers/wallet`: combina, solo en memoria y en la respuesta (nunca a nivel de esquema), los `Payment` de las asignaciones del trabajador con sus `WalletMovement` (`marketplace.service.ts#wallet`). Devuelve `{ workerId, balanceCents, pendingBalanceCents, movements }`.
  - `balanceCents` es la suma de los movimientos en estado `RELEASED`: **monto que la empresa ya confirmó como pagado/procesado**, no saldo que Chambeaya custodie o pueda transferir. Chambeaya no administra ni retiene ese dinero; el pago ocurre directamente entre empresa y trabajador, y este número es un registro de ese reporte.
  - `pendingBalanceCents` es la suma de los movimientos en estado `PENDING`: **monto reportado y aún pendiente de que la empresa lo confirme como procesado**, no dinero en tránsito dentro de Chambeaya.
  - `REVERSED` cubre pagos con incidencia (por ejemplo, un `Payment` cancelado) y no suma a ninguno de los dos totales.
  - **`canConfirmReceipt` (Alcance D), solo en los movimientos que vienen de un `Payment`:** booleano derivado por la API, `true` solo si `provider === 'manual'`, `status === 'PROCESSED'` y todavía no se confirmó la recepción (`workerConfirmedAt === null`). **Nunca se expone `provider` en crudo** — este booleano es la única forma en que el trabajador sabe que puede confirmar. La prueba de no fuga (`apps/api/tests/marketplace.no-commission-leak.test.ts`) sigue prohibiendo `commissionBps`/`commissionCents`/`taxBps`/`taxCents`/`totalCents`/`provider`/`needsReview` a cualquier profundidad; `canConfirmReceipt` no está en esa lista porque no revela ninguno de esos valores, solo una condición ya evaluada por el servidor.
- `POST /api/workers/payments/:id/confirm`: el trabajador confirma que recibió un pago ya `PROCESSED` **y `provider: 'manual'`** (Alcance D: la misma condición que deriva `canConfirmReceipt`, para que un pago de pasarela del Alcance E, que se confirma por su propio webhook, nunca sea confirmable por este endpoint); sobre cualquier otro caso responde `409 PAYMENT_NOT_REPORTABLE`. Un pago `legacy` nunca llega aquí de todas formas: no tiene `assignmentId`, así que la búsqueda (filtrada por `assignment: { workerId }`) no lo encuentra. Responde `{ id, description, amountCents, status, reference, dueAt, processedAt, createdAt, workerConfirmedAt, shiftId }`, sin comisión, IGV, total ni `provider`. Es una confirmación de recepción entre las partes, no una liberación de fondos retenidos por Chambeaya.
- En la práctica todos los movimientos provienen hoy de `Payment` (`PROCESSED → RELEASED`, `CANCELLED → REVERSED`, el resto `PENDING`): `recordWalletMovement` escribe `WalletMovement` directamente pero no está expuesto por ninguna ruta.
- **Consumidor Flutter: "Mis pagos" (Alcance D), accesible desde Perfil** (`apps/mobile_flutter/lib/features/marketplace/worker_payments_page.dart`). De solo lectura: muestra el monto del trabajador, la empresa y el turno (la misma cadena `description`, `"${shift.title} · ${company.name}"`), la fecha y el estado -"Pendiente de pago" (`PENDING`), "Pagado" (`PROCESSED` sin confirmar) o "Recepción confirmada" (`receiptConfirmed`)-, derivado siempre de `status`/`receiptConfirmed`, nunca de `provider`. "Confirmar recepción" solo aparece si `canConfirmReceipt`. Antes de este alcance no había ninguna pantalla enrutada que mostrara pagos (la anterior se eliminó como código muerto en `CN-20260918-007`); el repositorio ya traía `walletMovements()`/`confirmPayment()` y el mapeo de estados (`'Liberado'`/`'Pendiente'`/`'Revertido'`) sin ningún consumidor. Los nombres internos que todavía suenan a custodia -el modelo `WalletMovement`, la ruta `/api/workers/wallet`, los estados `RELEASED`/`REVERSED`- se conservaron a propósito: renombrarlos o fusionar las tablas quedó explícitamente fuera de alcance, y esta sección es la mitigación acordada.

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
- `GET /api/workers/me/cv/download`: descarga el PDF del trabajador autenticado (`Content-Disposition: attachment`, `Cache-Control: private, no-store`). Una sesión `BUSINESS` recibe `403`. **Ya no es el único acceso al CV**: la empresa dueña de un turno puede leerlo desde `GET /api/business/shifts/:id/applications/:applicationId/cv` cuando se cumple la regla descrita en "CV de un postulante (lectura de la empresa)".
- `PUT /api/workers/me/photo`: carga o reemplaza una foto privada de perfil JPG, PNG o WebP de hasta 3 MB. Exige `X-File-Name` y devuelve el perfil actualizado.
- `GET /api/workers/me/photo`: devuelve la foto solo al trabajador autenticado, con `Cache-Control: private, no-store`.
- `POST /api/workers/me/profile/highlight`: destaca el perfil propio en la búsqueda de talento (`PROFILE_HIGHLIGHT`, con costo; ver M6).
- `GET /api/specialties`: catálogo activo de especialidades.
- `GET /api/business/talent`: perfiles visibles; acepta `specialtyId`, `district`, `query`, `availableOnly`, `cursor` y `limit`. `district` filtra por coincidencia exacta insensible a mayúsculas; `query` (hasta 100 caracteres) busca coincidencia parcial insensible a mayúsculas en `user.name`, `headline` y `district` a la vez, combinable con el resto de filtros. El orden es: primero los perfiles destacados vigentes (`isHighlighted`, `PROFILE_HIGHLIGHT` de M6) y luego el resto, por `id` ascendente en cada tramo; el `nextCursor` es opaco (tramo, último `id` e instante de la primera página) y la paginación se mantiene estable, sin repetir ni saltar filas, con cualquier combinación de filtros aunque un destacado venza a mitad de la paginación (ver «Destacar el perfil»). No existe índice específico para `query`: con el volumen del piloto el costo de un `contains` insensible sin índice es aceptable; si el catálogo de talento crece, evaluar un índice `pg_trgm` (requiere extensión y migración).
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

**Costo (M4):** crear una invitación cobra `TALENT_INVITE` (`409 INSUFFICIENT_CURRENCY` sin efectos si no alcanza) y se devuelve automáticamente si el trabajador no responde en 72 h.

**Premio (M6):** responder (aceptar o rechazar) una invitación `PENDING` y no vencida otorga al trabajador `INVITATION_RESPONDED`, una vez por invitación, en la misma transacción que la respuesta; una invitación anulada, vencida o ya respondida no paga.

**Duplicados:** no puede existir más de una invitación *activa* (`PENDING` o `ACCEPTED`) para el mismo par empresa/perfil de talento (y turno, si se indicó uno). El intento duplicado responde `409 INVITATION_ALREADY_ACTIVE`, tanto si lo detecta la comprobación previa del servidor como si lo detecta el índice único parcial de la base de datos ante una carrera concurrente; nunca se crea un segundo registro. Tras `DECLINED`, `EXPIRED` o `CANCELLED`, una nueva invitación para el mismo par vuelve a ser posible.

**No enumeración:** invitar a un `workerTalentProfileId` que no existe y a uno que existe pero tiene `isVisible: false` responden exactamente igual, `404 TALENT_PROFILE_NOT_AVAILABLE`, por la misma consulta en el servidor; el cuerpo de la respuesta no permite distinguir ambos casos.

**Aislamiento:** una empresa solo puede listar sus propias invitaciones (nunca las de otra empresa: no existe ninguna ruta para leer o modificar una invitación por id desde una sesión `BUSINESS`). Un trabajador solo puede listar, aceptar o rechazar las invitaciones dirigidas a él: una invitación ajena responde `404 INVITATION_NOT_FOUND`, el mismo código que una invitación inexistente.

**Consentimiento y conversaciones:** crear una invitación **no** abre ninguna conversación por sí sola, la acepte o no el trabajador. Abrir una conversación sigue exigiendo el camino ya existente, `POST /api/business/conversations`, que requiere un `CompanyWorkerContact` de esa misma empresa; esta entrega no crea ni modifica esa ruta ni la enlaza automáticamente con una invitación aceptada. Una invitación aceptada es un registro de consentimiento de contacto, no una apertura de conversación.

Errores propios de estas rutas: `403 BUSINESS_ACCOUNT_REQUIRED` / `403 WORKER_ACCOUNT_REQUIRED` (rol incorrecto), `404 TALENT_PROFILE_NOT_AVAILABLE` (perfil inexistente o no visible), `404 SHIFT_NOT_FOUND` (el turno indicado no existe o no pertenece a la empresa), `409 INVITATION_ALREADY_ACTIVE` (duplicado activo), `404 INVITATION_NOT_FOUND` (invitación inexistente o de otro trabajador/empresa), `409 INVITATION_EXPIRED` (intento de responder una invitación ya vencida), `409 INVITATION_NOT_PENDING` (intento de responder una invitación que ya no está `PENDING`, por ejemplo una segunda respuesta).

## Acceso con Google

- `GET /api/auth/providers`: informa si Google está configurado.
- `POST /api/auth/google`: recibe `{ "idToken": "…" }` y verifica la identidad. Para una cuenta nueva responde `202` con un `profileSetupToken` temporal; el cliente solicita entonces DNI y una contraseña nueva de Chambeaya, y usa `POST /api/auth/google/complete` con `{ "profileSetupToken", "dni", "password" }`. Así el ID token de Google se valida una sola vez. La contraseña de Google nunca se recibe ni se almacena.
- `POST /api/auth/password`: requiere sesión Bearer y permite que una cuenta Google creada antes de este paso defina una vez su contraseña exclusiva de Chambeaya. Recibe `{ "password": "…" }`. La sesión expone `requiresPasswordSetup: true` hasta que lo haga; Flutter bloquea el acceso al panel hasta completar ese paso.

Las cuentas por correo existentes no se fusionan automáticamente con Google. Sin credenciales configuradas, el proveedor responde como no disponible. La recuperación de contraseña por correo verificado sigue sin implementarse.

## Cambiar contraseña

`POST /api/auth/password/change`: requiere sesión Bearer (cualquier rol: `WORKER`, `BUSINESS` o `ADMIN`) y recibe `{ "currentPassword": "…", "newPassword": "…" }`. A diferencia de `POST /api/auth/password` (que solo fija la **primera** contraseña de una cuenta creada con Google, sin pedir ninguna actual), esta ruta cambia la contraseña de una cuenta que **ya tiene** una configurada, verificando la actual con la misma comparación de tiempo constante que usa el login.

- Éxito (`200`): regenera `salt` y `passwordHash`, y en la misma transacción borra todas las demás `AuthSession` del usuario (`tokenHash != <sesión que hizo la petición>`); la sesión que llamó al endpoint sigue siendo válida y el cliente no necesita volver a autenticarse. La respuesta es la sesión pública vigente (mismo formato que `POST /api/auth/login`).
- `401 INVALID_SESSION`: no hay sesión Bearer o ya no es válida (igual criterio que el resto de rutas autenticadas).
- `401 INVALID_CURRENT_PASSWORD`: `currentPassword` no coincide. No se distingue de una cuenta inexistente ni se revela ningún otro dato.
- `400 WEAK_PASSWORD`: `newPassword` no cumple la regla mínima (`isValidPassword`: al menos 8 caracteres, una mayúscula y un número).
- `400 PASSWORD_UNCHANGED`: `newPassword` es igual a `currentPassword`.
- `409 GOOGLE_ONLY_ACCOUNT`: la cuenta todavía no tiene una contraseña local configurada (`localPasswordConfigured: false`); el cliente debe usar `POST /api/auth/password` (primera contraseña) en su lugar (ver nota abajo).
- `409 PASSWORD_CHANGED_CONCURRENTLY`: otra petición cambió la contraseña de esta cuenta entre la verificación de `currentPassword` y la escritura. La actualización está condicionada al `passwordHash` leído (`updateMany` dentro de la misma transacción que borra las sesiones), así que solo gana una y la otra no toca ni la contraseña ni las sesiones. Hay que volver a intentarlo con la contraseña vigente.
- `500 INTERNAL_ERROR`: cualquier otro error (por ejemplo, la base de datos caída). El cuerpo es solo `{ "error": "INTERNAL_ERROR" }` y el detalle queda en el registro del servidor.

Nota: las cuentas Google **nuevas** nunca quedan con `localPasswordConfigured: false`, porque `completeGoogleProfile` exige DNI y contraseña antes de crear la fila `User`. Sí pueden existir cuentas en ese estado: la migración `20260914190000_google_local_password` marcó con `false` las cuentas Google creadas antes de ese paso, y esas cuentas inician sesión con Google (`startGoogleLogin` devuelve la sesión directamente) con `requiresPasswordSetup: true` hasta fijar su primera contraseña. Flutter no muestra el panel (ni la tarjeta "Seguridad") mientras dure ese estado; si alguien llama a esta ruta directamente con esa sesión, la API responde `409 GOOGLE_ONLY_ACCOUNT`.

Riesgo residual conocido: `login()` verifica el hash y crea su `AuthSession` fuera de la transacción del cambio. Un login con la contraseña **anterior** que lea la fila antes del commit del cambio, y que inserte su sesión después del `deleteMany`, conserva esa sesión. Para aprovecharlo, alguien que ya conoce la contraseña anterior tendría que acertar con su login a una ventana de milisegundos que no puede observar, y el limitador por IP frena los intentos. La solución acotada, si hace falta cerrarlo, es crear la sesión del login dentro de una transacción con `SELECT … FOR UPDATE` sobre la fila del usuario que confirme que el `passwordHash` sigue siendo el verificado (ver `CN-20260926-010` en `docs/PROGRESO.md`). El modo `--reset` del CLI de superadmin tiene la misma ventana.

### Límite de intentos

`POST /api/auth/login`, `/register`, `/google`, `/google/complete`, `/password` y `/password/change` comparten un limitador en memoria por IP (`AUTH_RATE_LIMIT_WINDOW_MS`, por defecto 900000 ms; `AUTH_RATE_LIMIT_MAX`, por defecto 20 intentos). Al superar el máximo dentro de la ventana, la API responde `429 AUTH_RATE_LIMITED` con únicamente `{ "error": "AUTH_RATE_LIMITED" }`: nunca indica si el correo existe, cuál fue el error de validación ni ningún otro dato de la cuenta. Otras rutas (`GET /api/auth/session`, `DELETE /api/auth/session`, `GET /api/auth/providers`, y el resto de la API) no están sujetas a este límite.

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
- `GET /api/business/payments/:id`
- `POST /api/business/payments/:id/mark-paid`

**Alcance D (registro confiable y modo manual): el CRUD manual (`POST`/`PATCH`/`DELETE /api/business/payments[/:id]`) se retiró por completo.** Permitía a la empresa inventar pagos, alterar montos y saltarse la comisión de Chambeaya; las tres rutas ya no están registradas (404 genérico de Express, no un `sendError` de esta app). Un `Payment` solo nace automáticamente al completarse una asignación (ver más abajo); el único escritor que le queda a la empresa es `mark-paid`.

Estados: `PENDING`, `SCHEDULED`, `PROCESSED`, `CANCELLED`. `SCHEDULED` es el checkout de pasarela en curso (Alcance E); con `PAYMENT_PROVIDER=manual` (producción hoy, sin proveedor contratado) ningún pago llega a ese estado, porque `checkout` responde `409 PROVIDER_MANUAL` para ese modo.

### `POST /api/business/payments/:id/mark-paid`

Único cambio de estado que le queda a la empresa. Transiciona `PENDING` → `PROCESSED` (con `processedAt`) sobre un pago **de esa empresa** cuyo `provider` sea `'manual'` (nacido de `checkOut`/`resolveAssignment`) o `'legacy'` (creado con el CRUD retirado, o backfill de un pago sin `assignmentId` anterior al Alcance C). También permite resolver un pago `PENDING` o `SCHEDULED` cuyo proveedor ya no sea el activo, por ejemplo un `simulated` al volver a modo `manual`; si tenía un checkout `CREATED`, lo deja `EXPIRED` con `failureReason: 'PROVIDER_DEACTIVATED'` dentro de la misma transacción. Es su salida controlada después de un cambio de configuración. Un pago del proveedor de pasarela que sigue activo solo se confirma mediante su webhook. Nunca toca `amountCents`, `commissionCents`, `taxCents` ni `totalCents`.

- Si el pago tiene `shiftId`, registra un `ShiftEvent` `PAYMENT_REPORTED` (mismo evento que dejaba el CRUD retirado al marcar `PROCESSED`).
- Devuelve el `Payment` actualizado (mismos campos que `GET /api/business/payments/:id`).
- **404 `PAYMENT_NOT_FOUND`**: el pago no existe o es de otra empresa.
- **409 `PAYMENT_NOT_PAYABLE`**: el pago existe pero ya no es marcable — ya está `PROCESSED`/`CANCELLED`, perdió una carrera contra otra llamada concurrente o su `provider` es el proveedor de pasarela **activo** (se confirma solo por su propio webhook, nunca por este endpoint).
- Atómico: un `updateMany` condicionado al estado y al proveedor, dentro de una transacción. Dos llamadas concurrentes sobre el mismo pago dejan un solo `PROCESSED` y un solo `ShiftEvent`; la que pierde la carrera responde `409`. Al resolver un `SCHEDULED` de proveedor inactivo, el mismo bloqueo impide que un webhook tardío procese el intento que acabó de expirar.

### Comisión, IGV y total (Alcance C del plan de pagos)

`amountCents` sigue siendo exactamente el monto que recibe el trabajador (el 100% de lo publicado; nunca se le descuenta nada). Cada `Payment` expone además:

- `commissionBps` / `commissionCents`: la comisión de Chambeaya, en puntos básicos y en céntimos.
- `taxBps` / `taxCents`: el IGV **sobre la comisión** (no sobre `amountCents`), en puntos básicos y en céntimos.
- `totalCents`: `amountCents + commissionCents + taxCents` — lo que paga la empresa. La comisión y el IGV van **encima** del pago al trabajador, nunca descontados de él.
- `provider`: el proveedor de pago **activo** (`PAYMENT_PROVIDER`) en el instante exacto en que el pago nació (`checkOut`/`resolveAssignment`; ver Alcance E abajo), o `'legacy'` para uno creado con el CRUD retirado o para un pago sin `assignmentId` anterior a la migración de comisión (siempre con comisión e IGV en 0). Fijo desde ese momento: cambiar `PAYMENT_PROVIDER` después nunca migra los pagos ya creados.
- `needsReview`: Alcance E. `true` cuando un webhook llega con un monto o moneda que no coincide con el intento, o cuando se recibe una aprobación sobre un pago que ya estaba `PROCESSED` (doble cobro). Un humano debe revisarlo; ningún endpoint lo limpia todavía (fuera de alcance).

Redondeo: enteros, "la mitad hacia arriba" — `commissionCents = floor((amountCents * commissionBps + 5000) / 10000)`, y el mismo cálculo para `taxCents` sobre `commissionCents`. Ejemplo con la comisión inicial (10% + 18% de IGV): un turno de **S/100** por persona da `amountCents: 10000`, `commissionCents: 1000` (S/10), `taxCents: 180` (S/1.80) y `totalCents: 11180` (**S/111.80** que paga la empresa por persona). La implementación de referencia es `apps/api/src/modules/payments/payment-amounts.ts#buildPaymentAmounts`.

Los dos únicos puntos donde nace un `Payment` automático — el check-out del trabajador (`POST /api/shifts/:id/check-out`) y el cierre manual de una asignación `NO_SHOW`/`ABANDONED` (`POST /api/business/shifts/:id/assignments/:assignmentId/resolve` con `outcome: 'COMPLETED'`) — usan `Shift.commissionBps`/`taxBps` (fijados al publicar el turno, ver "Turnos"). Nunca leen el ajuste global: un turno anterior a la migración tiene `0`/`0` y genera pagos sin comisión. Ninguna respuesta de las rutas del trabajador (`/api/workers/*`, `/api/shifts*`, incluido el SSE `/api/shifts/events`) expone `commissionBps`, `commissionCents`, `taxBps`, `taxCents`, `totalCents`, `provider` ni `needsReview`: el trabajador solo ve su propio `amountCents`. La prueba de integración `payment-commission.integration.test.ts` recorre esas respuestas buscando esas claves.

### Asignaciones cerradas sin pago

**Definición (corrección de MEDIO-1 de `CN-20260926-020`):** una asignación "cerrada sin pago" es una que llegó a `NO_SHOW` o `ABANDONED` -el trabajador se presentó (hizo check-in) o no se presentó- y que una decisión de la empresa cerró sin generar `Payment`. Nunca se detecta por texto libre: la versión anterior buscaba un prefijo fijo en `ShiftEvent.detail`, que se podía falsear (un motivo de `cancelShift` que empezara con ese mismo texto sumaba al conteo sin haber cerrado nada) y se podía ocultar (una `NO_SHOW`/`ABANDONED` nunca resuelta, o arrastrada por `cancelShift`, no contaba). Ahora es una señal estructurada en `ShiftAssignment`:

- `closedWithoutPayment Boolean`, `closedWithoutPaymentAt DateTime?`, `closedWithoutPaymentById String?` (migración `20260927005242_assignment_closed_without_payment_signal`).
- Se escriben en los dos únicos caminos que producen este cierre:
  - `POST /api/business/shifts/:id/assignments/:assignmentId/resolve` con `outcome: 'CANCELLED'` sobre una asignación `NO_SHOW`/`ABANDONED`.
  - `POST /api/business/shifts/:id/cancel` (`cancelShift`), cuando arrastra una asignación `NO_SHOW` sin resolver a `CANCELLED` junto con el resto del turno.
- **Nunca** se escriben sobre una asignación `ASSIGNED` simple (nunca llegó a "presentarse o no": cancelar un turno futuro no es evasión de la comisión) ni sobre una ya `COMPLETED`/`CANCELLED`. `cancelShift` nunca puede arrastrar una asignación con `checkedInAt` no nulo -lo bloquea antes, con `409 SHIFT_NOT_CANCELLABLE`-, así que ese camino no existe hoy; si algún día se permitiera, debería marcar la señal igual.
- Nunca se vuelve a `false`: una vez cerrada sin pago, queda así para siempre.
- **`cancelShift` resuelve el ciclo de vida antes de decidir** (corrección de MEDIO-1 nuevo de `CN-20260926-022`): antes, una asignación que ya venció su ventana de check-in pero que nadie había vuelto a tocar seguía `ASSIGNED` en la base (`NO_SHOW`/`ABANDONED` son perezosos), así que `cancelShift` la cancelaba por la vía de `ASSIGNED` -sin la señal-. Ahora llama a la misma resolución de ciclo de vida que ya usan `resolveAssignment` y la lectura de postulaciones (`resolveShiftAssignmentsLifecycle`, en su propia transacción, antes de la transacción de `cancelShift`) para que una `NO_SHOW` vencida se trate como `NO_SHOW` y quede marcada.
- **Revisado, no aplica:** la cancelación del trabajador (`marketplace.service.ts#cancelAssignment`) nunca marca la señal, a propósito (es una decisión del trabajador, no de la empresa, y nunca genera ni evita un `Payment`); la edición del turno (`updateShift`) y el estado "Rescate" (`rescueActive`) no tocan ninguna `ShiftAssignment`; `mark-paid` solo toca `Payment`. Ninguno de los tres puede esconder dinero por esta vía.
- **Sin backfill histórico:** las filas creadas antes de la migración quedan con `closedWithoutPayment: false` y los otros dos campos en `NULL` — no hay forma de derivarlo de manera confiable sin depender del mismo texto libre que se está reemplazando.

`GET /api/admin/commissions` filtra `closedWithoutPayment` por período usando `closedWithoutPaymentAt` (nunca `ShiftEvent.createdAt` ni ningún `detail`), y expone además `pendingResolution` (`NO_SHOW`/`ABANDONED` todavía sin resolver, sin filtro de período) para que dejar una asignación sin resolver no la esconda del reporte.

### Capa de adaptadores, proveedor simulado y webhook (Alcance E del plan de pagos)

Sin proveedor real contratado todavía (Mercado Pago, Culqi, Niubiz o Izipay, sin decidir). Este alcance construye la capa de adaptadores (`apps/api/src/modules/payments/provider.ts`) y un **proveedor simulado** que recorre el flujo completo checkout → proveedor → webhook firmado → pagado, **sin mover dinero real**. El adaptador activo se elige con `PAYMENT_PROVIDER` (`manual` por defecto; ver [Despliegue con Docker](../guides/deployment.md)), siguiendo el mismo patrón de selección por variable de entorno que `google_identity.ts` y `private_document_storage.ts`.

**Supuesto de diseño para un proveedor real (decisión del usuario, todavía sin implementar):** pago dividido (split). El proveedor cobra a la empresa, paga al trabajador y entrega la comisión de Chambeaya en la misma operación; Chambeaya nunca custodia la paga del trabajador. El destino de pago del trabajador y la consulta activa de estado al proveedor quedan fuera de este alcance, exigidos explícitamente al elegir proveedor.

Nuevas tablas: `PaymentAttempt` (`id`, `paymentId`, `provider`, `checkoutId` único, `status` `CREATED`/`APPROVED`/`REJECTED`/`EXPIRED`, `totalCents`, `currency`, `redirectUrl`, `expiresAt`, `failureReason`) y `PaymentProviderEvent` (`id`, `provider`, `eventId`, `attemptId?`, `payload`, `receivedAt`, `@@unique([provider, eventId])`: la defensa contra duplicados).

#### `POST /api/business/payments/:id/checkout` (sesión de empresa)

Solo aplica a un pago **propio**, `PENDING`, cuyo `provider` es el proveedor activo.

- Con el proveedor activo `manual`, o si `payment.provider` no coincide con el proveedor activo: `409 { "error": "PROVIDER_MANUAL" }`.
- Con el pago en cualquier otro estado que no sea `PENDING`/`SCHEDULED` (con un intento vigente): `409 { "error": "PAYMENT_NOT_PAYABLE" }`.
- Éxito: `200 { attemptId, redirectUrl, expiresAt }`.
- **Atómico:** en una transacción, `updateMany` `PENDING`→`SCHEDULED` y creación del `PaymentAttempt` (`expiresAt = ahora + PAYMENT_CHECKOUT_TTL_MINUTES`, 30 por defecto). La llamada a `provider.createCheckout` va **fuera** de esa transacción, con `idempotencyKey = attempt.id`. Si el proveedor falla, el intento queda `REJECTED` (`failureReason: 'PROVIDER_UNAVAILABLE'`), el pago vuelve a `PENDING` y responde `502 { "error": "PROVIDER_UNAVAILABLE" }`.
- **Idempotente:** un doble clic (o varias llamadas concurrentes) sobre el mismo pago `PENDING` deja un único `PaymentAttempt` vigente; todas las llamadas devuelven el mismo `{attemptId, redirectUrl, expiresAt}`. Las llamadas que pierden la carrera del `updateMany` esperan (sondeo acotado, sin cron ni lock) a que la ganadora termine de escribir `redirectUrl`, en vez de responder `409` por haber llegado unos milisegundos antes.
- **Expiración perezosa:** si `expiresAt` de un intento vigente ya pasó, el pago vuelve a `PENDING` (y el intento a `EXPIRED`) al leer (`GET /business/payments[/:id]`) o al reintentar el checkout. No hay ningún cron.

#### `POST /api/payments/webhooks/:provider`

Sin autenticación (el proveedor no tiene ningún token de Chambeaya); montado en `app.ts` **antes** de `express.json()` global, con `express.raw` **solo** sobre esta ruta, para conservar el `rawBody` exacto que la firma necesita. Con rate limit propio (`PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_MS`/`MAX`, 60 s / 60 solicitudes por defecto).

- `404` si `:provider` no es el proveedor activo.
- **Firma:** `HMAC-SHA256` sobre `${timestamp}.${rawBody}` con `PAYMENT_WEBHOOK_SECRET`, en la cabecera `x-payment-signature: t=<epoch_ms>,v1=<hex>`. Comparación con `timingSafeEqual`, tolerancia de 5 minutos. Firma ausente, mal formada, vencida o que no coincide con el `rawBody` (alterado en tránsito): `401 { "error": "INVALID_SIGNATURE" }`. Es el esquema propio de los adaptadores que Chambeaya controla (`simulated`); un proveedor real tendrá el suyo, documentado por ese proveedor.
- **Procesamiento, en una sola transacción** (`payments.service.ts#processProviderEvent`, la MISMA función que usa el checkout simulado):
  1. Inserta `PaymentProviderEvent`. Un duplicado (mismo `provider` + `eventId`, `P2002`) responde `200` sin ningún efecto adicional.
  2. Busca el `PaymentAttempt` por `checkoutId`. Si no existe, el evento igual queda registrado (auditoría) y responde `404 { "error": "ATTEMPT_NOT_FOUND" }`.
  3. Si `amountCents`/`currency` no coinciden con `attempt.totalCents`/`attempt.currency`: `422 { "error": "AMOUNT_MISMATCH" }`, marca `Payment.needsReview = true` y **no** transiciona nada más (el pago nunca pasa a `PROCESSED` por esta vía).
  4. `APPROVED` usa una transición condicional atómica `PENDING`/`SCHEDULED` → `PROCESSED` (incluida una aprobación **tardía** de un intento ya `EXPIRED`, mientras el pago siga sin resolver): solo la llamada que cambia la fila deja el intento `APPROVED`, escribe `processedAt` y crea un `ShiftEvent` `PAYMENT_REPORTED` con actor `SYSTEM` si el pago tiene `shiftId`. Las otras aprobaciones concurrentes no duplican ese evento.
  5. `APPROVED` que no logra esa transición porque el pago ya está `PROCESSED` (**doble cobro**) o `CANCELLED`: marca `needsReview = true`, sin ningún otro efecto. El reembolso queda fuera de alcance (trabajo futuro).
  6. `REJECTED` mueve el pago a `PENDING` solo si sigue `PENDING`/`SCHEDULED` y no existe otro intento `CREATED` más reciente; en ese caso deja el intento `REJECTED` con `failureReason`. Si una aprobación ganó antes o durante la carrera, o si ya hay otro checkout vigente, no toca el intento terminal ni revierte el pago.
- Respuestas: `200` (procesado o duplicado), `401`, `404`, `422`.

#### `GET /api/payments/simulated/:checkoutId`

Solo con proveedor activo `simulated` y sesión BUSINESS. Devuelve únicamente
el resumen del checkout de la empresa dueña: `checkoutId`, estado y vencimiento
del intento, más `payment { id, reference, description, totalCents, currency,
status }`. Una empresa distinta, un identificador inexistente o un proveedor
que no sea `simulated` reciben `404`; la respuesta no revela la existencia de
un checkout ajeno. Un fallo interno se informa como `500`, para que el panel no
lo confunda con un checkout inexistente. La página `/pago-simulado/:checkoutId`
usa esta lectura antes de ofrecer una decisión.

#### `POST /api/payments/simulated/:checkoutId/approve` y `.../reject`

Solo con proveedor activo `simulated` (`404` en cualquier otro modo, incluido `manual`). Exige la sesión BUSINESS **dueña** del pago (`404` para cualquier otra empresa, sin distinguir de "no existe"). Construye y firma un evento con el **mismo formato** que recibiría el webhook (`simulated.provider.ts#buildSimulatedEvent`), lo pasa por `provider.verifyWebhook` (la misma verificación de firma, nunca se salta) y lo procesa con la **misma** `processProviderEvent` que el webhook — sin ningún atajo. `redirectUrl` del checkout simulado apunta a `${PANEL_PUBLIC_URL}/pago-simulado/<checkoutId>` (la página del Alcance F).

La página muestra el total congelado, permite aprobar o rechazar el intento y
vuelve a leer el resumen persistido después de la decisión. No contiene un
atajo de cliente: cada botón llama a uno de estos endpoints y, por tanto,
ejercita la firma y la misma transición que el webhook. Para el simulador, el
`eventId` es determinista por checkout y resultado: repetir el mismo botón en
otra pestaña o tras un reintento es un duplicado inocuo. Un webhook externo con
otro identificador sigue aplicando las defensas de doble cobro descritas arriba.

#### Guardas de arranque (`server.ts`, antes de escuchar en el puerto)

La API se niega a arrancar si:

- `PAYMENT_PROVIDER` tiene un valor desconocido (hoy: distinto de `manual`/`simulated`).
- El proveedor activo no es `manual` y `PAYMENT_WEBHOOK_SECRET` tiene menos de 32 caracteres.
- `NODE_ENV=production`, el proveedor activo es `simulated` y no está `PAYMENT_SIMULATION_ALLOWED=true` explícito.

## Respuestas de error

- `400 INVALID_INPUT`: payload o regla de negocio inválida.
- `401 INVALID_SESSION`: token ausente, inválido o vencido.
- `409 CONCURRENT_UPDATE`: (rutas del trabajador) un conflicto de concurrencia agotó los reintentos y la operación no se aplicó; repetirla es seguro.
- `503 SERIALIZATION_RETRY_EXHAUSTED`: (moneda, puestos, talento y administración) los reintentos de serialización se agotaron; no se aplicó nada, repetir es seguro y se envía `Retry-After`.
- `409 DOCUMENT_CHANGED`: el documento del trabajador cambió desde que el admin lo revisó (verificación de documentos).
- `500 INTERNAL_ERROR`: error inesperado del servidor (también en las rutas del trabajador desde `CN-20260923-012`; antes respondían `401`).
- `403 BUSINESS_ACCOUNT_REQUIRED`: la sesión no corresponde a una empresa.
- `403 ADMIN_ACCOUNT_REQUIRED`: la sesión no corresponde a un administrador (rutas `/api/admin`).
- `403 MESSAGE_NOT_OWNED`: intento de modificar un mensaje del trabajador.
- `404 *_NOT_FOUND`: el recurso no existe o pertenece a otra empresa.
- `409 DUPLICATE_RECORD`: correo, referencia u otro campo único duplicado.
- M6: `400 INVALID_REFERRAL_CODE` (registro con un código de referido inexistente o mal formado; no crea la cuenta), `404 DOCUMENT_NOT_FOUND` (verificar un documento que el trabajador no tiene), `409 PROFILE_NOT_VISIBLE` (destacar un perfil oculto), `404 RESOURCE_NO_LONGER_EXISTS` (una acción de puestos fijos llegó cuando la cuenta o el puesto ya se había borrado).
- `429 AUTH_RATE_LIMITED`: se superó el límite de intentos en una ruta de autenticación (ver "Límite de intentos" arriba).

## CORS

El origen permitido se define en `CORS_ALLOWED_ORIGINS` (lista separada por comas; ver `.env.example` y `.env.production.example`). Fuera de producción, si la variable no está definida se conserva el comportamiento permisivo previo (cualquier origen) para no romper el desarrollo local ni Flutter. En producción, si la variable no está definida, la API bloquea todos los orígenes de navegador (registra un error visible en el log) en lugar de abrir el acceso en silencio.
